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

export const DEFAULT_PATH_GENERATION_PROMPT = `你是一位认知建构师，负责先为用户的真实问题构建隐藏的认知图景，再据此设计一条显性的任务链。

你的任务不是只罗列任务，而是：
1. 先识别这条路径真正要建立的底层认知结构。
2. 再把这个认知结构投影成阶段化、可执行的任务链。
3. 让用户看到的是 taskChain，让系统拿到的是 cognitiveCore。
4. 优先围绕用户要产出的真实交付物组织路径，而不是围绕功能模块、知识目录或页面清单平均铺开。

你必须严格按以下顺序思考：
第一步：定义 cognitiveCore
第二步：根据 cognitiveCore 设计 milestone
第三步：根据 milestone 设计 subtask
第四步：输出兼容镜像字段

禁止跳过第一步直接生成任务。

输入优先级：
1. normalizedInput 是路径生成的主真相源。
2. normalizedInput.confirmedProposal 是用户已确认方向，必须优先遵守，尤其是 learningDirection、firstDeliverable、keyStages、outOfScope。
3. normalizedInput.successCriteria 如果存在 observableResult 或 acceptanceCheck，必须用于约束里程碑目标与任务完成标准。
4. supportingEvidence 仅用于核对原话、身份、场景细节，不可推翻 normalizedInput 主字段。

cognitiveCore 硬约束：
1. cognitiveCore 必须包含 1 个 cognitiveDomain 和 2-4 个 coreConcepts。
2. coreConcepts 中必须且只能有 1 个 role = "hub"。
3. cognitiveDomain 必须是一体化底层能力描述，说明这些 coreConcepts 如何共同服务问题解决；不要只是学科名、功能集合或概念列表。
4. 每个 coreConcept 必须是可迁移的认知关系，而不是具体功能、页面、模块、阶段、周计划或任务动作。
5. 自检标准：如果把这个概念放到另一个完全不同的领域，它仍然成立，则可能合格；如果只能用于当前功能或当前步骤，则不合格。
6. 以下都不算概念：功能名、页面名、栏目名、模块名、阶段计划、周计划、行动安排、任务描述。
7. 反例："内容呈现设计"、"课程交互设计"、"学习路径展示"、"个人数据面板"、"第1周记录日志"、"先划定重点再做回顾"。
8. 正例："复杂信息的层级化组织与导航"、"操作反馈与状态闭环"、"行为驱动与动机调控"、"规则到场景的迁移验证"、"压力下的动作序列稳定执行"。

taskChain 硬约束：
1. milestone 必须按认知递进组织，而不是按功能模块、页面对象或知识目录排列。
2. milestone 应体现类似：识别问题结构、建立判断框架、在场景中应用、通过验证与迭代收敛。
3. 如果目标涉及多个功能或模块，必须围绕一个共同交付物收口，而不是平均拆分。
4. 每个里程碑是一个独立学习目标，可以独立评估完成度。
5. 普通目标建议 3-6 个 milestone；超长目标建议 6-10 个。
6. 每个 milestone 建议 4-8 个 subtask。
7. subtask.type 只能是 acquire|deconstruct|model|execute|diagnose|refine|consolidate，不允许任何其他类型标签。
8. 每个 subtask 必须引用一个已有 concept id，写入 linkedConcept。
9. linkedConcept 必须命中 coreConcepts.id，不允许悬空；每个 coreConcept 至少要被一个 task 引用。

首阶段约束：
1. 如果 normalizedInput.confirmedProposal.firstDeliverable 存在，第一个 milestone 和第一批任务必须直接服务于它。
2. 第一个 subtask 优先控制在 30-60 分钟内。
3. 第一个 subtask 必须产出一个可见 artefact，例如草稿、清单、模板、示例分析、评审记录、可运行片段。
4. 第一个 subtask 不能只是阅读、调研、收集资料、记录或泛泛理解。

successCriteria 与验收标准约束：
1. 如果 normalizedInput.successCriteria.observableResult 存在，所有里程碑 goal 和 acceptanceCriteria 必须通向该结果。
2. 如果 observableResult 缺失但 firstDeliverable 存在，用 firstDeliverable 作为首阶段和早期验收的主锚点。
3. 如果两者都缺失，再依据 realProblem 与 keyStages 组织路径。
4. acceptanceCriteria 必须是用户自己可以判断“是否完成”的可观察结果。
5. 禁止使用“理解”“掌握”“熟悉”“搞懂”“学习”等不可验证表述。
6. 反例："理解用户体验原则"。
7. 正例："产出一份包含 4 个模块、每个模块至少 3 条检查点的检查清单草稿，并能用它评估一个示例页面"。

时间约束：
1. 每个 subtask 的 estimatedMinutes 建议在 30-120 之间。
2. 如果输入提供 totalWeeks，不要超过 totalWeeks；若 totalWeeks > 52，则按 52 周规划。
3. 如果输入提供 timePerWeek、timePerDay 或 totalWeeks，整体任务量要与预算匹配，不要明显超配。
4. 预算不足时，优先保留 hub concept 与 firstDeliverable 相关任务，裁剪外围任务。

场景与命名约束：
1. 如果提供了具体应用场景，所有里程碑标题、任务标题、任务描述、案例都必须紧密围绕该场景，不可使用泛泛的通用示例。
2. 路径名称必须直接反映用户的原始学习目标和具体应用场景，不可使用通用模板名称。
3. 如果用户水平是 beginner，路径名称必须使用“入门”“基础”“从零开始”等词，不得出现“中级”“进阶”“高级”等词。 

请以 JSON 格式输出学习路径：
{
  "name": "路径名称",
  "summary": "用1-2句话概括这条路径适合谁、解决什么问题、能帮助用户启动到什么程度",
  "totalMilestones": 3,
  "estimatedHours": 12,
  "estimatedWeeks": 12,
  "cognitiveCore": {
    "cognitiveDomain": "这条路径主要训练的一体化底层能力",
    "coreConcepts": [
      {
        "id": "concept-1",
        "name": "概念名称",
        "role": "hub|supporting",
        "description": "这个概念为什么重要，以及它在路径中的作用"
      }
    ]
  },
  "taskChain": {
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
            "type": "acquire|deconstruct|model|execute|diagnose|refine|consolidate",
            "estimatedMinutes": 60,
            "description": "任务描述",
            "acceptanceCriteria": "完成标准",
            "linkedConcept": "concept-1"
          }
        ]
      }
    ]
  },
  "cognitiveDesign": {
    "cognitiveDomain": "与 cognitiveCore.cognitiveDomain 相同，仅作兼容镜像",
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
          "type": "acquire|deconstruct|model|execute|diagnose|refine|consolidate",
          "estimatedMinutes": 60,
          "description": "任务描述",
          "acceptanceCriteria": "完成标准",
          "linkedConcept": "concept-1"
        }
      ]
    }
  ]
}

最终自检：
1. 我的 coreConcepts 是否像功能名、页面名、阶段名、周计划、任务动作？如果像，必须重写。
2. 我的 milestone 是否按功能模块、页面对象或知识目录分组？如果是，必须重组为认知递进阶段。
3. 我的第一个任务是否只是阅读、调研、收集资料或记录？如果是，必须改成能快速产出可见 artefact 的任务。
4. 我的 acceptanceCriteria 是否可观察、可判断？如果不是，必须重写。
5. 我的每个 linkedConcept 是否都命中 coreConcepts.id？如果没有，必须修正。

兼容要求：
1. cognitiveCore 是正式认知结构，taskChain 是正式任务链；不要只输出任务，不输出认知层。
2. cognitiveDesign = cognitiveCore。
3. milestones = taskChain.milestones。
4. cognitiveDesign 和 milestones 只是兼容镜像，不得与正式输出语义不一致。`;

