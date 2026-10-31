/**
 * 数据库 seed / 引导装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：核心 Prompt 同步（File-as-Truth）、阶段字段路由 seed、初始管理员、
 * 内置预制虚拟学习者、skill model config seed-if-empty、学习者卡库默认卡播种。
 * 全部幂等；除注明外失败即阻断启动（由 index 的 assertActive 串联节奏）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { ensureCoreAgentPrompts } from '../services/prompt-manifest/seed-core-agent-prompts';
import { initializeAdmin } from '../services/auth/init-admin.service';
import { ensureBuiltinVirtualLearners } from '../virtual-lab/builtin-learners';
import { bootstrapFieldRoutings, reconcileStaleFieldDefinitions } from '../services/field-routing-bootstrap.service';
import { seedSkillModelConfigsIfEmpty } from '../services/seed-skill-model-configs';
import { importCards } from '../services/virtual-lab/card-import.service';

/** 启动仍应继续时返回；进入 draining 时抛错终止后续步骤 */
export type AssertActive = () => void;

export async function runPromptFileSeed(assertActive: AssertActive): Promise<void> {
  const promptBootstrap = await ensureCoreAgentPrompts(systemPrisma, 'sync');
  assertActive();
  logger.info('核心 Prompt 文件同步完成（File-as-Truth）', {
    mode: promptBootstrap.mode,
    performed: promptBootstrap.performed,
    reason: promptBootstrap.reason,
    createdCount: promptBootstrap.created?.length || 0,
    updatedCount: promptBootstrap.updated?.length || 0,
    skippedCount: promptBootstrap.skipped?.length || 0,
    missingBeforeCount: promptBootstrap.missingBefore?.length || 0,
    created: promptBootstrap.created,
    updated: promptBootstrap.updated || [],
  });
}

export async function runFieldRoutingSeed(assertActive: AssertActive): Promise<void> {
  const fieldRoutingBootstrap = await bootstrapFieldRoutings({ database: systemPrisma });
  assertActive();
  logger.info('阶段字段路由 seed 完成（V3 §3）', fieldRoutingBootstrap);
  // 字段换阶段/删除后的旧 (stage, fieldId) 行对账清理（#125）；admin 覆盖行不动
  const reconciled = await reconcileStaleFieldDefinitions(systemPrisma);
  assertActive();
  if (reconciled.deleted > 0) {
    logger.warn('字段定义对账：清理编排声明外的残留行', reconciled);
  }
}

export async function runAdminSeed(assertActive: AssertActive): Promise<void> {
  // 初始化管理员账户
  const adminBootstrap = await initializeAdmin();
  assertActive();
  if (adminBootstrap.status === 'created') {
    logger.info('✅ 初始管理员创建成功', {
      adminId: adminBootstrap.adminId,
      name: adminBootstrap.name,
      email: adminBootstrap.email
    });
  } else if (adminBootstrap.status === 'existing') {
    logger.info('✅ 管理员账户已存在，跳过创建', { adminId: adminBootstrap.adminId });
  } else {
    logger.warn('未创建初始管理员：未配置 INIT_ADMIN_PASSWORD');
  }
}

/**
 * 内置预制虚拟学习者同步（File-as-Truth：virtual-learners/presets.yaml → DB 实例）
 * 幂等（按 presetKey upsert，保留运行时产物）。
 * ⚠ 2026-10-09 起不再随启动执行（架构改版：卡库选角，空白项目零 VL 起步）——
 * 本函数保留为显式入口（工具/脚本按需调用），开机自跑已从 index.ts 摘除。
 */
export async function runBuiltinVirtualLearnersSeed(assertActive: AssertActive): Promise<void> {
  try {
    const builtinLearners = await ensureBuiltinVirtualLearners(prisma);
    assertActive();
    logger.info('内置预制虚拟学习者同步完成', {
      version: builtinLearners.version,
      created: builtinLearners.created.length,
      updated: builtinLearners.updated.length,
      skipped: builtinLearners.skipped.length,
      drifted: builtinLearners.drifted.length,
      versionAhead: builtinLearners.versionAhead.length,
      errors: builtinLearners.errors.length,
    });
  } catch (err) {
    logger.warn('[startup] 内置预制虚拟学习者同步失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Seed-if-empty：新库自动写入 flash/pro 分工 + thinking=disabled（代码 truth；已有行跳过，admin 可改） */
export async function runSkillModelConfigSeed(): Promise<void> {
  await seedSkillModelConfigsIfEmpty(systemPrisma).catch((err) => {
    logger.warn('[startup] skill model config seed 失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** 默认卡库文件（仓库分发，File-as-Truth；镜像 runtime 层同样 COPY 该目录） */
const LEARNER_CARDS_FILE = path.resolve(__dirname, '../../../virtual-learners/cards/virtual-learners-200.json');

/** runLearnerCardsSeed 的可注入面（单测用；缺省即真实实现） */
export interface LearnerCardsSeedDeps {
  countCards?: () => Promise<number>;
  importCardsFn?: (content: string) => Promise<{
    parseError: string | null;
    results: Array<{ cardKey: string | null; action: string; reason?: string }>;
    summary: { total: number; created: number; updated: number; skipped: number; failed: number };
  }>;
  readFile?: (file: string) => string;
  cardsFile?: string;
}

/**
 * 学习者卡库默认卡播种（2026-10-29 用户拍板：新部署开箱即有 200 张默认金标/边界卡）。
 *
 * - 仅当卡库为空（virtual_learner_profiles 零行）时播种：已有库一律不动——部署方
 *   删掉的卡不会被重启复活，手工导入/ curated 过的库不会被覆盖。
 * - 幂等：importCards 按 cardKey 去重，走与手工导入完全相同的服务路径
 *   （enrich=false，零 LLM 调用；一张卡=一份纯档案+故事池，不建账号——2026-10-29 拍板）。
 * - 卡库选角原则不变（2026-10-09）：播种的是「卡」，不产生任何 VL 实例。
 * - 可用 WENFLOW_SEED_LEARNER_CARDS=false 显式关闭；文件缺失（精简部署）不阻断启动。
 * - 失败不阻断启动（与内置预制同步同款 best-effort）。注意：若批次中部分卡失败，
 *   库已非空，重启不会自动补齐——失败清单会写进日志，由部署方按日志手工补导。
 */
export async function runLearnerCardsSeed(
  assertActive: AssertActive,
  deps: LearnerCardsSeedDeps = {},
): Promise<void> {
  if (String(process.env.WENFLOW_SEED_LEARNER_CARDS ?? '').toLowerCase() === 'false') {
    logger.info('[startup] 学习者卡库默认卡播种已按 WENFLOW_SEED_LEARNER_CARDS=false 关闭');
    return;
  }
  const cardsFile = deps.cardsFile ?? LEARNER_CARDS_FILE;
  const countCards = deps.countCards ?? (() => prisma.virtual_learner_profiles.count());
  try {
    const existing = await countCards();
    assertActive();
    if (existing > 0) {
      logger.info('[startup] 卡库非空，跳过默认卡播种', { existingCards: existing });
      return;
    }
    let content: string;
    try {
      content = deps.readFile ? deps.readFile(cardsFile) : readFileSync(cardsFile, 'utf8');
    } catch {
      logger.warn('[startup] 未找到默认卡库文件，跳过播种（精简部署不含卡文件属预期）', {
        file: cardsFile,
      });
      return;
    }
    assertActive();
    const report = deps.importCardsFn
      ? await deps.importCardsFn(content)
      : await importCards(content, 'json', { enrich: false, update: false });
    assertActive();
    if (report.parseError) {
      logger.warn('[startup] 默认卡库文件解析失败（不阻断启动）', {
        file: cardsFile,
        parseError: report.parseError,
      });
      return;
    }
    const failures = report.results.filter((r) => r.action === 'failed');
    logger.info('[startup] 学习者卡库默认卡播种完成', {
      file: cardsFile,
      created: report.summary.created,
      skipped: report.summary.skipped,
      updated: report.summary.updated,
      failed: report.summary.failed,
      failureSamples: failures.slice(0, 5).map((f) => ({ cardKey: f.cardKey, reason: f.reason })),
      restartWillNotReseed: failures.length > 0 ? '库已非空，重启不会自动补齐缺失卡，请按 failureSamples 手工补导' : undefined,
    });
  } catch (err) {
    logger.warn('[startup] 学习者卡库默认卡播种失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
