/**
 * 幂等维护脚本：清理 `agent_prompts.model` 上已废弃的「模型绑定副本」。
 *
 * 背景（见 doc/MODEL_GATEWAY_DESIGN.md §4.9）：
 * - 提示词工件**不承载模型绑定**，模型只来自路由层/runtime（runtimeOverride > route > codeDefaults）。
 * - `agent_prompts.model` 是历史 seed 写入的副本，运行时仅作最后兜底；`route` 恒有值，
 *   因此它实际不会被采用，反而会让「改平台默认模型对已 seed 的 skill 不生效」（2026-09：30/30 ACTIVE 带副本）。
 * - seed / 发布路径已停止写入（写 null），但历史 ACTIVE 行仍残留副本，需要一次性清理。
 *
 * 本脚本只做一件事：
 *   UPDATE agent_prompts SET model = NULL WHERE status='ACTIVE' AND model IS NOT NULL
 * 不改动其它任何字段；可重复执行（第二次运行应报告 0 行待清理）。
 *
 * 用法（默认 dry-run，只打印不写库；加 --apply 才真正写库）：
 *   npx ts-node --transpile-only src/scripts/clear-deprecated-prompt-model.ts
 *   npx ts-node --transpile-only src/scripts/clear-deprecated-prompt-model.ts --apply
 *
 * 注意：这是共享 System 库，--apply 前请先备份 prisma/system.db。
 */
import 'dotenv/config';
import systemPrisma from '../config/system-database';

/** 待清理行的最小字段集 */
export interface PromptModelRow {
  agentId: string;
  version: number;
  status: string;
  model: string | null;
}

export interface ClearPromptModelArgs {
  /** true = 真正写库；false = dry-run（默认） */
  apply: boolean;
}

export interface ClearPromptModelResult {
  apply: boolean;
  /** 清理前 ACTIVE prompt 总数 */
  activeTotalBefore: number;
  /** 清理前 ACTIVE 且 model 非空的行数 */
  withModelBefore: number;
  /** 待清理行按旧 model 值分组的分布 */
  distribution: Record<string, number>;
  /** 待清理样例（agentId/version/旧值），最多 10 条 */
  sample: Array<{ agentId: string; version: number; model: string }>;
  /** 实际更新的行数（dry-run 恒为 0） */
  updated: number;
  /** 清理后 ACTIVE prompt 总数（应保持不变） */
  activeTotalAfter: number;
  /** 清理后 ACTIVE 且 model 非空的行数（目标为 0） */
  withModelAfter: number;
  /** skill_model_configs.model 非空行数（清理前，用于确认未被触碰） */
  skillModelRowsBefore: number;
  /** skill_model_configs.model 非空行数（清理后，应与 before 相等） */
  skillModelRowsAfter: number;
}

/** 仅需的 DB 访问面（可注入，便于单测） */
export interface PromptModelDatabase {
  agent_prompts: {
    findMany: (args: unknown) => Promise<PromptModelRow[]>;
    count: (args: unknown) => Promise<number>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  skill_model_configs: {
    count: (args: unknown) => Promise<number>;
  };
}

export function parseClearPromptModelArgs(argv: string[]): ClearPromptModelArgs {
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else throw new Error(`未知参数：${arg}（支持 --apply / --dry-run）`);
  }
  return { apply };
}

/** 纯函数：判定某行是否为「已废弃的 model 副本」（ACTIVE 且 model 非空） */
export function isDeprecatedPromptModelRow(
  row: Pick<PromptModelRow, 'status' | 'model'>
): boolean {
  return row.status === 'ACTIVE' && row.model !== null && row.model !== undefined;
}

/** 纯函数：从给定行集中筛出需要清理的行（判定口径的唯一来源） */
export function collectDeprecatedPromptModelRows(rows: PromptModelRow[]): PromptModelRow[] {
  return rows.filter(isDeprecatedPromptModelRow);
}

/** 纯函数：按旧 model 值分组计数 */
export function groupModelDistribution(rows: PromptModelRow[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const row of rows) {
    const key = row.model ?? '<null>';
    distribution[key] = (distribution[key] ?? 0) + 1;
  }
  return distribution;
}

const RETRYABLE_DB_ERROR = /database is locked|disk I\/O error|SQLITE_BUSY|SQLITE_IOERR/i;

