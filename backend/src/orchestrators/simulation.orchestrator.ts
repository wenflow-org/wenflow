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
import { virtualLearnerSimulationAgentHandler } from '../agents/virtual-learner-simulation-agent';
import goalConversationService from '../services/learning/goal-conversation.service';
import pathOrchestrator, { type GoalPathRequest } from './path.orchestrator';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingOrchestrator';
import {
  getSimulationOrchestratorConfig,
  type SimulationOrchestratorConfig
} from '../services/orchestratorConfig.service';
import type { 
  SimulationContext,
  SimulationStepResult,
  SimulationLogEntry,
  VirtualLearnerProfile,
  GoalConcernPool,
  LearnerLatentState
} from '../agents/virtual-learner-simulation-agent/types';

const ORCHESTRATOR_ID = 'simulation-orchestrator';

export interface SimulationOrchestratorInput {
  sessionId: string;
  userId: string;
  mode: 'single-step' | 'auto-loop';
}

export interface AutoLoopOptions {
  maxRounds?: number;
  onStep?: (result: SimulationStepResult) => void;
}

class SimulationOrchestrator {
  readonly id = ORCHESTRATOR_ID;

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
      partial.goalReadiness = 0.42;
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
    return {
      ...this.buildDefaultLearnerState(profile, currentStage),
      ...this.buildStoryBehaviorBias(storyContext),
      ...(learnerState || {})
    };
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

  private parseStoryContextFromStageResults(stageResults: any): any {
    return stageResults?.story || null;
  }
  
