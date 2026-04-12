/**
 * Content Generation Skill
 * 
 * 生成教学内容
 */

import {
  SkillDefinition,
  ContentGenerationInput,
  ContentGenerationOutput,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * 内容生成 Skill 定义
 */
export const contentGenerationDefinition: SkillDefinition = {
  name: 'content-generation',
  version: '1.0.0',
  category: 'generation',
  description: '生成教学内容，包括讲解、教程、练习等',
  
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '主题',
        required: true
      },
      type: {
        type: 'string',
        description: '内容类型：explanation/tutorial/exercise/quiz',
        required: true
      },
      targetLevel: {
        type: 'string',
        description: '目标水平：beginner/intermediate/advanced',
        required: true
      },
      style: {
        type: 'string',
        description: '风格：formal/casual/academic'
      },
      length: {
        type: 'string',
        description: '长度：short/medium/long'
      },
      context: {
        type: 'string',
        description: '额外上下文'
      },
      referenceMaterial: {
        type: 'string',
        description: '参考材料'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '生成的内容'
      },
      sections: {
        type: 'array',
        description: '内容分段'
      },
      keyPoints: {
        type: 'array',
        description: '关键点'
      },
      estimatedTime: {
        type: 'number',
        description: '预估学习时间'
      },
      difficulty: {
        type: 'string',
        description: '难度等级'
      }
    }
  },
  
  capabilities: ['content-creation', 'tutorial-generation', 'explanation-generation'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 内容类型对应的系统提示
const SYSTEM_PROMPTS: Record<string, string> = {
  explanation: `你是一位经验丰富的教育专家，擅长将复杂概念解释得通俗易懂。
请根据提供的背景信息，生成具体、实用的学习内容。
必须包含：
1. 核心概念定义（结合背景信息中的主题和描述）
2. 重要性说明（说明为什么这个内容对学习者重要）
3. 实际应用场景（使用背景信息中的具体例子）
4. 常见误区提示
5. 学习建议

重要：请严格根据背景信息中的"主题"、"描述"、"目标"生成内容，不要偏离主题。`,

  tutorial: `你是一位技术导师，擅长编写实用的教程。
请根据提供的背景信息，创建具体、可操作的教程。
必须包含：
1. 学习目标和前置知识（基于背景信息中的目标）
2. 分步骤讲解（每步包含说明和代码示例，使用背景信息中的具体场景）
3. 常见问题解答
4. 练习建议

重要：请严格根据背景信息中的"主题"、"描述"、"目标"生成教程内容，不要偏离主题。`,

  exercise: `你是一位教学设计专家，擅长设计有针对性的练习。
请根据提供的背景信息，创建具体、有针对性的练习。
必须包含：
1. 练习目标（基于背景信息中的目标）
2. 背景描述（使用背景信息中的具体场景）
3. 具体任务要求（与背景信息中的描述一致）
4. 提示和引导
5. 参考答案思路

重要：请严格根据背景信息中的"主题"、"描述"、"目标"设计练习，不要偏离主题。`,

  quiz: `你是一位测评专家，擅长设计测试题。
请创建测试内容，包含：
1. 考查目标
2. 多种题型（选择题、简答题、编程题）
3. 每题的分值和解析
4. 时间建议`
};

// 目标水平对应的风格调整
const LEVEL_INSTRUCTIONS: Record<string, string> = {
  beginner: '使用通俗易懂的语言，避免专业术语，多使用类比和生活化的例子。',
  intermediate: '适度使用专业术语，配合解释，提供实用技巧和最佳实践。',
  advanced: '可以使用专业术语，深入探讨原理，提供优化思路和进阶内容。'
};

// 长度对应的字数指导
const LENGTH_GUIDE: Record<string, string> = {
  short: '内容控制在300-500字。',
  medium: '内容控制在800-1500字。',
  long: '内容可以详细展开，2000字以上。'
};

// 导入 Prisma 用于日志记录
import prisma from '../../config/database';

// 扩展输入类型支持日志参数
interface ContentGenerationInputWithLog extends ContentGenerationInput {
  agentId?: string;
  userId?: string;
  action?: string;
}

/**
 * 内容生成 Skill 实现
 */
export async function contentGeneration(
  input: ContentGenerationInputWithLog
): Promise<SkillExecutionResult<ContentGenerationOutput>> {
  const startTime = Date.now();
  let result: any = null;
  let error: any = null;
  
  try {
    const {
      topic,
      type,
      targetLevel,
      style = 'casual',
      length = 'medium',
      context,
      referenceMaterial,
      agentId,
      userId,
      action
    } = input;
    
    // 构建系统提示
    const systemPrompt = [
      SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.explanation,
      LEVEL_INSTRUCTIONS[targetLevel] || LEVEL_INSTRUCTIONS.intermediate,
      LENGTH_GUIDE[length] || LENGTH_GUIDE.medium,
      style === 'formal' ? '请使用正式、专业的语言风格。' :
      style === 'academic' ? '请使用学术性的语言风格，引用相关理论。' :
      '请使用轻松、友好的语言风格。'
    ].join('\n\n');
    
    // 构建用户消息
    const userParts = [`请生成关于"${topic}"的${type === 'explanation' ? '讲解' : type === 'tutorial' ? '教程' : type === 'exercise' ? '练习' : '测试'}内容。`];
    
    if (context) {
      userParts.push(`\n背景信息：${context}`);
    }
    
    if (referenceMaterial) {
      userParts.push(`\n参考材料：${referenceMaterial}`);
    }
    
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userParts.join('\n') }
    ];
    
    // 调用 AI
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ messages });
    const content = response.choices[0]?.message.content || '';
    
    // 解析内容结构
    const sections = parseSections(content);
    const keyPoints = extractKeyPoints(content);
    
    // 估算学习时间
    const estimatedTime = estimateReadingTime(content);
    
    // 判断难度
    const difficulty = determineDifficulty(content, targetLevel);

    result = {
      success: true,
      output: {
        content,
        sections,
        keyPoints,
        estimatedTime,
        difficulty
      },
      duration: Date.now() - startTime
    };

    return result;
  } catch (e) {
    error = e;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ContentGeneration] 生成失败:', errorMessage);
    console.error('[ContentGeneration] 请求参数:', { topic: input.topic, type: input.type, targetLevel: input.targetLevel });
    return {
      success: false,
      error: {
        code: 'CONTENT_GENERATION_ERROR',
        message: errorMessage
      },
      duration: Date.now() - startTime
    };
  } finally {
// 记录 Agent 调用日志（如果提供了 agentId 和 userId）
    if (input.agentId && input.userId) {
      try {
        const durationMs = Date.now() - startTime;
        await prisma.agent_call_logs.create({
          data: {
            id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            agentId: input.agentId,
            userId: input.userId,
            input: JSON.stringify({ topic: input.topic, type: input.type, targetLevel: input.targetLevel }),
            output: result ? JSON.stringify(result.output) : null,
            success: !error,
            durationMs,
            tokensUsed: undefined, // content-generation skill 没有 token 信息
            error: error?.message,
            errorCode: error?.code,
            calledAt: new Date(),
            metadata: JSON.stringify({
              action: input.action || 'content-generation',
              style: input.style,
              length: input.length,
context: input.context?.substring(0, 200) // 限制长度
            })
          }
        });
        console.log('[ContentGeneration] Agent调用日志已记录', { agentId: input.agentId, userId: input.userId });
      } catch (logError) {
        console.error('[ContentGeneration] 记录Agent调用日志失败:', logError);
      }
    }
  }
}

