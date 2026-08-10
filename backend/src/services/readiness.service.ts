import { decryptSecret } from '../utils/secret-crypto';
import { FIELD_ROUTING_SEED_MANIFEST, detectFieldRoutingDrift } from './field-routing-bootstrap.service';
import { checkSkillsReadiness } from './skills-readiness.service';
import { logger } from '../utils/logger';

export interface ReadinessResult {
  ready: boolean;
  checks: {
    mainDatabase: 'ok' | 'failed';
    systemDatabase: 'ok' | 'failed';
    corePrompts: 'ok' | 'failed';
    aiConfiguration: 'ok' | 'failed';
    fieldRouting: 'ok' | 'failed';
    gatewayRegistry: 'ok' | 'failed';
  };
}

interface MainDatabase {
  users: { findFirst(args: any): Promise<unknown> };
  learning_paths: { findFirst(args: any): Promise<unknown> };
  domain_event_outbox: { findFirst(args: any): Promise<unknown> };
}

interface SystemDatabase {
  platform_api_configs: { findFirst(args: any): Promise<any> };
  agent_prompts: { findMany(args: any): Promise<Array<{ agentId: string }>> };
  agent_contracts: { count(args: any): Promise<number>; findMany(args?: any): Promise<Array<Record<string, any>>> };
  field_definitions: { count(args: any): Promise<number>; findMany(args?: any): Promise<Array<Record<string, any>>> };
  agent_field_routings: { count(args: any): Promise<number>; findMany(args?: any): Promise<Array<Record<string, any>>> };
  agent_registrations: { count(): Promise<number> };
  skill_registrations: { count(): Promise<number> };
}

const CRITICAL_PROMPT_IDS = [
  'skill:goal-conversation',
  'skill:path-planning',
  'skill:stage-designer',
  'skill:teaching-turn',
  'skill:session-wrapup'
] as const;

export class ReadinessService {
  constructor(
    private readonly mainDatabase: MainDatabase,
    private readonly systemDatabase: SystemDatabase,
    private readonly timeoutMs = 2000,
    private readonly isDraining: () => boolean = () => false
  ) {}

  async check(): Promise<ReadinessResult> {
    const checks: ReadinessResult['checks'] = {
      mainDatabase: 'failed',
      systemDatabase: 'failed',
      corePrompts: 'failed',
      aiConfiguration: 'failed',
      fieldRouting: 'failed',
      gatewayRegistry: 'failed'
    };

    if (this.isDraining()) return { ready: false, checks };

    await this.withTimeout(Promise.all([
      this.checkMainDatabase(checks),
      this.checkSystemDatabase(checks)
    ])).catch(() => undefined);

    return {
      ready: Object.values(checks).every(value => value === 'ok'),
      checks
    };
  }

  private async checkMainDatabase(checks: ReadinessResult['checks']) {
    try {
      await Promise.all([
        this.mainDatabase.users.findFirst({ select: { id: true } }),
        this.mainDatabase.learning_paths.findFirst({ select: { id: true } }),
        this.mainDatabase.domain_event_outbox.findFirst({ select: { id: true } })
      ]);
      checks.mainDatabase = 'ok';
    } catch {
      checks.mainDatabase = 'failed';
    }
  }

