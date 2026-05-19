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
import { getAPIGateway, CallerInfo, ExecutionContext } from '../../gateway/api-gateway';
import { agentConfigService } from '../../services/agentConfig.service';

type MessageRole = 'user' | 'assistant' | 'system';
type ChatMessage = { role: MessageRole; content: string };
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { textStructureAnalyzer } from '../../skills/text-structure-analyzer';
import { timeEstimator } from '../../skills/time-estimator';
import { logger } from '../../utils/logger';

const PATH_AGENT_MAX_TOKENS = 32000;

export const DEFAULT_PATH_GENERATION_PROMPT = `你是一位专业的课程设计师，负责创建里程碑式的学习路径。

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
10. 在输出用户可见任务链的同时，必须补充一份简洁的认知设计说明，告诉系统这条路径在训练什么底层能力
11. 第一个里程碑必须尽量服务于首个最小交付物，优先给学习者一个 30-60 分钟内能看见成果的早期胜利
12. 每个任务都要标注它主要服务的隐藏概念，用于后续 Learn 层教学承接

请以JSON格式输出学习路径：
{
  "name": "路径名称",
  "summary": "用1-2句话概括这条路径适合谁、解决什么问题、能帮助用户启动到什么程度",
  "totalMilestones": 3,
  "estimatedHours": 12,
  "estimatedWeeks": 12,
  "cognitiveDesign": {
    "cognitiveDomain": "这条路径主要训练的底层认知域",
    "coreConcepts": [
      {
        "id": "concept-1",
        "name": "概念名称",
        "role": "hub|supporting",
        "description": "这个概念为什么重要，以及它在路径中的作用"
      }
    ]
  },
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
          "acceptanceCriteria": "完成标准",
          "linkedConcept": "concept-1"
        }
      ]
    }
  ]
  }

额外规则：
1. cognitiveDomain 必须是抽象后的底层能力表述，不要只是重复学科名，例如“结构化问题求解”“证据驱动分析”“任务自动化抽象”
2. coreConcepts 保持 2-4 个即可，其中必须有且仅有 1 个 role = "hub"
3. linkedConcept 必须引用 coreConcepts 中已有的 id，不允许悬空
4. 如果输入提供了路径场景 framing，cognitiveDesign 必须与 framing 的 intent / planningFocus / firstDeliverable 保持一致`;

export const DEFAULT_PATH_FRAMING_PROMPT = `你是一个学习路径场景编排器中的 framing 规划器。

你的任务不是直接输出完整学习路径，而是先把已确认的目标信息压缩成一份稳定的路径 framing，供后续完整任务级路径生成使用。

输入会包含：
- 原始学习目标
- goal conversation 沉淀的 structuredData
- 用户已确认的 confirmedProposal
- 时间/资源/边界信息

要求：
1. 不要重新质疑用户已确认的方向。
2. 不要输出完整路径、周计划或任务清单。
3. 只输出 1 个 JSON 对象。
4. framing 必须明确：这版路径先解决什么、首个最小产出是什么、暂不展开什么、时间投入如何影响任务颗粒度。
5. framing 必须额外指出：这条路径要优先训练的底层认知域是什么。它不是学科名，而是更抽象的能力锚点。

请输出：
{
  "intent": "这版路径先聚焦解决什么",
  "targetState": "用户将达到的可观察状态",
  "firstDeliverable": "第一个最小可交付结果",
  "cognitiveDomain": "这条路径优先训练的底层认知域",
  "planningFocus": ["重点1", "重点2"],
  "excludedScope": ["暂不展开1"],
  "resourceProfile": {
    "timeBudget": "每天/每周可投入时间",
    "timeHorizon": "整体时间窗",
    "pace": "任务颗粒度判断"
  },
  "riskFlags": ["风险1"],
  "sourceGoal": {
    "surfaceGoal": "",
    "realProblem": "",
    "motivation": "",
    "urgency": ""
  }
}`;

