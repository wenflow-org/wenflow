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
  MilestoneOutput
} from '../../agents/protocol';
import { CallerInfo } from '../../gateway/api-gateway';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';

import { logger } from '../../utils/logger';

const AGENT_ID = 'skill:path-planning';
const PATH_AGENT_MAX_TOKENS = 32000;

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const PATH_PLANNING_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';

function normalizePromptString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePromptStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizePromptString(item))
    .filter((item): item is string => !!item);
}

function buildPromptFriendlyNormalizedInput(normalizedInput: any) {
  if (!normalizedInput || typeof normalizedInput !== 'object') return null;

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
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope>;
  milestones: MilestoneOutput[];
}

export function validatePathPlanningOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_NAME_MISSING' };
  }

  if (!Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONES_MISSING' };
  }

  if (!parsed.cognitiveCore || typeof parsed.cognitiveCore !== 'object' || Array.isArray(parsed.cognitiveCore)) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_COGNITIVE_CORE_MISSING' };
  }

  const coreConcepts = Array.isArray(parsed.cognitiveCore.coreConcepts)
    ? parsed.cognitiveCore.coreConcepts.filter((c: any) => c && typeof c === 'object')
    : [];
  if (coreConcepts.length > 0) {
    const hubCount = coreConcepts.filter((c: any) => c.role === 'hub').length;
    if (hubCount === 0) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MISSING' };
    }
    if (hubCount > 1) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MULTIPLE' };
    }
  }

  const conceptIds = new Set<string>();
  const conceptNames = new Set<string>();
  for (const concept of coreConcepts) {
    if (typeof concept.id === 'string' && concept.id) conceptIds.add(concept.id)
    if (typeof concept.name === 'string' && concept.name) conceptNames.add(concept.name)
  }
  for (const milestone of parsed.milestones) {
    if (!milestone || typeof milestone !== 'object') {
      return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONE_INVALID' };
    }
    if (milestone.subtasks !== undefined || milestone.acceptanceCriteria !== undefined) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_LEGACY_TASK_FIELDS' };
    }
    if (conceptIds.size > 0 && typeof milestone.coreConcept === 'string' && milestone.coreConcept
      && !conceptIds.has(milestone.coreConcept) && !conceptNames.has(milestone.coreConcept)) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND' };
    }
  }
  const stageNumbers = parsed.milestones.map((m: any) => m && m.stageNumber).filter((n: any) => typeof n === 'number');
  if (stageNumbers.length === parsed.milestones.length && stageNumbers.length > 0) {
    const contiguous = stageNumbers.every((n: number, i: number) => n === i + 1);
    if (!contiguous) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_STAGE_NUMBER_GAP' };
    }
  }

  return { valid: true as const };
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
  
  try {
    // 1. 分析用户目标
    const goalAnalysis = await analyzeGoal(input, context);
    
    // 2. 生成学习路径（包含里程碑）
    const path = await generatePath(input, context, goalAnalysis);
    
    // 注：path:created 事件由 durable outbox 承担（learning.service persistGeneratedPath），内存总线已退役

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
  normalizedInput?: any;
}> {
  const caller: CallerInfo = { agentId: 'path-agent', skillId: 'path-planning' };
   
  const structuredData = input.structuredData as any;
  const confirmedProposal = input.confirmedProposal as any;
  const conversationHistory = input.conversationHistory as any[] || [];
  const replan = input.metadata?.replan as any;
  const framingNormalizedInput = input.metadata?.normalizedInput && typeof input.metadata.normalizedInput === 'object'
    ? input.metadata.normalizedInput
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
      scenario,
      structuredData,
      confirmedProposal,
      conversationHistory,
      replan,
      normalizedInput: framingNormalizedInput,
    };
  }
  
  const userId = context?.userId || input?.metadata?.userId;
  // 无结构化数据时的确定性兜底分析（原 goal-analysis aux skill 已移除：
  // 主流程有 normalizedInput/structuredData 时不调用，fallback 输出也被 framing 覆盖，2026-08 去 LLM 化）
  void userId;
  const parsed = {
    subject: String(input.goal || '学习目标'),
    level: ['beginner', 'intermediate', 'advanced'].includes(input.currentLevel as string)
      ? input.currentLevel as string
      : 'beginner',
    focus: [] as string[],
    context: '',
    confidence: 0.5,
  };

  return {
    ...parsed,
    level: framingLevel || parsed.level,
    focus: framingPainPoints.length > 0 ? framingPainPoints : (Array.isArray(parsed.focus) ? parsed.focus : []),
    context: framingContext || parsed.context || '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    replan,
    normalizedInput: framingNormalizedInput,
  };
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
    normalizedInput?: any;
  }
): Promise<PathOutput> {
  
  const confirmedProposal = analysis.confirmedProposal;
  const conversationHistory = analysis.conversationHistory;
  const replan = analysis.replan;
  const framingNormalizedInput = analysis.normalizedInput && typeof analysis.normalizedInput === 'object'
    ? analysis.normalizedInput
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
  const promptFriendlySceneFraming = buildPromptFriendlyNormalizedInput(framingNormalizedInput);

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
- 重调模式：${replan.mode || 'overwrite'}
- 触发来源：${replan.triggerSource || 'unknown'}
- 源路径 ID：${replan.sourcePathId || 'unknown'}
- 冻结已完成任务：${Array.isArray(replan.freezeCompletedTaskIds) && replan.freezeCompletedTaskIds.length > 0 ? replan.freezeCompletedTaskIds.join('、') : '无'}

【学习者重调投影】
${JSON.stringify(replan.learnerReplanProjection || {}, null, 2)}

【重调要求】
1. 这是对现有学习路径的调整重调，不是从零忽略已有学习历史重新规划。
2. 必须显式参考学习者已稳定掌握、掌握不稳、持续吃力和前置缺口信息。
3. 不要围绕已稳定掌握内容重复铺设大量基础阶段。
4. 对掌握不稳和前置缺口内容，应通过补桥接阶段、补充任务、降低阶段跳跃度来处理。
5. 如果已完成任务被冻结，请把它们视为既有学习历史，不要简单复制同名任务来伪装重调。` : ''}

【强制要求】以下所有生成内容必须紧密围绕"${analysis.context || input.goal}"展开：
- 路径名称必须包含"${analysis.context || input.goal}"的核心主题关键词（提取 2-6 字即可），不得使用通用模板名称
- 每个里程碑的标题必须体现"${analysis.context || input.goal}"的具体阶段
- 禁止使用电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例，全部替换为"${analysis.context || input.goal}"相关场景

重要要求：
1. 路径名称必须是简洁主题名：核心主题/技能 + 水平词（如"Python 自动化 Excel 报表入门"），控制在 8-20 个字；名称只表达"学什么"，不要冒号加副标题、括号补充说明、"从…到…"完整过程句，也不要把用户目标原文整段搬入名称；具体场景、交付物与细节放进 summary 和 milestones
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
    defaultSystemPrompt: PATH_PLANNING_PROMPT,
    requireActivePrompt: true,
    caller: { agentId: 'path-agent', skillId: 'path-planning' },
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
    validateParsedOutput: (parsed) => validatePathPlanningOutput(parsed),
    mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
      contract: runtimeContract,
      artifact: output,
      phase: 'core-path-generated',
      status: 'succeeded',
      isTerminal: true,
      nextAction: null,
      nextState: null,
    }),
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: ({ failureReason }) => `请只输出一个学习路径 JSON 对象，必须包含非空 name、非空 milestones 数组和 cognitiveCore 对象。上次失败原因：${failureReason}`,
    },
  }, input, { userId, ...(systemPromptOverride ? { systemPromptOverride } : {}) });

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'PATH_AGENT_OUTPUT_INVALID');
  }

  return {
    ...result.output,
    runtimeEnvelope: result.runtimeEnvelope,
    _debug: {
      rawModelOutput: result.debug.rawModelOutput,
      extractedJson: result.debug.extractedJson || undefined,
    }
  };
}

export default pathAgentHandler;
