/**
 * Skill 模型配置 Seed（File-as-Truth）
 *
 * 代码内固化「flash/pro 分工 + thinking=disabled」作为新库默认配置。
 * 策略：seed-if-empty —— 每个 skillId 若 DB 无对应行才插入，已有行不动（admin 可手动调整）。
 * 运行时机：purgeRetiredSkills() 之后、initializeGateway() 之前（2026-09-05 纳入启动流）。
 *
 * 维护规则：新增/删除 mainline skill 或调整 pro/flash 分工时，修改 SKILL_MODEL_SEED 一表即可，
 * 不需要改逻辑。skillId 必须与 prompts/skills.yaml 对齐。
 */

import { logger } from '../utils/logger';

interface SkillModelSeedEntry {
  skillId: string;
  model: string;          // 显式模型，与 DB 一致；空串 = 平台默认（当前不用于 mainline）
  thinkingMode: 'disabled' | 'default'; // disabled: 思考档关；default: 跟随上游（仅 aux/handler）
}

/**
 * 「flash/pro 分工 + disabled」实测定稿（2026-09-05 双模型×流式实测结论）
 *
 * 分工原则：
 *   判断/后台设计类 → deepseek-v4-pro（输出更丰富）
 *   实时对话/高频/短输出 → deepseek-v4-flash（TTFT 更快）
 *   全部 thinkingMode=disabled（实测思考档在两个模型上均为纯负担：TTFT 30-120s/524 限流/输出更短）
 *
 * - aux/handler-only skill 不在此表（未在此配置即沿用平台默认，见 runSeedIfEmpty）
 * - 虚拟学习者 5 个 skill 继承 flash + disabled（未在此显式配置）
 */
export const SKILL_MODEL_SEED: SkillModelSeedEntry[] = [
  // ===== pro 组（后台设计/判断/评审/教学质量关键，低频或质量优先）=====
  { skillId: 'path-planning',                    model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  { skillId: 'kc-mapper',                        model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  { skillId: 'path-reviewer',                    model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  { skillId: 'stage-designer',                   model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  { skillId: 'lesson-knowledge-enricher',        model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-persona-designer', model: 'deepseek-v4-pro', thinkingMode: 'disabled' },
  // teaching-turn：2026-09-05 质量对照实测（虚拟学习者数据）——pro-disabled 追问为开放建构式
  // （认知层 analyze/理解度 0.92），flash-disabled 为验证式（understand）；实时代价仅 5.9→10.8s 可接受
  { skillId: 'teaching-turn',                    model: 'deepseek-v4-pro', thinkingMode: 'disabled' },

  // ===== flash 组（实时对话/高频/短输出）=====
  { skillId: 'goal-conversation',                model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'teaching-opening-generator',       model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'peer-reinforcement',               model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'adaptive-guidance-copy',           model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'session-wrapup',                   model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'learning-predictor',               model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-goal-dialogue-simulator',    model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-learn-turn-simulator',       model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-memory-curator',             model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-path-evaluator',             model: 'deepseek-v4-flash', thinkingMode: 'disabled' },
  { skillId: 'virtual-learner-scenario-designer',          model: 'deepseek-v4-flash', thinkingMode: 'disabled' },

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