interface PathOutput {
  id?: string;
  name: string;
  summary?: string;
  subject: string;
  totalMilestones: number;
  estimatedHours?: number;
  cognitiveDesign?: {
    cognitiveDomain?: string;
    coreConcepts?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
  };
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
          summary: { type: 'string' },
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
      userVisible: `学习路径已生成：${path.name}`,
      path,
      internal: {
        core: {
          stage: 'completed',
          confidence: goalAnalysis.confidence,
          isCompleted: true
        },
        ext: {
          path: {
            path,
            totalMilestones: path.milestones?.length || 0
          }
        },
        path,
        totalMilestones: path.milestones?.length || 0,
      },
      renderHints: {
        component: 'learning-path',
        totalMilestones: path.milestones?.length || 0,
      },
      schemaVersion: 'agent-output-v1',
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
      userVisible: '学习路径生成失败，请稍后重试',
      error: {
        code: 'PATH_AGENT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      schemaVersion: 'agent-output-v1',
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
  replan?: any;
  pathSceneFraming?: any;
}> {
  const gateway = getAPIGateway();
  const caller: CallerInfo = { agentId: 'path-agent' };
   
  const structuredData = input.structuredData as any;
  const confirmedProposal = input.confirmedProposal as any;
  const conversationHistory = input.conversationHistory as any[] || [];
  const replan = input.metadata?.replan as any;
  const pathSceneFraming = input.metadata?.pathSceneFraming as any;
  
  if (structuredData) {
    logger.info('使用结构化数据', {
      learner: structuredData.learner,
      end_user: structuredData.end_user,
      context: structuredData.learning_context
    });
    
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
      conversationHistory,
      // @ts-ignore
      replan,
      // @ts-ignore
      pathSceneFraming
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
 
  const userId = context?.userId || input?.metadata?.userId;
  const response = await gateway.execute(
    {
      messages,
      max_tokens: PATH_AGENT_MAX_TOKENS
    },
    caller,
    { userId }
  );
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
    replan?: any;
    pathSceneFraming?: any;
  }
): Promise<PathOutput> {
  const gateway = getAPIGateway();
  const caller: CallerInfo = { agentId: 'path-agent' };
  const promptConfig = await agentConfigService.getActivePrompt('path-agent');
  
  const confirmedProposal = analysis.confirmedProposal;
  const conversationHistory = analysis.conversationHistory;
  const replan = analysis.replan;
  const pathSceneFraming = analysis.pathSceneFraming;
  const confirmedStages = Array.isArray(confirmedProposal?.key_stages)
    ? confirmedProposal.key_stages.filter(Boolean)
    : [];
  
  const systemPrompt = promptConfig?.systemPrompt || DEFAULT_PATH_GENERATION_PROMPT;

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
- 首个产出：${confirmedProposal.first_deliverable}
- 关键阶段：${confirmedStages.join('、')}
- 学习方式：${confirmedProposal.learning_style}

【重要】请基于用户确认的方案轮廓设计路径阶段，保持方向一致。` : ''}

${pathSceneFraming ? `路径场景 framing（高优先级）：
${JSON.stringify(pathSceneFraming, null, 2)}

【重要】完整任务级路径必须优先服从这份 framing：
- 第一阶段和第一批任务必须直接服务于 firstDeliverable
- planningFocus 决定这版路径的主轴
- excludedScope 中的内容不要提前展开成主任务
- resourceProfile.pace 决定任务颗粒度与节奏` : ''}

${conversationHistory && conversationHistory.length > 0 ? `
完整对话历史（用于验证关键信息）：
${conversationHistory.map((m: any) => `${m.role}: ${m.content}`).join('\n')}

【重要】如果对某些信息不确定（如学习者身份），请查看对话历史验证。` : ''}

${replan ? `
【路径重调模式】
- 重调模式：${replan.mode || 'new_version'}
- 触发来源：${replan.triggerSource || 'unknown'}
- 源路径 ID：${replan.sourcePathId || 'unknown'}
- 冻结已完成任务：${Array.isArray(replan.freezeCompletedTaskIds) && replan.freezeCompletedTaskIds.length > 0 ? replan.freezeCompletedTaskIds.join('、') : '无'}

【学习者重调投影】
${JSON.stringify(replan.learnerReplanProjection || {}, null, 2)}

【重调要求】
1. 这是对现有学习路径的新版本重调，不是从零忽略已有学习历史重新规划。
2. 必须显式参考学习者已稳定掌握、掌握不稳、持续吃力和前置缺口信息。
3. 不要围绕已稳定掌握内容重复铺设大量基础阶段。
4. 对掌握不稳和前置缺口内容，应通过补桥接阶段、补充任务、降低阶段跳跃度来处理。
5. 如果已完成任务被冻结，请把它们视为既有学习历史，不要在新版本里简单复制同名任务来伪装重调。` : ''}

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

const userId = context?.userId || input?.metadata?.userId;
  const response = await gateway.execute(
    {
      messages,
      max_tokens: promptConfig?.maxTokens || PATH_AGENT_MAX_TOKENS,
      temperature: promptConfig?.temperature
    },
    caller,
    { userId }
  );
  const content = response.choices[0]?.message.content || '';
   
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const pathData = JSON.parse(jsonMatch[0]);
      return {
        id: `path_${Date.now()}`,
        name: pathData.name,
        summary: typeof pathData.summary === 'string' ? pathData.summary : undefined,
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
  const gateway = getAPIGateway();
  const caller: CallerInfo = { agentId: 'path-agent' };
  
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
    const userId = context?.userId;
    const response = await gateway.execute(
      {
        messages,
        max_tokens: PATH_AGENT_MAX_TOKENS
      },
      caller,
      { userId }
    );
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
