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
 *
 * 2026-11-02（#177）新增：平台默认模型目录归一化。平台 defaultModel 若指向 llm-providers.json
 * 注册目录外的模型（如历史遗留的评测专用 id），运行时无可用渠道、请求直接 transport 失败，
 * 且未配模型的 skill 会静默继承它（六个 skill 曾长期只产出规则兜底）。启动期按 File-as-Truth
 * 归一化回目录声明默认并告警——消除故障本身，而不只是留痕。只在值确实解析不到目录时改写。
 */

import { logger } from '../utils/logger';
import { getModelDefaults, getProviderCatalog, resolvesToRegisteredModel } from '../config/models.config';

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

  // #177：平台默认模型目录归一化（消除 transport 失败通路，见文件头注释）
  await normalizePlatformModelDefaults(systemPrisma);

  if (seeded > 0) {
    logger.info('✅ Skill 模型配置 seed 完成（代码 truth → DB，已有行跳过）', {
      skillSeeded: seeded - (platformUpdated ? 1 : 0),
      platformThinkingDisabled: platformUpdated,
    });
  }

  return { seeded, platformUpdated };
}

/** 解析 platform_api_configs 的别名覆盖 JSON（chatModels/reasoningModels/lightModels）。坏值视为未声明。 */
function parseAliasMembers(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

/**
 * 目录内首个可用模型（优先 tier 命中，否则退回第一个）——文件 `defaults` 自身也可能被手改到
 * 目录外（`parseLlmProvidersConfig` 只校验结构、不校验 defaults 是否注册），归一化目标必须是
 * 目录内模型，否则会把 DB 默认改成一个同样无可用渠道的 id。
 */
function firstRegisteredModelId(tier: 'chat' | 'reasoning'): string | null {
  const models = getProviderCatalog().filter((p) => p.enabled).flatMap((p) => p.models);
  return (models.find((m) => m.tier === tier) ?? models[0])?.id ?? null;
}

/**
 * #177：平台三个默认模型字段（chat/reasoning/evaluation）必须能解析到 llm-providers.json 注册目录。
 * 解析不到（值非空、且不是已注册别名/裸 id/限定式引用）时按 File-as-Truth 归一化回目录声明的
 * 默认（{chat, reasoning}）并告警——这是消除故障本身（否则这些模型会被当作字面 id 发给上游，
 * 无可用渠道 → transport 失败 → skill 静默规则兜底）。空值不算漂移（交给 env/下游兜底）。
 * 只改「确实解析不到目录」的字段，不覆盖合法配置。
 *
 * 运行期同样会调用本函数：目录热重载（手改 llm-providers.json、供应商删/停用）后由
 * api-gateway 在解析前重跑，见 router.ts resolve()。
 */
export async function normalizePlatformModelDefaults(systemPrisma: any): Promise<number> {
  try {
    const platform = await systemPrisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
      select: {
        defaultModel: true,
        defaultReasoningModel: true,
        defaultEvaluationModel: true,
        chatModels: true,
        reasoningModels: true,
        lightModels: true,
      },
    });
    if (!platform) return 0;

    const overrides = {
      chat: parseAliasMembers(platform.chatModels),
      reasoning: parseAliasMembers(platform.reasoningModels),
      light: parseAliasMembers(platform.lightModels),
    };
    const { chat, reasoning } = getModelDefaults();
    const chatTarget = resolvesToRegisteredModel(chat, overrides)
      ? chat
      : (firstRegisteredModelId('chat') ?? chat);
    const reasoningTarget = resolvesToRegisteredModel(reasoning, overrides)
      ? reasoning
      : (firstRegisteredModelId('reasoning') ?? chatTarget);

    // #177：env 兜底（DB 未配默认时的最后来源）指向目录外时启动期告警；运行期由 api-gateway
    // 护栏兜住（目录外 env 值不生效，回落文件默认，见 router.guardEnvFallbackModel）。
    for (const [envKey, tier] of [['AI_MODEL', 'chat'], ['AI_MODEL_REASONING', 'reasoning']] as const) {
      const value = String(process.env[envKey] || '').trim();
      if (value && !resolvesToRegisteredModel(value, overrides)) {
        logger.warn('[seed-skill-model] env 默认模型不在已注册目录（运行期会回落文件默认）', {
          envKey,
          value,
          tier,
        });
      }
    }

    const fixes: Record<string, string> = {};
    if (!resolvesToRegisteredModel(platform.defaultModel, overrides)) fixes.defaultModel = chatTarget;
    if (!resolvesToRegisteredModel(platform.defaultReasoningModel, overrides)) fixes.defaultReasoningModel = reasoningTarget;
    if (!resolvesToRegisteredModel(platform.defaultEvaluationModel, overrides)) fixes.defaultEvaluationModel = chatTarget;
    if (!Object.keys(fixes).length) return 0;

    await systemPrisma.platform_api_configs.update({
      where: { id: 'platform' },
      data: { ...fixes, updatedAt: new Date() },
    });
    logger.warn('[seed-skill-model] 平台默认模型指向注册目录外，已按 llm-providers.json 声明默认归一化', {
      before: {
        defaultModel: platform.defaultModel,
        defaultReasoningModel: platform.defaultReasoningModel,
        defaultEvaluationModel: platform.defaultEvaluationModel,
      },
      after: fixes,
    });
    return Object.keys(fixes).length;
  } catch (err) {
    logger.warn('[seed-skill-model] 平台默认模型归一化失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
