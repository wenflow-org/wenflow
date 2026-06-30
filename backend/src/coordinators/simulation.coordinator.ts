/**
 * Simulation Orchestrator - 模拟流程协调器
 * 
 * 负责协调虚拟用户模拟的完整流程：
 * - Goal对话阶段：VirtualLearnerSimulationAgent ↔ GoalConversationService
 * - Path生成阶段：调用PathOrchestrator
 * - Learning阶段：调用AITeachingService
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import goalConversationService from '../services/learning/goal-conversation.service';
import learningService from '../services/learning/learning.service';
import pathCoordinator, { type GoalPathRequest } from './path.coordinator';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingCoordinator';
import {
  getSimulationAgentConfig,
  type SimulationAgentConfig
} from '../services/agentConfig.service';
import { executeSkill, virtualLearnerGoalDialogueSimulatorDefinition, virtualLearnerPathEvaluatorDefinition, virtualLearnerLearnTurnSimulatorDefinition } from '../skills';
import { normalizeFrictionBudget, type FrictionBudget } from '../skills/virtual-learner-shared';
import { sessionWrapupAgent, type SessionWrapupInput } from '../skills/session-wrapup';
import { buildGoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import type { 
  SimulationContext,
  SimulationStepResult,
  SimulationLogEntry,
  VirtualLearnerProfile,
  GoalConcernPool,
  LearnerLatentState
} from './simulation.types';

const COORDINATOR_ID = 'simulation-agent';

export interface SimulationOrchestratorInput {
  sessionId: string;
  userId: string;
  mode: 'single-step' | 'auto-loop';
}

export interface AutoLoopOptions {
  maxRounds?: number;
  onStep?: (result: SimulationStepResult) => void;
  autoAdvanceToPath?: boolean;
  autoAdvanceToLearning?: boolean;
}

export interface RunFullOptions {
  maxRounds?: number;
  maxMilestones?: number;
  continueOnTaskComplete?: boolean;
  autoAdvanceToPath?: boolean;
  autoAdvanceToLearning?: boolean;
}

class SimulationOrchestrator {
  readonly id = COORDINATOR_ID;

  private sanitizeVisibleDialogue(text: string): string {
    if (!text) return '';

    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private sanitizeVisibleContextMessage(message: any, role: 'learner' | 'goal_agent') {
    const content = this.sanitizeVisibleDialogue(typeof message?.content === 'string' ? message.content : '');
    if (!content) return null;
    return { role, content };
  }

  private trimLearningConversationHistory(history: any[] = []) {
    if (!Array.isArray(history) || history.length === 0) return [];
    return history.slice(-6).map((item: any) => ({
      role: item?.role,
      content: this.sanitizeVisibleDialogue(typeof item?.content === 'string' ? item.content : '')
    })).filter((item: any) => item.content);
  }

  private inferLearningPhase(learnerState: LearnerLatentState | null | undefined): 'trying' | 'blocked' | 'verifying' | 'ready_to_close' {
    const state = learnerState || {};
    const blockerCount = Array.isArray(state.remainingBlockers) ? state.remainingBlockers.length : 0;
    const cognitiveLoad = typeof state.cognitiveLoad === 'number' ? state.cognitiveLoad : 0;
    const misconceptionRisk = typeof state.misconceptionRisk === 'number' ? state.misconceptionRisk : 0;
    const taskUnderstanding = typeof state.taskUnderstanding === 'number' ? state.taskUnderstanding : 0;

    if (state.readyForNextTask === true) return 'ready_to_close';
    if (blockerCount > 0 || cognitiveLoad >= 0.72 || misconceptionRisk >= 0.7) return 'blocked';
    if (taskUnderstanding >= 0.7) return 'verifying';
    return 'trying';
  }

  private getRunnableTasks(tasks: any[] = []) {
    return tasks.filter(task => task.status !== 'completed');
  }

  private buildLearningProgressSnapshot(milestones: any[], milestoneIdx: number, taskIdx: number) {
    const milestone = milestones[milestoneIdx];
    const tasks = this.getRunnableTasks(milestone?.subtasks || []);
    const task = tasks[taskIdx] || null;

    return {
      currentMilestone: milestoneIdx,
      currentMilestoneTitle: milestone?.title || null,
      currentTaskIdx: task ? taskIdx : 0,
      currentTaskId: task?.id || null,
      currentTaskTitle: task?.title || null,
      totalMilestones: milestones.length
    };
  }

  private isGoalConverged(stage?: string | null) {
    return stage === 'ready' || stage === 'completed';
  }
  
  private async getVirtualSession(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: true
      }
    });
    
    if (!session) {
      throw new Error('模拟会话不存在');
    }
    
    return session;
  }
  
  private async getGoalConversation(conversationId: string, userId: string) {
    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: conversationId, userId }
    });
    
    return conversation;
  }
  
  private parseProfileData(profileRecord: any): VirtualLearnerProfile {
    let profileData: any = {};
    try {
      profileData = JSON.parse(profileRecord.profile || '{}');
    } catch {}
    
    let knownConcepts: string[] = [];
    try {
      knownConcepts = JSON.parse(profileRecord.knownConcepts || '[]');
    } catch {}
    
    let struggleConcepts: string[] = [];
    try {
      struggleConcepts = JSON.parse(profileRecord.struggleConcepts || '[]');
    } catch {}
    
    let personalityTraits: any = {};
    try {
      personalityTraits = JSON.parse(profileRecord.personalityTraits || '{}');
    } catch {}
    
    return {
      id: profileRecord.id,
      userId: profileRecord.userId,
      profile: profileData,
      learningGoal: profileRecord.learningGoal,
      knowledgeLevel: profileRecord.knowledgeLevel || 'beginner',
      knownConcepts,
      struggleConcepts,
      personalityTraits,
      simulationPrompt: profileRecord.simulationPrompt,
      simulationModel: profileRecord.simulationModel,
      simulationTemperature: profileRecord.simulationTemperature
    };
  }
  
  private buildSimulationContext(
    profile: VirtualLearnerProfile,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    lastAssistantMessage: string,
    currentStage: 'goal' | 'path' | 'learning',
    storyContext?: any,
    goalState?: any,
    learnerState?: any,
    knowledgeState?: any,
    learningState?: any
  ): SimulationContext {
    return {
      profile,
      conversationHistory,
      currentStage,
      lastAssistantMessage,
      storyContext,
      goalState,
      learnerState: this.mergeLearnerState(profile, learnerState, currentStage, storyContext),
      knowledgeState,
      learningState
    };
  }

  private buildStoryBehaviorBias(storyContext?: any): Partial<LearnerLatentState> {
    if (!storyContext) return {};

    const pressurePoints = Array.isArray(storyContext.pressurePoints) ? storyContext.pressurePoints : [];
    const behaviorHooks = Array.isArray(storyContext.behaviorHooks) ? storyContext.behaviorHooks : [];
    const text = [...pressurePoints, ...behaviorHooks].join('；');

    const partial: Partial<LearnerLatentState> = {};

    if (text.includes('焦虑') || text.includes('紧张') || text.includes('压力')) {
      partial.frustrationLevel = 0.34;
      partial.confusionLevel = 0.54;
    }

    if (text.includes('追问') || text.includes('确认') || text.includes('求助')) {
      partial.wantsClarification = true;
    }

    if (text.includes('保留') || text.includes('质疑') || text.includes('防御')) {
      partial.readyToAdvance = false;
    }

    if (text.includes('装懂') || text.includes('先猜') || text.includes('模糊带过')) {
      partial.selfPerceivedMastery = 0.58;
      partial.actualMastery = 0.38;
    }

    return partial;
  }

  private buildDefaultLearnerState(
    profile: VirtualLearnerProfile,
    currentStage: 'goal' | 'path' | 'learning'
  ): LearnerLatentState {
    const traits = profile.personalityTraits || {};
    const p = profile.profile || {};

    const patienceBase = traits.patience === 'low' ? 0.35 : traits.patience === 'high' ? 0.78 : 0.58;
    const enthusiasmBase = traits.enthusiasm === 'low' ? 0.4 : traits.enthusiasm === 'high' ? 0.76 : 0.58;
    const attentionPenalty = typeof p.cognitiveLoadTolerance === 'string' && p.cognitiveLoadTolerance.includes('信息一多') ? 0.12 : 0;
    const frustrationBoost = p.emotionalBaseline || (Array.isArray(p.emotionalTriggers) && p.emotionalTriggers.length) ? 0.08 : 0;
    const helpSeeking = typeof p.helpSeekingPattern === 'string' ? p.helpSeekingPattern : '';
    const wantsClarificationByTrait = traits.questionStyle === 'clarifying'
      || traits.questionStyle === 'challenging'
      || helpSeeking.includes('追问')
      || helpSeeking.includes('确认')
      || helpSeeking.includes('具体例子');

    return {
      motivationLevel: enthusiasmBase,
      attentionLevel: Math.max(0.2, patienceBase - attentionPenalty),
      persistenceLevel: patienceBase,
      confusionLevel: currentStage === 'goal' ? 0.48 : 0.32,
      frustrationLevel: Math.min(0.75, 0.18 + frustrationBoost),
      goalReadiness: currentStage === 'goal' ? 0.28 : currentStage === 'path' ? 0.6 : undefined,
      wantsClarification: currentStage === 'goal' ? wantsClarificationByTrait : undefined,
      readyToAdvance: currentStage === 'goal' ? false : undefined,
      selfPerceivedMastery: profile.knowledgeLevel === 'beginner' ? 0.24 : profile.knowledgeLevel === 'advanced' ? 0.72 : 0.5,
      actualMastery: profile.knowledgeLevel === 'beginner' ? 0.2 : profile.knowledgeLevel === 'advanced' ? 0.75 : 0.48,
      memoryStrength: p.memoryRepairPattern ? 0.42 : 0.5,
      remainingUnknowns: currentStage === 'goal' ? ['真实问题还没有完全说清', '还不确定哪种方式真正适合自己'] : undefined,
      stableErrorStyle: Array.isArray(p.failurePatterns) ? p.failurePatterns.slice(0, 2) : undefined
    };
  }

  private mergeLearnerState(
    profile: VirtualLearnerProfile,
    learnerState: any,
    currentStage: 'goal' | 'path' | 'learning',
    storyContext?: any
  ): LearnerLatentState {
    const merged = {
      ...this.buildDefaultLearnerState(profile, currentStage),
      ...this.buildStoryBehaviorBias(storyContext),
      ...(learnerState || {})
    };

    if (currentStage === 'goal') {
      if (typeof merged.goalReadiness !== 'number' || !Number.isFinite(merged.goalReadiness)) {
        merged.goalReadiness = this.buildDefaultLearnerState(profile, currentStage).goalReadiness;
      }

      if (merged.goalReadiness >= 0.78 && merged.wantsClarification === false && merged.readyToAdvance !== false) {
        merged.readyToAdvance = true;
      }

      if (merged.goalReadiness < 0.55) {
        merged.readyToAdvance = false;
      }
    }

    if (currentStage === 'learning') {
      if (typeof merged.taskUnderstanding !== 'number' || !Number.isFinite(merged.taskUnderstanding)) {
        merged.taskUnderstanding = merged.understandingLevel;
      }

      if (typeof merged.helpSeekingReadiness !== 'number' || !Number.isFinite(merged.helpSeekingReadiness)) {
        merged.helpSeekingReadiness = merged.wantsClarification ? 0.7 : 0.35;
      }

      if (typeof merged.readyForNextTask !== 'boolean') {
        merged.readyForNextTask = !!(merged.taskUnderstanding !== undefined && merged.taskUnderstanding >= 0.72 && merged.misconceptionRisk !== undefined && merged.misconceptionRisk < 0.45);
      }
    }

    return merged;
  }

  private mapGoalStageToLearnerPhase(goalStage?: string | null) {
    const normalized = String(goalStage || '').toLowerCase();
    if (normalized === 'proposing' || normalized === 'ready' || normalized === 'completed') {
      return 'proposal_evaluation' as const;
    }
    return 'understanding' as const;
  }

  private buildGoalVisibleContext(history: Array<{ role: 'user' | 'assistant'; content: string }>, lastAssistantMessage: string) {
    const visibleHistory = history.flatMap((item) => {
      if (item.role === 'user') {
        const learner = this.sanitizeVisibleContextMessage(item, 'learner');
        return learner ? [learner] : [];
      }
      const goalAgent = this.sanitizeVisibleContextMessage(item, 'goal_agent');
      return goalAgent ? [goalAgent] : [];
    });

    return {
      history: visibleHistory,
      lastGoalAgentMessage: this.sanitizeVisibleDialogue(lastAssistantMessage || visibleHistory.filter((item) => item.role === 'goal_agent').slice(-1)[0]?.content || '')
    };
  }

  private async simulateGoalLearnerReply(params: {
    profile: VirtualLearnerProfile;
    storyContext?: any;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    lastAssistantMessage: string;
    currentPhase: 'opening' | 'understanding' | 'proposal_evaluation';
    previousLearnerState?: any;
    goalState?: any;
    frictionBudget?: FrictionBudget;
  }) {
    const output = await executeSkill(virtualLearnerGoalDialogueSimulatorDefinition, {
      learner: {
        profile: params.profile.profile || {},
        learningGoal: params.profile.learningGoal,
        knownConcepts: params.profile.knownConcepts || [],
        struggleConcepts: params.profile.struggleConcepts || [],
        personalityTraits: params.profile.personalityTraits || {},
      },
      story: params.storyContext || null,
      visibleContext: this.buildGoalVisibleContext(params.conversationHistory, params.lastAssistantMessage),
      currentPhase: params.currentPhase,
      previousLearnerState: params.previousLearnerState || null,
      frictionBudget: params.frictionBudget,
      task: {
        mode: 'simulate-goal-learner-turn',
        requirements: [
          'only use learner-visible content',
          'ignore system/developer/tool/reminder text',
          'reply as the learner',
          'use proposal_evaluation to judge proposal fit and task relevance'
        ]
      }
    });

    return {
      success: !!output?.reply,
      output
    };
  }

  private finalizeGoalLearnerState(
    profile: VirtualLearnerProfile,
    learnerState: any,
    storyContext?: any,
    finalStage?: string | null
  ): LearnerLatentState {
    const merged = this.mergeLearnerState(profile, learnerState, 'goal', storyContext);

    if (finalStage === 'ready' || finalStage === 'completed') {
      return {
        ...merged,
        goalReadiness: Math.max(typeof merged.goalReadiness === 'number' ? merged.goalReadiness : 0.28, 0.86),
        wantsClarification: false,
        readyToAdvance: true,
        remainingUnknowns: []
      };
    }

    return merged;
  }

  private buildGoalConcernPool(profile: VirtualLearnerProfile, goalState: any): GoalConcernPool {
    const primary = new Set<string>();
    const secondary = new Set<string>();
    const hidden = new Set<string>();
    const understanding = goalState?.understanding || {};
    const background = understanding?.background || {};

    primary.add('我真正想解决的问题可能和表面目标不完全一样');

    if (profile.profile?.priorAttempts || understanding?.pain_points) {
      primary.add('我之前试过类似学习，但效果不好，担心这次还是学不会');
    }

    if (profile.profile?.availableTime === 'minimal' || background?.available_time || background?.expected_time) {
      secondary.add('我的时间可能不稳定，担心学不完或者坚持不下去');
    }

    if (profile.struggleConcepts?.length) {
      primary.add(`我对某些关键点长期卡住，比如：${profile.struggleConcepts.slice(0, 2).join('、')}`);
    }

    if (profile.knowledgeLevel === 'beginner') {
      secondary.add('我担心自己基础不够，容易跟不上');
    }

    if (profile.personalityTraits?.questionStyle === 'none') {
      hidden.add('即使我没完全懂，也可能不会第一时间主动问出来');
    }

    if (profile.personalityTraits?.patience === 'low') {
      hidden.add('如果过程太绕或太长，我可能会失去耐心');
    }

    if (profile.profile?.motivationType === 'career' || profile.profile?.motivationType === 'necessity') {
      secondary.add('我希望学习结果尽快能用，不太想学很多暂时用不上的内容');
    }

    if (profile.profile?.emotionalBaseline) {
      hidden.add(`这件事会牵动我的情绪底色：${profile.profile.emotionalBaseline}`);
    }

    if (Array.isArray(profile.profile?.emotionalTriggers) && profile.profile.emotionalTriggers.length) {
      hidden.add(`有些情境会明显放大我的压力，比如：${profile.profile.emotionalTriggers.slice(0, 2).join('、')}`);
    }

    if (profile.profile?.helpSeekingPattern) {
      hidden.add(`我在求助上有固定习惯：${profile.profile.helpSeekingPattern}`);
    }

    if (profile.profile?.adversarialPattern) {
      secondary.add(`如果建议不贴近现实，我可能会先保留或质疑：${profile.profile.adversarialPattern}`);
    }

    if (profile.profile?.cognitiveLoadTolerance) {
      secondary.add(`我的信息承载方式有边界：${profile.profile.cognitiveLoadTolerance}`);
    }

    if (profile.profile?.metacognitiveProfile) {
      hidden.add(`我未必能马上准确说清卡点根因：${profile.profile.metacognitiveProfile}`);
    }

    if (profile.profile?.memoryRepairPattern) {
      hidden.add(`即使我忘了或没真懂，也可能先按自己的习惯处理：${profile.profile.memoryRepairPattern}`);
    }

    return {
      primary: Array.from(primary),
      secondary: Array.from(secondary),
      hidden: Array.from(hidden)
    };
  }

  private flattenGoalConcernPool(concernPool: GoalConcernPool): string[] {
    return [...(concernPool.primary || []), ...(concernPool.secondary || []), ...(concernPool.hidden || [])];
  }

  private inferDisclosedGoalConcerns(reply: string, concernPool: GoalConcernPool, disclosed: string[]): string[] {
    const next = new Set(disclosed);
    const text = (reply || '').toLowerCase();

    const flatPool = this.flattenGoalConcernPool(concernPool);

    const concernKeywords = flatPool.map(item => ({
      item,
      keywords: item
        .replace(/[，。；：,.:]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 2)
    }));

    for (const { item, keywords } of concernKeywords) {
      if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
        next.add(item);
      }
    }

    return Array.from(next);
  }
  
  private async addSessionLog(sessionId: string, log: SimulationLogEntry) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) return;
    
    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {}
    
    logs.push(log);
    
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        logs: JSON.stringify(logs),
        updatedAt: new Date()
      }
    });
  }
  
  private async updateSessionStatus(
    sessionId: string,
    status: string,
    currentStage?: string,
    goalConversationId?: string,
    learningPathId?: string
  ) {
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        status,
        currentStage: currentStage || undefined,
        goalConversationId: goalConversationId || undefined,
        learningPathId: learningPathId || undefined,
        updatedAt: new Date()
      }
    });
  }
  
  private async updateStageResults(sessionId: string, stage: string, result: any) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) return;
    
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {}
    
    stageResults[stage] = result;
    
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        stageResults: JSON.stringify(stageResults),
        updatedAt: new Date()
      }
    });
  }

  private async resetSessionRuntime(
    sessionId: string,
    options: {
      keepGoalConversation?: boolean;
      keepLearningPath?: boolean;
      nextStage: 'goal' | 'path' | 'learning';
      nextStatus?: 'created' | 'running' | 'completed' | 'failed';
      removeStageResults?: string[];
      logPhasesToRemove?: string[];
      resetTaskProgress?: boolean;
      clearCompletedAt?: boolean;
    }
  ) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    })

    if (!session) {
      throw new Error('模拟会话不存在')
    }

    let stageResults: any = {}
    try {
      stageResults = JSON.parse(session.stageResults || '{}')
    } catch {}

    for (const key of options.removeStageResults || []) {
      delete stageResults[key]
    }

    let logs: any[] = []
    try {
      logs = JSON.parse(session.logs || '[]')
    } catch {}

    const logPhasesToRemove = new Set(options.logPhasesToRemove || [])
    const nextLogs = logPhasesToRemove.size
      ? logs.filter((entry: any) => !logPhasesToRemove.has(String(entry?.phase || '')))
      : logs

    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        status: options.nextStatus || 'running',
        currentStage: options.nextStage,
        goalConversationId: options.keepGoalConversation ? session.goalConversationId || undefined : null,
        learningPathId: options.keepLearningPath ? session.learningPathId || undefined : null,
        currentTaskId: null,
        completedTasks: options.resetTaskProgress ? 0 : session.completedTasks,
        totalTasks: options.resetTaskProgress ? 0 : session.totalTasks,
        stageResults: JSON.stringify(stageResults),
        logs: JSON.stringify(nextLogs),
        completedAt: options.clearCompletedAt ? null : session.completedAt,
        updatedAt: new Date()
      }
    })
  }

  private parseStageResultsPayload(raw: string | null | undefined) {
    try {
      return JSON.parse(raw || '{}') || {}
    } catch {
      return {}
    }
  }

  /**
   * 从 session.stageResults.simulationConfig 读取本次会话的 frictionBudget
   * 默认 'normal' (真实人物常态)
   */
  private getSessionFrictionBudget(session: any): FrictionBudget {
    const stageResults = this.parseStageResultsPayload(session?.stageResults)
    return normalizeFrictionBudget(stageResults?.simulationConfig?.frictionBudget)
  }

  private parseStoryContextFromStageResults(stageResults: any): any {
    return stageResults?.story || null;
  }
  
  async executeSingleStep(input: SimulationOrchestratorInput): Promise<SimulationStepResult> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      logger.info('[simulation-coordinator] 执行单步模拟', {
        sessionId: input.sessionId,
        userId: input.userId
      });
      
      const session = await this.getVirtualSession(input.sessionId);
      const profile = this.parseProfileData(session.virtual_learner_profiles);
      let initialStageResults: any = {};
      try {
        initialStageResults = JSON.parse(session.stageResults || '{}');
      } catch {}
      const storyContext = this.parseStoryContextFromStageResults(initialStageResults);
      
      if (!session.goalConversationId) {
        const openingStart = Date.now();
        const openingResult = await this.simulateGoalLearnerReply({
          profile,
          storyContext,
          conversationHistory: [],
          lastAssistantMessage: '',
          currentPhase: 'opening',
          previousLearnerState: undefined,
          goalState: undefined,
          frictionBudget: this.getSessionFrictionBudget(session)
        });
        const openingReply = openingResult.success && openingResult.output?.reply
          ? openingResult.output.reply
          : profile.learningGoal;

        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'virtual-reply',
          durationMs: Date.now() - openingStart,
          details: {
            output: {
              reply: openingReply,
              thoughtProcess: openingResult.output?.debug?.stateChangeReason,
              learnerState: this.finalizeGoalLearnerState(profile, openingResult.output?.learnerState || {}, storyContext, 'understanding'),
              emotion: openingResult.output?.emotion,
              opening: true
            }
          }
        });

        const goalResult = await goalConversationService.startConversation(
          input.userId,
          openingReply
        );
        
        await this.updateSessionStatus(
          input.sessionId,
          'running',
          'goal',
          goalResult.internal.core.conversationId
        );
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'goal-response',
          details: {
            output: {
              userVisible: goalResult.userVisible,
              stage: goalResult.internal.core.stage,
              confidence: goalResult.internal.core.confidence,
              conversationId: goalResult.internal.core.conversationId,
              quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
                typeof q === 'string' ? q : q.text
              ) || []
            }
          }
        });

        for (const log of logs) {
          await this.addSessionLog(input.sessionId, log);
        }

        return {
          success: true,
          virtualUserReply: openingReply,
          goalConversationResponse: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q => 
              typeof q === 'string' ? q : q.text
            )
          },
          currentStage: 'goal',
          goalReady: this.isGoalConverged(goalResult.internal.core.stage),
          logs
        };
      }
      
      const conversation = await this.getGoalConversation(session.goalConversationId, input.userId);
      
      if (!conversation) {
        throw new Error('Goal对话不存在');
      }
      
      let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      try {
        const collectedData = JSON.parse(conversation.collectedData || '{}');
        const rawMessages = collectedData.messages || [];
        conversationHistory = rawMessages.map((m: any) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: this.sanitizeVisibleDialogue(typeof m.content === 'string' ? m.content : '')
        })).filter((m: { role: 'user' | 'assistant'; content: string }) => !!m.content);
      } catch {}
      
      const lastAssistantMessage = conversationHistory.length > 0
        ? conversationHistory.filter(m => m.role === 'assistant').pop()?.content || ''
        : conversationHistory.filter(m => m.role !== 'user').pop()?.content || '';
      
      let goalState: any = {};
      try {
        goalState = JSON.parse(conversation.collectedData || '{}');
      } catch {}

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}

      const existingGoalState = stageResults.goal || {};
      const activeStoryContext = this.parseStoryContextFromStageResults(stageResults);
      const concernPool = existingGoalState.concernPool || this.buildGoalConcernPool(profile, goalState);
      const disclosedConcerns = existingGoalState.disclosedConcerns || [];
      const missingFields = [
        !goalState?.understanding?.real_problem ? '真实问题' : null,
        !goalState?.understanding?.background?.current_level ? '当前基础' : null,
        !goalState?.understanding?.background?.expected_time ? '时间预期' : null,
        !goalState?.understanding?.motivation ? '学习动机' : null
      ].filter(Boolean);

      const enrichedGoalState = {
        ...goalState,
        missingFields,
        concernPool,
        disclosedConcerns
      };
      
      const simulationContext = this.buildSimulationContext(
        profile,
        conversationHistory,
        lastAssistantMessage,
        'goal',
        activeStoryContext,
        enrichedGoalState,
        stageResults.goal?.learnerState,
        stageResults.goal?.knowledgeState,
        undefined
      );
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await this.simulateGoalLearnerReply({
        profile,
        storyContext: activeStoryContext,
        conversationHistory,
        lastAssistantMessage,
        currentPhase: this.mapGoalStageToLearnerPhase(goalState?.stage || existingGoalState.stage),
        previousLearnerState: stageResults.goal?.learnerState,
        goalState,
        frictionBudget: this.getSessionFrictionBudget(session)
      });
      
      if (!virtualReplyResult.success || !virtualReplyResult.output?.reply) {
        throw new Error('虚拟用户回复生成失败');
      }

      const currentGoalLearnerState = this.finalizeGoalLearnerState(
        profile,
        virtualReplyResult.output?.learnerState || {},
        activeStoryContext,
        existingGoalState.finalStage || existingGoalState.stage || goalState?.stage
      );
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'virtual-reply',
        durationMs: Date.now() - virtualReplyStart,
        details: {
          output: {
              reply: virtualReplyResult.output?.reply,
            thoughtProcess: virtualReplyResult.output?.debug?.stateChangeReason,
            learnerState: currentGoalLearnerState,
            emotion: virtualReplyResult.output?.emotion
          }
        }
      });

      const nextDisclosedConcerns = this.inferDisclosedGoalConcerns(
        virtualReplyResult.output.reply,
        concernPool,
        disclosedConcerns
      );

      await this.updateStageResults(input.sessionId, 'goal', {
        ...existingGoalState,
        concernPool,
        disclosedConcerns: nextDisclosedConcerns,
        learnerState: currentGoalLearnerState
      });
      
      const goalResponseStart = Date.now();
      const goalResult = await goalConversationService.continueConversation(
        session.goalConversationId,
        virtualReplyResult.output.reply,
        input.userId
      );
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'goal-response',
        durationMs: Date.now() - goalResponseStart,
        details: {
          output: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
              typeof q === 'string' ? q : q.text
            ) || []
          }
        }
      });

      const goalReady = this.isGoalConverged(goalResult.internal.core.stage);
      const finalGoalLearnerState = this.finalizeGoalLearnerState(
        profile,
        virtualReplyResult.output?.learnerState || {},
        activeStoryContext,
        goalResult.internal.core.stage
      );

      if (goalReady) {
        // 同步 learningPathId 到 virtual_session（goalConversationService 已自动触发 path 生成）
        const updatedConversation = await prisma.goal_conversations.findUnique({
          where: { id: session.goalConversationId }
        });
        
        await this.updateSessionStatus(
          input.sessionId,
          'running',
          'path',
          undefined,
          updatedConversation?.learningPathId
        );
        
        await this.updateStageResults(input.sessionId, 'goal', {
          ...existingGoalState,
          success: true,
          durationMs: Date.now() - startTime,
          conversationId: session.goalConversationId,
          finalStage: goalResult.internal.core.stage,
          learningPathId: updatedConversation?.learningPathId,
          learnerState: finalGoalLearnerState,
          concernPool,
          disclosedConcerns: nextDisclosedConcerns
        });
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'goal',
              to: 'path',
              learningPathId: updatedConversation?.learningPathId,
              message: '路径已自动开始生成'
            }
          }
        });
        
      }

      for (const log of logs) {
        await this.addSessionLog(input.sessionId, log);
      }
      
      logger.info('[simulation-coordinator] 单步模拟完成', {
        sessionId: input.sessionId,
        durationMs: Date.now() - startTime,
        goalReady
      });
      
        return {
          success: true,
          virtualUserReply: virtualReplyResult.output.reply,
        goalConversationResponse: {
          userVisible: goalResult.userVisible,
          stage: goalResult.internal.core.stage,
          confidence: goalResult.internal.core.confidence,
          quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
            typeof q === 'string' ? q : q.text
          )
        },
          currentStage: goalReady ? 'path' : 'goal',
          goalReady,
          logs
        };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 单步模拟失败', {
        sessionId: input.sessionId,
        error: error.message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: error.message
        }
      });
      
      await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
      
      return {
        success: false,
        virtualUserReply: '',
        currentStage: 'goal',
        goalReady: false,
        logs,
        error: error.message
      };
    }
  }
  
  async executeAutoLoop(
    input: SimulationOrchestratorInput,
    options: AutoLoopOptions = {}
  ): Promise<SimulationStepResult[]> {
    const config = await getSimulationAgentConfig();
    const maxRounds = options.maxRounds || config.maxRounds;
    const results: SimulationStepResult[] = [];
    
    logger.info('[simulation-coordinator] 开始自动循环模拟', {
      sessionId: input.sessionId,
      maxRounds,
      config
    });
    
    for (let round = 0; round < maxRounds; round++) {
      const stepResult = await this.executeSingleStep(input);
      results.push(stepResult);
      
      if (options.onStep) {
        options.onStep(stepResult);
      }
      
      if (config.stepDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.stepDelayMs));
      }
      
      if (!stepResult.success) {
        logger.warn('[simulation-coordinator] 自动循环因错误终止', {
          sessionId: input.sessionId,
          round,
          error: stepResult.error
        });
        break;
      }
      
      if (stepResult.goalReady) {
        logger.info('[simulation-coordinator] 自动循环因Goal Ready终止', {
          sessionId: input.sessionId,
          round
        });
        
        const shouldAdvancePath = options.autoAdvanceToPath ?? config.autoAdvanceToPath;
        if (shouldAdvancePath) {
          logger.info('[simulation-coordinator] 自动推进到Path阶段', {
            sessionId: input.sessionId
          });
          await this.advanceToPathGeneration(input.sessionId);

          if (options.autoAdvanceToLearning) {
            logger.info('[simulation-coordinator] 自动推进到Learning阶段', {
              sessionId: input.sessionId
            });
            try {
              await this.startLearningPhase(input.sessionId);
            } catch (err: any) {
              logger.warn('[simulation-coordinator] 自动启动 Learn 失败', { error: err.message });
            }
          }
        }
        break;
      }
    }
    
    logger.info('[simulation-coordinator] 自动循环模拟完成', {
      sessionId: input.sessionId,
      totalRounds: results.length
    });
    
    return results;
  }

  /**
   * 一键运行整个会话: Goal -> Path -> Learn
   * 适合"全自动"按钮，跑到 Goal 收敛 -> 自动生成 Path -> 自动启动 Learn -> 跑完所有 task
   */
  async executeFullSession(
    sessionId: string,
    options: RunFullOptions = {}
  ): Promise<{
    success: boolean;
    goalRounds: number;
    learningSteps: number;
    pathGenerated: boolean;
    isPathCompleted: boolean;
    finalStage?: string;
    error?: string;
  }> {
    const config = await getSimulationAgentConfig();
    const maxRounds = options.maxRounds || config.maxRounds;
    const maxMilestones = options.maxMilestones || 10;
    const continueOnTaskComplete = options.continueOnTaskComplete ?? true;

    logger.info('[simulation-coordinator] 一键全流程开始', {
      sessionId,
      maxRounds,
      maxMilestones,
      continueOnTaskComplete
    });

    const session = await this.getVirtualSession(sessionId);
    const summary = {
      success: false,
      goalRounds: 0,
      learningSteps: 0,
      pathGenerated: false,
      isPathCompleted: false,
      finalStage: session.currentStage,
      error: undefined as string | undefined
    };

    try {
      // ========== Phase A: Goal ==========
      if (session.currentStage === 'goal') {
        const goalResults = await this.executeAutoLoop(
          { sessionId, userId: session.userId, mode: 'auto-loop' },
          {
            maxRounds,
            autoAdvanceToPath: true,
            autoAdvanceToLearning: false
          }
        );
        summary.goalRounds = goalResults.length;
        const lastGoal = goalResults[goalResults.length - 1];
        if (!lastGoal?.goalReady && !lastGoal?.success) {
          summary.error = lastGoal?.error || 'Goal 阶段未完成';
          return summary;
        }
      }

      // refresh session state
      const updatedAfterGoal = await this.getVirtualSession(sessionId);
      summary.finalStage = updatedAfterGoal.currentStage;
      summary.pathGenerated = !!updatedAfterGoal.learningPathId;

      // ========== Phase B: Path -> Learn bridge ==========
      if (updatedAfterGoal.learningPathId && updatedAfterGoal.currentStage !== 'learning') {
        try {
          await this.startLearningPhase(sessionId);
        } catch (err: any) {
          logger.warn('[simulation-coordinator] 启动 Learn 失败', { error: err.message });
          summary.error = err.message || '启动 Learn 失败';
          return summary;
        }
      }

      // ========== Phase C: Learn loop with continueOnTaskComplete ==========
      const refreshed = await this.getVirtualSession(sessionId);
      if (refreshed.currentStage !== 'learning') {
        summary.finalStage = refreshed.currentStage;
        summary.success = true;
        return summary;
      }

      let totalLearningSteps = 0;
      let consecutiveTaskBoundaries = 0;
      const maxTaskBoundaries = continueOnTaskComplete ? maxMilestones * 3 : 1;

      while (consecutiveTaskBoundaries < maxTaskBoundaries) {
        const learnResult = await this.executeAutoLearning(sessionId, { maxMilestones });
        totalLearningSteps += learnResult.totalSteps || 0;

        // refresh
        const after = await this.getVirtualSession(sessionId);
        summary.finalStage = after.currentStage;

        if (after.status === 'completed') {
          summary.isPathCompleted = true;
          break;
        }
        if (after.status === 'failed') {
          summary.error = '学习被中止';
          break;
        }
        if (!continueOnTaskComplete) {
          break;
        }

        // if last loop ran 0 steps, no further progress is possible
        if (!learnResult.success || (learnResult.totalSteps || 0) === 0) {
          break;
        }

        consecutiveTaskBoundaries += 1;
      }

      summary.learningSteps = totalLearningSteps;
      summary.success = true;
      return summary;
    } catch (error: any) {
      logger.error('[simulation-coordinator] 一键全流程失败', { sessionId, error });
      summary.error = error.message || 'unknown';
      return summary;
    }
  }

  
  async advanceToPathGeneration(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = session.stageResults || {};
      
      if (!session.goalConversationId) {
        throw new Error('Goal对话不存在');
      }
      
      const conversation = await this.getGoalConversation(
        session.goalConversationId,
        session.userId
      );
      
      if (!conversation) {
        throw new Error('Goal对话记录不存在');
      }
      
      let collectedData: any = {};
      try {
        collectedData = JSON.parse(conversation.collectedData || '{}');
      } catch {}
      
      const pathRequest: GoalPathRequest = {
        userId: session.userId,
        sourceConversationId: session.goalConversationId,
        source: 'goal',
        rawGoal: session.virtual_learner_profiles.learningGoal,
        visibleSummary: buildGoalPathVisibleSummary({
          understanding: collectedData.understanding || {},
          confirmedProposal: collectedData.confirmedProposal || null,
          collected: collectedData.collected || {},
        }),
        conversationHistory: collectedData.messages || []
      };
      
      logger.info('[simulation-coordinator] 开始路径生成', {
        sessionId,
        userId: session.userId
      });
      
      const pathResult = await pathCoordinator.generateFromGoal(pathRequest);
      
      const learningPathId = pathResult?.path?.id || pathResult?.id;
      
      if (learningPathId) {
        await this.updateSessionStatus(
          sessionId,
          'running',
          'path',
          undefined,
          learningPathId
        );
        
        await this.updateStageResults(sessionId, 'path', {
          success: true,
          learningPathId,
          totalMilestones: pathResult?.path?.totalMilestones
        });
      }
      
      logger.info('[simulation-coordinator] 路径生成完成', {
        sessionId,
        learningPathId
      });
      
      return {
        success: true,
        learningPathId
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 路径生成失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async reviewPathProposal(sessionId: string): Promise<{
    success: boolean;
    reaction?: string;
    visibleRequestedChanges?: string[];
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在，请先生成路径');
      }
      
      const profile = this.parseProfileData(session.virtual_learner_profiles);

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}
      
      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId }
      });
      
      if (!learningPath) {
        throw new Error('学习路径记录不存在');
      }
      
      const milestones = await prisma.milestones.findMany({
        where: { learningPathId: session.learningPathId },
        orderBy: { stageNumber: 'asc' }
      });
      
      const reactionStart = Date.now();
      const reactionOutput = await executeSkill(virtualLearnerPathEvaluatorDefinition, {
        learner: profile,
        story: this.parseStoryContextFromStageResults(stageResults),
        pathProposal: {
          title: learningPath.title,
          description: learningPath.description,
          totalMilestones: learningPath.totalMilestones,
          estimatedHours: learningPath.estimatedHours,
          difficulty: learningPath.difficulty,
          milestones: milestones.map(m => ({
            stageNumber: m.stageNumber,
            title: m.title,
            description: m.description,
            estimatedHours: m.estimatedHours
          }))
        },
        goalState: null,
        previousReaction: stageResults.path_review || null,
        learnerState: this.mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults)),
        frictionBudget: this.getSessionFrictionBudget(session)
      });

      if (!reactionOutput?.reaction) {
        throw new Error('虚拟用户 Path 评审结果无效');
      }
      
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        durationMs: Date.now() - reactionStart,
        details: {
          output: {
            reaction: reactionOutput.reaction,
            visibleRequestedChanges: reactionOutput.visibleRequestedChanges || []
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'path_review', {
        success: true,
        reaction: reactionOutput.reaction,
        visibleRequestedChanges: reactionOutput.visibleRequestedChanges || [],
        learnerState: this.mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults))
      });
      
      logger.info('[simulation-coordinator] 路径评审完成', {
        sessionId,
        hasReaction: !!reactionOutput.reaction,
        requestedChangeCount: Array.isArray(reactionOutput.visibleRequestedChanges) ? reactionOutput.visibleRequestedChanges.length : 0
      });
      
      return {
        success: true,
        reaction: reactionOutput.reaction,
        visibleRequestedChanges: reactionOutput.visibleRequestedChanges || []
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 路径评审失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async startLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: any[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在，请先生成路径');
      }
      
      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });
      
      if (!learningPath || !learningPath.milestones.length) {
        throw new Error('学习路径或里程碑不存在');
      }

      let firstMilestone = learningPath.milestones[0];
      let firstMilestoneIdx = 0;
      let runnableTasks = this.getRunnableTasks(firstMilestone?.subtasks || []);
      let firstTask = runnableTasks[0];
      let firstTaskIdx = 0;

      if (options.taskId) {
        firstMilestoneIdx = learningPath.milestones.findIndex(m => Array.isArray(m.subtasks) && m.subtasks.some(task => task.id === options.taskId));
        const selectedMilestone = firstMilestoneIdx >= 0 ? learningPath.milestones[firstMilestoneIdx] : undefined;
        runnableTasks = this.getRunnableTasks(selectedMilestone?.subtasks || []);
        const selectedTask = selectedMilestone?.subtasks?.find((task: any) => task.id === options.taskId);

        if (!selectedMilestone || !selectedTask) {
          throw new Error('指定任务不存在');
        }

        if (String(selectedTask.status || '').toLowerCase() === 'completed') {
          throw new Error('指定任务已完成，不能重新启动');
        }

        firstMilestone = selectedMilestone;
        firstTask = selectedTask;
        firstTaskIdx = runnableTasks.findIndex(task => task.id === options.taskId);

        if (firstTaskIdx < 0) {
          throw new Error('指定任务当前不可启动');
        }
      }
      
      if (!firstTask) {
        throw new Error('第一个里程碑没有可用任务');
      }
      
      logger.info('[simulation-coordinator] 开始学习阶段', {
        sessionId,
        learningPathId: learningPath.id,
        firstTaskId: firstTask.id,
        firstMilestone: firstMilestone.title
      });
      
      const teachingSession = await aiTeachingOrchestrator.startSession({
        userId: session.userId,
        taskId: firstTask.id,
        forceNew: true
      });
      
      await this.updateSessionStatus(
        sessionId,
        'running',
        'learning',
        session.goalConversationId || undefined,
        session.learningPathId
      );
      
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'learning-start',
        details: {
          output: {
            teachingSessionId: teachingSession.sessionId,
            welcomeMessage: teachingSession.welcomeMessage,
            currentMilestone: firstMilestone.title,
            currentTask: firstTask.title
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'learning', {
        success: true,
        teachingSessionId: teachingSession.sessionId,
        ...this.buildLearningProgressSnapshot(learningPath.milestones, firstMilestoneIdx, firstTaskIdx)
      });

      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: firstTask.id,
          updatedAt: new Date()
        }
      });
      
      return {
        success: true,
        teachingSessionId: teachingSession.sessionId,
        welcomeMessage: teachingSession.welcomeMessage,
        selectedTaskId: firstTask.id,
        milestones: learningPath.milestones.map(m => ({
          stageNumber: m.stageNumber,
          title: m.title,
          description: m.description,
          estimatedHours: m.estimatedHours,
          subtasksCount: m.subtasks?.length || 0
        }))
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 学习阶段启动失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeLearningStep(sessionId: string): Promise<{
    success: boolean;
    userMessage?: string;
    aiResponse?: string;
    milestoneProgress?: any;
    isPathCompleted?: boolean;
    taskCompleted?: boolean;
    logs?: SimulationLogEntry[];
    error?: string;
  }> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      const session = await this.getVirtualSession(sessionId);
      const profile = this.parseProfileData(session.virtual_learner_profiles);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在');
      }
      
      const stageResults: any = this.parseStageResultsPayload(session.stageResults)

      const learningState = stageResults.learning || {};
      if (learningState.manualStop || session.status === 'failed') {
        return {
          success: false,
          error: learningState.stoppedReason ? `学习已停止: ${learningState.stoppedReason}` : '学习已停止'
        }
      }

      if (learningState.taskRuntime?.status === 'completed') {
        return {
          success: true,
          isPathCompleted: false,
          taskCompleted: true,
          milestoneProgress: {
            currentMilestone: typeof learningState.currentMilestone === 'number' ? learningState.currentMilestone + 1 : null,
            totalMilestones: learningState.totalMilestones || null,
            currentTask: learningState.currentTaskTitle || null
          },
          logs
        };
      }

      const currentMilestoneIdx = learningState.currentMilestone || 0;
      const currentTaskIdx = learningState.currentTaskIdx || 0;
      
      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });
      
      if (!learningPath) {
        throw new Error('学习路径不存在');
      }
      
      const milestones = learningPath.milestones;
      const currentMilestone = milestones[currentMilestoneIdx];
      
      if (!currentMilestone) {
        return {
          success: true,
          isPathCompleted: true,
          milestoneProgress: {
            completed: milestones.length,
            total: milestones.length
          },
          logs
        };
      }
      
      const tasks = this.getRunnableTasks(currentMilestone.subtasks || []);
      const currentTask = tasks[currentTaskIdx];
      
      if (!currentTask) {
        const nextMilestoneIdx = currentMilestoneIdx + 1;
        if (nextMilestoneIdx >= milestones.length) {
          return {
            success: true,
            isPathCompleted: true,
            logs
          };
        }
        
        await this.updateStageResults(sessionId, 'learning', {
          ...learningState,
          ...this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, 0)
        });
        
        return await this.executeLearningStep(sessionId);
      }
      
      const trimmedConversationHistory = this.trimLearningConversationHistory(learningState.conversationHistory || [])
      const lastAssistantMessage = [...trimmedConversationHistory]
        .reverse()
        .find((item: any) => item.role === 'assistant')?.content || '';

      const mergedLearnerState = this.mergeLearnerState(profile, learningState.learnerState, 'learning', this.parseStoryContextFromStageResults(stageResults))
      const simulationContext = {
        profile,
        conversationHistory: trimmedConversationHistory,
        lastAssistantMessage,
        currentStage: 'learning',
        learnerState: {
          ...mergedLearnerState,
          phaseFocus: this.inferLearningPhase(mergedLearnerState)
        },
        learningState: {
          currentMilestone: currentMilestone.title,
          currentTask: currentTask.title,
          milestoneProgress: currentMilestoneIdx + 1,
          totalMilestones: milestones.length
        }
      };
      
      const virtualReplyStart = Date.now();
      const virtualReplyOutput = await executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
        learner: {
          profile: profile.profile || {},
          learningGoal: profile.learningGoal,
          knownConcepts: profile.knownConcepts || [],
          struggleConcepts: profile.struggleConcepts || [],
          personalityTraits: profile.personalityTraits || {},
        },
        story: this.parseStoryContextFromStageResults(stageResults),
        visibleContext: {
          history: trimmedConversationHistory.map((item: any) => ({
            role: item.role === 'assistant' ? 'teacher' : 'learner',
            content: item.content,
          })),
          lastTeacherMessage: lastAssistantMessage,
        },
        currentPhase: simulationContext.learnerState.phaseFocus,
        previousLearnerState: mergedLearnerState,
        currentTask: {
          title: currentTask.title,
          milestoneTitle: currentMilestone.title,
        },
        knowledgeSnapshot: [],
        frictionBudget: this.getSessionFrictionBudget(session),
      });

      const virtualReplyResult = {
        success: !!virtualReplyOutput?.reply,
        userVisible: virtualReplyOutput?.reply || '',
        learnerState: virtualReplyOutput?.learnerState,
        learnerFeedback: virtualReplyOutput?.learnerFeedback,
        internal: {
          emotion: virtualReplyOutput?.emotion,
          learnerState: virtualReplyOutput?.learnerState,
          learnerFeedback: virtualReplyOutput?.learnerFeedback,
        }
      };
      
      if (!virtualReplyResult.success || !virtualReplyResult.userVisible) {
        const errorMsg = !virtualReplyOutput?.reply ? '学习者回复生成失败' : '学习者回复为空';
        throw new Error(errorMsg);
      }
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'learning-reply',
        durationMs: Date.now() - virtualReplyStart,
        details: {
          output: {
            reply: virtualReplyResult.userVisible,
            currentTask: currentTask.title,
            currentMilestone: currentMilestone.title,
            learnerState: virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
            learnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
            emotion: virtualReplyResult.internal?.emotion
          }
        }
      });
      
      let aiResponse = '';
      let nextTaskIdx = currentTaskIdx;
      let nextMilestoneIdx = currentMilestoneIdx;
      let taskCompleted = false;
      let taskCompletionResult: any = null;
      let learningStepError: string | null = null;
      let closureDecision: any = null;
      let shouldStopCurrentTask = false;

      const teachingSessionId = learningState.teachingSessionId;
      
      if (teachingSessionId) {
        try {
          const aiResponseStart = Date.now();
          const aiResult = await aiTeachingOrchestrator.processStudentMessage(
            teachingSessionId,
            virtualReplyResult.userVisible
          );
          
          aiResponse = aiResult.aiResponse || '';
          
          const learnerFeedback = virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null;
          const teacherReady = !!(aiResult.isCompletion || aiResult.autoEnded);
          const learnerReady = !!(
            learnerFeedback?.selfReportedTaskDone === true &&
            learnerFeedback?.wantsMoreHelp !== true &&
            learnerFeedback?.stopAsking === true &&
            (!Array.isArray(learnerFeedback?.remainingBlockers) || learnerFeedback.remainingBlockers.length === 0)
          );
          closureDecision = {
            teacherReady,
            learnerReady,
            canCompleteTask: teacherReady && learnerReady,
            teacherSignal: {
              isCompletion: !!aiResult.isCompletion,
              autoEnded: !!aiResult.autoEnded,
              classroomStage: aiResult.promptDebug?.learnDebug?.output?.stageDecision?.stage || null
            },
            learnerFeedback,
            reason: teacherReady && learnerReady
              ? '教学系统给出收束信号，AI 学生也自评当前 task 已完成。'
              : teacherReady
                ? '教学系统给出收束信号，但 AI 学生仍未自评完成或仍想继续获得帮助。'
                : learnerReady
                  ? 'AI 学生自评当前 task 已完成，但教学系统尚未给出收束信号。'
                  : '教学系统与 AI 学生均未同时满足当前 task 收束条件。'
          };

          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'learning-response',
            durationMs: Date.now() - aiResponseStart,
            details: {
              output: {
                aiResponse,
                isCompletion: aiResult.isCompletion,
                autoEnded: aiResult.autoEnded || false,
                cognitiveLevel: aiResult.analysis?.cognitiveLevel,
                knowledgePoint: aiResult.knowledgePoint || null,
                knowledgePoints: aiResult.knowledgePoints || [],
                strategies: aiResult.strategies || [],
                peerTriggered: aiResult.peerTriggered || false,
                peerMessage: aiResult.peerMessage || null,
                currentState: aiResult.currentState || null,
                promptDebug: aiResult.promptDebug || null,
                closureDecision
              }
            }
          });
          
          if (closureDecision.canCompleteTask) {
            if (String(currentTask.status || '').toLowerCase() !== 'completed') {
              taskCompletionResult = await learningService.completeTask({
                taskId: currentTask.id,
                userId: session.userId,
                actualMinutes: currentTask.estimatedMinutes || 30,
                notes: '虚拟学习者完成当前 task 的教学会话',
                rating: 5
              });
            }
            taskCompleted = true;
            shouldStopCurrentTask = true;
          } else if (closureDecision.teacherReady) {
            shouldStopCurrentTask = true;
          }
        } catch (err: any) {
          logger.warn('[simulation-coordinator] AI教学响应失败，已停止当前学习步骤', {
            sessionId,
            error: err.message
          });
          learningStepError = err.message || '教学响应失败';
          aiResponse = `当前教学会话不可继续：${learningStepError}。请重新开始当前 task 或人工检查。`;
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: err.message || '教学响应失败',
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'learning-step-stopped'
              }
            }
          });
        }
      } else {
        learningStepError = '当前 Learn 没有绑定教学会话';
        aiResponse = '当前 Learn 没有绑定教学会话，请先重新开始当前 task。';
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'error',
          details: {
            error: '当前 Learn 没有绑定教学会话',
            output: {
              currentTask: currentTask.title,
              currentMilestone: currentMilestone.title,
              action: 'learning-step-stopped'
            }
          }
        });
      }
      
      const isPathCompleted = nextMilestoneIdx >= milestones.length;
      
      await this.updateStageResults(sessionId, 'learning', {
        ...learningState,
        ...(isPathCompleted
          ? {
              currentMilestone: milestones.length,
              currentMilestoneTitle: null,
              currentTaskIdx: 0,
              currentTaskId: null,
              currentTaskTitle: null,
              totalMilestones: milestones.length
            }
          : this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx)),
        learnerState: this.mergeLearnerState(profile, virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState, 'learning', this.parseStoryContextFromStageResults(stageResults)),
        latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
        closureDecision,
        taskRuntime: taskCompleted
          ? {
              status: 'completed',
              reason: closureDecision?.reason || '教学系统与 AI 学生共同判定当前 task 已完成，虚拟学习者停止继续追问',
              completedAt: new Date().toISOString(),
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              teachingSessionId,
              completionSource: 'teacher-and-learner-feedback',
              closureDecision,
              completionResult: taskCompletionResult?.task ? {
                id: taskCompletionResult.task.id,
                status: taskCompletionResult.task.status,
                completedAt: taskCompletionResult.task.completedAt
              } : null
            }
          : {
              ...(learningState.taskRuntime || {}),
              status: learningStepError
                ? 'error'
                : closureDecision?.teacherReady && !closureDecision?.learnerReady
                  ? 'teacher_ready_learner_not_satisfied'
                  : closureDecision?.learnerReady && !closureDecision?.teacherReady
                    ? 'learner_ready_waiting_teacher'
                    : 'active',
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              teachingSessionId,
              error: learningStepError,
              closureDecision,
              updatedAt: new Date().toISOString()
            },
        conversationHistory: [
          ...(learningState.conversationHistory || []),
          { role: 'user', content: virtualReplyResult.userVisible },
          { role: 'assistant', content: aiResponse }
        ]
      });

      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: isPathCompleted ? null : currentTask.id,
          updatedAt: new Date()
        }
      });
      
      if (isPathCompleted) {
        await this.updateSessionStatus(sessionId, 'completed', 'learning');
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'learning',
              to: 'completed',
              message: '学习路径已完成'
            }
          }
        });

        // 触发 wrapup 总结生成
        try {
          await this.generateWrapupForSession(sessionId);
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'stage-transition',
            details: {
              output: { message: '已生成学习总结' }
            }
          });
        } catch (err: any) {
          logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: err.message });
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: err.message || 'wrapup generation failed'
            }
          });
        }
      }
      
      for (const log of logs) {
        await this.addSessionLog(sessionId, log);
      }
      
      return {
        success: !learningStepError,
        userMessage: virtualReplyResult.userVisible,
        aiResponse,
        milestoneProgress: {
          currentMilestone: isPathCompleted ? milestones.length : nextMilestoneIdx + 1,
          totalMilestones: milestones.length,
          currentTask: isPathCompleted ? null : (this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx).currentTaskTitle || null)
        },
        isPathCompleted,
        taskCompleted,
        ...(shouldStopCurrentTask ? { currentTaskStopped: true } : {}),
        logs,
        error: learningStepError || undefined
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 学习步骤执行失败', {
        sessionId,
        error: error.message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: error.message
        }
      });
      
      return {
        success: false,
        logs,
        error: error.message
      };
    }
  }

  async executeAutoLearning(
    sessionId: string,
    options: { maxMilestones?: number } = {}
  ): Promise<{
    success: boolean;
    totalSteps?: number;
    completedMilestones?: number;
    error?: string;
  }> {
    const maxMilestones = options.maxMilestones || 10;
    
    try {
      let session = await this.getVirtualSession(sessionId);

      if (session.status === 'completed') {
        return { success: true, totalSteps: 0, completedMilestones: 0 };
      }

      const initialStageResults = this.parseStageResultsPayload(session.stageResults)
      if (initialStageResults.learning?.manualStop || session.status === 'failed') {
        return {
          success: false,
          error: initialStageResults.learning?.stoppedReason ? `学习已停止: ${initialStageResults.learning.stoppedReason}` : '学习已停止'
        }
      }

      if (session.currentStage !== 'learning') {
        const startResult = await this.startLearningPhase(sessionId);
        if (!startResult.success) {
          return { success: false, error: startResult.error };
        }
        session = await this.getVirtualSession(sessionId)
      }
      
      let steps = 0;
      const maxSteps = maxMilestones * 3;
      
      for (let i = 0; i < maxSteps; i++) {
        const latestSession = await this.getVirtualSession(sessionId)
        const latestStageResults = this.parseStageResultsPayload(latestSession.stageResults)
        if (latestStageResults.learning?.manualStop || latestSession.status === 'failed') {
          return {
            success: false,
            totalSteps: steps,
            error: latestStageResults.learning?.stoppedReason ? `学习已停止: ${latestStageResults.learning.stoppedReason}` : '学习已停止'
          }
        }

        const stepResult = await this.executeLearningStep(sessionId);
        steps++;
        
        if (stepResult.isPathCompleted) {
          logger.info('[simulation-coordinator] 自动学习完成', {
            sessionId,
            totalSteps: steps
          });
          
          return {
            success: true,
            totalSteps: steps,
            completedMilestones: maxMilestones
          };
        }

        if (stepResult.taskCompleted || (stepResult as any).currentTaskStopped) {
          logger.info('[simulation-coordinator] 当前学习任务已收束或需处理，停止自动学习', {
            sessionId,
            totalSteps: steps
          });

          return {
            success: true,
            totalSteps: steps,
            completedMilestones: 0
          };
        }
        
        if (!stepResult.success) {
          throw new Error(stepResult.error || '学习步骤失败');
        }
        
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      return {
        success: true,
        totalSteps: steps,
        completedMilestones: maxMilestones
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 自动学习失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emergencyStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}

      const learningState = stageResults.learning || {};
      const teachingSessionId = learningState.teachingSessionId;

      if (teachingSessionId) {
        await aiTeachingOrchestrator.resetSession(teachingSessionId, session.userId).catch(() => {});
      }

      await this.updateStageResults(sessionId, 'learning', {
        ...learningState,
        manualStop: true,
        stoppedAt: new Date().toISOString(),
        stoppedReason: reason
      });

      await this.updateSessionStatus(sessionId, 'failed', 'learning');

      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: `EMERGENCY_STOP:${reason}`
        }
      });

      return { success: true };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 紧急停止学习失败', {
        sessionId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async restartPathPhase(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      let stageResults: any = {}
      try {
        stageResults = JSON.parse(session.stageResults || '{}')
      } catch {}

      const learningState = stageResults.learning || {}
      const teachingSessionId = learningState.teachingSessionId

      if (teachingSessionId) {
        await aiTeachingOrchestrator.resetSession(teachingSessionId, session.userId).catch(() => {})
      }

      if (session.learningPathId) {
        await prisma.learning_paths.delete({
          where: { id: session.learningPathId }
        }).catch(() => {})
      }

      await this.resetSessionRuntime(sessionId, {
        keepGoalConversation: true,
        keepLearningPath: false,
        nextStage: 'path',
        nextStatus: 'running',
        removeStageResults: ['path', 'path_review', 'learning'],
        logPhasesToRemove: ['learning-start', 'learning-step', 'stage-transition'],
        resetTaskProgress: true,
        clearCompletedAt: true
      })

      return await this.advanceToPathGeneration(sessionId)
    } catch (error: any) {
      logger.error('[simulation-coordinator] 重建路径失败', {
        sessionId,
        error: error.message
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  async restartLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: any[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      let stageResults: any = {}
      try {
        stageResults = JSON.parse(session.stageResults || '{}')
      } catch {}

      const learningState = stageResults.learning || {}
      const teachingSessionId = learningState.teachingSessionId
      const preferredTaskId = options.taskId || learningState.currentTaskId || undefined

      if (teachingSessionId) {
        await aiTeachingOrchestrator.resetSession(teachingSessionId, session.userId).catch(() => {})
      }

      await this.resetSessionRuntime(sessionId, {
        keepGoalConversation: true,
        keepLearningPath: true,
        nextStage: 'learning',
        nextStatus: 'running',
        removeStageResults: ['learning'],
        logPhasesToRemove: ['learning-start', 'learning-step', 'learning-reply', 'learning-response', 'stage-transition'],
        resetTaskProgress: true,
        clearCompletedAt: true
      })

      const restartResult = await this.startLearningPhase(sessionId, preferredTaskId ? { taskId: preferredTaskId } : {})
      if (restartResult.success) {
        return restartResult
      }

      if (preferredTaskId && ['指定任务不存在', '指定任务已完成，不能重新启动', '指定任务当前不可启动'].includes(String(restartResult.error || ''))) {
        logger.warn('[simulation-coordinator] 重新开始学习时指定任务不可用，回退到首个可启动任务', {
          sessionId,
          preferredTaskId,
          error: restartResult.error
        })

        return await this.startLearningPhase(sessionId)
      }

      return restartResult
    } catch (error: any) {
      logger.error('[simulation-coordinator] 重开学习失败', {
        sessionId,
        error: error.message
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 学习完成后生成 wrapup 总结 (调用 skill:session-wrapup)
   * 将结果写入 stageResults.learning.wrapup
   */
  async generateWrapupForSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learning = stageResults.learning || {};
      const storyContext = stageResults.story || stageResults.storyContext || null;

      // 已经生成过就不重复
      if (learning.wrapup) {
        return { success: true };
      }

      const conversation = Array.isArray(learning.conversationHistory) ? learning.conversationHistory : [];
      const messages = conversation.map((m: any) => ({
        role: m.role || (m.isLearner ? 'user' : 'assistant'),
        content: m.content || m.text || '',
        timestamp: m.timestamp || m.createdAt || undefined
      }));

      const userMessageCount = messages.filter(m => m.role === 'user').length;
      const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;

      const createdAt = session.createdAt ? new Date(session.createdAt as any).getTime() : Date.now();
      const completedAt = Date.now();
      const durationMinutes = Math.max(1, Math.round((completedAt - createdAt) / 60000));

      // 知识点: 从 learnerState 抽取
      const learnerState = learning.learnerState || {};
      const knowledgePoints: SessionWrapupInput['knowledgePoints'] = Array.isArray(learnerState.knowledgePoints)
        ? learnerState.knowledgePoints.map((kp: any) => ({
            name: kp.name || kp.label || '未命名知识点',
            status: kp.status || 'in_progress',
            progress: typeof kp.progress === 'number' ? kp.progress : 50
          }))
        : [];

      const wrapupInput: SessionWrapupInput = {
        messages,
        knowledgePoints,
        sessionInfo: {
          subject: storyContext?.subject || '虚拟学习场景',
          topic: storyContext?.title || storyContext?.storyTitle || '本次故事',
          durationMinutes,
          userMessageCount,
          assistantMessageCount,
          taskType: 'practice',
          taskTitle: learning.currentTaskTitle || undefined,
          taskDescription: learning.currentTaskDescription || undefined,
          pathTitle: storyContext?.pathTitle || null,
          pathSummary: storyContext?.pathSummary || null
        },
        learningState: typeof learnerState.lss === 'number'
          ? {
              lss: learnerState.lss || 5,
              ktl: learnerState.ktl || 5,
              lf: learnerState.lf || 5,
              lsb: learnerState.lsb || 5,
              recentTrend: learnerState.recentTrend,
              recommendedPacing: learnerState.recommendedPacing
            }
          : undefined
      };

      const result = await sessionWrapupAgent.generate(wrapupInput);

      // 写回 stageResults.learning.wrapup
      await this.updateStageResults(sessionId, 'learning', {
        ...learning,
        wrapup: {
          generatedAt: new Date().toISOString(),
          summary: result.summary,
          evaluation: result.evaluation,
          summarySource: result.summarySource,
          evaluationSource: result.evaluationSource
        }
      });

      logger.info('[simulation-coordinator] wrapup 已生成', { sessionId });
      return { success: true };
    } catch (error: any) {
      logger.error('[simulation-coordinator] generateWrapupForSession 失败', { sessionId, error });
      return { success: false, error: error.message || 'unknown' };
    }
  }
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };
