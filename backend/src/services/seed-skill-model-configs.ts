/**
 * Skill 模型配置 Seed（代码 truth → DB，只补行为差异）
 *
 * 代码内只固化「思考 = disabled」这类行为差异，**不再写模型**。
 * 2026-10-24 用户拍板：默认不物化成覆盖——模型留空 = 继承平台默认，平台默认换了全体跟随；
 * 此前写死的 model 让 18 个技能看起来像被手工配置过（实际是 seed/脚本钉住的），
 * 覆盖矩阵也无法区分「继承」与「有人选的」。
 * 策略：seed-if-empty —— 每个 skillId 若 DB 无对应行才插入，已有行不动（admin 可手动调整）。
 * 运行时机：purgeRetiredSkills() 之后、initializeGateway() 之前（2026-09-05 纳入启动流）。
 *
 * 维护规则：新增/删除 mainline skill 或调整 thinking 档时修改本表，不需要改逻辑。
 * skillId 必须与 prompts/skills.yaml 对齐。
 */

import { logger } from '../utils/logger';

interface SkillModelSeedEntry {
  skillId: string;
  /** 空串 = 继承平台默认模型（2026-10-24 起所有条目都为空，保留字段只为兼容旧表结构） */
  model: string;
  thinkingMode: 'disabled' | 'default'; // disabled: 思考档关；default: 跟随上游
}

/**
 * 「行为差异」定稿（2026-09-05 双模型×流式实测结论）
 *
 * thinkingMode 全 disabled：实测思考档是纯负担（TTFT 30-120s / 524 限流 / 输出更短）。
 * 模型一律留空：2026-09 的 flash/pro 分工与 09-15 的 agnes 切换都已失效，
 * 要换模型应在「Skill 运行时」里显式选择（覆盖矩阵会标成「技能覆盖」）。
 *
 * - aux/handler-only skill 不在此表（未在此配置即沿用平台默认）
 */
export const SKILL_MODEL_SEED: SkillModelSeedEntry[] = [
  { skillId: 'path-planning',                    model: '', thinkingMode: 'disabled' },
  { skillId: 'kc-mapper',                        model: '', thinkingMode: 'disabled' },
  { skillId: 'path-reviewer',                    model: '', thinkingMode: 'disabled' },
  { skillId: 'stage-designer',                   model: '', thinkingMode: 'disabled' },
  { skillId: 'lesson-knowledge-enricher',        model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-persona-designer', model: '', thinkingMode: 'disabled' },
  { skillId: 'teaching-turn',                    model: '', thinkingMode: 'disabled' },
  { skillId: 'goal-conversation',                model: '', thinkingMode: 'disabled' },
  { skillId: 'teaching-opening-generator',       model: '', thinkingMode: 'disabled' },
  { skillId: 'peer-reinforcement',               model: '', thinkingMode: 'disabled' },
  { skillId: 'adaptive-guidance-copy',           model: '', thinkingMode: 'disabled' },
  { skillId: 'session-wrapup',                   model: '', thinkingMode: 'disabled' },
  { skillId: 'learning-predictor',               model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-goal-dialogue-simulator',    model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-learn-turn-simulator',       model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-memory-curator',             model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-path-evaluator',             model: '', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-scenario-designer',          model: '', thinkingMode: 'disabled' },

  // semantic-freeze-judge（守门 skill，必须关闭思考，实测中强制 disabled）
  { skillId: 'semantic-freeze-judge',            model: '', thinkingMode: 'disabled' },
];

/**
 * 平台级默认思考配置（平台 defaultThinkingMode 为 'default' 时，未显式配置的 skill 会走上游预思考——
 * 已在 2026-09-05 实测证明为纯负担。改为 'disabled' 作为平台代码 truth。）
 */
export const PLATFORM_DEFAULT_THINKING: { thinkingMode: string; reasoningEffort: string } = {
  thinkingMode: 'disabled',
  reasoningEffort: 'default',
};

/**
 * 启动时 seed-if-empty：DB 无该 skillId 行才插入，已有行跳过（admin 可手动调整）。
 * 平台 level 也只在值仍为 'default' 时才升级为 'disabled'（不覆盖 admin 已改的值）。
 */
export async function seedSkillModelConfigsIfEmpty(
  systemPrisma: any,
): Promise<{ seeded: number; platformUpdated: boolean }> {
  let seeded = 0;

  for (const entry of SKILL_MODEL_SEED) {
    const existing = await systemPrisma.skill_model_configs.findUnique({
      where: { skillId: entry.skillId },
      select: { skillId: true },
    }).catch(() => null);

    if (existing) continue; // 已有行 → 跳过（admin 手动配置优先）

    try {
      const id = `seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await systemPrisma.skill_model_configs.create({
        data: {
          id,
          skillId: entry.skillId,
          enabled: true,
          tier: 'chat',
          model: entry.model || null,
          thinkingMode: entry.thinkingMode,
          reasoningEffort: 'default',
          temperature: 0.7,
          maxTokens: 2000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      seeded++;
    } catch (err) {
      logger.warn('[seed-skill-model] insert failed', {
        skillId: entry.skillId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 平台级 defaultThinkingMode：从 'default' 升级为 'disabled'（不覆盖 admin 已改的值）
  let platformUpdated = false;
  try {
    const platform = await systemPrisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
      select: { defaultThinkingMode: true },
    });
    if (platform && platform.defaultThinkingMode === 'default') {
      await systemPrisma.platform_api_configs.update({
        where: { id: 'platform' },
        data: {
          defaultThinkingMode: PLATFORM_DEFAULT_THINKING.thinkingMode,
          defaultReasoningEffort: PLATFORM_DEFAULT_THINKING.reasoningEffort,
          updatedAt: new Date(),
        },
      });
      platformUpdated = true;
      seeded += 1; // 归入"seeded"统计
    }
  } catch (err) {
    logger.warn('[seed-skill-model] platform update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (seeded > 0) {
    logger.info('✅ Skill 模型配置 seed 完成（代码 truth → DB，已有行跳过）', {
      skillSeeded: seeded - (platformUpdated ? 1 : 0),
      platformThinkingDisabled: platformUpdated,
    });
  }

  return { seeded, platformUpdated };
}
