/**
 * ContentAgent v3.0 - 策略配置
 * 
 * 定义 5 种策略的详细配置，融合 v1.0 和 v5.0 的优点
 */

import { ContentStrategy, StrategyConfig, TriggerCondition, ContentGuideline, UIType } from './types';

// ==================== 策略配置常量 ====================

/**
 * 支持鼓励策略 (SUPPORTIVE)
 * 
 * 触发场景：学生挫败感较高（> 0.7）
 * 目标：降低认知负荷，建立信心
 * 特点：使用简单类比，强调进步，频繁提示
 */
export const SUPPORTIVE_STRATEGY: StrategyConfig = {
  type: ContentStrategy.SUPPORTIVE,
  priority: 1,  // 最高优先级
  triggerConditions: [
    { field: 'frustration', operator: '>', value: 0.7 },
    { field: 'currentLSB', operator: '<', value: -0.3 }  // LSB 为负且绝对值较大
  ] as TriggerCondition[],
  contentGuidelines: {
    tone: '轻松、亲切、鼓励',
    pronounUsage: '咱们、我们一起',
    difficultyLevel: 2,
    explanationDepth: '浅',
    exampleType: '超简单生活类比',
    feedbackStyle: '积极鼓励，强调进步',
    hintFrequency: 0.8
  } as ContentGuideline,
  uiTypeRecommendation: 'choice' as UIType,
  difficultyAdjustment: -2
};

/**
 * 基础引导策略 (BASIC)
 * 
 * 触发场景：学生理解度较低（< 0.3）
 * 目标：从零开始建立基础理解
 * 特点：循序渐进，使用生活类比，温和引导
 */
export const BASIC_STRATEGY: StrategyConfig = {
  type: ContentStrategy.BASIC,
  priority: 2,
  triggerConditions: [
    { field: 'problemClarity', operator: '<', value: 0.3 },
    { field: 'currentKTL', operator: '<', value: 0.3 }
  ] as TriggerCondition[],
  contentGuidelines: {
    tone: '耐心、循序渐进',
    pronounUsage: '你、让我们',
    difficultyLevel: 2,
    explanationDepth: '中等，从零开始',
    exampleType: '生活类比 + 简单示例',
    feedbackStyle: '温和引导',
    hintFrequency: 0.6
  } as ContentGuideline,
  uiTypeRecommendation: 'input' as UIType,
  difficultyAdjustment: -1
};

/**
 * 标准对话策略 (STANDARD)
 * 
 * 触发场景：学生状态正常（默认策略）
 * 目标：标准教学流程，逐步深入
 * 特点：苏格拉底式追问，实际应用场景
 */
export const STANDARD_STRATEGY: StrategyConfig = {
  type: ContentStrategy.STANDARD,
  priority: 4,  // 较低优先级，作为默认
  triggerConditions: [] as TriggerCondition[],  // 默认策略，无特定触发条件
  contentGuidelines: {
    tone: '好奇、引导',
    pronounUsage: '你、你觉得呢',
    difficultyLevel: 3,
    explanationDepth: '中等',
    exampleType: '实际应用场景',
    feedbackStyle: '苏格拉底式追问',
    hintFrequency: 0.3
  } as ContentGuideline,
  uiTypeRecommendation: 'input' as UIType,
  difficultyAdjustment: 0
};

/**
 * 挑战深化策略 (CHALLENGE)
 * 
 * 触发场景：学生理解度和信心都很高（> 0.8）
 * 目标：提供进阶内容，引导深度思考
 * 特点：提出深层次问题，讨论边界情况
 */
export const CHALLENGE_STRATEGY: StrategyConfig = {
  type: ContentStrategy.CHALLENGE,
  priority: 3,
  triggerConditions: [
    { field: 'problemClarity', operator: '>', value: 0.8 },
    { field: 'confidence', operator: '>', value: 0.8 },
    { field: 'currentKTL', operator: '>', value: 0.7 }
  ] as TriggerCondition[],
  contentGuidelines: {
    tone: '挑战性、激发思考',
    pronounUsage: '你、你怎么看',
    difficultyLevel: 4,
    explanationDepth: '深入',
    exampleType: '边界情况、复杂场景',
    feedbackStyle: '提出更深层次问题',
    hintFrequency: 0.1
  } as ContentGuideline,
  uiTypeRecommendation: 'reflection' as UIType,
  difficultyAdjustment: +1
};

/**
 * 针对性补救策略 (REMEDIAL)
 * 
 * 触发场景：学生连续错误（>= 2）或前一次得分低（< 60）
 * 目标：找出理解断层，重建信心
 * 特点：回顾前置知识，针对性纠正误解
 */
export const REMEDIAL_STRATEGY: StrategyConfig = {
  type: ContentStrategy.REMEDIAL,
  priority: 2,
  triggerConditions: [
    { field: 'consecutiveErrors', operator: '>=', value: 2 },
    { field: 'previousScore', operator: '<', value: 60 }
  ] as TriggerCondition[],
  contentGuidelines: {
    tone: '理解、澄清',
    pronounUsage: '我理解你的想法、让我们重新看',
    difficultyLevel: 1,
    explanationDepth: '回到基础',
    exampleType: '针对性纠正误解',
    feedbackStyle: '澄清误解，重建信心',
    hintFrequency: 0.7
  } as ContentGuideline,
  uiTypeRecommendation: 'choice' as UIType,
  difficultyAdjustment: -2
};

/**
 * 所有策略配置映射
 */
export const STRATEGY_CONFIGS: Record<ContentStrategy, StrategyConfig> = {
  [ContentStrategy.SUPPORTIVE]: SUPPORTIVE_STRATEGY,
  [ContentStrategy.BASIC]: BASIC_STRATEGY,
  [ContentStrategy.STANDARD]: STANDARD_STRATEGY,
  [ContentStrategy.CHALLENGE]: CHALLENGE_STRATEGY,
  [ContentStrategy.REMEDIAL]: REMEDIAL_STRATEGY
};

/**
 * 策略原因说明
 */
export const STRATEGY_REASONS: Record<ContentStrategy, string> = {
  [ContentStrategy.SUPPORTIVE]: '检测到学生挫败感较高，采用支持鼓励策略，降低认知负荷，建立信心',
  [ContentStrategy.BASIC]: '检测到学生理解度较低，采用基础引导策略，从零开始建立理解',
  [ContentStrategy.STANDARD]: '学生状态正常，采用标准对话策略，循序渐进深入探讨',
  [ContentStrategy.CHALLENGE]: '学生理解度和信心都很高，采用挑战深化策略，引导深度思考',
  [ContentStrategy.REMEDIAL]: '检测到学生连续错误或得分较低，采用针对性补救策略，找出理解断层'
};
