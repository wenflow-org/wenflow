/**
 * Quiz Generation Skill
 * 
 * 生成测试题
 */

import {
  SkillDefinition,
  QuizGenerationInput,
  QuizGenerationOutput,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * 测验生成 Skill 定义
 */
export const quizGenerationDefinition: SkillDefinition = {
  name: 'quiz-generation',
  version: '1.0.0',
  category: 'generation',
  description: '根据内容和主题生成测试题目',
  
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '主题',
        required: true
      },
      content: {
        type: 'string',
        description: '相关内容',
        required: true
      },
      questionCount: {
        type: 'number',
        description: '题目数量',
        required: true
      },
      questionTypes: {
        type: 'array',
        description: '题型列表'
      },
      difficulty: {
        type: 'string',
        description: '难度：easy/medium/hard'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '题目列表'
      },
      totalScore: {
        type: 'number',
        description: '总分'
      },
      estimatedTime: {
        type: 'number',
        description: '预估时间（分钟）'
      }
    }
  },
  
  capabilities: ['quiz-creation', 'question-generation', 'assessment-design'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 题型对应的系统提示
const QUESTION_TYPE_GUIDES: Record<string, string> = {
  'multiple-choice': `选择题格式：
题目: [题目内容]
选项:
A. [选项A]
B. [选项B]
C. [选项C]
D. [选项D]
答案: [正确选项字母]
解析: [详细解释]`,

  'short-answer': `简答题格式：
题目: [题目内容]
参考答案: [标准答案要点]
评分标准: [得分点]`,

  'coding': `编程题格式：
题目: [题目描述]
要求: [具体要求]
输入示例: [示例输入]
输出示例: [示例输出]
提示: [可选提示]
参考答案: [示例代码]`
};

/**
 * 测验生成 Skill 实现
 */
export async function quizGeneration(
  input: QuizGenerationInput
): Promise<SkillExecutionResult<QuizGenerationOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      topic,
      content,
      questionCount,
      questionTypes = ['multiple-choice'],
      difficulty = 'medium'
    } = input;
    
    // 构建系统提示
    const systemPrompt = `你是一位专业的教育测评专家，擅长设计高质量的测试题目。
请根据提供的内容生成测试题，要求：
1. 题目紧扣主题和内容
2. 难度适中，符合${difficulty === 'easy' ? '基础' : difficulty === 'hard' ? '进阶' : '中等'}水平
3. 答案准确，解析清晰
4. 避免重复和歧义

请按照以下格式输出每道题目：
---
${questionTypes.map(type => QUESTION_TYPE_GUIDES[type] || '').join('\n\n')}
---

注意：每道题目之间用 "---" 分隔。`;

    // 构建用户消息
    const userMessage = `主题：${topic}

参考内容：
${content.substring(0, 3000)}${content.length > 3000 ? '...' : ''}

请生成 ${questionCount} 道题目，题型包括：${questionTypes.map(t => 
  t === 'multiple-choice' ? '选择题' : 
  t === 'short-answer' ? '简答题' : 
  t === 'coding' ? '编程题' : t
).join('、')}。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
    
    // 调用 AI
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ 
      messages,
      temperature: 0.7
    });
    const generatedContent = response.choices[0]?.message.content || '';
    
    // 解析生成的题目
    const questions = parseQuestions(generatedContent, questionTypes);
    
    // 计算总分
    const totalScore = questions.reduce((sum, q) => sum + getQuestionScore(q.type), 0);
    
    // 估算时间
    const estimatedTime = estimateQuizTime(questions);

    return {
      success: true,
      output: {
        questions,
        totalScore,
        estimatedTime
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'QUIZ_GENERATION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 解析题目
 */
function parseQuestions(content: string, types: string[]): QuizGenerationOutput['questions'] {
  const questions: QuizGenerationOutput['questions'] = [];
  const blocks = content.split('---').filter(b => b.trim());
  
  let questionId = 1;
  
  for (const block of blocks) {
    const question = parseQuestionBlock(block, questionId.toString());
    if (question) {
      questions.push(question);
      questionId++;
    }
  }
  
  return questions;
}

/**
 * 解析单个题目块
 */
function parseQuestionBlock(block: string, id: string): QuizGenerationOutput['questions'][0] | null {
  const lines = block.trim().split('\n');
  
  let question = '';
  let type: 'multiple-choice' | 'short-answer' | 'coding' = 'multiple-choice';
  const options: string[] = [];
  let correctAnswer = '';
  let explanation = '';
  const difficulty: 'easy' | 'medium' | 'hard' = 'medium';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.startsWith('题目:') || trimmedLine.startsWith('题目：')) {
      question = trimmedLine.replace(/^题目[:：]\s*/, '');
    } else if (trimmedLine.match(/^[A-D][\.、．]/)) {
      options.push(trimmedLine.replace(/^[A-D][\.、．]\s*/, ''));
    } else if (trimmedLine.startsWith('选项:')) {
      // 跳过选项标签
    } else if (trimmedLine.startsWith('答案:') || trimmedLine.startsWith('答案：')) {
      correctAnswer = trimmedLine.replace(/^答案[:：]\s*/, '');
    } else if (trimmedLine.startsWith('解析:') || trimmedLine.startsWith('解析：')) {
      explanation = trimmedLine.replace(/^解析[:：]\s*/, '');
    } else if (trimmedLine.startsWith('参考答案:')) {
      correctAnswer = trimmedLine.replace(/^参考答案[:：]\s*/, '');
      type = 'short-answer';
    } else if (trimmedLine.startsWith('要求:')) {
      type = 'coding';
    }
  }
  
  if (!question) return null;
  
  // 根据特征判断题型
  if (options.length > 0) {
    type = 'multiple-choice';
  } else if (correctAnswer.includes('```') || correctAnswer.includes('def ') || correctAnswer.includes('function')) {
    type = 'coding';
  } else if (correctAnswer.length > 20) {
    type = 'short-answer';
  }
  
  return {
    id,
    question,
    type,
    options: options.length > 0 ? options : undefined,
    correctAnswer,
    explanation,
    difficulty,
    tags: []
  };
}

/**
 * 获取题目分数
 */
function getQuestionScore(type: string): number {
  switch (type) {
    case 'multiple-choice': return 5;
    case 'short-answer': return 10;
    case 'coding': return 20;
    default: return 10;
  }
}

/**
 * 估算答题时间
 */
function estimateQuizTime(questions: QuizGenerationOutput['questions']): number {
  let totalMinutes = 0;
  
  for (const q of questions) {
    switch (q.type) {
      case 'multiple-choice':
        totalMinutes += 2;
        break;
      case 'short-answer':
        totalMinutes += 5;
        break;
      case 'coding':
        totalMinutes += 15;
        break;
    }
  }
  
  return totalMinutes;
}

export default quizGeneration;
