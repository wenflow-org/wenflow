/**
 * Answer Generation Skill
 * 
 * 生成辅导回复
 */

import {
  SkillDefinition,
  AnswerGenerationInput,
  AnswerGenerationOutput,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * 答案生成 Skill 定义
 */
export const answerGenerationDefinition: SkillDefinition = {
  name: 'answer-generation',
  version: '1.0.0',
  category: 'generation',
  description: '根据问题生成辅导回复',
  
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '用户问题',
        required: true
      },
      context: {
        type: 'string',
        description: '上下文'
      },
      retrievedContent: {
        type: 'array',
        description: '检索到的相关内容'
      },
      userLevel: {
        type: 'string',
        description: '用户水平',
        required: true
      },
      style: {
        type: 'string',
        description: '回答风格：socratic/direct/guided'
      },
      maxTokens: {
        type: 'number',
        description: '最大token数'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: '回答内容'
      },
      confidence: {
        type: 'number',
        description: '置信度'
      },
      followUpQuestions: {
        type: 'array',
        description: '后续问题建议'
      },
      relatedTopics: {
        type: 'array',
        description: '相关主题'
      },
      sources: {
        type: 'array',
        description: '参考来源'
      }
    }
  },
  
  capabilities: ['answer-generation', 'socratic-teaching', 'guided-learning'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 用户水平对应的指导策略
const LEVEL_STRATEGIES: Record<string, string> = {
  beginner: `用户是初学者，请：
1. 使用通俗易懂的语言，避免专业术语
2. 多使用类比和生活化的例子
3. 提供详细的步骤说明
4. 给出完整的代码示例
5. 鼓励用户，增强学习信心`,

  intermediate: `用户有一定基础，请：
1. 适度使用专业术语，配合解释
2. 提供实用技巧和最佳实践
3. 引导用户思考更深层次的问题
4. 可以省略基础步骤，专注关键点
5. 提供优化建议`,

  advanced: `用户是高级学习者，请：
1. 可以使用专业术语
2. 深入探讨原理和机制
3. 提供进阶内容和优化思路
4. 讨论边界情况和性能考量
5. 推荐相关资源深入学习`
};

// 回答风格对应的提示
const STYLE_PROMPTS: Record<string, string> = {
  socratic: `采用苏格拉底式教学，通过提问引导用户思考：
- 不要直接给出答案
- 通过问题引导用户发现答案
- 每次只给一个小提示
- 鼓励用户尝试和犯错`,

  direct: `采用直接讲解方式：
- 直接给出答案和解释
- 清晰完整地回答问题
- 提供具体的代码或步骤
- 总结关键要点`,

  guided: `采用引导式教学，平衡直接和启发：
- 先给出核心概念或方向
- 然后逐步展开细节
- 在关键处设置思考点
- 最后总结和练习建议`
};

/**
 * 答案生成 Skill 实现
 */
export async function answerGeneration(
  input: AnswerGenerationInput
): Promise<SkillExecutionResult<AnswerGenerationOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      question,
      context,
      retrievedContent = [],
      userLevel,
      style = 'guided',
      maxTokens = 1024
    } = input;
    
    // 构建系统提示
    const systemPrompt = `你是一位专业的AI学习辅导助手。
${LEVEL_STRATEGIES[userLevel] || LEVEL_STRATEGIES.intermediate}

${STYLE_PROMPTS[style] || STYLE_PROMPTS.guided}

回答要求：
1. 内容准确，逻辑清晰
2. 根据用户水平调整深度
3. 如有检索到的参考资料，优先使用
4. 如果不确定，诚实说明并提供方向
5. 适当推荐相关主题供进一步学习`;

    // 构建消息
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    // 添加上下文
    if (context) {
      messages.push({
        role: 'user',
        content: `[背景信息]\n${context}`
      });
      messages.push({
        role: 'assistant',
        content: '我已了解背景信息，请继续提问。'
      });
    }
    
    // 添加检索内容
    if (retrievedContent.length > 0) {
      const refContent = retrievedContent
        .map((r: any, i: number) => `[参考资料${i + 1}]\n${typeof r === 'string' ? r : (r.content || JSON.stringify(r))}`)
        .join('\n\n');
      messages.push({
        role: 'user',
        content: refContent
      });
      messages.push({
        role: 'assistant',
        content: '我已阅读参考资料，请提出你的问题。'
      });
    }
    
    // 添加用户问题
    messages.push({
      role: 'user',
      content: question
    });
    
    // 调用 AI
    const client = getOpenAIClient();
    const response = await client.chatCompletion({
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    });
    
    const answer = response.choices[0]?.message.content || '';
    
    // 提取后续问题建议
    const followUpQuestions = extractFollowUpQuestions(answer);
    
    // 提取相关主题
    const relatedTopics = extractRelatedTopics(answer);
    
    // 计算置信度
    const confidence = calculateConfidence(answer, retrievedContent);
    
    // 提取来源
    const sources = retrievedContent
      .filter((r: any) => typeof r === 'object' && r !== null && r.source)
      .map((r: any) => r.source);

    return {
      success: true,
      output: {
        answer,
        confidence,
        followUpQuestions,
        relatedTopics,
        sources
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'ANSWER_GENERATION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 提取后续问题建议
 */
function extractFollowUpQuestions(answer: string): string[] {
  const questions: string[] = [];
  const lines = answer.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测问题格式的建议
    const questionMatch = trimmedLine.match(/^\d*[\.、]?\s*(.+\?)$/);
    if (questionMatch) {
      questions.push(questionMatch[1]);
    }
    
    // 检测"你可以尝试"等建议
    const suggestMatch = trimmedLine.match(/(?:你可以尝试|建议|试试|思考)[:：]?\s*(.+)$/);
    if (suggestMatch) {
      questions.push(suggestMatch[1]);
    }
  }
  
  return questions.slice(0, 3);
}

/**
 * 提取相关主题
 */
function extractRelatedTopics(answer: string): string[] {
  const topics: Set<string> = new Set();
  
  // 检测加粗文本
  const boldMatches = answer.match(/\*\*([^*]+)\*\*/g);
  if (boldMatches) {
    for (const match of boldMatches) {
      topics.add(match.replace(/\*\*/g, ''));
    }
  }
  
  // 检测代码块中的关键词
  const codeMatches = answer.match(/```[\s\S]*?```/g);
  if (codeMatches) {
    for (const code of codeMatches) {
      const keywords = code.match(/(function|class|import|const|let|var)\s+(\w+)/g);
      if (keywords) {
        for (const kw of keywords) {
          const name = kw.split(/\s+/)[1];
          if (name) topics.add(name);
        }
      }
    }
  }
  
  return Array.from(topics).slice(0, 5);
}

/**
 * 计算置信度
 */
function calculateConfidence(answer: string, retrievedContent: any[]): number {
  let confidence = 0.5;
  
  // 回答长度
  if (answer.length > 100) confidence += 0.1;
  if (answer.length > 300) confidence += 0.1;
  
  // 有代码示例
  if (answer.includes('```')) confidence += 0.1;
  
  // 有检索内容支持
  if (retrievedContent.length > 0) confidence += 0.1;
  
  // 有清晰的解释结构
  if (answer.includes('首先') || answer.includes('第一步')) confidence += 0.05;
  if (answer.includes('总结') || answer.includes('要点')) confidence += 0.05;
  
  return Math.min(confidence, 0.95);
}

export default answerGeneration;
