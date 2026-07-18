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
} from '../../agents/protocol';
import { getAPIGateway, CallerInfo, ExecutionContext } from '../../gateway/api-gateway';
import { agentConfigService } from '../../services/agentConfig.service';
import { callPrompt } from '../../composers/prompt-composer';

type MessageRole = 'user' | 'assistant' | 'system';
type ChatMessage = { role: MessageRole; content: string };
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { textStructureAnalyzer } from '../../skills/text-structure-analyzer';
import { pathSceneFramingDefinition } from '../../skills/path-scene-framing';
import { stageDesignerDefinition } from '../../skills/stage-designer';
import { labelGeneratorDefinition } from '../../skills/label-generator';
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
  const planningHints = normalizedInput.planningHints && typeof normalizedInput.planningHints === 'object'
    ? normalizedInput.planningHints
    : null;
  return {
    normalizedInput: {
      version: normalizePromptString(normalizedInput.version) || '1.0',
      learnerProfile: {
        surfaceGoal: normalizePromptString(learnerProfile.surfaceGoal),
        motivation: normalizePromptString(learnerProfile.motivation),
        urgency: normalizePromptString(learnerProfile.urgency),
        backgroundExperience: normalizePromptString(learnerProfile.backgroundExperience),
        painPoints: normalizePromptStringArray(learnerProfile.painPoints),
        learningSignal: normalizePromptString(learnerProfile.learningSignal),
        constraintsAndBoundaries: normalizePromptStringArray(learnerProfile.constraintsAndBoundaries),
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
        timeBudget: normalizePromptString(resources.timeBudget),
        timeBudgetCadence: normalizePromptString(resources.timeBudgetCadence),
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
      planningHints: planningHints ? {
        paceSignal: planningHints.paceSignal === 'compact' || planningHints.paceSignal === 'standard' || planningHints.paceSignal === 'extended'
          ? planningHints.paceSignal
          : null,
        milestoneRange: Array.isArray(planningHints.milestoneRange) ? planningHints.milestoneRange : null,
        conceptRange: Array.isArray(planningHints.conceptRange) ? planningHints.conceptRange : null,
        subtasksPerStageRange: Array.isArray(planningHints.subtasksPerStageRange) ? planningHints.subtasksPerStageRange : null,
        subtaskMinutesRange: Array.isArray(planningHints.subtaskMinutesRange) ? planningHints.subtaskMinutesRange : null,
        maxWeeks: typeof planningHints.maxWeeks === 'number' ? planningHints.maxWeeks : null,
      } : null,
    },
  };
}


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
  id: 'skill:path-planning',
  name: '学习路径规划 Skill',
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
      source: 'skill:path-planning',
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
        agentId: 'skill:path-planning',
        agentName: '学习路径规划 Skill',
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
        agentId: 'skill:path-planning',
        agentName: '学习路径规划 Skill',
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
  structuredData?: any;
  confirmedProposal?: any;
  conversationHistory?: any[];
  scenario?: string;
  replan?: any;
  pathSceneFraming?: any;
}> {
  const gateway = getAPIGateway();
  const caller: CallerInfo = { agentId: 'path-agent', skillId: 'path-planning' };
   
  const structuredData = input.structuredData as any;
  const confirmedProposal = input.confirmedProposal as any;
  const conversationHistory = input.conversationHistory as any[] || [];
  const replan = input.metadata?.replan as any;
  const pathSceneFraming = input.metadata?.pathSceneFraming as any;
  const framingNormalizedInput = pathSceneFraming?.normalizedInput && typeof pathSceneFraming.normalizedInput === 'object'
    ? pathSceneFraming.normalizedInput
    : null;
  const framingPainPoints = Array.isArray(framingNormalizedInput?.learnerProfile?.painPoints)
    ? framingNormalizedInput.learnerProfile.painPoints.filter(Boolean)
    : [];
  const framingContext = typeof framingNormalizedInput?.problemSpace?.scenario === 'string' && framingNormalizedInput.problemSpace.scenario.trim()
    ? framingNormalizedInput.problemSpace.scenario.trim()
    : (typeof framingNormalizedInput?.problemSpace?.currentPainPoint === 'string' && framingNormalizedInput.problemSpace.currentPainPoint.trim()
      ? framingNormalizedInput.problemSpace.currentPainPoint.trim()
      : '');
  const framingLevel = typeof framingNormalizedInput?.learnerProfile?.currentBaseline?.level === 'string' && framingNormalizedInput.learnerProfile.currentBaseline.level.trim()
    ? framingNormalizedInput.learnerProfile.currentBaseline.level.trim()
    : null;
  
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
      level: framingLevel || structuredData.learner?.skill_level || input.currentLevel || 'beginner',
      focus: framingPainPoints.length > 0 ? framingPainPoints : (structuredData.end_user?.pain_points || []),
      context: framingContext || structuredData.end_user?.identity || '',
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
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...parsed,
        level: framingLevel || parsed.level,
        focus: framingPainPoints.length > 0 ? framingPainPoints : (Array.isArray(parsed.focus) ? parsed.focus : []),
        context: framingContext || parsed.context || '',
        replan,
        pathSceneFraming,
      };
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
  const systemPromptOverride = (context as any)?.metadata?.pathAgentSystemPromptOverride as string | undefined;
  const result = await callPrompt<any, PathOutput>({
    agentId: 'skill:path-planning',
    defaultSystemPrompt: '',
    caller: { agentId: 'path-agent', skillId: 'path-planning' },
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
  }, input, { userId, ...(systemPromptOverride ? { systemPromptOverride } : {}) });

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
  const caller: CallerInfo = { agentId: 'path-agent', skillId: 'path-planning' };
  
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
        source: 'skill:path-planning',
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