/**
 * 解析内容分段
 */
function parseSections(content: string): ContentGenerationOutput['sections'] {
  const sections: ContentGenerationOutput['sections'] = [];
  const lines = content.split('\n');
  
  let currentSection: { title: string; content: string } | null = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测标题行
    const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: headingMatch[2],
        content: ''
      };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      // 没有标题的内容作为第一个段落
      if (trimmedLine) {
        if (!currentSection) {
          currentSection = { title: '概述', content: '' };
        }
        currentSection.content += line + '\n';
      }
    }
  }
  
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return sections;
}

/**
 * 提取关键点
 */
function extractKeyPoints(content: string): string[] {
  const keyPoints: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测列表项
    const listMatch = trimmedLine.match(/^[-*•]\s*(.+)$/);
    if (listMatch) {
      keyPoints.push(listMatch[1]);
      continue;
    }
    
    // 检测数字列表
    const numMatch = trimmedLine.match(/^\d+[\.、]\s*(.+)$/);
    if (numMatch) {
      keyPoints.push(numMatch[1]);
    }
  }
  
  return keyPoints.slice(0, 10); // 最多返回10个关键点
}

/**
 * 估算阅读时间
 */
function estimateReadingTime(content: string): number {
  // 中文约300字/分钟，英文约200词/分钟
  const charCount = content.replace(/\s/g, '').length;
  return Math.ceil(charCount / 300);
}

/**
 * 判断难度
 */
function determineDifficulty(
  content: string,
  targetLevel: string
): 'easy' | 'medium' | 'hard' {
  // 基于内容特征判断难度
  const hasCodeBlocks = content.includes('```');
  const hasFormulas = content.includes('$') || content.includes('公式');
  const avgSentenceLength = content.length / (content.split(/[。！？.!?]/).length || 1);
  
  let score = 0;
  
  if (hasCodeBlocks) score += 1;
  if (hasFormulas) score += 1;
  if (avgSentenceLength > 50) score += 1;
  if (targetLevel === 'advanced') score += 1;
  if (targetLevel === 'beginner') score -= 1;
  
  if (score <= 1) return 'easy';
  if (score <= 2) return 'medium';
  return 'hard';
}

export default contentGeneration;
