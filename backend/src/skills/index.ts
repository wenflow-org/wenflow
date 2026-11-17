/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';
export * from './context-envelope';

import { pluginIdOfSkill, pluginNameOf } from '../config/plugin-catalog';
import { getPluginStates } from '../services/plugin-states.service';

// 阶段任务设计器
export { stageDesignerDefinition } from './path-task-design';
import { stageDesigner as stageDesignerFn } from './path-task-design';

// 动态引导文案
export { adaptiveGuidanceCopyDefinition } from './profile-adaptive-copy';
import { adaptiveGuidanceCopy as adaptiveGuidanceCopyFn } from './profile-adaptive-copy';

// 课后知识增强（session-knowledge-distiller + dialogue-concept-extractor 于 2026-07 合并）
export { lessonKnowledgeEnricherDefinition } from './profile-lesson-enrich';
import { lessonKnowledgeEnricher as lessonKnowledgeEnricherFn } from './profile-lesson-enrich';
export { learningPredictorDefinition } from './profile-learning-predict';
import { learningPredictor as learningPredictorFn } from './profile-learning-predict';

// 目标理解编排器（新增：understanding 管理）
// 已退役（code-only，见 retired-skills.ts）：纯函数 sanitize/merge/buildCollected 仍被 goal-conversation 直接引用，
// 但 handler 调度器无任何调用点，故不再在此 import（曾长期挂着未使用的 import）。
export { goalUnderstandingComposerDefinition } from './goal-understanding-composer';

// 任务完成度评估器（新增：acceptance criteria 匹配）
export { acceptanceEvidenceEvaluatorDefinition } from './acceptance-evidence-evaluator';

// 教学策略选择器（新增：策略别名映射 + 引导 prompt 构建）
export { teachingStrategySelectorDefinition } from './teaching-strategy-selector';

// MCP 非 LLM 工具能力
export { mcpToolDefinition } from './mcp-tool';
import { executeMcpTool as executeMcpToolFn } from './mcp-tool';

// 网页搜索能力（非 LLM 外挂能力）
export { webSearchDefinition } from './web-search';
import { executeWebSearch as executeWebSearchFn } from './web-search';

// 网页抓取能力（非 LLM 外挂能力；与 web-search 并列：search 找 URL，fetch 取正文）
export { webFetchDefinition } from './web-fetch';
import { executeWebFetch as executeWebFetchFn } from './web-fetch';

// 文生图能力（非 LLM 外挂能力；与 web-search / web-fetch 并列：找 URL / 取正文 / 画图）
export { textToImageDefinition } from './text-to-image';
import { executeTextToImage as executeTextToImageFn } from './text-to-image';

// 决策模型能力（非 LLM 外挂能力；SystemOne 槽位协议：choice / noul / score，只判定不生成）
export { decisionGateDefinition } from './decision-gate';
import { decisionGateDefinition } from './decision-gate';
import { executeDecisionGate as executeDecisionGateFn } from './decision-gate';

// goal 会话确认裁决器（handler-only 小 skill：打字确认的唯一语义裁决通道，fail-open 按非确认）
export { goalConfirmAdjudicatorDefinition, executeGoalConfirmAdjudicator, adjudicateGoalConfirm, GOAL_CONFIRM_ADJUDICATOR_PROMPT } from './goal-confirm-adjudicator';

// 课堂质量独立评审（2026-11-13：referee 看不到板书/图文/逐轮脚手架，课堂级病历单由此补位）
export { classroomQualityJudgeDefinition, executeClassroomQualityJudge, CLASSROOM_QUALITY_JUDGE_PROMPT } from './teaching-classroom-judge';
import { classroomQualityJudgeDefinition } from './teaching-classroom-judge';
import { executeClassroomQualityJudge as executeClassroomQualityJudgeFn } from './teaching-classroom-judge';
import { goalConfirmAdjudicatorDefinition } from './goal-confirm-adjudicator';
import { executeGoalConfirmAdjudicator as executeGoalConfirmAdjudicatorFn } from './goal-confirm-adjudicator';

