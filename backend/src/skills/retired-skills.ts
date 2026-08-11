/**
 * 退役 Skill 名单单源（SSOT）。
 *
 * 定位：全仓唯一维护"退役 skill 名单"的文件。index.ts 启动 purge 与
 * cleanup-retired-field-data.ts 手动脚本均 import 本文件派生；禁止任何其他文件
 * 再定义同类名单（否则双名单漂移回归，漂移过程见 doc/RETIRED_SKILLS_FIX_PLAN.md）。
 *
 * 两常量语义：
 * - PURGED_SKILLS：启动 purge 语义——曾经注册过、启动时必须清残留的 skill
 *   （skill_registrations / skill_model_configs / user_skill_configs /
 *   agent_prompts / agent_field_routings / agent_contracts）。
 * - ALL_RETIRED_SKILLS：全量清理语义——在 PURGED_SKILLS 基础上追加"仅清理历史行"
 *   项（code-only 注销 / 仅 manifest 残留，从未注册），供手动 cleanup 脚本使用。
 *   恒为 PURGED_SKILLS 超集（不变量在模块加载时断言）。
 *
 * 僵尸项处置（2026-08-10，doc/RETIRED_SKILLS_FIX_PLAN.md §4.3）：
 * basic-evaluator / goal-alignment-checker 是"已注册（v4-aux-skills）但零生产调用"
 * 的僵尸项——保留注册、**移出**清理名单（归入活跃集合）。原因：cleanup 删其行会导致
 * skill_model_configs 永久丢失（该表不可自愈，写入方仅管理端配置）与运行期窗口故障。
 * 它们由 retired:check 门禁（check-retired-skill-lists.ts）的"活跃守卫"保护：
 * 任何把注册中 skill 放入 ALL_RETIRED_SKILLS 的改动都会在 CI 被拒绝。
 * course-design 同为注册中零调用项（唯一调用点 designWeekCourses 无调用者），不进名单。
 *
 * 维护规则：
 * 1. 新退役条目：曾注册过的补入 PURGED_SKILLS；从未注册（仅 code-only / manifest 残留）
 *    的补入 RESIDUE_ONLY_SKILLS。同步更新 doc/SKILL_PROTOCOL_V4.md 附录 A 与
 *    prompts/core / prompt-lab/manifests 对应文件处置。
 * 2. 正式注销注册中 skill（如 v4-aux）必须四同步：注册代码 / 文件 / 本名单 / 文档，
 *    避免再造僵尸。
 * 3. 本文件被 retired:check 门禁（backend/src/scripts/check-retired-skill-lists.ts）校验：
 *    PURGED ⊆ ALL、ALL ∩ 活跃注册集 = ∅、无 core.yaml / 未声明 manifest 残留。
 */

/**
 * 启动 purge 名单（36 项，2026-08-10 自 index.ts:45-92 单源化，逐项一致；2026-08-11 增补
 * session-evaluation-fallback）。
 * 语义：曾经注册过、启动时须清残留，防止幽灵注册；不 purge 注册中 skill 的配置行。
 */
export const PURGED_SKILLS: readonly string[] = [
  'pdf-parser',
  'time-estimator',
  'quiz-generation',
  'exercise-generator',
  'content-generation',
  'error-pattern',
  'code-explainer',
  'answer-generation',
  'batch-anderson-labeler',
  'goal-type-identifier',
  'task-profile-builder',
  // 2026-07 调用调查后退役：生产零调用或事件无发射者
  'state-assessment',
  'confidence-handler',
  'label-generator',
  'text-structure-analyzer',
  'retrieval',
  'web-extractor',
  'image-analyzer',
  'memory-search',
  'smart-search',
  // 2026-07 合并入 lesson-knowledge-enricher
  'session-knowledge-distiller',
  'dialogue-concept-extractor',
  // 2026-08 第三阶段命名反转：learning-* 改回 teaching-*（一次 breaking）；
  // 旧 id 仅作历史日志/数据解析，注册表/DB 不应残留，启动时 purge 防止幽灵注册
  'learning-turn',
  'learning-opening-generator',
  'learning-strategy-selector',
  // 2026-08 legacy 插件适配链退役：generic-planner/basic-generator/basic-extractor/data-mapping
  // 仅被 agentPluginConfig（零消费者）与插件自身互相转发引用，业务主链不走，零调用
  'generic-planner',
  'basic-generator',
  'basic-extractor',
  'data-mapping',
  // 2026-08 冗余 LLM 层退役：path-scene-framing（信息零增量，确定性定帧 buildFramedNormalizedInput 取代）
  'path-scene-framing',
  // 2026-08 冗余 LLM 层退役：goal-analysis（主流程不调用、fallback 输出被确定性 framing 覆盖，path-planning 内联兜底）
  'goal-analysis',
  // 2026-08 零调用退役：goal-profile-inference / learning-pattern-distiller（画像叙述改由
  // profile-aggregator 确定性 buildNarrativeInsights 产出）、structured-output-parser（无消费方）、
  // prompt-compiler skill（与 services/prompt-compiler 确定性编译器同名，且无生产调用）
  'goal-profile-inference',
  'learning-pattern-distiller',
  'structured-output-parser',
  'prompt-compiler',
  // 2026-08-11 完整退役：session-evaluation-fallback（曾注册于 v4-aux-skills）——43a01fb
  // 纯重试+明确失败改造后失去全部调用语义（session-wrapup 缺 evaluation 直接 evaluation=null +
  // 'unavailable'），注册/户口簿/产物四同步注销（doc/FALLBACK_RETIREMENT_PLAN.md Phase A）；
  // 存量 skill_registrations/skill_model_configs 等行由启动 purge 清理
  'session-evaluation-fallback',
] as const;

/**
 * 仅残留清理项（5 项）：从未注册，不入启动 purge，仅供 cleanup 脚本清理历史行。
 * - goal-understanding-composer / teaching-strategy-selector / acceptance-evidence-evaluator：
 *   2026-08 LLM skill 本体注销，保留确定性纯函数模块（被 goal-conversation / teaching-turn 消费）
 * - concept-priority / path-adjustment-generator：2026-08-09 退役，仅 manifest 残留
 *   （prompt-lab/manifests/，resolve-prompt-contract 按需加载，无运行影响）
 */
const RESIDUE_ONLY_SKILLS: readonly string[] = [
  'goal-understanding-composer',
  'teaching-strategy-selector',
  'acceptance-evidence-evaluator',
  'concept-priority',
  'path-adjustment-generator',
] as const;

/**
 * 全量清理名单（41 项 = purge 36 + 残留 5）：cleanup-retired-field-data.ts 使用。
 * 不含僵尸项 basic-evaluator / goal-alignment-checker（注册中，见文件头处置说明）。
 */
export const ALL_RETIRED_SKILLS: readonly string[] = [...PURGED_SKILLS, ...RESIDUE_ONLY_SKILLS] as const;

// 不变量：PURGED ⊆ ALL（结构上由展开保证，此处显式断言防未来重构破坏）
{
  const allSet = new Set(ALL_RETIRED_SKILLS);
  const missing = PURGED_SKILLS.filter((name) => !allSet.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[retired-skills] 不变量被破坏：PURGED_SKILLS 存在不在 ALL_RETIRED_SKILLS 的条目: ${missing.join(', ')}`,
    );
  }
}
