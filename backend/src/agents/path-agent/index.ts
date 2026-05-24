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
import { callPrompt } from '../../composers/prompt-composer';

type MessageRole = 'user' | 'assistant' | 'system';
type ChatMessage = { role: MessageRole; content: string };
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { textStructureAnalyzer } from '../../skills/text-structure-analyzer';
import { timeEstimator } from '../../skills/time-estimator';
import { logger } from '../../utils/logger';

const PATH_AGENT_MAX_TOKENS = 32000;

function normalizePromptString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePromptStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizePromptString(item))
    .filter((item): item is string => !!item);
}

function buildPathSceneFramingPromptInput(pathSceneFraming: any) {
  if (!pathSceneFraming || typeof pathSceneFraming !== 'object') return null;

  const normalizedInput = pathSceneFraming.normalizedInput && typeof pathSceneFraming.normalizedInput === 'object'
    ? pathSceneFraming.normalizedInput
    : {};
  const learnerProfile = normalizedInput.learnerProfile && typeof normalizedInput.learnerProfile === 'object'
    ? normalizedInput.learnerProfile
    : {};
  const problemSpace = normalizedInput.problemSpace && typeof normalizedInput.problemSpace === 'object'
    ? normalizedInput.problemSpace
    : {};
  const resources = normalizedInput.resources && typeof normalizedInput.resources === 'object'
    ? normalizedInput.resources
    : {};
  const successCriteria = normalizedInput.successCriteria && typeof normalizedInput.successCriteria === 'object'
    ? normalizedInput.successCriteria
    : {};
  const confirmedProposal = normalizedInput.confirmedProposal && typeof normalizedInput.confirmedProposal === 'object'
    ? normalizedInput.confirmedProposal
    : null;
  return {
    normalizedInput: {
      version: normalizePromptString(normalizedInput.version) || '1.0',
      learnerProfile: {
        surfaceGoal: normalizePromptString(learnerProfile.surfaceGoal),
        currentBaseline: {
          level: normalizePromptString(learnerProfile.currentBaseline?.level),
          evidence: normalizePromptString(learnerProfile.currentBaseline?.evidence),
        },
      },
      problemSpace: {
        realProblem: normalizePromptString(problemSpace.realProblem),
        scenario: normalizePromptString(problemSpace.scenario),
        currentPainPoint: normalizePromptString(problemSpace.currentPainPoint),
      },
      resources: {
        timePerWeek: normalizePromptString(resources.timePerWeek),
        timePerSession: normalizePromptString(resources.timePerSession),
        timeHorizon: normalizePromptString(resources.timeHorizon),
        deadlineText: normalizePromptString(resources.deadlineText),
      },
      successCriteria: {
        observableResult: normalizePromptString(successCriteria.observableResult),
        acceptanceCheck: normalizePromptString(successCriteria.acceptanceCheck),
      },
      confirmedProposal: confirmedProposal ? {
        learningDirection: normalizePromptString(confirmedProposal.learningDirection),
        firstDeliverable: normalizePromptString(confirmedProposal.firstDeliverable),
        keyStages: normalizePromptStringArray(confirmedProposal.keyStages),
        outOfScope: normalizePromptStringArray(confirmedProposal.outOfScope),
      } : null,
    },
  };
}

