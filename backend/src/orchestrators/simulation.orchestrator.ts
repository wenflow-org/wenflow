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
  VirtualLearnerProfile 
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
    goalState?: any
  ): SimulationContext {
    return {
      profile,
      conversationHistory,
      currentStage,
      lastAssistantMessage,
      goalState
    };
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
      
      if (!session.goalConversationId) {
        const goalResult = await goalConversationService.startConversation(
          input.userId,
          profile.learningGoal
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
              stage: goalResult.internal.core.stage,
              conversationId: goalResult.internal.core.conversationId
            }
          }
        });
        
        await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
        
        return {
          success: true,
          virtualUserReply: profile.learningGoal,
          goalConversationResponse: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q => 
              typeof q === 'string' ? q : q.text
            )
          },
          currentStage: 'goal',
          goalReady: goalResult.internal.core.stage === 'ready',
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
      
      const simulationContext = this.buildSimulationContext(
        profile,
        conversationHistory,
        lastAssistantMessage,
        'goal',
        goalState
      );
      
      const agentInput = {
        type: 'custom' as const,
        goal: '模拟虚拟用户回复',
        metadata: {
          simulationType: 'simulate_reply',
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
            reply: virtualReplyResult.userVisible?.substring(0, 100),
            thoughtProcess: virtualReplyResult.internal?.thoughtProcess
          }
        }
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
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence
          }
        }
      });
      
      const goalReady = goalResult.internal.core.stage === 'ready';
      
      if (goalReady) {
        // 同步 learningPathId 到 virtual_session（goalConversationService 已自动触发 path 生成）
        const updatedConversation = await prisma.goal_conversations.findUnique({
          where: { id: session.goalConversationId }
        });
        
        if (updatedConversation?.learningPathId) {
          await this.updateSessionStatus(
            input.sessionId,
            'running',
            'path',
            undefined,
            updatedConversation.learningPathId
          );
        }
        
        await this.updateStageResults(input.sessionId, 'goal', {
          success: true,
          durationMs: Date.now() - startTime,
          conversationId: session.goalConversationId,
          finalStage: goalResult.internal.core.stage,
          learningPathId: updatedConversation?.learningPathId
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
        
        await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
      }
      
      await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
      
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
        currentStage: 'goal',
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
            profile
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
            confidence: reactionOutput.confidence
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'path_review', {
        success: true,
        reaction: reactionOutput.reaction,
        decision: reactionOutput.decision,
        modifyRequest: reactionOutput.modifyRequest,
        confidence: reactionOutput.confidence
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

  async startLearningPhase(sessionId: string): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: any[];
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
                orderBy: { order: 'asc' },
                where: { status: 'active' }
              }
            }
          }
        }
      });
      
      if (!learningPath || !learningPath.milestones.length) {
        throw new Error('学习路径或里程碑不存在');
      }
      
      const firstMilestone = learningPath.milestones[0];
      const firstTask = firstMilestone.subtasks?.[0];
      
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
        currentMilestone: firstMilestone.stageNumber,
        currentMilestoneTitle: firstMilestone.title,
        currentTaskId: firstTask.id,
        currentTaskTitle: firstTask.title,
        totalMilestones: learningPath.milestones.length
      });
      
      return {
        success: true,
        teachingSessionId: teachingSession.sessionId,
        welcomeMessage: teachingSession.welcomeMessage,
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
                orderBy: { order: 'asc' },
                where: { status: 'active' }
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
      
      const tasks = currentMilestone.subtasks || [];
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
          currentMilestone: nextMilestoneIdx,
          currentTaskIdx: 0
        });
        
        return await this.executeLearningStep(sessionId);
      }
      
      const simulationContext = {
        profile,
        conversationHistory: learningState.conversationHistory || [],
        currentStage: 'learning',
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
            reply: virtualReplyResult.userVisible?.substring(0, 100),
            currentTask: currentTask.title,
            currentMilestone: currentMilestone.title
          }
        }
      });
      
      let aiResponse = '';
      let nextTaskIdx = currentTaskIdx + 1;
      let nextMilestoneIdx = currentMilestoneIdx;
      let taskCompleted = false;
      
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
                aiResponse: aiResponse?.substring(0, 100),
                isCompletion: aiResult.isCompletion,
                cognitiveLevel: aiResult.analysis?.cognitiveLevel
              }
            }
          });
          
          if (aiResult.isCompletion) {
            taskCompleted = true;
            nextTaskIdx = 0;
            nextMilestoneIdx = currentMilestoneIdx + 1;
          }
        } catch (err: any) {
          logger.warn('[simulation-orchestrator] AI教学响应失败，使用模拟回复', {
            sessionId,
            error: err.message
          });
          aiResponse = `好的，我已经理解了。让我们继续下一个任务。`;
          taskCompleted = true;
          nextTaskIdx = 0;
          nextMilestoneIdx = currentMilestoneIdx + 1;
        }
      } else {
        aiResponse = `收到你的回复："${virtualReplyResult.userVisible.substring(0, 50)}..." 让我们继续学习。`;
        taskCompleted = true;
      }
      
      const isPathCompleted = nextMilestoneIdx >= milestones.length;
      
      await this.updateStageResults(sessionId, 'learning', {
        ...learningState,
        currentMilestone: isPathCompleted ? currentMilestoneIdx : nextMilestoneIdx,
        currentTaskIdx: isPathCompleted ? 0 : nextTaskIdx,
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
          currentMilestone: nextMilestoneIdx + 1,
          totalMilestones: milestones.length,
          currentTask: isPathCompleted ? null : (tasks[nextTaskIdx]?.title || null)
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
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };