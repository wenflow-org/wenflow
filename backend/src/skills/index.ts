/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';
export * from './context-envelope';

// 文本结构分析
export { textStructureAnalyzerDefinition } from './text-structure-analyzer';
import { textStructureAnalyzer as textStructureAnalyzerFn } from './text-structure-analyzer';

// 检索
export { retrievalDefinition } from './retrieval';
import { retrieval as retrievalFn } from './retrieval';

// Web 内容提取
export { webExtractorDefinition } from './web-extractor';
import { webExtractor as webExtractorFn } from './web-extractor';

// 图片分析
export { imageAnalyzerDefinition } from './image-analyzer';
import { imageAnalyzer as imageAnalyzerFn } from './image-analyzer';

// 记忆搜索
export { memorySearchDefinition } from './memory-search';
import { memorySearch as memorySearchFn } from './memory-search';

// 智能搜索
export { smartSearchDefinition } from './smart-search';
import { smartSearch as smartSearchFn } from './smart-search';

// 动态标签生成 (PathAgent v3.1)
export { labelGeneratorDefinition } from './label-generator';
import { labelGenerator as labelGeneratorFn } from './label-generator';

// 路径场景 framing (PathAgent v3.2)
export { pathSceneFramingDefinition } from './path-scene-framing';
import { pathSceneFraming as pathSceneFramingFn } from './path-scene-framing';

// 阶段任务设计器
export { stageDesignerDefinition } from './stage-designer';
import { stageDesigner as stageDesignerFn } from './stage-designer';

// 动态引导文案
export { adaptiveGuidanceCopyDefinition } from './adaptive-guidance-copy';
import { adaptiveGuidanceCopy as adaptiveGuidanceCopyFn } from './adaptive-guidance-copy';

// goal 阶段画像推断
export { goalProfileInferenceDefinition } from './goal-profile-inference';
import { goalProfileInference as goalProfileInferenceFn } from './goal-profile-inference';

// learn 阶段模式蒸馏
export { learningPatternDistillerDefinition } from './learning-pattern-distiller';
import { learningPatternDistiller as learningPatternDistillerFn } from './learning-pattern-distiller';

// 课堂知识蒸馏
export { sessionKnowledgeDistillerDefinition } from './session-knowledge-distiller';
import { sessionKnowledgeDistiller as sessionKnowledgeDistillerFn } from './session-knowledge-distiller';

// 对话概念抽取
export { dialogueConceptExtractorDefinition } from './dialogue-concept-extractor';
import { dialogueConceptExtractor as dialogueConceptExtractorFn } from './dialogue-concept-extractor';

// 结构化输出解析器（新增：通用 JSON 提取）
export { structuredOutputParserDefinition } from './structured-output-parser';
import { structuredOutputParser as structuredOutputParserFn } from './structured-output-parser';

// 目标理解编排器（新增：understanding 管理）
export { goalUnderstandingComposerDefinition } from './goal-understanding-composer';
import { goalUnderstandingComposer as goalUnderstandingComposerFn } from './goal-understanding-composer';

// 任务完成度评估器（新增：acceptance criteria 匹配）
export { acceptanceEvidenceEvaluatorDefinition } from './acceptance-evidence-evaluator';
import { acceptanceEvidenceEvaluator as acceptanceEvidenceEvaluatorFn } from './acceptance-evidence-evaluator';

// 教学策略选择器（新增：策略别名映射 + 引导 prompt 构建）
export { teachingStrategySelectorDefinition } from './teaching-strategy-selector';
import { teachingStrategySelector as teachingStrategySelectorFn } from './teaching-strategy-selector';

// Prompt 编译器（新增：简化配置编译为完整 Prompt）
export { promptCompilerDefinition, promptCompilerRuntimeDefinition } from './prompt-compiler';
import { promptCompilerHandler as promptCompilerFn } from './prompt-compiler';

// MCP 非 LLM 工具能力
export { mcpToolDefinition } from './mcp-tool';
import { executeMcpTool as executeMcpToolFn } from './mcp-tool';

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

// 安德森标注缓存 (PathAgent v3.1)
export { andersonLabelerCache, AndersonLabelerCache, CachedLabel, CacheHitResult } from './anderson-labeler/cache';