export const DEFAULT_PATH_GENERATION_PROMPT = `你是一位认知建构师，负责先为用户的真实问题构建隐藏的认知图景，再据此设计一条阶段化的学习骨架。

你的任务不是只罗列任务，而是：
1. 先识别这条路径真正要建立的底层认知结构。
2. 再把这个认知结构投影成 milestone 级的阶段骨架。
3. 让系统先拿到稳定的 cognitiveCore 与 milestones，阶段内 subtasks 由后续 stage-designer 单独生成。
4. 优先围绕用户要产出的真实交付物组织路径，而不是围绕功能模块、知识目录或页面清单平均铺开。

你必须严格按以下顺序思考：
第一步：定义 cognitiveCore
第二步：根据 cognitiveCore 设计 milestone
第三步：输出兼容镜像字段

禁止跳过第一步直接生成 milestone。

输入优先级：
1. normalizedInput 是路径生成的主真相源。
2. normalizedInput.confirmedProposal 是用户已确认方向，必须优先遵守，尤其是 learningDirection、firstDeliverable、keyStages、outOfScope。
3. normalizedInput.successCriteria 如果存在 observableResult 或 acceptanceCheck，必须用于约束里程碑目标与任务完成标准。
4. normalizedInput.planningHints 如果存在，是上游对路径节奏的建议范围，优先用于决定概念数、milestone 数、周期上限；若缺失，再使用默认范围。
cognitiveCore 硬约束：
1. cognitiveCore 必须包含 1 个 cognitiveDomain 和 planningHints.conceptRange 范围内的 coreConcepts；若未提供 planningHints，默认 2-4 个。
2. coreConcepts 中必须且只能有 1 个 role = "hub"。
3. 先提炼 coreConcepts，再基于 coreConcepts 整合 cognitiveDomain。不要先写 cognitiveDomain 再反向补概念。

什么是核心概念：
1. 核心概念不是知识点、功能模块、学习阶段或任务步骤。
2. 核心概念是解决这类问题时必须理解的底层认知关系。
3. 一条好的核心概念描述的是“关系”，而不是“事物”。
4. 它应该能迁移到相近但不同的场景，并指导 Learn 层知道该帮助学习者理解什么、练习什么。

提炼 coreConcepts 时，必须先连续问自己三件事：
第一问：这个人真正在应对什么？
1. 不要回答他“要做什么”，而要回答他“在与什么博弈”。
2. 例如：
- “坡道起步总是熄火”背后是在应对“动力传递的时机与反馈信号的识别”。
- “睡不着，脑子停不下来”背后是在应对“认知唤醒与生理放松的拮抗关系”。
- “公告出来了不知道从哪开始复习”背后是在应对“碎片信息摄入下的系统性知识建构”。
- “不知道怎么设计好的用户体验”背后是在应对“设计者与使用者的认知资源错配”。

第二问：如果只保留一个最核心的关系，它是什么？
1. 这个关系就是 hub concept。
2. 它应该是“如果这个没理解，后面的都白做”的那个关系。

第三问：还有哪些关系支撑着这个核心？
1. 这些是 supporting concepts。
2. supporting concept 必须明确自己与 hub 的关系：前提、展开、互补，或循环校准。
3. 不要只是并列罗列几个看起来抽象的名词；要让它们共同构成一套稳定的认知骨架。

概念设计的质量标准：
1. 可迁移检验：把这个概念放到另一个相近领域，它是否仍然成立？如果只能用于当前功能、当前页面、当前模块或当前步骤，则不合格。
2. 非任务检验：如果这个概念在描述“先做什么、再做什么”，它就是任务，不是概念。
3. 可指导检验：Learn 层拿到这个概念后，是否知道要帮助学习者建立什么理解、练习什么判断、校准什么能力？如果不知道，这个概念还不够好。

概念命名规范：
1. coreConcept.name 应该写成一句关系描述，而不是单词标签。
2. name 优先控制在 12-28 个字左右，便于后续 milestone、task、Learn 复用；更详细的解释写到 description。
3. 好的名称通常像：
- “动力传递临界点的识别与稳定维持”
- “多动作协同的序列化与节奏控制”
- “生理唤醒与睡眠驱力的动态平衡调控”
- “复杂信息的层级化组织与导航”
4. 不好的名称通常是：
- 单个对象名，例如“离合器”“睡眠卫生”“碎片时间”
- 任务动作句，例如“梳理需求”“提炼检查点”“整合清单并验证”

cognitiveDomain 生成规则：
1. 在 coreConcepts 稳定后，再整合出 cognitiveDomain。
2. cognitiveDomain 不是把每个概念重说一遍，而是回答：这些概念合在一起，最终构成了什么一体化底层能力？
3. 把答案写成“能力/判断/组织/调节/映射/验证”一类表述，让它像一条长期可迁移的能力主线。
4. 优先使用这样的句式：
- “在____约束下，识别____并建立____”
- “把____转成____，再通过____完成校准”
- “围绕____建立可迁移的判断框架与执行闭环”
5. 好的 cognitiveDomain 应让人看到：这条路径最终训练的不是某个功能，而是一种可复用的认知能力。

milestones 硬约束：
1. milestone 必须按认知递进组织，而不是按功能模块、页面对象或知识目录排列。
2. milestone 应体现类似：识别问题结构、建立判断框架、在场景中应用、通过验证与迭代收敛。
3. 如果目标涉及多个功能或模块，必须围绕一个共同交付物收口，而不是平均拆分。
4. 每个里程碑是一个独立学习目标，可以独立评估完成度。
4.1 每个 milestone 必须明确绑定 1 个 coreConcept，写入 coreConcept 字段，表示这个阶段主要服务的核心概念。
5. milestone 数量优先遵守 normalizedInput.planningHints.milestoneRange；若未提供 planningHints，默认 3-6 个。
6. milestone 只写阶段级骨架，不要输出任何 subtask、task slot、acceptanceCriteria、教学脚本或周计划。
7. milestone title 不要写成“第1周”“第2周”这类排期语句，也不要写成“记录/梳理/提炼/整合”这类操作步骤句。

首阶段约束：
1. 如果 normalizedInput.confirmedProposal.firstDeliverable 存在，第一个 milestone 必须直接服务于它。
2. 第一个 milestone 的 goal 应明确首阶段要建立的核心能力入口，而不是写成完整执行处方。

successCriteria 约束：
1. 如果 normalizedInput.successCriteria.observableResult 存在，所有里程碑 goal 必须通向该结果。
2. 如果 observableResult 缺失但 firstDeliverable 存在，用 firstDeliverable 作为首阶段和早期验收的主锚点。
3. 如果两者都缺失，再依据 realProblem 与 keyStages 组织路径。
4. goal 必须是用户可观察的阶段结果，但保持阶段级，不要下钻成 task 级验收细则。

时间约束：
1. 如果输入提供 totalWeeks，不要超过 totalWeeks；如果 normalizedInput.planningHints.maxWeeks 存在，也不要超过它；若两者都缺失，默认不超过 52 周。
2. 如果输入提供 timePerWeek、timePerDay 或 totalWeeks，整体阶段任务量要与预算匹配，不要明显超配。
3. 预算不足时，优先保留 hub concept 与 firstDeliverable 相关阶段，裁剪外围阶段。

场景与命名约束：
1. 如果提供了具体应用场景，所有里程碑标题、描述、goal 都必须紧密围绕该场景，不可使用泛泛的通用示例。
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
        "coreConcept": "concept-1",
        "description": "里程碑描述",
        "goal": "里程碑学习目标",
      "estimatedHours": 4
    }
  ]
}

最终自检：
1. 我的 cognitiveDomain 是否像一条长期可迁移的能力主线，而不是用户问题原话？如果不像，必须继续抽象。
1.1 我的 coreConcept 是否都像“机制/关系/框架/原则/模型”，并能作为 milestone 的稳定骨架？如果不像，必须改写。
1.2 我的每个 milestone 是否都绑定了一个明确的 coreConcept？如果没有，必须补齐。
1.3 如果某个 coreConcept 以“梳理/整理/记录/分析/验证/设计”等任务动作开头，必须改写成底层关系描述。
1.4 如果 Learn 层拿到某个概念后，仍不知道要帮助学习者建立什么理解或练习什么判断，必须继续重写。
2. 我的 milestone 是否按功能模块、页面对象或知识目录分组？如果是，必须重组为认知递进阶段。
3. 我的 milestone 标题或 goal 是否写成了周计划、步骤清单或执行处方？如果是，必须收回到阶段骨架层。

兼容要求：
1. cognitiveCore 是正式认知结构，milestones 是正式阶段骨架；不要只输出阶段，不输出认知层。
2. cognitiveDesign = cognitiveCore。
3. cognitiveDesign 和 milestones 只是兼容镜像，不得与正式输出语义不一致。`;

