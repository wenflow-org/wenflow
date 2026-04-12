/**
 * Path Agent
 * 
 * 学习路径规划 + 动态重规划
 * 
 * 概念模型：
 * - 学习路径 (learning_path)：用户的一个学习目标，如"Python Excel自动化"
 * - 里程碑 (milestone)：关键学习阶段，如"Python基础"、"Excel操作"
 * - 子任务 (subtask)：每个里程碑下的具体任务
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext,
  MilestoneOutput,
  SubtaskOutput
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { textStructureAnalyzer } from '../../skills/text-structure-analyzer';
import { timeEstimator } from '../../skills/time-estimator';
import { logger } from '../../utils/logger';

interface PathOutput {
  id?: string;
  name: string;
  subject: string;
  totalMilestones: number;
  estimatedHours?: number;
  milestones: MilestoneOutput[];
}

/**
 * Path Agent 定义
 */
export const pathAgentDefinition: AgentDefinition = {
  id: 'path-agent',
  name: '学习路径规划Agent',
  version: '2.0.0',
  type: 'path',
  category: 'standard',
  description: '根据用户目标生成里程碑式学习路径，支持动态调整',
  
  capabilities: [
    'goal-analysis',
    'path-generation',
    'milestone-planning',
    'dynamic-replanning',
    'time-estimation'
  ],
  
  subscribes: [
    'learning:speed:change',
    'learning:focus:shift',
    'learning:fatigue:high',
    'learning:struggle',
    'learning:mastery'
  ],
  
  publishes: [
    'path:created',
    'path:adjusted',
    'path:completed'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      goal: { type: 'string', description: '用户的真实学习目标' },
      currentLevel: { type: 'string', description: '用户当前水平' },
      timePerDay: { type: 'string', description: '每天可用时间' },
      metadata: {
        type: 'object',
        properties: {
          availableTime: { type: 'string' },
          deadline: { type: 'string' },
          deadlineText: { type: 'string' }
        }
      },
      // 新增：完整数据包
      structuredData: {
        type: 'object',
        description: 'GoalConversationAgent 梳理的结构化信息'
      },
      confirmedProposal: {
        type: 'object',
        description: '用户确认的方案轮廓'
      },
      confidenceScores: {
        type: 'object',
        description: '置信度评分'
      },
      conversationHistory: {
        type: 'array',
        description: '完整对话历史'
      }
    },
    required: ['type', 'goal']
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          totalMilestones: { type: 'number' },
          estimatedHours: { type: 'number' },
          milestones: { type: 'array' }
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

/**
 * Path Agent 处理函数
 */
export async function pathAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  try {
    // 1. 分析用户目标
    const goalAnalysis = await analyzeGoal(input, context);
    
    // 2. 生成学习路径（包含里程碑）
    const path = await generatePath(input, context, goalAnalysis);
    
    // 3. 发布路径创建事件
    await eventBus.emit({
      type: 'path:created',
      source: 'path-agent',
      userId: context.userId,
      data: {
        pathId: path.id,
        pathName: path.name,
        totalMilestones: path.milestones?.length || 0
      }
    });

    return {
      success: true,
      path,
      metadata: {
        agentId: 'path-agent',
        agentName: '学习路径规划Agent',
        agentType: 'path',
        confidence: goalAnalysis.confidence,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'path-agent',
        agentName: '学习路径规划Agent',
        agentType: 'path',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 分析用户目标
 */
async function analyzeGoal(input: AgentInput, context: AgentContext): Promise<{
  subject: string;
  level: string;
  focus: string[];
  context: string;
  confidence: number;
}> {
  const client = getOpenAIClient();
  
  // 优先使用结构化数据（如果有）
  const structuredData = input.structuredData as any;
  const confirmedProposal = input.confirmedProposal as any;
  const conversationHistory = input.conversationHistory as any[] || [];
  
  // 如果提供了结构化数据，直接使用
  if (structuredData) {
    logger.info('使用结构化数据', {
      learner: structuredData.learner,
      end_user: structuredData.end_user,
      context: structuredData.learning_context
    });
    
    // 识别场景类型
    let scenario = 'standard';
    if (structuredData.learner?.identity === '帮他人') {
      scenario = 'proxy_learning';
    } else if (structuredData.learning_context?.urgency === 'urgent') {
      scenario = 'urgent_learning';
    } else if (structuredData.learning_context?.motivation === 'interest') {
      scenario = 'interest_learning';
    }
    
    return {
      subject: input.goal,
      level: structuredData.learner?.skill_level || input.currentLevel || 'beginner',
      focus: structuredData.end_user?.pain_points || [],
      context: structuredData.end_user?.identity || '',
      confidence: input.confidenceScores?.understanding || 0.8,
      // @ts-ignore
      scenario,
      // @ts-ignore
      structuredData,
      // @ts-ignore
      confirmedProposal,
      // @ts-ignore
      conversationHistory
    };
  }
  
  const systemPrompt = `你是一位教育规划专家，负责分析用户的学习目标。
请分析用户的学习目标，识别：
1. 学习主题/领域（必须是 2-4 字的短标签，如"创业"、"编程"、"前端"、"数据分析"等）
2. 适合的学习水平（必须优先尊重用户明确声明的水平）
3. 学习重点
4. 具体应用场景/上下文（保留用户提到的具体项目、公司、领域等，如"腾讯股票分析"、"电商运营"等；若无则为空字符串）
5. 分析置信度

重要规则（必须严格遵守）：
- 【最高优先级】如果用户明确提到"零基础"、"初学者"、"入门"、"小白"、"新手"、"没有基础"、"完全不懂"等词，level 必须为 "beginner"
- 如果用户明确提到"进阶"、"有基础"、"中级"、"有一定基础"等词，level 必须为 "intermediate"
- 如果用户明确提到"高级"、"深入"、"专家"、"资深"等词，level 必须为 "advanced"
- 不要忽略用户明确声明的自身水平，用户说自己是什么水平就是什么水平
- 即使用户目标看起来很复杂，只要用户声明是零基础，level 就必须是 "beginner"

请以 JSON 格式输出：
{
  "subject": "短标签（2-4 字）",
  "level": "beginner|intermediate|advanced",
  "focus": ["重点 1", "重点 2"],
  "context": "具体应用场景（保留用户原话中的关键信息）",
  "confidence": 0.8
}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `用户目标：${input.goal}
${input.currentLevel ? `当前水平：${input.currentLevel}` : ''}
${input.timePerDay ? `每天可用时间：${input.timePerDay}` : ''}` }
  ];

  const response = await client.chatCompletion({ messages, temperature: 0.3 });
  const content = response.choices[0]?.message.content || '';
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error: any) {
    throw new Error(`PATH_AGENT_GOAL_ANALYSIS_INVALID: ${error?.message || 'JSON parse failed'}`);
  }

  throw new Error('PATH_AGENT_GOAL_ANALYSIS_INVALID: response does not contain valid JSON');
}

/**
 * 生成学习路径（里程碑模式）
 */
async function generatePath(
  input: AgentInput,
  context: AgentContext,
  analysis: { 
    subject: string; 
    level: string; 
    focus: string[]; 
    context: string; 
    confidence: number;
    scenario?: string;
    structuredData?: any;
    confirmedProposal?: any;
    conversationHistory?: any[];
  }
): Promise<PathOutput> {
  const client = getOpenAIClient();
  
  // 从 analysis 中提取新增字段
  const confirmedProposal = analysis.confirmedProposal;
  const conversationHistory = analysis.conversationHistory;
  
  const systemPrompt = `你是一位专业的课程设计师，负责创建里程碑式的学习路径。

请创建一个包含里程碑的学习路径，每个里程碑代表一个关键学习阶段。

里程碑设计原则：
1. 每个里程碑是一个独立的学习目标，可以独立评估完成度
2. 里程碑之间有递进关系，前一个里程碑是后一个的基础
3. 每个里程碑包含多个子任务，子任务类型要多样化
4. 支持超长目标时，建议总里程碑在6-10个之间；普通目标保持3-6个里程碑
5. 每个里程碑建议4-8个子任务，避免单阶段任务过少或过多
6. 每个子任务 estimatedMinutes 建议在30-120之间，需结合用户可用时间
7. 如输入有 totalWeeks，整体规划不要超过 totalWeeks；若 totalWeeks > 52，则按52周规划
8. 如果提供了"具体应用场景"，所有里程碑标题、任务标题、任务描述、案例都必须紧密围绕该场景，不可使用泛泛的通用示例
9. 路径名称必须直接反映用户的原始学习目标和具体应用场景，不可使用通用模板名称

请以JSON格式输出学习路径：
{
  "name": "路径名称",
  "totalMilestones": 3,
  "estimatedHours": 12,
  "estimatedWeeks": 12,
  "milestones": [
    {
      "stageNumber": 1,
      "title": "里程碑标题",
      "description": "里程碑描述",
      "goal": "里程碑学习目标",
      "estimatedHours": 4,
      "subtasks": [
        {
          "title": "子任务标题",
          "type": "reading|practice|project|quiz",
          "estimatedMinutes": 60,
          "description": "任务描述",
          "acceptanceCriteria": "完成标准"
        }
      ]
    }
  ]
}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `原始学习目标：${input.goal}
学习主题：${analysis.subject}
目标水平：${analysis.level}
${analysis.context ? `具体应用场景：${analysis.context}` : ''}
${analysis.focus.length > 0 ? `学习重点：${analysis.focus.join('、')}` : ''}
${input.metadata?.availableTime ? `可用时间：${input.metadata.availableTime}` : ''}
${input.metadata?.totalWeeks ? `总学习周期（周）：${input.metadata.totalWeeks}` : ''}

${confirmedProposal ? `用户确认的方案轮廓：
- 学习方向：${confirmedProposal.learning_direction}
- 关键阶段：${confirmedProposal.key_stages.join('、')}
- 学习方式：${confirmedProposal.learning_style}

【重要】请基于用户确认的方案轮廓设计路径阶段，保持方向一致。` : ''}

${conversationHistory && conversationHistory.length > 0 ? `
完整对话历史（用于验证关键信息）：
${conversationHistory.map((m: any) => `${m.role}: ${m.content}`).join('\n')}

【重要】如果对某些信息不确定（如学习者身份），请查看对话历史验证。` : ''}

【强制要求】以下所有生成内容必须紧密围绕"${analysis.context || input.goal}"展开：
- 路径名称中必须包含"${analysis.context || input.goal}"或高度相关的关键词，不得使用通用模板名称
- 每个里程碑的标题必须体现"${analysis.context || input.goal}"的具体阶段
- 每个任务的描述必须使用"${analysis.context || input.goal}"的真实案例和数据场景
- 禁止使用电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例，全部替换为"${analysis.context || input.goal}"相关场景

重要要求：
1. 路径名称必须直接反映用户的原始学习目标："${input.goal}"
2. 如果用户水平是 beginner（零基础），路径名称必须使用"入门"、"基础"、"从零开始"等词汇，绝对不能出现"中级"、"进阶"、"高级"等词
3. 所有里程碑、子任务的标题和描述都要具体化到"${analysis.context || input.goal}"场景，不要使用泛泛的通用描述
4. 案例、数据、练习内容都必须与"${analysis.context || input.goal}"强相关` }
  ];

  const response = await client.chatCompletion({ 
    messages, 
    temperature: 0.5,
    max_tokens: 4000
  });
  const content = response.choices[0]?.message.content || '';
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const pathData = JSON.parse(jsonMatch[0]);
      return {
        id: `path_${Date.now()}`,
        name: pathData.name,
        subject: analysis.subject,
        totalMilestones: pathData.totalMilestones,
        estimatedHours: pathData.estimatedHours,
        milestones: pathData.milestones
      };
    }
  } catch (error: any) {
    throw new Error(`PATH_AGENT_OUTPUT_INVALID: ${error?.message || 'JSON parse failed'}`);
  }

  throw new Error('PATH_AGENT_OUTPUT_INVALID: response does not contain valid JSON');
}