// ============================================================
// 核心 LLM 能力单元（原 agents/，已迁入 skills/）
// ============================================================
export { goalConversationAgentDefinition } from './goal-conversation';
import { runGoalConversationAgent } from './goal-conversation';
export { pathAgentDefinition, replanPath } from './path-planning';
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
import { textStructureAnalyzerDefinition } from './text-structure-analyzer';
import { retrievalDefinition } from './retrieval';
import { webExtractorDefinition } from './web-extractor';
import { imageAnalyzerDefinition } from './image-analyzer';
import { memorySearchDefinition } from './memory-search';
import { smartSearchDefinition } from './smart-search';
import { labelGeneratorDefinition } from './label-generator';
import { pathSceneFramingDefinition } from './path-scene-framing';
import { stageDesignerDefinition } from './stage-designer';
import { adaptiveGuidanceCopyDefinition } from './adaptive-guidance-copy';
import { goalProfileInferenceDefinition } from './goal-profile-inference';
import { learningPatternDistillerDefinition } from './learning-pattern-distiller';
import { sessionKnowledgeDistillerDefinition } from './session-knowledge-distiller';
import { dialogueConceptExtractorDefinition } from './dialogue-concept-extractor';
import { virtualLearnerScenarioDesignerDefinition } from './virtual-learner-scenario-designer';
import { virtualLearnerPersonaDesignerDefinition } from './virtual-learner-persona-designer';
import { virtualLearnerGoalDialogueSimulatorDefinition } from './virtual-learner-goal-dialogue-simulator';
import { virtualLearnerPathEvaluatorDefinition } from './virtual-learner-path-evaluator';
import { virtualLearnerLearnTurnSimulatorDefinition } from './virtual-learner-learn-turn-simulator';
import { virtualLearnerRefereeDefinition } from './virtual-learner-referee';
import { virtualLearnerActorAuditorDefinition } from './virtual-learner-actor-auditor';
import { structuredOutputParserDefinition } from './structured-output-parser';
import { goalUnderstandingComposerDefinition } from './goal-understanding-composer';
import { acceptanceEvidenceEvaluatorDefinition } from './acceptance-evidence-evaluator';
import { teachingStrategySelectorDefinition } from './teaching-strategy-selector';
import { promptCompilerDefinition } from './prompt-compiler';
import { mcpToolDefinition } from './mcp-tool';

export const allSkillDefinitions: SkillDefinition[] = [
  textStructureAnalyzerDefinition,
  retrievalDefinition,
  webExtractorDefinition,
  imageAnalyzerDefinition,
  memorySearchDefinition,
  smartSearchDefinition,
  labelGeneratorDefinition,
  pathSceneFramingDefinition,
  stageDesignerDefinition,
  adaptiveGuidanceCopyDefinition,
  goalProfileInferenceDefinition,
  learningPatternDistillerDefinition,
  sessionKnowledgeDistillerDefinition,
  dialogueConceptExtractorDefinition,
  virtualLearnerPersonaDesignerDefinition,
  virtualLearnerScenarioDesignerDefinition,
  virtualLearnerGoalDialogueSimulatorDefinition,
  virtualLearnerPathEvaluatorDefinition,
  virtualLearnerLearnTurnSimulatorDefinition,
  virtualLearnerRefereeDefinition,
  virtualLearnerActorAuditorDefinition,
  structuredOutputParserDefinition,
  goalUnderstandingComposerDefinition,
  acceptanceEvidenceEvaluatorDefinition,
  teachingStrategySelectorDefinition,
  promptCompilerDefinition,
  mcpToolDefinition,
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
  'text-structure-analyzer': textStructureAnalyzerFn,
  'retrieval': retrievalFn,
  'web-extractor': webExtractorFn,
  'image-analyzer': imageAnalyzerFn,
  'memory-search': memorySearchFn,
  'smart-search': smartSearchFn,
  'label-generator': labelGeneratorFn,
  'path-scene-framing': pathSceneFramingFn,
  'stage-designer': stageDesignerFn,
  'adaptive-guidance-copy': adaptiveGuidanceCopyFn,
  'goal-profile-inference': goalProfileInferenceFn,
  'learning-pattern-distiller': learningPatternDistillerFn,
  'session-knowledge-distiller': sessionKnowledgeDistillerFn,
  'dialogue-concept-extractor': dialogueConceptExtractorFn,
  'virtual-learner-persona-designer': virtualLearnerPersonaDesignerFn,
  'virtual-learner-scenario-designer': virtualLearnerScenarioDesignerFn,
  'virtual-learner-goal-dialogue-simulator': virtualLearnerGoalDialogueSimulatorFn,
  'virtual-learner-path-evaluator': virtualLearnerPathEvaluatorFn,
  'virtual-learner-learn-turn-simulator': virtualLearnerLearnTurnSimulatorFn,
  'virtual-learner-referee': virtualLearnerRefereeFn,
  'virtual-learner-actor-auditor': virtualLearnerActorAuditorFn,
  'structured-output-parser': structuredOutputParserFn,
  'goal-understanding-composer': goalUnderstandingComposerFn,
  'acceptance-evidence-evaluator': acceptanceEvidenceEvaluatorFn,
  'teaching-strategy-selector': teachingStrategySelectorFn,
  'prompt-compiler': promptCompilerFn,
  'mcp-tool': executeMcpToolFn,
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
export async function executeSkill(
  definition: SkillDefinition | { id?: string; name?: string },
  input: any,
  options: SkillExecutionOptions = {}
): Promise<any> {
  const rawId = (definition.id || definition.name) as string;
  // 兼容核心能力单元：AgentDefinition 的 id 形如 'skill:goal-conversation'，
  // 而 skillHandlers 的 key 是去前缀的 'goal-conversation'。
  const skillId = skillHandlers[rawId] ? rawId : rawId.replace(/^skill:/, '');
  const handler = skillHandlers[skillId];
  if (!handler) {
    throw new Error(`Skill handler not found: ${skillId}`);
  }
  const result = await executeSkillHandler(definition, input, handler, options);
  return result.output;
}

export { executeSkillHandler } from './executor';