export const DEFAULT_PATH_FRAMING_PROMPT = `此常量仅保留兼容，不再作为 Path 主链推荐 framing 结构。`;

interface PathOutput {
  id?: string;
  name: string;
  summary?: string;
  subject: string;
  totalMilestones: number;
  estimatedHours?: number;
  cognitiveCore?: {
    cognitiveDomain?: string;
    coreConcepts?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
  };
  cognitiveDesign?: {
    cognitiveDomain?: string;
    coreConcepts?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
  };
  _debug?: {
    rawModelOutput?: string;
    extractedJson?: string;
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
  const promptFriendlySceneFraming = buildPathSceneFramingPromptInput(pathSceneFraming);

  const userPayload = `原始学习目标：${input.goal}
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

${promptFriendlySceneFraming ? `路径前置清洗结果（高优先级参考输入）：
${JSON.stringify(promptFriendlySceneFraming, null, 2)}

【重要】如果提供了这份清洗结果，请把它视为上游已整理好的正式输入：
- 优先依据其中的 normalizedInput.problemSpace.realProblem、normalizedInput.successCriteria、normalizedInput.confirmedProposal 设计路径
- 第一阶段必须直接服务于 normalizedInput.confirmedProposal.firstDeliverable（若存在）
- 不要把 confirmedProposal.keyStages 直接抄成 coreConcept；keyStages 是阶段提示，不是隐藏概念名称。` : ''}

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
- 禁止使用电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例，全部替换为"${analysis.context || input.goal}"相关场景

重要要求：
1. 路径名称必须直接反映用户的原始学习目标："${input.goal}"
2. 如果用户水平是 beginner（零基础），路径名称必须使用"入门"、"基础"、"从零开始"等词汇，绝对不能出现"中级"、"进阶"、"高级"等词
3. 所有里程碑标题、描述、goal 都要具体化到"${analysis.context || input.goal}"场景，不要使用泛泛的通用描述

生成前自检（必须满足）：
1. 不要把里程碑写成“内容呈现/课程交互/学习路径展示/个人数据面板”这类功能分组；如果阶段标题像功能目录，必须重组为认知递进阶段。
2. 不要输出 subtasks、tasks、acceptanceCriteria、第一周计划、执行次数或作业清单；这些由后续 stage-designer 生成。
3. 如果 ${confirmedFirstDeliverable ? `首个交付物是“${confirmedFirstDeliverable}”` : '存在首个交付物'}，第一阶段 goal 必须直接服务于它。
4. ${observableResult ? `可观察结果是“${observableResult}”，所有里程碑 goal 都必须通向它。` : '如果没有明确的可观察结果，就把首个交付物当作早期阶段目标锚点。'}
5. ${acceptanceCheck ? `验收检查要求：${acceptanceCheck}` : 'goal 必须是用户自己可以判断“是否达成”的阶段结果，但不要下钻到 task 级验收。'}
6. coreConcepts 必须先表达底层认知关系，再用于绑定里程碑；如果概念名仍像功能名、页面名、模块名、栏目名或任务动作句，必须继续抽象。`;

  const userId = context?.userId || input?.metadata?.userId;
  const result = await callPrompt<any, PathOutput>({
    agentId: 'path-agent',
    defaultSystemPrompt: DEFAULT_PATH_GENERATION_PROMPT,
    caller: { agentId: 'path-agent' },
    modelDefaults: {
      maxTokens: PATH_AGENT_MAX_TOKENS,
      temperature: 0.2,
    },
    buildUserPayload: () => userPayload,
    normalizeOutput: (pathData) => ({
      id: `path_${Date.now()}`,
      name: pathData.name,
      summary: typeof pathData.summary === 'string' ? pathData.summary : undefined,
      subject: analysis.subject,
      totalMilestones: pathData.totalMilestones,
      estimatedHours: pathData.estimatedHours,
      cognitiveCore: pathData.cognitiveCore,
      cognitiveDesign: pathData.cognitiveDesign || pathData.cognitiveCore,
      milestones: pathData.milestones,
      _debug: {
        rawModelOutput: '',
        extractedJson: '',
      }
    }),
  }, input, { userId });

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'PATH_AGENT_OUTPUT_INVALID');
  }

  return {
    ...result.output,
    _debug: {
      rawModelOutput: result.debug.rawModelOutput,
      extractedJson: result.debug.extractedJson || undefined,
    }
  };
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
