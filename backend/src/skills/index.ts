/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';
export * from './context-envelope';

// 阶段任务设计器
export { stageDesignerDefinition } from './stage-designer';
import { stageDesigner as stageDesignerFn } from './stage-designer';

// 动态引导文案
export { adaptiveGuidanceCopyDefinition } from './adaptive-guidance-copy';
import { adaptiveGuidanceCopy as adaptiveGuidanceCopyFn } from './adaptive-guidance-copy';

// 课后知识增强（session-knowledge-distiller + dialogue-concept-extractor 于 2026-07 合并）
export { lessonKnowledgeEnricherDefinition } from './lesson-knowledge-enricher';
import { lessonKnowledgeEnricher as lessonKnowledgeEnricherFn } from './lesson-knowledge-enricher';

// 目标理解编排器（新增：understanding 管理）
export { goalUnderstandingComposerDefinition } from './goal-understanding-composer';
import { goalUnderstandingComposer as goalUnderstandingComposerFn } from './goal-understanding-composer';

// 任务完成度评估器（新增：acceptance criteria 匹配）
export { acceptanceEvidenceEvaluatorDefinition } from './acceptance-evidence-evaluator';
import { acceptanceEvidenceEvaluator as acceptanceEvidenceEvaluatorFn } from './acceptance-evidence-evaluator';

// 教学策略选择器（新增：策略别名映射 + 引导 prompt 构建）
export { teachingStrategySelectorDefinition } from './teaching-strategy-selector';
import { teachingStrategySelector as teachingStrategySelectorFn } from './teaching-strategy-selector';

// MCP 非 LLM 工具能力
export { mcpToolDefinition } from './mcp-tool';
import { executeMcpTool as executeMcpToolFn } from './mcp-tool';

// v4 辅助 LLM Skills（由原遗留插件/旁路迁入）
import { auxSkillDefinitions, auxSkillHandlers } from './v4-aux-skills';
export { auxSkillDefinitions, auxSkillDefinitionMap } from './v4-aux-skills';

// 虚拟学习者场景设计
export { virtualLearnerScenarioDesignerDefinition, VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT, VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE } from './virtual-learner-scenario-designer';
import { virtualLearnerScenarioDesigner as virtualLearnerScenarioDesignerFn } from './virtual-learner-scenario-designer';

// 虚拟学习者身份设计
export { virtualLearnerPersonaDesignerDefinition, VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT, VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE } from './virtual-learner-persona-designer';
import { virtualLearnerPersonaDesigner as virtualLearnerPersonaDesignerFn } from './virtual-learner-persona-designer';

// 虚拟学习者 Goal 对话模拟
export { virtualLearnerGoalDialogueSimulatorDefinition, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE } from './virtual-learner-goal-dialogue-simulator';
import { virtualLearnerGoalDialogueSimulator as virtualLearnerGoalDialogueSimulatorFn } from './virtual-learner-goal-dialogue-simulator';

// 虚拟学习者 Path 评估
export { virtualLearnerPathEvaluatorDefinition, VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT, VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS, VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE } from './virtual-learner-path-evaluator';
import { virtualLearnerPathEvaluator as virtualLearnerPathEvaluatorFn } from './virtual-learner-path-evaluator';

// 虚拟学习者 Learn 回合模拟
export { virtualLearnerLearnTurnSimulatorDefinition, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE } from './virtual-learner-learn-turn-simulator';
import { virtualLearnerLearnTurnSimulator as virtualLearnerLearnTurnSimulatorFn } from './virtual-learner-learn-turn-simulator';

// 虚拟学习者实验旁路裁判
export { virtualLearnerRefereeDefinition, VIRTUAL_LEARNER_REFEREE_PROMPT, VIRTUAL_LEARNER_REFEREE_MAX_TOKENS, VIRTUAL_LEARNER_REFEREE_TEMPERATURE } from './virtual-learner-referee';
import { virtualLearnerReferee as virtualLearnerRefereeFn } from './virtual-learner-referee';

// 虚拟学习者角色保真审计
export { virtualLearnerActorAuditorDefinition, VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT, VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS, VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE } from './virtual-learner-actor-auditor';
import { virtualLearnerActorAuditor as virtualLearnerActorAuditorFn } from './virtual-learner-actor-auditor';

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
export { sessionWrapupAgentDefinition, sessionWrapupAgent, toWrapupArtifact, toWrapupSkillOutcome } from './session-wrapup';
import { sessionWrapupAgentHandler } from './session-wrapup';
export { peerAgentDefinition, toPeerCanonicalArtifact, toPeerSkillOutcome } from './peer-reinforcement';
import { peerAgentHandler } from './peer-reinforcement';
export { buildSkillOutcome, noneTransition } from './outcome';
export type { SkillOutcome, ProposedTransition, SkillOutcomeMeta } from './outcome';

