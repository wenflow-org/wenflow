/** v4 历史版本保存的 core SSOT 快照解析。 */

import { parseCoreFile, type CoreFile } from './core-file-loader';

export interface CoreSnapshotResolution {
  core: CoreFile | null;
  raw: string | null;
  error?: string;
}

export function resolveCoreSnapshot(metadata: unknown, skillId: string): CoreSnapshotResolution {
  let parsed: any = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return { core: null, raw: null, error: '历史版本 metadata 不是合法 JSON' };
    }
  }
  const raw = parsed?.promptLab?.coreSnapshot;
  if (typeof raw !== 'string' || !raw.trim()) {
    return { core: null, raw: null, error: '历史版本缺少 coreSnapshot；请先执行 prompts:sync 回填' };
  }
  const result = parseCoreFile(`agent_prompts:${skillId}:coreSnapshot`, raw);
  if (!result.core) {
    return { core: null, raw, error: `历史 coreSnapshot 不合法：${result.diagnostics.map((d) => d.message).join('；')}` };
  }
  if (result.core.skillId !== skillId) {
    return { core: null, raw, error: `历史 coreSnapshot skillId=${result.core.skillId} 与目标 ${skillId} 不一致` };
  }
  return { core: result.core, raw };
}

export interface DeveloperApproval {
  reference: string;
}

/** 结构变更必须引用已完成消费者同步的开发提交或变更单。 */
export function normalizeDeveloperApproval(value: unknown): DeveloperApproval | null {
  if (!value || typeof value !== 'object') return null;
  const reference = typeof (value as any).reference === 'string'
    ? (value as any).reference.trim()
    : '';
  return reference ? { reference: reference.slice(0, 200) } : null;
}
