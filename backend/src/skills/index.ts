/**
 * Skills 入口文件
 * 
 * 统一导出所有 Skill
 */

// 协议
export * from './protocol';

// PDF 解析
export { pdfParserDefinition } from './pdf-parser';
import { pdfParser as pdfParserFn } from './pdf-parser';

// 文本结构分析
export { textStructureAnalyzerDefinition } from './text-structure-analyzer';
import { textStructureAnalyzer as textStructureAnalyzerFn } from './text-structure-analyzer';

// 时间估算
export { timeEstimatorDefinition } from './time-estimator';
import { timeEstimator as timeEstimatorFn } from './time-estimator';

// 内容生成
export { contentGenerationDefinition } from './content-generation';
import { contentGeneration as contentGenerationFn } from './content-generation';

// 测验生成
export { quizGenerationDefinition } from './quiz-generation';
import { quizGeneration as quizGenerationFn } from './quiz-generation';

// 检索
export { retrievalDefinition } from './retrieval';
import { retrieval as retrievalFn } from './retrieval';

// 答案生成
export { answerGenerationDefinition } from './answer-generation';
import { answerGeneration as answerGenerationFn } from './answer-generation';

// 代码解释器
export { codeExplainerDefinition } from './code-explainer';
import { codeExplainer as codeExplainerFn } from './code-explainer';

// 练习生成器
export { exerciseGeneratorDefinition } from './exercise-generator';
import { exerciseGenerator as exerciseGeneratorFn } from './exercise-generator';

// 错误模式分析
export { errorPatternDefinition } from './error-pattern';
import { errorPattern as errorPatternFn } from './error-pattern';

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

// 目标类型识别 (PathAgent v3.1)
export { goalTypeIdentifierDefinition } from './goal-type-identifier';
import { goalTypeIdentifier as goalTypeIdentifierFn } from './goal-type-identifier';

// 批量安德森标注 (PathAgent v3.1)
export { batchAndersonLabelerDefinition } from './batch-anderson-labeler';
import { batchAndersonLabeler as batchAndersonLabelerFn } from './batch-anderson-labeler';

// 动态标签生成 (PathAgent v3.1)
export { labelGeneratorDefinition } from './label-generator';
import { labelGenerator as labelGeneratorFn } from './label-generator';

// 安德森标注缓存 (PathAgent v3.1)
export { andersonLabelerCache, AndersonLabelerCache, CachedLabel, CacheHitResult } from './anderson-labeler/cache';

// 所有 Skill 定义
import { SkillDefinition } from './protocol';
import { pdfParserDefinition } from './pdf-parser';
import { textStructureAnalyzerDefinition } from './text-structure-analyzer';
import { timeEstimatorDefinition } from './time-estimator';
import { contentGenerationDefinition } from './content-generation';
import { quizGenerationDefinition } from './quiz-generation';
import { retrievalDefinition } from './retrieval';
import { answerGenerationDefinition } from './answer-generation';
import { codeExplainerDefinition } from './code-explainer';
import { exerciseGeneratorDefinition } from './exercise-generator';
import { errorPatternDefinition } from './error-pattern';
import { webExtractorDefinition } from './web-extractor';
import { imageAnalyzerDefinition } from './image-analyzer';
import { memorySearchDefinition } from './memory-search';
import { smartSearchDefinition } from './smart-search';
import { goalTypeIdentifierDefinition } from './goal-type-identifier';
import { batchAndersonLabelerDefinition } from './batch-anderson-labeler';
import { labelGeneratorDefinition } from './label-generator';

export const allSkillDefinitions: SkillDefinition[] = [
  pdfParserDefinition,
  textStructureAnalyzerDefinition,
  timeEstimatorDefinition,
  contentGenerationDefinition,
  quizGenerationDefinition,
  retrievalDefinition,
  answerGenerationDefinition,
  codeExplainerDefinition,
  exerciseGeneratorDefinition,
  errorPatternDefinition,
  webExtractorDefinition,
  imageAnalyzerDefinition,
  memorySearchDefinition,
  smartSearchDefinition,
  goalTypeIdentifierDefinition,
  batchAndersonLabelerDefinition,
  labelGeneratorDefinition
];

// Skill 名称映射
export const skillHandlers: Record<string, (input: any) => Promise<any>> = {
  'pdf-parser': pdfParserFn,
  'text-structure-analyzer': textStructureAnalyzerFn,
  'time-estimator': timeEstimatorFn,
  'content-generation': contentGenerationFn,
  'quiz-generation': quizGenerationFn,
  'retrieval': retrievalFn,
  'answer-generation': answerGenerationFn,
  'code-explainer': codeExplainerFn,
  'exercise-generator': exerciseGeneratorFn,
  'error-pattern': errorPatternFn,
  'web-extractor': webExtractorFn,
  'image-analyzer': imageAnalyzerFn,
  'memory-search': memorySearchFn,
  'smart-search': smartSearchFn,
  'goal-type-identifier': goalTypeIdentifierFn,
  'batch-anderson-labeler': batchAndersonLabelerFn,
  'label-generator': labelGeneratorFn
};

import { runWithContext, setRequestContext } from '../gateway/openai-client';

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
