import { createHash } from 'crypto';
import systemPrisma from '../config/system-database';
import { getAPIGateway, APIExecutor, type CallerInfo, type ResolvedRoute } from '../gateway/api-gateway';
import { logger } from '../utils/logger';
import { getRuntimeCapabilityProbeInterval } from './capability-probe-settings.service';

export type AICapabilityStatus = 'operational' | 'degraded' | 'unavailable' | 'unknown';

export interface AICapabilityHealth {
  id: string;
  status: AICapabilityStatus;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  latencyMs: number | null;
  failureCode: string | null;
  retryable: boolean;
  message: string;
}

export interface AICapabilitySnapshot {
  overall: AICapabilityStatus;
  checkedAt: string | null;
  stale: boolean;
  capabilities: AICapabilityHealth[];
}

const CAPABILITIES: Array<{ id: string; caller: CallerInfo }> = [
  { id: 'goal-conversation', caller: { agentId: 'goal-agent', skillId: 'goal-conversation' } },
  { id: 'path-planning', caller: { agentId: 'path-agent', skillId: 'path-planning' } },
  { id: 'stage-designer', caller: { agentId: 'path-agent', skillId: 'stage-designer' } },
  { id: 'teaching-turn', caller: { agentId: 'teaching-agent', skillId: 'teaching-turn' } },
  { id: 'session-wrapup', caller: { agentId: 'teaching-agent', skillId: 'session-wrapup' } }
];

const STALE_AFTER_MS = 5 * 60_000;
const DEGRADED_LATENCY_MS = 8_000;

function initialHealth(id: string): AICapabilityHealth {
  return {
    id,
    status: 'unknown',
    checkedAt: null,
    lastSuccessAt: null,
    latencyMs: null,
    failureCode: null,
    retryable: true,
    message: '能力状态正在确认'
  };
}

function routeFingerprint(route: ResolvedRoute): string {
  return createHash('sha256')
    .update(JSON.stringify({
      providerId: route.providerId,
      endpoint: route.endpoint,
      model: route.model,
      privateNetworkPolicy: route.privateNetworkPolicy,
      credential: createHash('sha256').update(route.apiKey || '').digest('hex')
    }))
    .digest('hex');
}

function classifyFailure(error: unknown): { code: string; retryable: boolean; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('model is not configured')
    || normalized.includes('model 未配置')
    || normalized.includes('route configuration is incomplete')
  ) {
    return { code: 'CONFIG_MISSING', retryable: false, message: '模型配置不完整' };
  }
  if (normalized.includes('quota') || normalized.includes('balance') || normalized.includes('余额') || normalized.includes('402')) {
    return { code: 'QUOTA_EXHAUSTED', retryable: false, message: '模型服务额度不足' };
  }
  if (normalized.includes('api key') || normalized.includes('401') || normalized.includes('403')) {
    return { code: 'AUTH_INVALID', retryable: false, message: '模型服务认证失败' };
  }
  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return { code: 'RATE_LIMITED', retryable: true, message: '模型服务请求受限' };
  }
  if (normalized.includes('timeout') || normalized.includes('超时')) {
    return { code: 'UPSTREAM_TIMEOUT', retryable: true, message: '模型服务响应超时' };
  }
  return { code: 'UPSTREAM_UNAVAILABLE', retryable: true, message: '模型服务暂时不可用' };
}

export class AICapabilityHealthService {
  private health = new Map(CAPABILITIES.map(item => [item.id, initialHealth(item.id)]));
  private streaks = new Map(CAPABILITIES.map(item => [item.id, { successes: 0, failures: 0 }]));
  private timer: NodeJS.Timeout | null = null;
  private refreshInFlight: Promise<AICapabilitySnapshot> | null = null;
  /** 默认关闭；启动时由 platform_settings 覆盖 */
  private enabled = false;
  private intervalMs = 120_000;

  /** 当前探测开关状态（仅读取，不触发 IO） */
  isEnabled(): boolean {
    return this.enabled;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * 在运行时切换探测开关。开启时若此前未启动定时器则启动；
   * 关闭时立即清除定时器并等待在途探测完成，从而停止后续周期性 LLM 请求。
   * 调用前应先持久化到 platform_settings，本方法只负责内存态与定时器联动。
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (enabled) {
      await this.start();
    } else {
      await this.stop();
    }
  }