/**
 * 动态重规划路径（里程碑模式）
 */
export async function replanPath(
  currentPath: PathOutput,
  signal: { type: string; intensity: number },
  context: AgentContext
): Promise<PathOutput> {
  if (!currentPath) return currentPath;
  
  const eventBus = getEventBus();
  
  // 根据信号类型调整路径
  let adjustment = '';
  
  switch (signal.type) {
    case 'accelerating':
      adjustment = '用户学习速度加快，合并相似里程碑';
      break;
    case 'decelerating':
      adjustment = '用户学习速度减慢，拆分里程碑，增加子任务';
      break;
    case 'fatigue-high':
      adjustment = '用户疲劳度高，减少每个里程碑的子任务数量';
      break;
    case 'struggling':
      adjustment = '用户遇到困难，在里程碑前插入补充里程碑';
      break;
    case 'mastery':
      adjustment = '用户已掌握当前内容，跳过基础里程碑';
      break;
    default:
      return currentPath;
  }
  
  const client = getOpenAIClient();
  
  const systemPrompt = `你是一位动态学习路径规划专家。
根据用户的实时学习状态，调整里程碑式学习路径。
调整要求：${adjustment}

请输出调整后的完整路径，保持相同的JSON格式。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `当前路径：
${JSON.stringify(currentPath, null, 2)}

信号强度：${signal.intensity}` }
  ];

  try {
    const response = await client.chatCompletion({ 
      messages, 
      temperature: 0.3,
      max_tokens: 4000
    });
    const content = response.choices[0]?.message.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const newPath = JSON.parse(jsonMatch[0]);
      
      // 发布路径调整事件
      await eventBus.emit({
        type: 'path:adjusted',
        source: 'path-agent',
        userId: context.userId,
        data: {
          oldPathId: currentPath.id,
          newPathId: newPath.id,
          signal: signal.type,
          adjustment
        }
      });
      
      return { ...currentPath, ...newPath };
    }
  } catch (error: any) {
    throw new Error(`PATH_REPLAN_FAILED: ${error?.message || 'unknown error'}`);
  }

  throw new Error('PATH_REPLAN_FAILED: response does not contain valid JSON');
}

export default pathAgentHandler;
