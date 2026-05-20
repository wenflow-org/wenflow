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
        conversationHistory = collectedData.messages || [];
      } catch {}
      
      const lastAssistantMessage = conversationHistory.length > 0
        ? conversationHistory.filter(m => m.role === 'assistant').pop()?.content || ''
        : '';
      
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
        await this.updateStageResults(input.sessionId, 'goal', {
          success: true,
          durationMs: Date.now() - startTime,
          conversationId: session.goalConversationId,
          finalStage: goalResult.internal.core.stage
        });
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
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };