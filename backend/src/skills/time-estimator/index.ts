/**
 * Time Estimator Skill
 * 
 * 估算学习时长
 */

import {
  SkillDefinition,
  TimeEstimatorInput,
  TimeEstimatorOutput,
  SkillExecutionResult
} from '../protocol';

/**
 * 时间估算 Skill 定义
 */
export const timeEstimatorDefinition: SkillDefinition = {
  name: 'time-estimator',
  version: '1.0.0',
  category: 'computation',
  description: '根据内容类型、难度和用户水平估算学习时长',
  
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '学习内容',
        required: true
      },
      contentType: {
        type: 'string',
        description: '内容类型：reading/video/exercise/project',
        required: true
      },
      difficulty: {
        type: 'string',
        description: '难度：easy/medium/hard'
      },
      userLevel: {
        type: 'string',
        description: '用户水平：beginner/intermediate/advanced'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      estimatedMinutes: {
        type: 'number',
        description: '预估学习时间（分钟）'
      },
      breakdown: {
        type: 'object',
        description: '时间分解'
      },
      confidence: {
        type: 'number',
        description: '置信度 0-1'
      },
      factors: {
        type: 'array',
        description: '影响因素'
      }
    }
  },
  
  capabilities: ['time-estimation', 'difficulty-assessment'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 基础时间参数（分钟）
const BASE_TIME = {
  reading: {
    base: 10,          // 每1000字基础时间
    easy: 0.8,
    medium: 1.0,
    hard: 1.5
  },
  video: {
    base: 1,           // 视频1分钟对应学习时间
    easy: 1.0,
    medium: 1.2,
    hard: 1.5
  },
  exercise: {
    base: 15,          // 每道题基础时间
    easy: 0.7,
    medium: 1.0,
    hard: 1.8
  },
  project: {
    base: 60,          // 项目基础时间
    easy: 0.8,
    medium: 1.0,
    hard: 1.5
  }
};

// 用户水平调整因子
const LEVEL_FACTOR = {
  beginner: 1.3,
  intermediate: 1.0,
  advanced: 0.7
};

/**
 * 时间估算 Skill 实现
 */
export async function timeEstimator(
  input: TimeEstimatorInput
): Promise<SkillExecutionResult<TimeEstimatorOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      content,
      contentType,
      difficulty = 'medium',
      userLevel = 'intermediate'
    } = input;
    
    const factors: string[] = [];
    let baseMinutes = 0;
    
    switch (contentType) {
      case 'reading':
        // 计算字数，估算阅读时间
        const charCount = content.replace(/\s/g, '').length;
        const wordCount = charCount / 1000;
        baseMinutes = wordCount * BASE_TIME.reading.base;
        factors.push(`字数: ${charCount}`);
        break;
        
      case 'video':
        // 尝试从内容中提取视频时长
        const durationMatch = content.match(/(\d+)\s*(?:分钟|min|分)/);
        if (durationMatch) {
          baseMinutes = parseInt(durationMatch[1]);
        } else {
          // 默认假设为10分钟视频
          baseMinutes = 10;
        }
        factors.push(`视频时长: ${baseMinutes}分钟`);
        break;
        
      case 'exercise':
        // 计算练习题数量
        const questionCount = (content.match(/[\?？]/g) || []).length ||
                              (content.match(/\d+[\.、]/g) || []).length ||
                              1;
        baseMinutes = questionCount * BASE_TIME.exercise.base;
        factors.push(`题目数量: ${questionCount}`);
        break;
        
      case 'project':
        // 项目通常有明确的预估时间
        const projectTimeMatch = content.match(/(\d+)\s*(?:小时|hour|h)/i);
        if (projectTimeMatch) {
          baseMinutes = parseInt(projectTimeMatch[1]) * 60;
        } else {
          baseMinutes = BASE_TIME.project.base;
        }
        factors.push('项目实践');
        break;
    }
    
    // 应用难度调整
    const difficultyMultiplier = BASE_TIME[contentType][difficulty] || 1.0;
    baseMinutes *= difficultyMultiplier;
    factors.push(`难度: ${difficulty} (${difficultyMultiplier}x)`);
    
    // 应用用户水平调整
    const levelMultiplier = LEVEL_FACTOR[userLevel] || 1.0;
    baseMinutes *= levelMultiplier;
    factors.push(`用户水平: ${userLevel} (${levelMultiplier}x)`);
    
    // 计算时间分解
    const breakdown = calculateBreakdown(baseMinutes, contentType);
    
    // 计算置信度
    const confidence = calculateConfidence(content, contentType);
    
    // 四舍五入到最近的5分钟
    const estimatedMinutes = Math.round(baseMinutes / 5) * 5;

    return {
      success: true,
      output: {
        estimatedMinutes: Math.max(5, estimatedMinutes), // 最少5分钟
        breakdown,
        confidence,
        factors
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'TIME_ESTIMATION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 计算时间分解
 */
function calculateBreakdown(
  totalMinutes: number,
  contentType: string
): TimeEstimatorOutput['breakdown'] {
  switch (contentType) {
    case 'reading':
      return {
        reading: Math.round(totalMinutes * 0.7),
        practice: Math.round(totalMinutes * 0.2),
        review: Math.round(totalMinutes * 0.1)
      };
      
    case 'video':
      return {
        reading: Math.round(totalMinutes * 0.2), // 预习
        practice: Math.round(totalMinutes * 0.6), // 观看
        review: Math.round(totalMinutes * 0.2)  // 复习
      };
      
    case 'exercise':
      return {
        reading: Math.round(totalMinutes * 0.2), // 理解题目
        practice: Math.round(totalMinutes * 0.6), // 做题
        review: Math.round(totalMinutes * 0.2)  // 检查
      };
      
    case 'project':
      return {
        reading: Math.round(totalMinutes * 0.15), // 需求理解
        practice: Math.round(totalMinutes * 0.7), // 实践
        review: Math.round(totalMinutes * 0.15)  // 总结
      };
      
    default:
      return {
        reading: Math.round(totalMinutes * 0.5),
        practice: Math.round(totalMinutes * 0.3),
        review: Math.round(totalMinutes * 0.2)
      };
  }
}

/**
 * 计算置信度
 */
function calculateConfidence(content: string, contentType: string): number {
  let confidence = 0.5;
  
  // 内容长度影响置信度
  if (content.length > 100) confidence += 0.1;
  if (content.length > 500) confidence += 0.1;
  if (content.length > 1000) confidence += 0.1;
  
  // 特定格式增加置信度
  if (contentType === 'video' && content.includes('分钟')) {
    confidence += 0.2;
  }
  if (contentType === 'project' && content.includes('小时')) {
    confidence += 0.2;
  }
  if (contentType === 'exercise' && content.includes('?')) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 0.95);
}

export default timeEstimator;