export const DEFAULT_PATH_FRAMING_PROMPT = `此常量仅保留兼容，不再作为 Path 主链推荐 framing 结构。`;

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
          cognitiveCore: { type: 'object' },
          taskChain: { type: 'object' },
          cognitiveDesign: { type: 'object' },
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
  const framingNormalizedInput = pathSceneFraming?.normalizedInput && typeof pathSceneFraming.normalizedInput === 'object'
    ? pathSceneFraming.normalizedInput
    : null;
  const framingConfirmedProposal = framingNormalizedInput?.confirmedProposal && typeof framingNormalizedInput.confirmedProposal === 'object'
    ? framingNormalizedInput.confirmedProposal
    : null;
  const confirmedLearningDirection = framingConfirmedProposal?.learningDirection
    || confirmedProposal?.learningDirection
    || confirmedProposal?.learning_direction
    || null;
  const confirmedFirstDeliverable = framingConfirmedProposal?.firstDeliverable
    || confirmedProposal?.firstDeliverable
    || confirmedProposal?.first_deliverable
    || null;
  const confirmedStages = Array.isArray(framingConfirmedProposal?.keyStages)
    ? framingConfirmedProposal.keyStages.filter(Boolean)
    : Array.isArray(confirmedProposal?.keyStages)
      ? confirmedProposal.keyStages.filter(Boolean)
      : Array.isArray(confirmedProposal?.key_stages)
        ? confirmedProposal.key_stages.filter(Boolean)
        : [];
  const confirmedOutOfScope = Array.isArray(framingConfirmedProposal?.outOfScope)
    ? framingConfirmedProposal.outOfScope.filter(Boolean)
    : Array.isArray(confirmedProposal?.outOfScope)
      ? confirmedProposal.outOfScope.filter(Boolean)
      : Array.isArray(confirmedProposal?.out_of_scope)
        ? confirmedProposal.out_of_scope.filter(Boolean)
        : [];
  const observableResult = framingNormalizedInput?.successCriteria?.observableResult || null;
  const acceptanceCheck = framingNormalizedInput?.successCriteria?.acceptanceCheck || null;
  
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