// 资料采集编排器（非 LLM 外挂能力；确定性编排 search→选源→fetch，LLM 仅抽取带引文要点）
export { materialCollectorDefinition, executeMaterialCollector, collectMaterialPack, collectMaterialForGoal, hasMaterialNeed } from './path-material-collect';
export { materialBriefDefinition, generateMaterialBriefDraft, normalizeMaterialBrief, MATERIAL_BRIEF_PROMPT } from './path-material-brief';
import { materialBriefDefinition } from './path-material-brief';
import { executeMaterialCollector as executeMaterialCollectorFn } from './path-material-collect';
import { generateMaterialBriefDraft as generateMaterialBriefFn } from './path-material-brief';

// v4 辅助 LLM Skills（由原遗留插件/旁路迁入）
import { auxSkillDefinitions, auxSkillHandlers, auxRetiredSkillHandlers } from './v4-aux-skills';
export { auxSkillDefinitions, auxSkillDefinitionMap } from './v4-aux-skills';

// 虚拟学习者场景设计
export { virtualLearnerScenarioDesignerDefinition, VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT, VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE } from './simulation-scenario-designer';
import { virtualLearnerScenarioDesigner as virtualLearnerScenarioDesignerFn } from './simulation-scenario-designer';

// 虚拟学习者身份设计
export { virtualLearnerPersonaDesignerDefinition, VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT, VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE } from './simulation-persona-designer';
import { virtualLearnerPersonaDesigner as virtualLearnerPersonaDesignerFn } from './simulation-persona-designer';

// 虚拟学习者 Goal 对话模拟
export { virtualLearnerGoalDialogueSimulatorDefinition, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE } from './simulation-goal-dialogue';
import { virtualLearnerGoalDialogueSimulator as virtualLearnerGoalDialogueSimulatorFn } from './simulation-goal-dialogue';

// 虚拟学习者 Path 评估
export { virtualLearnerPathEvaluatorDefinition, VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT, VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS, VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE } from './simulation-path-evaluate';
import { virtualLearnerPathEvaluator as virtualLearnerPathEvaluatorFn } from './simulation-path-evaluate';

// 虚拟学习者 Learn 回合模拟
export { virtualLearnerLearnTurnSimulatorDefinition, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE } from './simulation-learn-turn';
import { virtualLearnerLearnTurnSimulator as virtualLearnerLearnTurnSimulatorFn } from './simulation-learn-turn';
import { virtualLearnerEpistemicGrounding as virtualLearnerEpistemicGroundingFn } from './simulation-epistemic-grounding';

// 虚拟学习者认知判决（物理两阶段第一段）
export { virtualLearnerEpistemicGroundingDefinition, VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_PROMPT, VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_MAX_TOKENS, VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_TEMPERATURE } from './simulation-epistemic-grounding';

// 虚拟学习者实验旁路裁判
export { virtualLearnerRefereeDefinition, VIRTUAL_LEARNER_REFEREE_PROMPT, VIRTUAL_LEARNER_REFEREE_MAX_TOKENS, VIRTUAL_LEARNER_REFEREE_TEMPERATURE } from './simulation-referee';
import { virtualLearnerReferee as virtualLearnerRefereeFn } from './simulation-referee';

// 虚拟学习者课后记忆提炼
export { virtualLearnerMemoryCuratorDefinition, VIRTUAL_LEARNER_MEMORY_CURATOR_PROMPT, VIRTUAL_LEARNER_MEMORY_CURATOR_MAX_TOKENS, VIRTUAL_LEARNER_MEMORY_CURATOR_TEMPERATURE } from './simulation-memory-curate';
import { virtualLearnerMemoryCurator as virtualLearnerMemoryCuratorFn } from './simulation-memory-curate';