/** 纯函数：SQLite 瞬时错误是否可重试 */
export function isRetryableDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_DB_ERROR.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带退避重试的 DB 操作，缓解 SQLite 偶发 disk I/O error / database is locked */
export async function withDbRetry<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = 4
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableDbError(error)) throw error;
      const delayMs = 100 * 2 ** (attempt - 1);
      console.warn(`[clear-prompt-model] ${label} 第 ${attempt} 次失败（${(error as Error).message}），${delayMs}ms 后重试`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** 清理已废弃的 prompt model 副本；dry-run 只统计不写库。 */
export async function clearDeprecatedPromptModel(
  args: ClearPromptModelArgs,
  database: PromptModelDatabase = systemPrisma as unknown as PromptModelDatabase
): Promise<ClearPromptModelResult> {
  const activeWhere = { status: 'ACTIVE' };

  const allRows = await withDbRetry('读取 agent_prompts', () =>
    database.agent_prompts.findMany({
      select: { agentId: true, version: true, status: true, model: true },
      orderBy: [{ agentId: 'asc' }, { version: 'asc' }],
    })
  );
  const toClear = collectDeprecatedPromptModelRows(allRows);
  const activeTotalBefore = allRows.filter((row) => row.status === 'ACTIVE').length;
  const withModelBefore = toClear.length;
  const distribution = groupModelDistribution(toClear);
  const sample = toClear.slice(0, 10).map((row) => ({
    agentId: row.agentId,
    version: row.version,
    model: row.model as string,
  }));

  const skillModelRowsBefore = await withDbRetry('读取 skill_model_configs', () =>
    database.skill_model_configs.count({ where: { NOT: { model: null } } })
  );

  let updated = 0;
  if (args.apply && withModelBefore > 0) {
    // 唯一允许的写操作：等价于 UPDATE ... SET model=NULL WHERE status='ACTIVE' AND model IS NOT NULL
    const result = await withDbRetry('清理 agent_prompts.model', () =>
      database.agent_prompts.updateMany({
        where: { status: 'ACTIVE', NOT: { model: null } },
        data: { model: null },
      })
    );
    updated = result.count;
    if (updated !== withModelBefore) {
      console.warn(`[clear-prompt-model] 预估 ${withModelBefore} 行，实际更新 ${updated} 行（并发变化）`);
    }
  }

  const activeTotalAfter = await withDbRetry('复核 ACTIVE 总数', () =>
    database.agent_prompts.count({ where: activeWhere })
  );
  const withModelAfter = await withDbRetry('复核待清理数', () =>
    database.agent_prompts.count({ where: { status: 'ACTIVE', NOT: { model: null } } })
  );
  const skillModelRowsAfter = await withDbRetry('复核 skill_model_configs', () =>
    database.skill_model_configs.count({ where: { NOT: { model: null } } })
  );

  return {
    apply: args.apply,
    activeTotalBefore,
    withModelBefore,
    distribution,
    sample,
    updated,
    activeTotalAfter,
    withModelAfter,
    skillModelRowsBefore,
    skillModelRowsAfter,
  };
}

async function main(): Promise<void> {
  const args = parseClearPromptModelArgs(process.argv.slice(2));
  const result = await clearDeprecatedPromptModel(args);

  console.log(
    `[clear-prompt-model] mode=${result.apply ? 'apply' : 'dry-run'}` +
    `${result.apply ? '' : '（只统计不写库；加 --apply 执行清理）'}`
  );
  console.log(`[clear-prompt-model] before：ACTIVE 总数=${result.activeTotalBefore} 带 model 副本=${result.withModelBefore}`);
  console.log(`[clear-prompt-model] 待清理按旧值分布：`);
  console.log(JSON.stringify(result.distribution, null, 2));
  if (result.sample.length > 0) {
    console.log(`[clear-prompt-model] 样例（最多 10 条）：`);
    for (const row of result.sample) {
      console.log(`  ${row.agentId} v${row.version} ← ${row.model}`);
    }
  }
  console.log(
    `[clear-prompt-model] after：ACTIVE 总数=${result.activeTotalAfter} 带 model 副本=${result.withModelAfter} 更新=${result.updated}`
  );
  console.log(
    `[clear-prompt-model] skill_model_configs.model 非空：before=${result.skillModelRowsBefore} after=${result.skillModelRowsAfter}` +
    `${result.skillModelRowsBefore === result.skillModelRowsAfter ? '（未触碰）' : '（⚠ 发生变化！）'}`
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await systemPrisma.$disconnect();
    });
}
