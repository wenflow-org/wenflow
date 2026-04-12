/**
 * Content Agent v5.0
 * 
 * 状态感知的智能授课内容生成
 * 
 * 核心特性：
 * 1. 动态 Prompt 注入（状态快照）
 * 2. 认知深度分层（带时间衰减）
 * 3. 隐形干预策略
 * 4. 专注教学内容（不含练习）
 */

import { v4 as uuidv4 } from 'uuid';
import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { EventBus, getEventBus } from '../../gateway/event-bus';
import prisma from '../../config/database';

// 导入 v5.0 核心模块
import {
  LearningState,
  createInitialLearningState,
  updateBehavior,
  updateEmotion,
  updateCognitiveEngagement,
  updateLearningPressure,
  generateStateSnapshot,
  CognitiveLevel
} from '../tutor-core/learning-state';

import {
  InterventionStrategy,
  selectStrategy,
  generateStylePrompt
} from '../tutor-core/intervention-strategies';

// ==================== Agent 定义 ====================

export const contentAgentDefinition: AgentDefinition = {
  id: 'content-agent',
  name: '学习内容生成Agent',
  version: '5.0.0',
  type: 'content',
  category: 'standard',
  description: '基于学习状态的智能授课内容生成，动态调整教学策略',
  
  capabilities: [
    'state-aware-content',
    'adaptive-teaching',
    'cognitive-depth-tracking',
    'intervention-strategies'
  ],
  
  subscribes: [
    'path:created',
    'path:adjusted',
    'learning:struggle',
    'learning:mastery'
  ],
  
  publishes: [
    'content:generated',
    'content:adjusted',
    'state:updated'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      taskType: { type: 'string' },
      topic: { type: 'string' },
      difficulty: { type: 'string' },
      userLevel: { type: 'string' },
      mastery: { type: 'number' },
      frustration: { type: 'number' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      keyPoints: { type: 'array' },
      difficulty: { type: 'string' },
      nextTopic: { type: 'string' },
      stateSnapshot: { type: 'object' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// ==================== 会话状态缓存 ====================

const sessionStateCache = new Map<string, LearningState>();

function getSessionState(sessionId: string): LearningState | undefined {
  return sessionStateCache.get(sessionId);
}

function setSessionState(sessionId: string, state: LearningState): void {
  sessionStateCache.set(sessionId, state);
}

function clearSessionState(sessionId: string): void {
  sessionStateCache.delete(sessionId);
}

// ==================== 内容策略选择 ====================

interface ContentStrategy {
  type: 'foundation' | 'remedial' | 'standard' | 'challenge' | 'review';
  difficulty: 'easy' | 'medium' | 'hard';
  instruction: string;
  focusAreas: string[];
}

function selectContentStrategy(params: {
  mastery: number;
  frustration: number;
  depthScore: number;
  consecutiveErrors: number;
  userLevel: string;
}): ContentStrategy {
  const { mastery, frustration, depthScore, consecutiveErrors, userLevel } = params;
  
  // 高挫败感 → 补救模式
  if (frustration > 0.6) {
    return {
      type: 'remedial',
      difficulty: 'easy',
      instruction: '使用超简单的类比和示例，降低认知负荷，先建立信心',
      focusAreas: ['基础概念', '简单示例', '正向反馈']
    };
  }
  
  // 低掌握度 + 低挫败 → 基础模式
  if (mastery < 0.3 && frustration < 0.4) {
    return {
      type: 'foundation',
      difficulty: 'easy',
      instruction: '从零开始，用生活类比解释每个概念，确保理解',
      focusAreas: ['概念定义', '类比说明', '基础示例']
    };
  }
  
  // 连续错误 → 复习模式
  if (consecutiveErrors >= 2) {
    return {
      type: 'review',
      difficulty: 'easy',
      instruction: '回顾前序知识点，找出理解断层',
      focusAreas: ['知识回顾', '断层诊断', '循序渐进']
    };
  }
  
  // 高掌握 + 高深度 → 挑战模式
  if (mastery > 0.7 && depthScore > 0.6) {
    return {
      type: 'challenge',
      difficulty: 'hard',
      instruction: '提供进阶内容，引导深度思考',
      focusAreas: ['进阶概念', '最佳实践', '深度思考']
    };
  }
  
  // 默认 → 标准模式
  return {
    type: 'standard',
    difficulty: 'medium',
    instruction: '标准教学流程，逐步深入',
    focusAreas: ['核心概念', '示例演示', '要点总结']
  };
}

// ==================== 核心 Handler ====================

export async function contentAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  console.log('[Content-Agent v5.0] 开始处理请求');
  console.log('[Content-Agent v5.0] input:', JSON.stringify(input, null, 2));
  console.log('[Content-Agent v5.0] context:', JSON.stringify(context, null, 2));
  
  let result: AgentOutput | null = null;
  let error: any = null;

  try {
    // 从 input.metadata 获取任务信息
    const taskId = input.metadata?.taskId;
    const taskType = input.metadata?.taskType || 'reading';
    const topic = input.metadata?.topic || input.goal;
    
    console.log('[Content-Agent v5.0] 解析参数:', { taskId, taskType, topic });
    const description = input.metadata?.description;
    const taskGoal = input.metadata?.taskGoal;
    const userLevel = input.currentLevel || 'intermediate';
    
    // 获取或初始化学习状态
    const sessionId = `task_${taskId || Date.now()}`;
    let state = getSessionState(sessionId);
    
    if (!state) {
      state = createInitialLearningState(topic);
    }
    
    // 更新状态（如果有学生消息）
    const studentMessage = input.metadata?.studentMessage;
    if (studentMessage) {
      updateBehavior(state, studentMessage);
    }
    
    // 从 metadata 获取状态参数（如果有）
    const mastery = input.metadata?.mastery ?? state.understanding.mastery;
    const frustration = input.metadata?.frustration ?? state.emotion.frustration;
    
    // 更新状态
    state.understanding.mastery = mastery;
    state.emotion.frustration = frustration;
    updateLearningPressure(state);
    
    // 生成状态快照
    const { snapshot, emergency } = generateStateSnapshot(state);
    
    // 选择内容策略
    const contentStrategy = selectContentStrategy({
      mastery: snapshot.mastery,
      frustration: snapshot.frustration,
      depthScore: snapshot.depthScore,
      consecutiveErrors: snapshot.consecutiveErrors,
      userLevel
    });
    
    // 选择干预策略
    const interventionStrategy = selectStrategy(state);
    
    // 构建动态 Prompt
    const statePrompt = buildStatePrompt(snapshot, emergency);
    const stylePrompt = generateStylePrompt(interventionStrategy);
    
    // 生成教学内容
    const content = await generateTeachingContent({
      topic,
      description,
      taskGoal,
      userLevel,
      contentStrategy,
      statePrompt,
      stylePrompt,
      context: input.metadata
    });
    
    // 缓存更新后的状态
    setSessionState(sessionId, state);
    
    // 发布事件
    await eventBus.emit({
      type: 'content:generated',
      source: 'content-agent',
      userId: context.userId,
      data: {
        taskId,
        taskType,
        topic,
        strategy: contentStrategy.type,
        stateSnapshot: snapshot
      }
    });
    
    result = {
      success: true,
      content: {
        ...content,
        stateSnapshot: snapshot,
        strategy: contentStrategy.type,
        difficulty: contentStrategy.difficulty
      },
      metadata: {
        agentId: 'content-agent',
        agentName: '学习内容生成 Agent v5.0',
        agentType: 'content',
        confidence: 0.85,
        generatedAt: new Date().toISOString()
      }
    };

    return result;
  } catch (e) {
    error = e;
    result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'content-agent',
        agentName: '学习内容生成Agent',
        agentType: 'content',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
    return result;
  } finally {
    // 记录 Agent 调用日志
    try {
      const durationMs = Date.now() - startTime;
      await prisma.agent_call_logs.create({
        data: {
          id: uuidv4(),
          agentId: 'content-agent',
          userId: context.userId,
          input: JSON.stringify({
            goal: input.goal,
            currentLevel: input.currentLevel,
            metadata: input.metadata
          }),
          output: JSON.stringify(result),
          success: result?.success ?? false,
          durationMs,
          error: error?.message
        }
      });
    } catch (logError) {
      console.error('[Content-Agent] 日志记录失败:', logError);
    }
  }
}

// ==================== 辅助函数 ====================

function buildStatePrompt(
  snapshot: any,
  emergency: string | null
): string {
  const lines: string[] = [];
  
  lines.push('【当前学习者状态快照】');
  lines.push(`- 当前主题：${snapshot.currentTopic}`);
  lines.push(`- 掌握度：${Math.round(snapshot.mastery * 100)}%`);
  lines.push(`- 挫败感：${Math.round(snapshot.frustration * 100)}%`);
  lines.push(`- 专注度：${Math.round(snapshot.focus * 100)}%`);
  lines.push(`- 压力等级：${snapshot.lssLevel.toUpperCase()}`);
  lines.push(`- 认知深度：${Math.round(snapshot.depthScore * 100)}%`);
  
  if (emergency) {
    lines.push('');
    lines.push('⚠️ ' + emergency);
  }
  
  return lines.join('\n');
}

async function generateTeachingContent(params: {
  topic: string;
  description?: string;
  taskGoal?: string;
  userLevel: string;
  contentStrategy: ContentStrategy;
  statePrompt: string;
  stylePrompt: string;
  context?: any;
}): Promise<any> {
  const {
    topic,
    description,
    taskGoal,
    userLevel,
    contentStrategy,
    statePrompt,
    stylePrompt,
    context
  } = params;
  
  const client = getOpenAIClient();
  
  // 构建学习上下文
  const learningContext = [
    context?.pathName && `学习路径：${context.pathName}`,
    context?.subject && `科目：${context.subject}`,
    context?.weekObjectives && `本周目标：${Array.isArray(context.weekObjectives) ? context.weekObjectives.join('、') : context.weekObjectives}`,
    taskGoal && `本课任务：${taskGoal}`,
    description && `任务描述：${description}`
  ].filter(Boolean).join('\n');
  
  const systemPrompt = `你是一位经验丰富的AI教师，专注于${context?.subject || '编程'}教学。

${statePrompt}

【教学策略】
- 策略类型：${contentStrategy.type}
- 难度级别：${contentStrategy.difficulty}
- 教学指导：${contentStrategy.instruction}
- 重点领域：${contentStrategy.focusAreas.join('、')}

${stylePrompt}

【输出要求】
1. 内容要紧密围绕主题"${topic}"
2. 根据学习者状态调整讲解深度和风格
3. 使用生动的类比和实际例子
4. 结构清晰，便于理解
5. 控制篇幅在 800-1500 字`;

  const userPrompt = `请为以下主题生成教学内容：

主题：${topic}
${learningContext ? '\n学习上下文：\n' + learningContext : ''}

请按照以下结构输出：

## 核心概念
[用简单易懂的语言解释核心概念]

## 为什么重要
[说明这个概念的实际意义和应用场景]

## 如何使用
[给出具体的使用方法和示例]

## 常见误区
[列举学习者容易犯的错误]

## 下一步
[建议学习的下一个主题]

请确保内容${contentStrategy.difficulty === 'easy' ? '通俗易懂' : contentStrategy.difficulty === 'hard' ? '深入专业' : '深入浅出'}。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  
  console.log('[Content-Agent v5.0] 调用 AI，主题:', topic);
  console.log('[Content-Agent v5.0] 策略:', contentStrategy.type);
  
  try {
    const response = await client.chatCompletion({
      messages,
      max_tokens: 4000,  // 生成详细教学内容需要更多空间
      temperature: 0.7
    });
    
    console.log('[Content-Agent v5.0] AI 响应:', JSON.stringify(response, null, 2).substring(0, 500));
    
    const content = response.choices[0]?.message?.content || '';
    
    console.log('[Content-Agent v5.0] 生成内容长度:', content.length);
    
    // 解析内容结构
    const sections = parseContentSections(content);
    
    return {
      explanation: content,
      sections,
      keyPoints: extractKeyPoints(content),
      resources: []
    };
  } catch (error) {
    console.error('[Content-Agent v5.0] AI 调用失败:', error);
    throw error;
  }
}

function parseContentSections(content: string): any[] {
  const sections: any[] = [];
  const regex = /^##\s+(.+)$/gm;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const title = match[1];
    const start = match.index;
    const nextMatch = regex.exec(content);
    const end = nextMatch ? nextMatch.index : content.length;
    
    // 重置 regex 位置
    regex.lastIndex = match.index + match[0].length;
    
    const sectionContent = content.slice(start + match[0].length, end).trim();
    sections.push({
      title,
      content: sectionContent
    });
  }
  
  return sections;
}

function extractKeyPoints(content: string): string[] {
  const points: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    // 提取要点列表
    const match = line.match(/^[-•*]\s+(.+)$/);
    if (match) {
      points.push(match[1]);
    }
    // 提取加粗的关键词
    const boldMatch = line.match(/\*\*([^*]+)\*\*/g);
    if (boldMatch) {
      boldMatch.forEach(b => {
        points.push(b.replace(/\*\*/g, ''));
      });
    }
  }
  
  return [...new Set(points)].slice(0, 10);
}

// 导出状态管理函数
export {
  getSessionState,
  setSessionState,
  clearSessionState
};