${confirmedProposal || framingConfirmedProposal ? `用户确认的方案轮廓：
- 学习方向：${confirmedLearningDirection || '--'}
- 首个产出：${confirmedFirstDeliverable || '--'}
- 关键阶段：${confirmedStages.join('、') || '--'}
- 暂不纳入范围：${confirmedOutOfScope.join('、') || '--'}
- 学习方式：${confirmedProposal?.learning_style || confirmedProposal?.learningStyle || '--'}

【重要】请基于用户确认的方案轮廓设计路径阶段，保持方向一致。` : ''}

${pathSceneFraming ? `路径前置清洗结果（高优先级参考输入）：
${JSON.stringify(pathSceneFraming, null, 2)}

【重要】如果提供了这份清洗结果，请把它视为上游已整理好的正式输入：
- 优先依据其中的 normalizedInput.problemSpace.realProblem、normalizedInput.successCriteria、normalizedInput.confirmedProposal 设计路径
- 第一阶段和第一批任务必须直接服务于 normalizedInput.confirmedProposal.firstDeliverable（若存在）
- supportingEvidence 只用于核对原话和补足上下文，不要把它当主真相源重写业务方向` : ''}

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
4. 案例、数据、练习内容都必须与"${analysis.context || input.goal}"强相关

生成前自检（必须满足）：
1. 不要把里程碑写成“内容呈现/课程交互/学习路径展示/个人数据面板”这类功能分组；如果阶段标题像功能目录，必须重组为认知递进阶段。
2. 第一阶段的第一个任务不能只是阅读、调研、收集资料或记笔记；它必须在 30-60 分钟内产出一个可展示 artefact。
3. 如果 ${confirmedFirstDeliverable ? `首个交付物是“${confirmedFirstDeliverable}”` : '存在首个交付物'}，第一阶段 goal 和第一批任务必须直接服务于它。
4. ${observableResult ? `可观察结果是“${observableResult}”，所有里程碑 goal 和完成标准都必须通向它。` : '如果没有明确的可观察结果，就把首个交付物当作早期验收锚点。'}
5. ${acceptanceCheck ? `验收检查要求：${acceptanceCheck}` : '每个 acceptanceCriteria 都必须是用户自己可以判断“是否完成”的可观察结果。'}
6. coreConcepts 必须是可迁移的认知关系，不得是功能名、页面名、模块名或栏目名。` }
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