// 所有 Skill 定义
import { SkillDefinition } from './protocol';
import { stageDesignerDefinition } from './stage-designer';
import { adaptiveGuidanceCopyDefinition } from './adaptive-guidance-copy';
import { lessonKnowledgeEnricherDefinition } from './lesson-knowledge-enricher';
import { virtualLearnerScenarioDesignerDefinition } from './virtual-learner-scenario-designer';
import { virtualLearnerPersonaDesignerDefinition } from './virtual-learner-persona-designer';
import { virtualLearnerGoalDialogueSimulatorDefinition } from './virtual-learner-goal-dialogue-simulator';
import { virtualLearnerPathEvaluatorDefinition } from './virtual-learner-path-evaluator';
import { virtualLearnerLearnTurnSimulatorDefinition } from './virtual-learner-learn-turn-simulator';
import { virtualLearnerRefereeDefinition } from './virtual-learner-referee';
import { virtualLearnerActorAuditorDefinition } from './virtual-learner-actor-auditor';
import { mcpToolDefinition } from './mcp-tool';

export const allSkillDefinitions: SkillDefinition[] = [
  stageDesignerDefinition,
  adaptiveGuidanceCopyDefinition,
  lessonKnowledgeEnricherDefinition,
  virtualLearnerPersonaDesignerDefinition,
  virtualLearnerScenarioDesignerDefinition,
  virtualLearnerGoalDialogueSimulatorDefinition,
  virtualLearnerPathEvaluatorDefinition,
  virtualLearnerLearnTurnSimulatorDefinition,
  virtualLearnerRefereeDefinition,
  virtualLearnerActorAuditorDefinition,
  mcpToolDefinition,
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
    name: 'session-wrapup',
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
    name: 'peer-reinforcement',
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
  'stage-designer': stageDesignerFn,
  'adaptive-guidance-copy': adaptiveGuidanceCopyFn,
  'lesson-knowledge-enricher': lessonKnowledgeEnricherFn,
  'virtual-learner-persona-designer': virtualLearnerPersonaDesignerFn,
  'virtual-learner-scenario-designer': virtualLearnerScenarioDesignerFn,
  'virtual-learner-goal-dialogue-simulator': virtualLearnerGoalDialogueSimulatorFn,
  'virtual-learner-path-evaluator': virtualLearnerPathEvaluatorFn,
  'virtual-learner-learn-turn-simulator': virtualLearnerLearnTurnSimulatorFn,
  'virtual-learner-referee': virtualLearnerRefereeFn,
  'virtual-learner-actor-auditor': virtualLearnerActorAuditorFn,
  'mcp-tool': executeMcpToolFn,
  ...auxSkillHandlers,
  // 核心 LLM 能力单元（原 agents/，已迁入 skills/）
  'goal-conversation': (input: any) => runGoalConversationAgent(input),
  'path-planning': (input: any) => pathAgentHandler(input.input, (input as any).context),
  'teaching-turn': (input: any) => teachingTurnAgentHandler(input),
  'session-wrapup': (input: any) => sessionWrapupAgentHandler(input.input, (input as any).context),
  'peer-reinforcement': (input: any) => peerAgentHandler(input.input, (input as any).context),
};

import { executeSkillHandler } from './executor';
import type { SkillExecutionOptions } from './protocol';

/**
 * 执行 Skill
 * @param definition - Skill 定义
 * @param input - 输入数据
 * @returns 执行结果
 */
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
  const skillId = skillHandlers[rawId] ? rawId : rawId.replace(/^skill:/, '');
  const handler = skillHandlers[skillId];
  if (!handler) {
    throw new Error(`Skill handler not found: ${skillId}`);
  }
  return executeSkillHandler(definition, input, handler, options);
}

export async function executeSkill(
  definition: SkillDefinition | { id?: string; name?: string },
  input: any,
  options: SkillExecutionOptions = {}
): Promise<any> {
  const result = await executeSkillWithResult(definition, input, options);
  return result.output;
}

export { executeSkillHandler } from './executor';