  /** 热更新探测间隔；若定时器已在跑则按新间隔重启 */
  async setIntervalMs(intervalMs: number): Promise<void> {
    this.intervalMs = intervalMs;
    if (this.enabled && this.timer) {
      await this.stop();
      await this.start();
    }
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    if (this.timer) return;
    try {
      this.intervalMs = await getRuntimeCapabilityProbeInterval();
    } catch {
      // 保留内存中的 intervalMs
    }
    this.timer = setInterval(() => {
      void this.refresh().catch(error => {
        logger.warn('[ai-capability] 定时探测失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshInFlight;
  }

  getSnapshot(): AICapabilitySnapshot {
    const capabilities = CAPABILITIES.map(item => ({ ...this.health.get(item.id)! }));
    const checkedTimes = capabilities
      .map(item => item.checkedAt ? new Date(item.checkedAt).getTime() : 0)
      .filter(Boolean);
    const latestCheckedAt = checkedTimes.length > 0 ? Math.max(...checkedTimes) : 0;
    const stale = latestCheckedAt === 0 || Date.now() - latestCheckedAt > STALE_AFTER_MS;
    const statuses = capabilities.map(item => item.status);
    const overall: AICapabilityStatus = statuses.includes('unavailable')
      ? 'unavailable'
      : statuses.includes('unknown') || stale
        ? 'unknown'
        : statuses.includes('degraded')
          ? 'degraded'
          : 'operational';

    return {
      overall,
      checkedAt: latestCheckedAt ? new Date(latestCheckedAt).toISOString() : null,
      stale,
      capabilities
    };
  }

  isCapabilityAvailable(capabilityId: string): boolean {
    const capability = this.health.get(capabilityId);
    if (!capability?.checkedAt) return false;
    if (Date.now() - new Date(capability.checkedAt).getTime() > STALE_AFTER_MS) return false;
    return capability.status === 'operational' || capability.status === 'degraded';
  }

  /**
   * 仅在「明确探测到不可用」时视为阻断；未探测（探活关闭）或数据过期不拦截，
   * 避免探活未开启时误伤注册等健康门控。
   */
  isCapabilityBlocked(capabilityId: string): boolean {
    const capability = this.health.get(capabilityId);
    if (!capability) return false;
    if (capability.status !== 'unavailable') return false;
    if (!capability.checkedAt) return false;
    if (Date.now() - new Date(capability.checkedAt).getTime() > STALE_AFTER_MS) return false;
    return true;
  }

  refresh(): Promise<AICapabilitySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = this.performRefresh().finally(() => {
      if (this.refreshInFlight === run) this.refreshInFlight = null;
    });
    this.refreshInFlight = run;
    return run;
  }

  private async performRefresh(): Promise<AICapabilitySnapshot> {
    const gateway = getAPIGateway();
    const executor = new APIExecutor();
    const checkedAt = new Date();
    const resolved: Array<{ id: string; route: ResolvedRoute }> = [];

    await Promise.all(CAPABILITIES.map(async capability => {
      try {
        const route = await gateway.resolveRoute(capability.caller);
        if (!route.endpoint || !route.apiKey || !route.model) {
          throw new Error('AI route configuration is incomplete');
        }
        resolved.push({ id: capability.id, route });
      } catch (error) {
        this.setFailure(capability.id, checkedAt, error);
      }
    }));

    const routeGroups = new Map<string, { route: ResolvedRoute; ids: string[] }>();
    for (const item of resolved) {
      const fingerprint = routeFingerprint(item.route);
      const group = routeGroups.get(fingerprint) || { route: item.route, ids: [] };
      group.ids.push(item.id);
      routeGroups.set(fingerprint, group);
    }

    await Promise.all(Array.from(routeGroups.values()).map(async group => {
      const startedAt = Date.now();
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 10_000);
      timer.unref?.();
      try {
        await executor.execute({
          ...group.route,
          timeoutMs: Math.min(group.route.timeoutMs || 10_000, 10_000),
          thinkingMode: 'disabled',
        }, {
          messages: [
            { role: 'system', content: '这是连通性检查。请只回复 OK。' },
            { role: 'user', content: 'OK' }
          ],
          max_tokens: 64,
          temperature: 0
        }, {
          sourceEntry: 'system-canary',
          callerAgent: 'system-canary',
          userRole: 'tester',
          abortSignal: controller.signal
        });
        const latencyMs = Date.now() - startedAt;
        for (const id of group.ids) this.setSuccess(id, checkedAt, latencyMs);
      } catch (error) {
        const failure = timedOut ? new Error('AI capability probe timeout') : error;
        for (const id of group.ids) this.setFailure(id, checkedAt, failure);
      } finally {
        clearTimeout(timer);
      }
    }));

    const snapshot = this.getSnapshot();
    await systemPrisma.platform_api_configs.updateMany({
      where: { id: 'platform' },
      data: {
        connectionStatus: snapshot.overall === 'operational' || snapshot.overall === 'degraded'
          ? 'connected'
          : snapshot.overall === 'unavailable'
            ? 'failed'
            : 'unknown',
        lastCheckedAt: checkedAt
      }
    }).catch(error => {
      logger.warn('[ai-capability] 连接状态写回失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return snapshot;
  }

  private setSuccess(id: string, checkedAt: Date, latencyMs: number): void {
    const previous = this.health.get(id) || initialHealth(id);
    const streak = this.streaks.get(id) || { successes: 0, failures: 0 };
    streak.successes += 1;
    streak.failures = 0;
    this.streaks.set(id, streak);

    const recovering = previous.status === 'unavailable' && streak.successes < 2;
    const slow = latencyMs >= DEGRADED_LATENCY_MS;
    this.health.set(id, {
      id,
      status: recovering ? 'unavailable' : slow ? 'degraded' : 'operational',
      checkedAt: checkedAt.toISOString(),
      lastSuccessAt: checkedAt.toISOString(),
      latencyMs,
      failureCode: recovering ? previous.failureCode : null,
      retryable: true,
      message: recovering ? '服务正在恢复，等待再次确认' : slow ? '服务可用，但响应较慢' : '服务正常'
    });
  }

  private setFailure(id: string, checkedAt: Date, error: unknown): void {
    const previous = this.health.get(id) || initialHealth(id);
    const streak = this.streaks.get(id) || { successes: 0, failures: 0 };
    streak.failures += 1;
    streak.successes = 0;
    this.streaks.set(id, streak);

    const classified = classifyFailure(error);
    const unavailable = previous.status === 'unavailable' || streak.failures >= 2;
    const status: AICapabilityStatus = unavailable
      ? 'unavailable'
      : previous.status === 'operational' || previous.status === 'degraded'
        ? 'degraded'
        : 'unknown';
    this.health.set(id, {
      id,
      status,
      checkedAt: checkedAt.toISOString(),
      lastSuccessAt: previous.lastSuccessAt,
      latencyMs: null,
      failureCode: classified.code,
      retryable: classified.retryable,
      message: unavailable
        ? classified.message
        : status === 'degraded'
          ? '服务探测偶发失败，继续观察'
          : '能力状态正在确认'
    });
  }
}

export const aiCapabilityHealthService = new AICapabilityHealthService();
