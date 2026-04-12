/**
 * Content Agent v5.0 - 授课型内容生成
 * 
 * 专注于授课学习内容，基于学生学习状态动态生成教学内容
 * 
 * 特性：
 * 1. 状态感知 - 根据学生掌握度、挫败感、认知深度调整内容
 * 2. 渐进式讲解 - 从简单到复杂，循序渐进
 * 3. 隐形干预 - 通过内容调整引导学习行为
 * 4. 移除练习 - 练习交由专门的 exercise-agent
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

/**
 * Content Agent 定义
 */
export const contentAgentDefinition: AgentDefinition = {
  id: 'content-agent',
  name: '授课内容生成Agent',
  version: '5.0.0',
  type: 'content',
  category: 'standard',
  description: '基于学习状态生成针对性的授课内容',
  
  capabilities: [
    'adaptive-content',
    'state-aware-generation',
    'progressive-disclosure'
  ],
  
  subscribes: [
    'path:created',
    'learning:start',
    'learning:struggle'
  ],
  
  publishes: [
    'content:generated',
    'content:adjusted'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      mastery: { type: 'number' },
      frustration: { type: 'number' },
      depthScore: { type: 'number' },
      sessionCount: { type: 'number' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      keyPoints: { type: 'array' },
      difficulty: { type: 'string' },
      nextTopic: { type: 'string' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 教学内容生成系统提示
const TEACHING_SYSTEM_PROMPT = `你是一位专业的编程教学内容设计师。

## 设计原则
1. **渐进式**：从简单概念开始，逐步深入
2. **实用导向**：用真实场景和例子说明概念
3. **互动性**：在内容中嵌入思考问题
4. **简洁明了**：每个知识点不超过 2-3 段

## 内容结构
根据学生状态调整内容结构：

### 初学者（掌握度 < 30%）
- 用生活类比解释概念
- 每个概念配一个简单示例
- 强调"是什么"和"为什么"

### 进阶者（掌握度 30-70%）
- 展示实际应用场景
- 对比不同方法的优劣
- 强调"怎么做"和"注意事项"

### 熟练者（掌握度 > 70%）
- 提供进阶技巧和最佳实践
- 讨论边界情况和异常处理
- 引导探索更深层次的知识

## 格式要求
使用 Markdown 格式，包含：
- ## 知识点标题
- 简短的概念说明
- 代码示例（带注释）
- 💡 思考题（1-2 个）
- 📌 要点总结`;

/**
 * Content Agent 处理函数
 */
export async function contentAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  // 从 input 获取参数
  const topic = input.metadata?.topic || input.goal || '编程基础';
  const taskId = input.metadata?.taskId;
  const description = input.metadata?.description;
  const taskGoal = input.metadata?.taskGoal;
  
  // 学习状态参数
  const mastery = input.metadata?.mastery || 0;
  const frustration = input.metadata?.frustration || 0;
  const depthScore = input.metadata?.depthScore || 0.5;
  const userLevel = input.currentLevel || 'beginner';
  
  // 学习上下文
  const learningContext = input.metadata?.learningContext || '';
  const previousTopics = input.metadata?.previousTopics || [];

  try {
    // 根据状态选择内容生成策略
    const contentStrategy = selectContentStrategy({
      mastery,
      frustration,
      depthScore,
      userLevel
    });
    
    console.log('[ContentAgent] 内容策略:', contentStrategy);
    
    // 生成教学内容
    const teachingContent = await generateTeachingContent({
      topic,
      description,
      taskGoal,
      learningContext,
      previousTopics,
      strategy: contentStrategy,
      userLevel
    });
    
    // 发布事件
    await eventBus.emit({
      type: 'content:generated',
      source: 'content-agent',
      userId: context.userId,
      data: {
        taskId,
        topic,
        strategy: contentStrategy.type,
        contentLength: teachingContent.content.length
      }
    });

    // 记录日志
    const durationMs = Date.now() - startTime;
    await logAgentCall({
      userId: context.userId,
      input: { topic, mastery, frustration, depthScore },
      output: { success: true },
      durationMs
    });

    return {
      success: true,
      content: {
        taskId: taskId || `task_${Date.now()}`,
        explanation: teachingContent.content + '\n\n## 要点总结\n' + teachingContent.keyPoints.map((k: string) => `- ${k}`).join('\n') + '\n\n## 下一主题\n' + teachingContent.nextTopic
      },
      metadata: {
        agentId: 'content-agent',
        agentName: '授课内容生成Agent',
        agentType: 'content',
        confidence: 0.85,
        generatedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('[ContentAgent] 错误:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'content-agent',
        agentName: '授课内容生成Agent',
        agentType: 'content',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 内容策略类型
 */
interface ContentStrategy {
  type: 'foundation' | 'progressive' | 'advanced' | 'remedial';
  difficulty: 'easy' | 'medium' | 'hard';
  instruction: string;
  focusAreas: string[];
}

/**
 * 选择内容生成策略
 */
function selectContentStrategy(params: {
  mastery: number;
  frustration: number;
  depthScore: number;
  userLevel: string;
}): ContentStrategy {
  const { mastery, frustration, depthScore, userLevel } = params;
  
  // 高挫败感 → 补救策略
  if (frustration > 0.6) {
    return {
      type: 'remedial',
      difficulty: 'easy',
      instruction: '使用超简单的类比和示例，降低认知负荷',
      focusAreas: ['基础概念', '单一知识点', '正向反馈']
    };
  }
  
  // 低掌握度 → 基础策略
  if (mastery < 0.3) {
    return {
      type: 'foundation',
      difficulty: 'easy',
      instruction: '从零开始，用生活类比解释每个概念',
      focusAreas: ['概念理解', '简单示例', '基础语法']
    };
  }
  
  // 中等掌握度 + 低认知深度 → 渐进策略
  if (mastery < 0.7 && depthScore < 0.4) {
    return {
      type: 'progressive',
      difficulty: 'medium',
      instruction: '展示实际应用，引导深入思考',
      focusAreas: ['应用场景', '最佳实践', '常见错误']
    };
  }
  
  // 高掌握度 → 进阶策略
  return {
    type: 'advanced',
    difficulty: 'hard',
    instruction: '提供进阶技巧，讨论边界情况',
    focusAreas: ['高级技巧', '性能优化', '架构思考']
  };
}

/**
 * 生成教学内容
 */
async function generateTeachingContent(params: {
  topic: string;
  description?: string;
  taskGoal?: string;
  learningContext?: string;
  previousTopics?: string[];
  strategy: ContentStrategy;
  userLevel: string;
}): Promise<{
  content: string;
  keyPoints: string[];
  nextTopic: string;
}> {
  const client = getOpenAIClient();
  const { topic, description, taskGoal, learningContext, strategy, userLevel } = params;
  
  // 构建系统提示
  const systemPrompt = `${TEACHING_SYSTEM_PROMPT}

【当前教学策略】
- 类型：${strategy.type}
- 难度：${strategy.difficulty}
- 指令：${strategy.instruction}
- 重点领域：${strategy.focusAreas.join('、')}

【用户水平】
${userLevel === 'beginner' ? '初学者 - 需要详细解释和简单示例' : 
  userLevel === 'intermediate' ? '进阶者 - 可以直接讨论应用和技巧' : 
  '熟练者 - 关注进阶和最佳实践'}`;

  // 构建用户提示
  const userPrompt = buildUserPrompt(topic, description, taskGoal, learningContext);
  
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  
  const response = await client.chatCompletion({ 
    messages,
    temperature: 0.6,
    max_tokens: 4000  // 生成详细教学内容需要更多空间
  });
  
  const content = response.choices[0]?.message.content || '';
  
  // 提取关键点
  const keyPoints = extractKeyPoints(content);
  
  // 建议下一个主题
  const nextTopic = suggestNextTopic(topic, strategy.type);
  
  return { content, keyPoints, nextTopic };
}

/**
 * 构建用户提示
 */
function buildUserPrompt(
  topic: string,
  description?: string,
  taskGoal?: string,
  learningContext?: string
): string {
  const parts = [`请为"${topic}"生成教学内容。`];
  
  if (description) {
    parts.push(`\n主题描述：${description}`);
  }
  
  if (taskGoal) {
    parts.push(`\n学习目标：${taskGoal}`);
  }
  
  if (learningContext) {
    parts.push(`\n学习背景：${learningContext}`);
  }
  
  parts.push(`\n请生成清晰、循序渐进的教学内容，包含：
1. 概念讲解（用类比帮助理解）
2. 代码示例（带详细注释）
3. 1-2 个思考题（激发思考）
4. 要点总结（3-5 条）`);
  
  return parts.join('\n');
}

/**
 * 提取关键点
 */
function extractKeyPoints(content: string): string[] {
  const keyPoints: string[] = [];
  
  // 匹配要点总结部分
  const summaryMatch = content.match(/📌\s*要点[总结]*[：:]\s*([\s\S]*?)(?=##|$)/);
  if (summaryMatch) {
    const lines = summaryMatch[1].split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 5);
    keyPoints.push(...lines.slice(0, 5));
  }
  
  // 如果没有找到，尝试提取标题
  if (keyPoints.length === 0) {
    const titleMatches = content.matchAll(/##\s*([^#\n]+)/g);
    for (const match of titleMatches) {
      if (keyPoints.length >= 5) break;
      const title = match[1].trim();
      if (title && !title.includes('总结')) {
        keyPoints.push(title);
      }
    }
  }
  
  return keyPoints;
}

/**
 * 建议下一个主题
 */
function suggestNextTopic(currentTopic: string, strategyType: string): string {
  // 简单的下一个主题建议逻辑
  // 实际可以根据知识图谱来推荐
  return `${currentTopic}的进阶应用`;
}

/**
 * 记录 Agent 调用日志
 */
async function logAgentCall(params: {
  userId: string;
  input: any;
  output: any;
  durationMs: number;
}): Promise<void> {
  try {
    await prisma.agent_call_logs.create({
      data: {
        id: uuidv4(),
        agentId: 'content-agent',
        userId: params.userId,
        input: JSON.stringify(params.input),
        output: JSON.stringify(params.output),
        success: params.output.success,
        durationMs: params.durationMs,
        calledAt: new Date()
      }
    });
  } catch (error) {
    console.error('[ContentAgent] 日志记录失败:', error);
  }
}

/**
 * 调整内容难度
 */
export async function adjustContentDifficulty(
  content: string,
  direction: 'easier' | 'harder'
): Promise<string> {
  const client = getOpenAIClient();
  
  const instruction = direction === 'easier'
    ? '将以下内容调整为更简单的版本：使用更通俗的语言，减少专业术语，增加示例和解释'
    : '将以下内容调整为更有挑战性的版本：增加深度内容，减少直接解释，增加思考性问题';
  
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是一位内容编辑专家，擅长调整内容难度。' },
    { role: 'user', content: `${instruction}\n\n${content}` }
  ];
  
  const response = await client.chatCompletion({ messages, temperature: 0.4 });
  return response.choices[0]?.message.content || content;
}

export default contentAgentHandler;