// 虚拟学习者角色保真审计
export { virtualLearnerActorAuditorDefinition, VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT, VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS, VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE } from './simulation-actor-audit';
import { virtualLearnerActorAuditor as virtualLearnerActorAuditorFn } from './simulation-actor-audit';

// ============================================================
// 核心 LLM 能力单元（原 agents/，已迁入 skills/）
// ============================================================
export { goalConversationAgentDefinition } from './goal-conversation';
import { runGoalConversationAgent } from './goal-conversation';
export { pathAgentDefinition } from './path-planning';
import { pathAgentHandler } from './path-planning';
export { teachingTurnAgentDefinition, toTeachingTurnSkillOutcome } from './teaching-turn';
export type { TeachingTurnArtifact, TeachingTurnInput, TeachingTurnOutput } from './teaching-turn';
import { teachingTurnAgentHandler } from './teaching-turn';
export { sessionWrapupAgentDefinition, sessionWrapupAgent, toWrapupArtifact, toWrapupSkillOutcome } from './teaching-wrapup';
import { sessionWrapupAgentHandler } from './teaching-wrapup';
export { peerAgentDefinition, toPeerCanonicalArtifact, toPeerSkillOutcome } from './teaching-peer-reinforcement';
import { peerAgentHandler } from './teaching-peer-reinforcement';
export { buildSkillOutcome, noneTransition } from './outcome';
export type { SkillOutcome, ProposedTransition, SkillOutcomeMeta } from './outcome';

// 所有 Skill 定义
import { SkillDefinition } from './protocol';
import { stageDesignerDefinition } from './path-task-design';
import { adaptiveGuidanceCopyDefinition } from './profile-adaptive-copy';
import { lessonKnowledgeEnricherDefinition } from './profile-lesson-enrich';
import { learningPredictorDefinition } from './profile-learning-predict';
import { virtualLearnerScenarioDesignerDefinition } from './simulation-scenario-designer';
import { virtualLearnerPersonaDesignerDefinition } from './simulation-persona-designer';
import { virtualLearnerGoalDialogueSimulatorDefinition } from './simulation-goal-dialogue';
import { virtualLearnerPathEvaluatorDefinition } from './simulation-path-evaluate';
import { virtualLearnerLearnTurnSimulatorDefinition } from './simulation-learn-turn';
import { virtualLearnerEpistemicGroundingDefinition } from './simulation-epistemic-grounding';
import { virtualLearnerRefereeDefinition } from './simulation-referee';
import { virtualLearnerMemoryCuratorDefinition } from './simulation-memory-curate';
import { virtualLearnerActorAuditorDefinition } from './simulation-actor-audit';
import { pathReviewerDefinition, pathReviewer as pathReviewerFn } from './path-reviewer';
import { kcMapperDefinition, kcMapper as kcMapperFn } from './path-kc-mapping';
import { mcpToolDefinition } from './mcp-tool';
import { webSearchDefinition } from './web-search';
import { webFetchDefinition } from './web-fetch';
import { textToImageDefinition } from './text-to-image';
import { materialCollectorDefinition } from './path-material-collect';

