/**
 * start-session 的自动驾驶档位解析与启动（2026-10-26 抽自路由）。
 *
 * 档位口径：'final'（默认，建会话 + 立刻开跑）| 'off'（只建会话，goal 由 /step 人工驱动）。
 * 评测/批量场景只需路径就绪，不需要 autopilot 随后自动「上课」烧模型额度。
 * 抽成纯函数便于路由文件守住分层棘轮（>1000 行只许缩短）。
 */
import { logger } from '../utils/logger';
import { autopilotService } from './autopilot.service';

export type SessionAutopilotResult = 'started' | 'queued' | 'failed' | 'off';

export function parseSessionAutopilotOption(value: unknown): { skip: boolean; error: string | null } {
  if (value === undefined || value === 'final') return { skip: false, error: null };
  if (value === 'off') return { skip: true, error: null };
  return { skip: false, error: "autopilot 只支持 'off' | 'final'" };
}

export async function startSessionAutopilot(sessionId: string, skip: boolean): Promise<SessionAutopilotResult> {
  if (skip) return 'off';
  try {
    const started = await autopilotService.start(sessionId, { target: 'final' });
    return started.queued ? 'queued' : 'started';
  } catch (error) {
    logger.warn('会话已创建，但自动驾驶启动失败', { sessionId, error: (error as Error)?.message });
    return 'failed';
  }
}
