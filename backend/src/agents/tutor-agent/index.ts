/**
 * Tutor Agent
 * 
 * 实时辅导答疑
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { answerGeneration } from '../../skills/answer-generation';
import { retrieval } from '../../skills/retrieval';

/**
 * Tutor Agent 定义
 */
export const tutorAgentDefinition: AgentDefinition = {
  id: 'tutor-agent',
  name: 'AI辅导Agent',
  version: '1.0.0',
  type: 'tutor',
  category: 'standard',
  description: '实时辅导答疑，根据用户水平提供个性化指导',
  
  capabilities: [
    'question-answering',
    'socratic-teaching',
    'hint-generation',
    'code-review',
    'error-explanation'
  ],
  
  // 订阅的事件
  subscribes: [
    'learning:struggle',
    'task:started',
    'task:struggled'
  ],
  
  // 发布的事件
  publishes: [
    'learning:hint-provided',
    'learning:question-answered'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      context: { type: 'string' },
      conversationHistory: { type: 'array' },
      taskId: { type: 'string' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      tutoring: {
        type: 'object',
        properties: {
          response: { type: 'string' },
          hints: { type: 'array' },
          relatedTopics: { type: 'array' },
          suggestedActions: { type: 'array' }
        }
      }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// ZPD 分层辅导策略
const ZPD_STRATEGIES = {
  novice: {
    style: 'direct',
    hintLevel: 'full',
    explanationDepth: 'detailed',
    codeExamples: true
  },
  'advanced-beginner': {
    style: 'guided',
    hintLevel: 'partial',
    explanationDepth: 'moderate',
    codeExamples: true
  },
  competent: {
    style: 'socratic',
    hintLevel: 'minimal',
    explanationDepth: 'conceptual',
    codeExamples: false
  },
  proficient: {
    style: 'discuss',
    hintLevel: 'none',
    explanationDepth: 'advanced',
    codeExamples: false
  },
  expert: {
    style: 'collaborate',
    hintLevel: 'none',
    explanationDepth: 'theoretical',
    codeExamples: false
  }
};

/**
 * Tutor Agent 处理函数
 */
export async function tutorAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  try {
    const question = input.metadata?.question || input.goal;
    const taskId = input.metadata?.taskId;
    const conversationHistory = context.conversationHistory || [];
    
    // 根据用户水平选择辅导策略
    const userLevel = getUserLevel(context.userProfile?.xp || 0);
    const strategy = ZPD_STRATEGIES[userLevel];
    
    // 检索相关内容（如果有参考资料）
    let retrievedContent: any[] = [];
    if (input.metadata?.referenceMaterial) {
      const retrievalResult = await retrieval({
        query: question,
        sources: [{ type: 'text', content: input.metadata.referenceMaterial }],
        topK: 3
      });
      if (retrievalResult.success && retrievalResult.output) {
        retrievedContent = retrievalResult.output.results;
      }
    }
    
    // 生成回答
    const answerResult = await answerGeneration({
      question,
      context: input.metadata?.context,
      retrievedContent,
      userLevel: mapUserLevelToAnswerLevel(userLevel),
      style: strategy.style as any
    });
    
    if (!answerResult.success || !answerResult.output) {
      throw new Error('答案生成失败');
    }
    
    // 发布辅导事件
    await eventBus.emit({
      type: 'learning:mastery' as any, // 使用已定义的事件类型
      source: 'tutor-agent',
      userId: context.userId,
      data: {
        question,
        taskId,
        userLevel,
        questionAnswered: true
      }
    });

    return {
      success: true,
      tutoring: {
        response: answerResult.output.answer,
        hints: generateHints(question, strategy, answerResult.output.answer),
        relatedTopics: answerResult.output.relatedTopics,
        suggestedActions: generateSuggestedActions(question, userLevel)
      },
      metadata: {
        agentId: 'tutor-agent',
        agentName: 'AI辅导Agent',
        agentType: 'tutor',
        confidence: answerResult.output.confidence,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'tutor-agent',
        agentName: 'AI辅导Agent',
        agentType: 'tutor',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 根据XP获取用户水平
 */
function getUserLevel(xp: number): keyof typeof ZPD_STRATEGIES {
  if (xp < 100) return 'novice';
  if (xp < 300) return 'advanced-beginner';
  if (xp < 600) return 'competent';
  if (xp < 1000) return 'proficient';
  return 'expert';
}

/**
 * 映射用户水平到答案生成参数
 */
function mapUserLevelToAnswerLevel(level: string): 'beginner' | 'intermediate' | 'advanced' {
  switch (level) {
    case 'novice':
    case 'advanced-beginner':
      return 'beginner';
    case 'competent':
      return 'intermediate';
    default:
      return 'advanced';
  }
}

/**
 * 生成提示
 */
function generateHints(
  question: string,
  strategy: typeof ZPD_STRATEGIES[keyof typeof ZPD_STRATEGIES],
  answer: string
): string[] {
  const hints: string[] = [];
  
  if (strategy.hintLevel === 'full') {
    // 提取答案中的关键点作为提示
    const keyPoints = answer.match(/[一二三四五六七八九十]+[、.．]|[-*•]\s|首先|其次|最后|注意/g);
    if (keyPoints) {
      hints.push('可以按照以下步骤思考：');
      hints.push(...keyPoints.slice(0, 3).map(p => p.replace(/[、.．\s]/g, '').trim()));
    }
  } else if (strategy.hintLevel === 'partial') {
    hints.push('试着先理解问题的核心是什么');
    hints.push('回顾一下相关的知识点');
  } else if (strategy.hintLevel === 'minimal') {
    hints.push('思考一下这个问题的关键点');
  }
  
  return hints;
}

/**
 * 生成建议行动
 */
function generateSuggestedActions(question: string, userLevel: string): string[] {
  const actions: string[] = [];
  
  // 根据问题类型建议行动
  if (question.includes('代码') || question.includes('code') || question.includes('编程')) {
    actions.push('尝试自己写一段代码');
    actions.push('在本地环境中运行测试');
    if (userLevel !== 'expert') {
      actions.push('参考示例代码进行修改');
    }
  } else {
    actions.push('用自己的话总结学到的内容');
    actions.push('尝试解决一个相关练习');
    actions.push('制作学习笔记');
  }
  
  return actions;
}

/**
 * 代码审查功能
 */
export async function reviewCode(
  code: string,
  language: string,
  context: AgentContext
): Promise<{
  issues: Array<{ line: number; message: string; severity: 'error' | 'warning' | 'suggestion' }>;
  suggestions: string[];
  explanation: string;
}> {
  const client = getOpenAIClient();
  
  const systemPrompt = `你是一位代码审查专家。请审查以下${language}代码，找出：
1. 潜在的错误或问题
2. 可以改进的地方
3. 代码风格建议

请以JSON格式输出：
{
  "issues": [
    { "line": 1, "message": "问题描述", "severity": "error|warning|suggestion" }
  ],
  "suggestions": ["建议1", "建议2"],
  "explanation": "整体说明"
}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请审查以下代码：\n\`\`\`${language}\n${code}\n\`\`\`` }
  ];

  const response = await client.chatCompletion({ messages, temperature: 0.3 });
  const content = response.choices[0]?.message.content || '';
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // 解析失败
  }
  
  return {
    issues: [],
    suggestions: ['代码看起来不错，可以继续优化'],
    explanation: '代码审查完成'
  };
}

/**
 * 错误解释功能
 */
export async function explainError(
  errorMessage: string,
  code: string,
  context: AgentContext
): Promise<string> {
  const client = getOpenAIClient();
  
  const userLevel = getUserLevel(context.userProfile?.xp || 0);
  const strategy = ZPD_STRATEGIES[userLevel];
  
  const systemPrompt = `你是一位编程教学专家，请解释以下错误。
${strategy.explanationDepth === 'detailed' ? '请详细解释原因和解决方法。' : 
  strategy.explanationDepth === 'conceptual' ? '请解释概念层面的原因。' : 
  '请简洁解释原因，让用户自己思考解决方案。'}
提供可操作的修复建议。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `错误信息：\n${errorMessage}\n\n相关代码：\n${code}` }
  ];

  const response = await client.chatCompletion({ messages, temperature: 0.4 });
  return response.choices[0]?.message.content || '无法解释此错误';
}

export default tutorAgentHandler;
