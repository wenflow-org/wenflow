/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';

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
  dialogueConceptExtractorDefinition
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
  'dialogue-concept-extractor': dialogueConceptExtractorFn
};

import { setRequestContext } from '../gateway/api-gateway/context';

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
  
  // 设置 skillId 到 context，让 OpenAIClient 知道这是 skill 调用（默认用 chat 模型）
  setRequestContext({ skillId });
  
  const result = await handler(input);
  
  // 检查执行结果，失败时抛出异常
  if (result && result.success === false) {
    const errorMsg = result.error?.message || `Skill ${skillId} execution failed`;
    throw new Error(errorMsg);
  }
  
  return result?.output || result;
}