export const allSkillDefinitions: SkillDefinition[] = [
  stageDesignerDefinition,
  adaptiveGuidanceCopyDefinition,
  lessonKnowledgeEnricherDefinition,
  learningPredictorDefinition,
  virtualLearnerPersonaDesignerDefinition,
  virtualLearnerScenarioDesignerDefinition,
  virtualLearnerGoalDialogueSimulatorDefinition,
  virtualLearnerPathEvaluatorDefinition,
  virtualLearnerLearnTurnSimulatorDefinition,
  virtualLearnerEpistemicGroundingDefinition,
  virtualLearnerRefereeDefinition,
  virtualLearnerMemoryCuratorDefinition,
  virtualLearnerActorAuditorDefinition,
  pathReviewerDefinition,
  kcMapperDefinition,
  mcpToolDefinition,
  webSearchDefinition,
  webFetchDefinition,
  textToImageDefinition,
  decisionGateDefinition,
  materialCollectorDefinition,
  goalConfirmAdjudicatorDefinition,
  classroomQualityJudgeDefinition,
  materialBriefDefinition,
  ...auxSkillDefinitions,
  // 核心 LLM 能力单元（注册为 Skill 以确保 agent-registry 可见）
  {
    name: 'goal-conversation',
    displayName: '目标对话 Skill',
    version: '1.0.0',
    status: 'working',
    category: 'generation',
    description: '与学习者多轮对话，收集学习目标并收敛到第一版学习方向',
    capabilities: ['goal-clarification', 'conversational-agent', 'learning-intake'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    stats: { callCount: 0, successRate: 1, avgLatency: 0 }
  },
  {
    name: 'path-planning',
    displayName: '学习路径规划 Skill',
    version: '1.0.0',
    status: 'working',
    category: 'generation',
    description: '基于认知图景生成阶段化学习路径骨架',
    capabilities: ['path-generation', 'cognitive-design', 'milestone-planning'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    stats: { callCount: 0, successRate: 1, avgLatency: 0 }
  },
  {
    name: 'teaching-turn',
    displayName: '教学回合 Skill',
    version: '1.0.0',
    status: 'working',
    category: 'generation',
    description: '生成单轮教学回复与结构化教学状态',
    capabilities: ['teaching-interaction', 'classroom-management', 'knowledge-tracking'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    stats: { callCount: 0, successRate: 1, avgLatency: 0 }
  },
  {
    name: 'teaching-wrapup',
    displayName: '课后产出 Skill',
    version: '1.0.0',
    status: 'working',
    category: 'analysis',
    description: '生成课后总结、知识评估与学习建议',
    capabilities: ['session-evaluation', 'knowledge-summary', 'learning-assessment'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    stats: { callCount: 0, successRate: 1, avgLatency: 0 }
  },
  {
    name: 'teaching-peer-reinforcement',
    displayName: '伴学 Skill',
    version: '1.0.0',
    status: 'working',
    category: 'generation',
    description: '同伴式引导讨论与学习理解补强',
    capabilities: ['peer-learning', 'guided-discovery', 'discussion-facilitation'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    stats: { callCount: 0, successRate: 1, avgLatency: 0 }
  },
];

// Skill 名称映射
export const skillHandlers: Record<string, (input: any) => Promise<any>> = {
  'path-task-design': stageDesignerFn,
  'profile-adaptive-copy': adaptiveGuidanceCopyFn,
  'profile-lesson-enrich': lessonKnowledgeEnricherFn,
  'profile-learning-predict': learningPredictorFn,
  'simulation-persona-designer': virtualLearnerPersonaDesignerFn,
  'simulation-scenario-designer': virtualLearnerScenarioDesignerFn,
  'simulation-goal-dialogue': virtualLearnerGoalDialogueSimulatorFn,
  'simulation-path-evaluate': virtualLearnerPathEvaluatorFn,
  'simulation-learn-turn': virtualLearnerLearnTurnSimulatorFn,
  'simulation-epistemic-grounding': virtualLearnerEpistemicGroundingFn,
  'simulation-referee': virtualLearnerRefereeFn,
  'simulation-memory-curate': virtualLearnerMemoryCuratorFn,
  'simulation-actor-audit': virtualLearnerActorAuditorFn,
  'path-reviewer': pathReviewerFn,
  'path-kc-mapping': kcMapperFn,
  'mcp-tool': executeMcpToolFn,
  'web-search': executeWebSearchFn,
  'web-fetch': executeWebFetchFn,
  'text-to-image': executeTextToImageFn,
  'decision-gate': executeDecisionGateFn,
  'path-material-collect': executeMaterialCollectorFn,
  'goal-confirm-adjudicator': executeGoalConfirmAdjudicatorFn,
  'teaching-classroom-judge': executeClassroomQualityJudgeFn,
  'path-material-brief': (input: any) => generateMaterialBriefFn(input),
  ...auxSkillHandlers,
  // 核心 LLM 能力单元（原 agents/，已迁入 skills/）
  'goal-conversation': (input: any) => runGoalConversationAgent(input),
  'path-planning': (input: any) => pathAgentHandler(input.input, (input as any).context),
  'teaching-turn': (input: any) => teachingTurnAgentHandler(input),
  'teaching-wrapup': (input: any) => sessionWrapupAgentHandler(input.input, (input as any).context),
  'teaching-peer-reinforcement': (input: any) => peerAgentHandler(input.input, (input as any).context),
};

/**
 * 可执行面 = 注册面（skillHandlers）+ 退役面（auxRetiredSkillHandlers）。
 * 退役 skill（见 retired-skills.ts；v4-aux-skills RETIRED_AUX_SKILL_IDS）不进注册面——
 * gateway 不注册（bootstrap 只遍历 allSkillDefinitions）、户口簿 F8/F11 与 retired:check
 * 活跃守卫要求注册集与退役名单互斥——但保留 executeSkillWithResult 直调入口：
 * eval-triage-judge / replay-path-planning 等离线脚本依赖（退役 ≠ 删代码）。
 */
export const executableSkillHandlers: Record<string, (input: any) => Promise<any>> = {
  ...skillHandlers,
  ...auxRetiredSkillHandlers,
};

import { executeSkillHandler } from './executor';
import type { SkillExecutionOptions } from './protocol';

/**
 * 执行 Skill 并返回完整结果（含 quality/debug/runtimeEnvelope）。
 * 需要区分 model/fallback 质量或读取 prompt 调试信息的调用方使用本入口。
 */
export async function executeSkillWithResult(
  definition: SkillDefinition | { id?: string; name?: string },
  input: any,
  options: SkillExecutionOptions = {}
): Promise<any> {
  const rawId = (definition.id || definition.name) as string;
  const skillId = executableSkillHandlers[rawId] ? rawId : rawId.replace(/^skill:/, '');
  // 插件启停（2026-10-24）：停用插件 = 成员能力不执行；调用方按各自失败策略继续。
  // 放在统一分发点而不是各 handler：新增成员 Skill 不会漏判。
  const pluginId = pluginIdOfSkill(skillId);
  if (pluginId) {
    const states = await getPluginStates();
    if (states[pluginId] === false) {
      throw new Error(`插件「${pluginNameOf(pluginId)}」已停用，Skill「${skillId}」未执行`);
    }
  }
  const handler = executableSkillHandlers[skillId];
  if (!handler) {
    throw new Error(`Skill handler not found: ${skillId}`);
  }
  return executeSkillHandler(definition, input, handler, options);
}

/**
 * 执行 Skill，返回**已解包的 output 本身**（不是 SkillExecutionResult）。
 *
 * ⚠️ 返回值形状：本函数 `return result.output`——调用方拿到的是 skill 的输出对象，
 * 其上**没有** `success` / `quality` / `debug` 字段（历史缺陷：三处消费方误检
 * `output.success`，恒 undefined → 恒判失败 → 记忆增量 100% 未落库）。
 * 需要成功/失败与质量信息时改用 {@link executeSkillWithResult}。
 *
 * @param definition - Skill 定义
 * @param input - 输入数据
 * @returns skill 的输出对象（output），失败时按 definition.failurePolicy 抛错或走兜底
 */
export async function executeSkill(
  definition: SkillDefinition | { id?: string; name?: string },
  input: any,
  options: SkillExecutionOptions = {}
): Promise<any> {
  const result = await executeSkillWithResult(definition, input, options);
  return result.output;
}

export { executeSkillHandler } from './executor';
