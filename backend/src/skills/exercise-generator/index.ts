/**
 * Exercise Generator Skill
 * 
 * 生成多样化的练习题，包括填空、选择、编程等题型
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * Exercise Generator Skill 定义
 */
export const exerciseGeneratorDefinition: SkillDefinition = {
  name: 'exercise-generator',
  version: '1.0.0',
  category: 'generation',
  description: '生成多样化的练习题，包括填空、选择、编程、简答等题型',
  
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '练习主题',
        required: true
      },
      learningObjectives: {
        type: 'string',
        description: '学习目标（逗号分隔）',
        default: ''
      },
      difficulty: {
        type: 'string',
        description: '难度：easy/medium/hard',
        default: 'medium'
      },
      userLevel: {
        type: 'string',
        description: '用户水平：beginner/intermediate/advanced',
        default: 'beginner'
      },
      questionCount: {
        type: 'number',
        description: '题目数量',
        default: 3
      },
      questionTypes: {
        type: 'string',
        description: '题型（逗号分隔）',
        default: 'fill-blank,coding'
      },
      context: {
        type: 'string',
        description: '相关学习内容（用于生成针对性练习）'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      exercises: {
        type: 'string',
        description: '练习题列表（JSON 字符串）'
      },
      totalPoints: {
        type: 'number',
        description: '总分'
      },
      estimatedTime: {
        type: 'number',
        description: '预计完成时间（分钟）'
      }
    }
  },
  
  capabilities: ['exercise-generation', 'question-creation', 'adaptive-difficulty'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Exercise Generator 输入
 */
export interface ExerciseGeneratorInput {
  topic: string;
  learningObjectives?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  userLevel?: 'beginner' | 'intermediate' | 'advanced';
  questionCount?: number;
  questionTypes?: Array<'fill-blank' | 'multiple-choice' | 'coding' | 'short-answer'>;
  context?: string;
}

/**
 * Exercise Generator 输出
 */
export interface ExerciseGeneratorOutput {
  exercises: Array<{
    id: string;
    type: 'fill-blank' | 'multiple-choice' | 'coding' | 'short-answer';
    question: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
    hint: string;
    points: number;
    estimatedMinutes: number;
  }>;
  totalPoints: number;
  estimatedTime: number;
}

/**
 * 题型配置
 */
const QUESTION_TYPE_CONFIG = {
  'fill-blank': {
    name: '填空题',
    points: 5,
    template: `请生成{count}道填空题，考查"{topic}"。
每道题包含：
1. 题干（包含一个空白处用____表示）
2. 正确答案
3. 详细解析
4. 提示信息`,
    systemPrompt: '你是一位填空题设计专家，擅长设计考查关键概念的填空题。'
  },
  'multiple-choice': {
    name: '选择题',
    points: 5,
    template: `请生成{count}道选择题，考查"{topic}"。
每道题包含：
1. 题干
2. 4 个选项（A/B/C/D）
3. 正确答案（A/B/C/D）
4. 详细解析
5. 提示信息`,
    systemPrompt: '你是一位选择题设计专家，擅长设计有迷惑性选项的选择题。'
  },
  'coding': {
    name: '编程题',
    points: 10,
    template: `请生成{count}道编程题，考查"{topic}"。
每道题包含：
1. 题目描述（包含背景场景）
2. 具体要求（清晰的功能要求）
3. 输入输出示例
4. 参考代码（Python）
5. 测试用例
6. 提示信息`,
    systemPrompt: '你是一位编程题设计专家，擅长设计实践性强的编程任务。'
  },
  'short-answer': {
    name: '简答题',
    points: 8,
    template: `请生成{count}道简答题，考查"{topic}"。
每道题包含：
1. 问题
2. 参考答案要点
3. 评分标准
4. 提示信息`,
    systemPrompt: '你是一位简答题设计专家，擅长设计考查理解和应用的简答题。'
  }
};

/**
 * Exercise Generator Skill 实现
 * 优化：合并所有题型为一次 AI 调用，避免多次请求
 */
export async function exerciseGenerator(
  input: ExerciseGeneratorInput
): Promise<SkillExecutionResult<ExerciseGeneratorOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      topic,
      learningObjectives = [],
      difficulty = 'medium',
      userLevel = 'beginner',
      questionCount = 3,
      questionTypes = ['fill-blank', 'coding'],
      context = ''
    } = input;
    
    // 合并所有题型为一次调用
    const typeNames = questionTypes.map(t => QUESTION_TYPE_CONFIG[t]?.name || t).join('、');
    
    const systemPrompt = `你是一位综合练习题设计专家，擅长设计多样化的练习题。
请生成${questionCount}道练习题，涵盖以下题型：${typeNames}。

输出格式要求：
- 每道题用 "## 第X题" 开头
- 标明题型
- 包含题干、答案、解析、提示
- 用 Markdown 格式`;

    const userPrompt = buildUnifiedPrompt(topic, questionTypes, questionCount, learningObjectives, difficulty, userLevel, context);
    
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ 
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 
      temperature: 0.6,
      max_tokens: 4000  // 生成多道练习题和详细解析需要更多空间
    });
    
    const content = response.choices[0]?.message.content || '';
    
    // 解析生成的练习
    const exercises = parseAllExercises(content, questionTypes);
    
    // 限制题目数量
    const limitedExercises = exercises.slice(0, questionCount);
    
    // 计算总分和预计时间
    const totalPoints = limitedExercises.reduce((sum, ex) => sum + ex.points, 0);
    const estimatedTime = limitedExercises.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);

    return {
      success: true,
      output: {
        exercises: limitedExercises,
        totalPoints,
        estimatedTime
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'EXERCISE_GENERATOR_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 构建统一的 Prompt（一次生成所有题型）
 */
function buildUnifiedPrompt(
  topic: string,
  questionTypes: string[],
  questionCount: number,
  learningObjectives: string[],
  difficulty: string,
  userLevel: string,
  context: string
): string {
  const parts = [`请为"${topic}"生成${questionCount}道练习题。`];
  
  // 添加题型说明
  parts.push(`\n题型要求：`);
  questionTypes.forEach(type => {
    const config = QUESTION_TYPE_CONFIG[type];
    if (config) {
      parts.push(`- ${config.name}：${type === 'fill-blank' ? '填空处用____表示' : type === 'multiple-choice' ? '4个选项A/B/C/D' : type === 'coding' ? '包含输入输出示例和参考代码' : '包含评分标准'}`);
    }
  });
  
  if (learningObjectives.length > 0) {
    parts.push(`\n学习目标：${learningObjectives.join('、')}`);
  }
  
  parts.push(`\n难度：${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'}`);
  parts.push(`目标用户：${userLevel === 'beginner' ? '零基础初学者' : userLevel === 'intermediate' ? '有一定基础' : '高级学习者'}`);
  
  if (context) {
    parts.push(`\n相关学习内容：\n${context.substring(0, 300)}`);
  }
  
  parts.push('\n请用中文回答，格式清晰，每道题包含：题型、题干、答案、解析、提示。');
  
  return parts.join('\n');
}

/**
 * 解析所有练习题
 */
function parseAllExercises(
  content: string,
  questionTypes: string[]
): ExerciseGeneratorOutput['exercises'] {
  const exercises: ExerciseGeneratorOutput['exercises'] = [];
  
  // 按题号分割
  const questionBlocks = content.split(/##\s*第?\d+\s*题|###?\s*题目?\s*\d+/i);
  
  for (let i = 0; i < questionBlocks.length; i++) {
    const block = questionBlocks[i];
    if (block.trim().length < 20) continue;
    
    // 检测题型
    const detectedType = detectQuestionType(block, questionTypes);
    const config = QUESTION_TYPE_CONFIG[detectedType] || QUESTION_TYPE_CONFIG['fill-blank'];
    
    const exercise = parseSingleExercise(block, detectedType, config.points, i + 1);
    
    if (exercise) {
      exercises.push(exercise);
    }
  }
  
  return exercises;
}

/**
 * 检测题型
 */
function detectQuestionType(block: string, allowedTypes: string[]): string {
  if (block.includes('编程') || block.includes('代码') || block.includes('```python')) {
    return allowedTypes.includes('coding') ? 'coding' : 'short-answer';
  }
  if (block.includes('A.') || block.includes('A、') || /[A-D][\.、]/.test(block)) {
    return allowedTypes.includes('multiple-choice') ? 'multiple-choice' : 'fill-blank';
  }
  if (block.includes('____') || block.includes('______') || block.includes('填空')) {
    return 'fill-blank';
  }
  return allowedTypes[0] || 'fill-blank';
}

/**
 * 构建完整 Prompt
 */
function buildPrompt(
  template: string,
  learningObjectives: string[],
  difficulty: string,
  userLevel: string,
  context: string
): string {
  const parts = [template];
  
  if (learningObjectives.length > 0) {
    parts.push(`\n\n学习目标：\n${learningObjectives.map(obj => `- ${obj}`).join('\n')}`);
  }
  
  parts.push(`\n\n难度：${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'}`);
  parts.push(`\n目标用户：${userLevel === 'beginner' ? '零基础初学者' : userLevel === 'intermediate' ? '有一定基础' : '高级学习者'}`);
  
  if (context) {
    parts.push(`\n\n相关学习内容：\n${context.substring(0, 500)}`);
  }
  
  parts.push('\n\n请用中文回答，格式清晰。');
  
  return parts.join('\n');
}

/**
 * 解析生成的练习题
 */
function parseExercises(
  content: string,
  type: string,
  basePoints: number
): ExerciseGeneratorOutput['exercises'] {
  const exercises: ExerciseGeneratorOutput['exercises'] = [];
  
  // 按题目分割（尝试多种分隔符）
  const questionBlocks = splitQuestions(content);
  
  for (let i = 0; i < questionBlocks.length; i++) {
    const block = questionBlocks[i];
    const exercise = parseSingleExercise(block, type, basePoints, i + 1);
    
    if (exercise) {
      exercises.push(exercise);
    }
  }
  
  return exercises;
}

/**
 * 分割题目块
 */
function splitQuestions(content: string): string[] {
  // 尝试按题号分割
  const patterns = [
    /(?:^|\n)\s*(?:第？\s*\d+\s*题 | 题目\s*\d+|Question\s*\d+|\d+[\.、])/gi,
    /(?:^|\n)\s*(?:【?\d+】?|第？\d+ 部分)/gi,
    /\n\s*\n(?=\s*(?:第？\d+|题目|Question|\d+[\.]))/g
  ];
  
  for (const pattern of patterns) {
    const matches = content.split(pattern);
    if (matches.length > 1) {
      return matches.filter(block => block.trim().length > 20);
    }
  }
  
  // 如果无法分割，返回整个内容作为一道题
  return [content];
}

/**
 * 解析单道练习题
 */
function parseSingleExercise(
  block: string,
  type: string,
  basePoints: number,
  index: number
): ExerciseGeneratorOutput['exercises'][number] | null {
  try {
    // 提取题干
    const question = extractQuestion(block, type);
    
    // 提取选项（如果是选择题）
    const options = type === 'multiple-choice' ? extractOptions(block) : undefined;
    
    // 提取正确答案
    const correctAnswer = extractAnswer(block, type);
    
    // 提取解析
    const explanation = extractExplanation(block);
    
    // 提取提示
    const hint = extractHint(block);
    
    // 估算完成时间
    const estimatedMinutes = estimateTime(type, block.length);
    
    return {
      id: `ex_${Date.now()}_${index}`,
      type: type as any,
      question,
      options,
      correctAnswer,
      explanation,
      hint,
      points: basePoints,
      estimatedMinutes
    };
  } catch (error) {
    console.error('解析练习题失败:', error);
    return null;
  }
}

/**
 * 提取题干
 */
function extractQuestion(block: string, type: string): string {
  // 移除题号
  let question = block.replace(/^(?:第？\d+\s*题 | 题目\s*\d+|Question\s*\d+|\d+[\.、])\s*/i, '');
  
  // 对于编程题，提取到"要求"或"参考答案"之前的内容
  if (type === 'coding') {
    const stopMarkers = ['参考答案', '参考代码', '答案', '解析', '要求：'];
    for (const marker of stopMarkers) {
      const idx = question.indexOf(marker);
      if (idx > 0) {
        question = question.substring(0, idx);
        break;
      }
    }
  } else {
    // 其他题型，提取到"答案"或"解析"之前
    const stopMarkers = ['答案', '解析', '提示'];
    for (const marker of stopMarkers) {
      const idx = question.indexOf(marker);
      if (idx > 0) {
        question = question.substring(0, idx);
        break;
      }
    }
  }
  
  return question.trim();
}

/**
 * 提取选项（选择题）
 */
function extractOptions(block: string): string[] {
  const options: string[] = [];
  const optionPatterns = [
    /([A-D])[\.、:：]\s*([^\n]+)/g,
    /【?([A-D])】?\s*([^\n]+)/g
  ];
  
  for (const pattern of optionPatterns) {
    const matches = [...block.matchAll(pattern)];
    if (matches.length >= 4) {
      return matches.map(m => m[2].trim());
    }
  }
  
  return options;
}

/**
 * 提取答案
 */
function extractAnswer(block: string, type: string): string {
  const answerPatterns = [
    /(?:正确)? 答案 [:：]?\s*([A-D]|[^\n]+)/i,
    /(?:参考)? 答案 [:：]?\s*([^\n]+)/i,
    /答案 (?:是 | 为)?([A-D])/i
  ];
  
  for (const pattern of answerPatterns) {
    const match = block.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  // 对于编程题，提取代码块
  if (type === 'coding') {
    const codeMatch = block.match(/```(?:python)?\n([\s\S]*?)```/);
    if (codeMatch) {
      return codeMatch[1].trim();
    }
  }
  
  return '参考答案见解析';
}

/**
 * 提取解析
 */
function extractExplanation(block: string): string {
  const explanationMarkers = ['解析', '答案解析', '详解', 'Explanation'];
  
  for (const marker of explanationMarkers) {
    const idx = block.indexOf(marker);
    if (idx > 0) {
      let endIdx = block.indexOf('提示', idx);
      if (endIdx === -1) endIdx = block.indexOf('下一题', idx);
      if (endIdx === -1) endIdx = block.length;
      
      return block.substring(idx + marker.length, endIdx).trim();
    }
  }
  
  // 如果没有找到解析，返回答案部分
  return '详细解析请参考解题思路';
}

/**
 * 提取提示
 */
function extractHint(block: string): string {
  const hintMarkers = ['提示', 'hint', '点拨', '思路'];
  
  for (const marker of hintMarkers) {
    const idx = block.indexOf(marker);
    if (idx > 0) {
      const nextLine = block.indexOf('\n', idx);
      if (nextLine > 0) {
        return block.substring(idx + marker.length, nextLine).trim();
      }
    }
  }
  
  return '仔细思考题目要求，回顾相关知识点';
}

/**
 * 估算完成时间
 */
function estimateTime(type: string, contentLength: number): number {
  const baseTimes = {
    'fill-blank': 2,
    'multiple-choice': 2,
    'short-answer': 5,
    'coding': 15
  };
  
  return baseTimes[type as keyof typeof baseTimes] || 5;
}

export default exerciseGenerator;