  private async checkSystemDatabase(checks: ReadinessResult['checks']) {
    try {
      const [activePrompts, contractCount, fieldCount, routingCount, agentCount, skillCount, platformConfig] = await Promise.all([
        this.systemDatabase.agent_prompts.findMany({
          where: {
            agentId: { in: [...CRITICAL_PROMPT_IDS] },
            status: 'ACTIVE'
          },
          select: { agentId: true }
        }),
        this.systemDatabase.agent_contracts.count({
          where: { agentId: { in: FIELD_ROUTING_SEED_MANIFEST.contractAgentIds } }
        }),
        this.systemDatabase.field_definitions.count({
          where: { fieldId: { in: FIELD_ROUTING_SEED_MANIFEST.fieldIds } }
        }),
        this.systemDatabase.agent_field_routings.count({
          where: { OR: FIELD_ROUTING_SEED_MANIFEST.routings }
        }),
        this.systemDatabase.agent_registrations.count(),
        this.systemDatabase.skill_registrations.count(),
        this.systemDatabase.platform_api_configs.findFirst({
          where: { id: 'platform' },
          select: { apiUrl: true, apiKey: true, defaultModel: true }
        })
      ]);
      checks.systemDatabase = 'ok';
      const activePromptIds = new Set(activePrompts.map(prompt => prompt.agentId));
      checks.corePrompts = CRITICAL_PROMPT_IDS.every(agentId => activePromptIds.has(agentId)) ? 'ok' : 'failed';
      checks.aiConfiguration = this.hasValidAIConfiguration(platformConfig) ? 'ok' : 'failed';
      checks.fieldRouting = contractCount === FIELD_ROUTING_SEED_MANIFEST.contractAgentIds.length
        && fieldCount === FIELD_ROUTING_SEED_MANIFEST.fieldIds.length
        && routingCount === FIELD_ROUTING_SEED_MANIFEST.routings.length
        ? 'ok' : 'failed';
      checks.gatewayRegistry = agentCount > 0 && skillCount > 0 ? 'ok' : 'failed';

      // 声明漂移检测：编排文件声明 vs DB 行内容 diff（只读，warn 不阻断）
      // bootstrap 的 upsert(update:{}) 只建不更新，seed 改动后旧行不会自动同步——
      // 此检测让"声明一套、库里另一套"的漂移在启动时可见
      this.detectFieldRoutingDriftWarnings().catch(() => undefined);

      // W1-W5 技能完成度诊断（warn 级，不阻断就绪判定；60s 缓存防 /readyz 轮询反复 fs 扫描）
      this.runSkillReadinessWarnings().catch(() => undefined);
    } catch {
      checks.systemDatabase = 'failed';
    }
  }

  private async detectFieldRoutingDriftWarnings(): Promise<void> {
    try {
      const report = await detectFieldRoutingDrift(this.systemDatabase);
      if (report.driftCount > 0) {
        logger.warn(`[readiness] 字段路由声明漂移 ${report.driftCount} 项（编排文件声明与 DB 不一致，admin 编辑行已豁免）`, {
          items: report.items.slice(0, 20).map((item) => ({
            kind: item.kind,
            key: item.key,
            field: item.field,
            seed: item.seedValue,
            db: item.dbValue,
          })),
        });
      }
    } catch (error) {
      logger.debug('[readiness] 字段路由漂移检测失败（不影响就绪判定）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runSkillReadinessWarnings(): Promise<void> {
    try {
      const report = await checkSkillsReadiness(this.systemDatabase as unknown as Parameters<typeof checkSkillsReadiness>[0]);
      const items = [
        ...report.checks.W1.items,
        ...report.checks.W2.items,
        ...report.checks.W3.items,
        ...report.checks.W4.items,
      ];
      if (items.length > 0) {
        logger.warn(`[readiness] 技能完成度诊断 ${items.length} 项（W1..W5，不阻断就绪判定）`, {
          items: items.map((item) => ({
            code: item.code,
            skillId: item.skillId,
            message: item.message,
            hint: item.hint,
          })),
        });
      } else {
        logger.info('[readiness] 技能完成度诊断通过（W1..W5 无告警）');
      }
    } catch (error) {
      logger.debug('[readiness] 技能完成度诊断失败（不影响就绪判定）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private hasValidAIConfiguration(config: any): boolean {
    const endpoint = String(config?.apiUrl || process.env.AI_API_URL || '').trim();
    let apiKey = '';
    try {
      apiKey = String(
        decryptSecret(config?.apiKey, 'system.platform_api_configs.apiKey')
        || process.env.AI_API_KEY
        || ''
      ).trim();
    } catch {
      return false;
    }
    const model = String(config?.defaultModel || process.env.AI_MODEL || '').trim();
    if (!endpoint || !apiKey || !model) return false;

    try {
      const url = new URL(endpoint);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('readiness timeout')), this.timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
