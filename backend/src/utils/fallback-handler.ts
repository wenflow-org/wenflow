/**
 * Fallback Handler
 *
 * Skill 失败时的降级处理方案
 * 提供安全的默认值和静态映射
 */

import { logger } from './logger';

interface FallbackResult<T> {
  value: T;
  fallback: boolean;
  reason: string;
  originalError?: string;
}

const STATIC_LABEL_MAPPING: Record<string, string[]> = {
  'reading': ['概念理解', '理论学习', '知识阅读', '基础概念', '原理学习'],
  'practice': ['动手实践', '代码练习', '实操训练', '技能练习', '应用实践'],
  'project': ['项目实战', '综合项目', '实践项目', '应用项目', '实战演练'],
  'quiz': ['知识测验', '练习测试', '考核评估', '能力检测', '知识检验']
};

const TASK_TYPE_MAPPING: Record<string, { type: string; estimatedMinutes: number }> = {
  '基础': { type: 'reading', estimatedMinutes: 30 },
  '入门': { type: 'reading', estimatedMinutes: 45 },
  '概念': { type: 'reading', estimatedMinutes: 30 },
  '原理': { type: 'reading', estimatedMinutes: 45 },
  '理解': { type: 'reading', estimatedMinutes: 30 },
  '练习': { type: 'practice', estimatedMinutes: 60 },
  '实操': { type: 'practice', estimatedMinutes: 90 },
  '实战': { type: 'project', estimatedMinutes: 120 },
  '项目': { type: 'project', estimatedMinutes: 180 },
  '测验': { type: 'quiz', estimatedMinutes: 20 },
  '测试': { type: 'quiz', estimatedMinutes: 30 },
  '考核': { type: 'quiz', estimatedMinutes: 30 }
};

const DEFAULT_CONSERVATIVE_VALUES: Record<string, any> = {
  'time-estimator': {
    estimatedMinutes: 60,
    confidence: 0.5,
    factors: ['fallback: 使用保守默认值'],
    breakdown: { reading: 30, practice: 20, review: 10 }
  },
  'text-structure-analyzer': {
    outline: [],
    chapters: [],
    keywords: [],
    summary: '无法提取结构，使用降级方案',
    estimatedReadTime: 30
  },
  'content-generation': {
    content: '',
    sections: [],
    keyPoints: [],
    estimatedTime: 30,
    difficulty: 'medium'
  },
  'quiz-generation': {
    questions: [],
    totalScore: 0,
    estimatedTime: 15
  },
  'smart-search': {
    results: [],
    totalFound: 0,
    queryExpansion: []
  },
  'pdf-parser': {
    text: '',
    pages: 0,
    structure: { headings: [], paragraphs: [] }
  }
};

export function handleSkillFailure<T>(
  skillName: string,
  error: Error | string,
  originalInput?: any
): FallbackResult<T> {
  const errorMessage = error instanceof Error ? error.message : error;

  logger.warn('[FallbackHandler] Skill failure, using fallback', {
    skillName,
    error: errorMessage
  });

  const fallbackValue = getFallbackValue(skillName, originalInput);

  return {
    value: fallbackValue as T,
    fallback: true,
    reason: `Skill "${skillName}" 失败，使用降级方案`,
    originalError: errorMessage
  };
}

export function fallbackAnnotation(
  taskTitle: string,
  taskDescription?: string
): FallbackResult<{
  type: 'reading' | 'practice' | 'project' | 'quiz';
  estimatedMinutes: number;
  labels: string[];
}> {
  const combinedText = `${taskTitle} ${taskDescription || ''}`;

  let bestMatch: { type: string; estimatedMinutes: number } | null = null;
  let matchScore = 0;

  for (const [keyword, mapping] of Object.entries(TASK_TYPE_MAPPING)) {
    if (combinedText.toLowerCase().includes(keyword.toLowerCase())) {
      if (keyword.length > matchScore) {
        bestMatch = mapping;
        matchScore = keyword.length;
      }
    }
  }

  if (!bestMatch) {
    bestMatch = { type: 'practice', estimatedMinutes: 60 };
  }

  const labels = STATIC_LABEL_MAPPING[bestMatch.type] || ['学习任务'];

  return {
    value: {
      type: bestMatch.type as 'reading' | 'practice' | 'project' | 'quiz',
      estimatedMinutes: bestMatch.estimatedMinutes,
      labels
    },
    fallback: true,
    reason: '基于任务标题关键词的降级注释'
  };
}

export function fallbackLabels(taskType: string): FallbackResult<string[]> {
  const labels = STATIC_LABEL_MAPPING[taskType] || ['学习任务'];

  return {
    value: labels,
    fallback: true,
    reason: `使用静态标签映射（类型：${taskType}）`
  };
}

export function getFallbackValue(skillName: string, input?: any): any {
  if (DEFAULT_CONSERVATIVE_VALUES[skillName]) {
    const baseValue = DEFAULT_CONSERVATIVE_VALUES[skillName];
    return {
      ...baseValue,
      fallback: true,
      inputSnapshot: input ? JSON.stringify(input).slice(0, 200) : null
    };
  }

  return {
    value: null,
    fallback: true,
    reason: `未知 Skill "${skillName}"，返回空值`,
    skillName
  };
}

export function isFallbackResult(result: any): boolean {
  return result && result.fallback === true;
}

export function mergeFallbackResults(
  results: FallbackResult<any>[]
): FallbackResult<any[]> {
  const values = results.map(r => r.value);
  const hasAnyFallback = results.some(r => r.fallback);
  const reasons = results
    .filter(r => r.fallback)
    .map(r => r.reason);

  return {
    value: values,
    fallback: hasAnyFallback,
    reason: hasAnyFallback
      ? reasons.join('; ')
      : '所有结果均正常'
  };
}

export function createSafeExecutor<T>(
  skillName: string,
  executor: () => Promise<T>,
  fallbackValue?: T
): () => Promise<FallbackResult<T>> {
  return async () => {
    try {
      const value = await executor();
      return {
        value,
        fallback: false,
        reason: '执行成功'
      };
    } catch (error) {
      return handleSkillFailure<T>(
        skillName,
        error instanceof Error ? error : String(error),
        undefined
      );
    }
  };
}

export const fallbackHandler = {
  handleSkillFailure,
  fallbackAnnotation,
  fallbackLabels,
  getFallbackValue,
  isFallbackResult,
  mergeFallbackResults,
  createSafeExecutor,
  STATIC_LABEL_MAPPING,
  TASK_TYPE_MAPPING,
  DEFAULT_CONSERVATIVE_VALUES
};

export default fallbackHandler;