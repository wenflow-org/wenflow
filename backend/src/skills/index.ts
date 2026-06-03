/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';

import prisma from '../config/database';

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

// 安德森标注缓存 (PathAgent v3.1)
export { andersonLabelerCache, AndersonLabelerCache, CachedLabel, CacheHitResult } from './anderson-labeler/cache';

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
  virtualLearnerLearnTurnSimulatorDefinition
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
  'virtual-learner-learn-turn-simulator': virtualLearnerLearnTurnSimulatorFn
};

import { setRequestContext } from '../gateway/api-gateway/context';
import { logger } from '../utils/logger';

function summarizeSkillPayload(value: any, depth = 0): any {
  if (depth > 2) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 2).map((item) => summarizeSkillPayload(item, depth + 1)),
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 10).map(([key, item]) => [key, summarizeSkillPayload(item, depth + 1)]);
    return Object.fromEntries(entries);
  }
  return String(value);
}

/**
 * 执行 Skill
 * @param definition - Skill 定义
 * @param input - 输入数据
 * @returns 执行结果
 */
export async function executeSkill(definition: SkillDefinition, input: any): Promise<any> {
  const skillId = definition.id || definition.name;
  const handler = skillHandlers[skillId];
  if (!handler) {
    throw new Error(`Skill handler not found: ${skillId}`);
  }

  const startedAt = Date.now();
  logger.info('[skill-executor] 开始执行', {
    skillId,
    inputSummary: summarizeSkillPayload(input),
  });
  
  // 设置 skillId 到 context，让 OpenAIClient 知道这是 skill 调用（默认用 chat 模型）
  setRequestContext({ skillId });

  try {
    const result = await handler(input);
    
    if (result && result.success === false) {
      const errorMsg = result.error?.message || `Skill ${skillId} execution failed`;
      throw new Error(errorMsg);
    }

    const durationMs = Date.now() - startedAt;
    await recordDirectSkillStats(skillId, true, durationMs);

    const output = result?.output || result;
    logger.info('[skill-executor] 执行完成', {
      skillId,
      durationMs,
      outputSummary: summarizeSkillPayload(output),
    });

    return output;
  } catch (error: any) {
    await recordDirectSkillStats(skillId, false, Date.now() - startedAt);
    logger.error('[skill-executor] 执行失败', {
      skillId,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    });
    throw error;
  }
}

async function recordDirectSkillStats(skillId: string, success: boolean, durationMs: number): Promise<void> {
  try {
    const current = await prisma.skill_registrations.findUnique({
      where: { name: skillId },
      select: { callCount: true, successRate: true }
    });

    if (!current) return;

    const nextCallCount = current.callCount + 1;
    const previousSuccesses = current.successRate * current.callCount;
    const nextSuccessRate = (previousSuccesses + (success ? 1 : 0)) / nextCallCount;

    await prisma.skill_registrations.update({
      where: { name: skillId },
      data: {
        callCount: nextCallCount,
        successRate: nextSuccessRate,
        updatedAt: new Date()
      }
    });
  } catch (error: any) {
    logger.warn('[skill-executor] 更新 Skill 统计失败', {
      skillId,
      success,
      durationMs,
      error: error?.message || String(error)
    });
  }
}