  async executeSingleStep(input: SimulationOrchestratorInput): Promise<SimulationStepResult> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      logger.info('[simulation-orchestrator] 执行单步模拟', {
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
        const openingContext = this.buildSimulationContext(
          profile,
          [],
          '',
          'goal',
          storyContext,
          undefined,
          undefined,
          undefined,
          undefined
        );

        const openingInput = {
          type: 'custom' as const,
          goal: '模拟虚拟用户首次开场',
          metadata: {
            simulationType: 'simulate_goal_reply',
            simulationContext: openingContext
          }
        };

        const openingAgentContext = {
          userId: input.userId,
          sourceEntry: 'simulation' as const,
          metadata: {
            traceId: uuidv4(),
            sessionId: input.sessionId,
            turnType: 'goal-opening'
          }
        };

        const openingStart = Date.now();
        const openingResult = await virtualLearnerSimulationAgentHandler(openingInput, openingAgentContext);
        const openingReply = openingResult.success && openingResult.userVisible
          ? openingResult.userVisible
          : profile.learningGoal;

        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'virtual-reply',
          durationMs: Date.now() - openingStart,
          details: {
            output: {
              reply: openingReply,
              thoughtProcess: openingResult.internal?.thoughtProcess,
              learnerState: this.mergeLearnerState(profile, openingResult.learnerState || openingResult.internal?.learnerState, 'goal', storyContext),
              emotion: openingResult.internal?.emotion,
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
          content: m.content
        }));
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
      
      const agentInput = {
        type: 'custom' as const,
        goal: '模拟虚拟用户回复',
        metadata: {
          simulationType: 'simulate_goal_reply',
          simulationContext
        }
      };
      
      const agentContext = {
        userId: input.userId,
        sourceEntry: 'simulation' as const,
        metadata: {
          traceId: uuidv4(),
          sessionId: input.sessionId
        }
      };
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await virtualLearnerSimulationAgentHandler(agentInput, agentContext);
      
      if (!virtualReplyResult.success || !virtualReplyResult.userVisible) {
        const errorMsg = typeof virtualReplyResult.error === 'string' 
          ? virtualReplyResult.error 
          : virtualReplyResult.error?.message || '虚拟用户回复生成失败';
        throw new Error(errorMsg);
      }
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'virtual-reply',
        durationMs: Date.now() - virtualReplyStart,
        details: {
          output: {
            reply: virtualReplyResult.userVisible,
            thoughtProcess: virtualReplyResult.internal?.thoughtProcess,
            learnerState: this.mergeLearnerState(profile, virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState, 'goal', activeStoryContext),
            emotion: virtualReplyResult.internal?.emotion
          }
        }
      });

      const nextDisclosedConcerns = this.inferDisclosedGoalConcerns(
        virtualReplyResult.userVisible,
        concernPool,
        disclosedConcerns
      );

      await this.updateStageResults(input.sessionId, 'goal', {
        ...existingGoalState,
        concernPool,
        disclosedConcerns: nextDisclosedConcerns,
        learnerState: this.mergeLearnerState(profile, virtualReplyResult.internal?.learnerState, 'goal', activeStoryContext)
      });
      
      const goalResponseStart = Date.now();
      const goalResult = await goalConversationService.continueConversation(
        session.goalConversationId,
        virtualReplyResult.userVisible,
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
          learnerState: this.mergeLearnerState(profile, virtualReplyResult.internal?.learnerState, 'goal', activeStoryContext),
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
      
      logger.info('[simulation-orchestrator] 单步模拟完成', {
        sessionId: input.sessionId,
        durationMs: Date.now() - startTime,
        goalReady
      });
      
        return {
          success: true,
          virtualUserReply: virtualReplyResult.userVisible,
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
      
      logger.error('[simulation-orchestrator] 单步模拟失败', {
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
    const config = await getSimulationOrchestratorConfig();
    const maxRounds = options.maxRounds || config.maxRounds;
    const results: SimulationStepResult[] = [];
    
    logger.info('[simulation-orchestrator] 开始自动循环模拟', {
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
        logger.warn('[simulation-orchestrator] 自动循环因错误终止', {
          sessionId: input.sessionId,
          round,
          error: stepResult.error
        });
        break;
      }
      
      if (stepResult.goalReady) {
        logger.info('[simulation-orchestrator] 自动循环因Goal Ready终止', {
          sessionId: input.sessionId,
          round
        });
        
        if (config.autoAdvanceToPath) {
          logger.info('[simulation-orchestrator] 自动推进到Path阶段', {
            sessionId: input.sessionId
          });
          await this.advanceToPathGeneration(input.sessionId);
        }
        break;
      }
    }
    
    logger.info('[simulation-orchestrator] 自动循环模拟完成', {
      sessionId: input.sessionId,
      totalRounds: results.length
    });
    
    return results;
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
        understanding: collectedData.understanding,
        structuredData: collectedData.structuredData,
        confirmedProposal: collectedData.confirmedProposal,
        confidenceScores: collectedData.confidenceScores,
        conversationHistory: collectedData.messages || []
      };
      
      logger.info('[simulation-orchestrator] 开始路径生成', {
        sessionId,
        userId: session.userId
      });
      
      const pathResult = await pathOrchestrator.generateFromGoal(pathRequest);
      
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
      
      logger.info('[simulation-orchestrator] 路径生成完成', {
        sessionId,
        learningPathId
      });
      
      return {
        success: true,
        learningPathId
      };
    } catch (error: any) {
      logger.error('[simulation-orchestrator] 路径生成失败', {
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
    decision?: 'accept' | 'modify' | 'reject';
    modifyRequest?: string;
    confidence?: number;
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
      
      const reactionInput = {
        type: 'custom' as const,
        goal: '评审学习路径方案',
        metadata: {
          simulationType: 'simulate_reaction',
          reactionContext: {
            reactionTarget: 'path_proposal',
            targetData: {
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
            profile,
            learnerState: this.mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults)),
            knowledgeState: stageResults.goal?.knowledgeState
          }
        }
      };
      
      const reactionContext = {
        userId: session.userId,
        sourceEntry: 'simulation' as const,
        metadata: {
          traceId: uuidv4(),
          sessionId
        }
      };
      
      const reactionStart = Date.now();
      const reactionResult = await virtualLearnerSimulationAgentHandler(reactionInput, reactionContext);
      
      const reactionOutput = reactionResult.reactionOutput || reactionResult.internal?.reaction;
      
      if (!reactionResult.success || !reactionOutput) {
        const errorMsg = typeof reactionResult.error === 'string'
          ? reactionResult.error
          : reactionResult.error?.message || '虚拟用户反应生成失败';
        throw new Error(errorMsg);
      }
      
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        durationMs: Date.now() - reactionStart,
        details: {
          output: {
            reaction: reactionOutput.reaction,
            decision: reactionOutput.decision,
            confidence: reactionOutput.confidence,
            reasons: reactionOutput.reasons,
            biggestConcern: reactionOutput.biggestConcern
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'path_review', {
        success: true,
        reaction: reactionOutput.reaction,
        decision: reactionOutput.decision,
        modifyRequest: reactionOutput.modifyRequest,
        confidence: reactionOutput.confidence,
        reasons: reactionOutput.reasons,
        biggestConcern: reactionOutput.biggestConcern,
        learnerState: this.mergeLearnerState(profile, reactionResult.internal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults))
      });
      
      logger.info('[simulation-orchestrator] 路径评审完成', {
        sessionId,
        decision: reactionOutput.decision,
        confidence: reactionOutput.confidence
      });
      
      return {
        success: true,
        reaction: reactionOutput.reaction,
        decision: reactionOutput.decision,
        modifyRequest: reactionOutput.modifyRequest,
        confidence: reactionOutput.confidence
      };
    } catch (error: any) {
      logger.error('[simulation-orchestrator] 路径评审失败', {
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
        firstMilestoneIdx = learningPath.milestones.findIndex(m => this.getRunnableTasks(m.subtasks || []).some(task => task.id === options.taskId));
        const selectedMilestone = firstMilestoneIdx >= 0 ? learningPath.milestones[firstMilestoneIdx] : undefined;
        runnableTasks = this.getRunnableTasks(selectedMilestone?.subtasks || []);
        const selectedTask = runnableTasks.find(task => task.id === options.taskId);

        if (!selectedMilestone || !selectedTask) {
          throw new Error('指定任务不存在或当前不可启动');
        }

        firstMilestone = selectedMilestone;
        firstTask = selectedTask;
        firstTaskIdx = runnableTasks.findIndex(task => task.id === options.taskId);
      }
      
      if (!firstTask) {
        throw new Error('第一个里程碑没有可用任务');
      }
      
      logger.info('[simulation-orchestrator] 开始学习阶段', {
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
      logger.error('[simulation-orchestrator] 学习阶段启动失败', {
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
      
      const stageResults: any = {};
      try {
        const sr = session.stageResults || '{}';
        const parsed = JSON.parse(sr);
        Object.assign(stageResults, parsed);
      } catch {}
      
      const learningState = stageResults.learning || {};
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
      
      const lastAssistantMessage = [...(learningState.conversationHistory || [])]
        .reverse()
        .find((item: any) => item.role === 'assistant')?.content || '';

      const simulationContext = {
        profile,
        conversationHistory: learningState.conversationHistory || [],
        lastAssistantMessage,
        currentStage: 'learning',
        learnerState: this.mergeLearnerState(profile, learningState.learnerState, 'learning', this.parseStoryContextFromStageResults(stageResults)),
        learningState: {
          currentMilestone: currentMilestone.title,
          currentTask: currentTask.title,
          milestoneProgress: currentMilestoneIdx + 1,
          totalMilestones: milestones.length
        }
      };
      
      const agentInput = {
        type: 'custom' as const,
        goal: '模拟学习者回复任务',
        metadata: {
          simulationType: 'simulate_learning_reply',
          simulationContext
        }
      };
      
      const agentContext = {
        userId: session.userId,
        sourceEntry: 'simulation' as const,
        metadata: {
          traceId: uuidv4(),
          sessionId,
          taskId: currentTask.id,
          milestoneId: currentMilestone.id
        }
      };
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await virtualLearnerSimulationAgentHandler(agentInput, agentContext);
      
      if (!virtualReplyResult.success || !virtualReplyResult.userVisible) {
        const errorMsg = typeof virtualReplyResult.error === 'string'
          ? virtualReplyResult.error
          : virtualReplyResult.error?.message || '学习者回复生成失败';
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
            emotion: virtualReplyResult.internal?.emotion
          }
        }
      });
      
      let aiResponse = '';
      let nextTaskIdx = currentTaskIdx;
      let nextMilestoneIdx = currentMilestoneIdx;

      const teachingSessionId = learningState.teachingSessionId;
      
      if (teachingSessionId) {
        try {
          const aiResponseStart = Date.now();
          const aiResult = await aiTeachingOrchestrator.processStudentMessage(
            teachingSessionId,
            virtualReplyResult.userVisible
          );
          
          aiResponse = aiResult.aiResponse || '';
          
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
                promptDebug: aiResult.promptDebug || null
              }
            }
          });
          
          if (aiResult.isCompletion || aiResult.autoEnded) {
            const followingTask = tasks[currentTaskIdx + 1];
            if (followingTask) {
              nextTaskIdx = currentTaskIdx + 1;
            } else {
              nextTaskIdx = 0;
              nextMilestoneIdx = currentMilestoneIdx + 1;
            }
          }
        } catch (err: any) {
          logger.warn('[simulation-orchestrator] AI教学响应失败，使用模拟回复', {
            sessionId,
            error: err.message
          });
          aiResponse = `好的，我已经理解了。让我们继续下一个任务。`;
          const followingTask = tasks[currentTaskIdx + 1];
          if (followingTask) {
            nextTaskIdx = currentTaskIdx + 1;
          } else {
            nextTaskIdx = 0;
            nextMilestoneIdx = currentMilestoneIdx + 1;
          }
        }
      } else {
        aiResponse = `收到你的回复："${virtualReplyResult.userVisible.substring(0, 50)}..." 让我们继续学习。`;
        const followingTask = tasks[currentTaskIdx + 1];
        if (followingTask) {
          nextTaskIdx = currentTaskIdx + 1;
        } else {
          nextTaskIdx = 0;
          nextMilestoneIdx = currentMilestoneIdx + 1;
        }
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
        conversationHistory: [
          ...(learningState.conversationHistory || []),
          { role: 'user', content: virtualReplyResult.userVisible },
          { role: 'assistant', content: aiResponse }
        ]
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
      }
      
      for (const log of logs) {
        await this.addSessionLog(sessionId, log);
      }
      
      return {
        success: true,
        userMessage: virtualReplyResult.userVisible,
        aiResponse,
        milestoneProgress: {
          currentMilestone: isPathCompleted ? milestones.length : nextMilestoneIdx + 1,
          totalMilestones: milestones.length,
          currentTask: isPathCompleted ? null : (this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx).currentTaskTitle || null)
        },
        isPathCompleted,
        logs
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-orchestrator] 学习步骤执行失败', {
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
      const session = await this.getVirtualSession(sessionId);
      
      if (session.status === 'completed') {
        return { success: true, totalSteps: 0, completedMilestones: 0 };
      }
      
      if (session.currentStage !== 'learning') {
        const startResult = await this.startLearningPhase(sessionId);
        if (!startResult.success) {
          return { success: false, error: startResult.error };
        }
      }
      
      let steps = 0;
      const maxSteps = maxMilestones * 3;
      
      for (let i = 0; i < maxSteps; i++) {
        const stepResult = await this.executeLearningStep(sessionId);
        steps++;
        
        if (stepResult.isPathCompleted) {
          logger.info('[simulation-orchestrator] 自动学习完成', {
            sessionId,
            totalSteps: steps
          });
          
          return {
            success: true,
            totalSteps: steps,
            completedMilestones: maxMilestones
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
      logger.error('[simulation-orchestrator] 自动学习失败', {
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
      logger.error('[simulation-orchestrator] 紧急停止学习失败', {
        sessionId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };
