/**
 * 数据库 seed / 引导装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：核心 Prompt 同步（File-as-Truth）、阶段字段路由 seed、初始管理员、
 * 内置预制虚拟学习者、skill model config seed-if-empty。
 * 全部幂等；除注明外失败即阻断启动（由 index 的 assertActive 串联节奏）。
 */
import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { ensureCoreAgentPrompts } from '../scripts/seed-core-agent-prompts';
import { initializeAdmin } from '../services/auth/init-admin.service';
import { ensureBuiltinVirtualLearners } from '../virtual-lab/builtin-learners';
import { bootstrapFieldRoutings } from '../services/field-routing-bootstrap.service';
import { seedSkillModelConfigsIfEmpty } from '../services/seed-skill-model-configs';

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
 * 幂等（按 presetKey upsert，保留运行时产物）；失败不阻断启动。
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
