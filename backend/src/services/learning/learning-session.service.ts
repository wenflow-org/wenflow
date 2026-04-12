/**
 * 学习会话服务
 * 
 * 管理学习会话的创建、消息添加和状态追踪
 * 集成 AI 状态评估和 EMA 基线更新
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { studentBaselineService } from '../student-baseline.service';
import { aiStateAssessmentService } from '../ai/state-assessment.service';
import { extractMetrics } from '../../utils/metrics-extractor';
import { sessionEvaluationAgent } from '../../agents/session-evaluation-agent';
import { learningStateService } from './learning-state.service';

/**
 * 学习会话接口
 */
export interface LearningSession {
  id: string;
  userId: string;
  goalId?: string;
  messages: Message[];
  state: StudentStateAssessment | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 消息接口
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * 学生状态评估接口
 */
export interface StudentStateAssessment {
  cognitive: number;
  stress: number;
  engagement: number;
  anomaly: boolean;
  anomalyReason?: string;
  intervention?: string;
  assessedAt?: string;
}

/**
 * 添加消息结果
 */
export interface AddMessageResult {
  session: LearningSession;
  state: StudentStateAssessment;
  metrics: {
    responseTime?: number;
    messageLength: number;
    interactionInterval?: number;
  };
  zScores?: {
    responseTime?: number;
    messageLength?: number;
    interactionInterval?: number;
    aiScore?: number;
  };
  anomaly?: {
    hasAnomaly: boolean;
    reasoning: string;
  };
}

/**
 * 学习会话服务类
 */
class LearningSessionService {
  
  /**
   * 创建新会话
   */
  async createSession(
    userId: string,
    goalId?: string
  ): Promise<LearningSession> {
    try {
const session = await prisma.learning_sessions.create({
        data: {
          id: `ls_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId,
          goalId: goalId || null,
          messages: JSON.stringify([]),
          state: JSON.stringify({
            cognitive: 0.5,
            stress: 0.5,
            engagement: 0.5,
            anomaly: false,
            assessedAt: new Date().toISOString()
          })
        }
      });
      
      logger.info('创建学习会话', { 
        sessionId: session.id, 
        userId, 
        goalId 
      });
      
      return {
        id: session.id,
        userId: session.userId,
        goalId: session.goalId || undefined,
        messages: [],
        state: null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };
    } catch (error: any) {
      logger.error('创建学习会话失败:', error.message);
      throw error;
    }
  }
  
  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<LearningSession | null> {
    try {
      const session = await prisma.learning_sessions.findUnique({
        where: { id: sessionId }
      });
      
      if (!session) {
        return null;
      }
      
      return {
        id: session.id,
        userId: session.userId,
        goalId: session.goalId || undefined,
        messages: JSON.parse(session.messages),
        state: JSON.parse(session.state),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };
    } catch (error: any) {
      logger.error('获取会话失败:', error.message);
      throw error;
    }
  }
  
  /**
   * 添加消息并更新状态（核心方法）
   * 
   * 流程：
   * 1. 提取数值指标（响应时间、消息长度等）
   * 2. 更新 EMA 基线
   * 3. AI 评估认知状态
   * 4. 综合 AI 和 EMA 进行最终判断
   * 5. 保存消息和状态
   */
  async addMessageAndAssessState(
    sessionId: string,
    message: Message,
    userId: string
  ): Promise<AddMessageResult> {
    try {
      // 1. 获取会话
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new Error('会话不存在');
      }
      
      // 2. 添加消息
      const updatedMessages = [...session.messages, message];
      
      // 3. 提取数值指标
      const metrics = extractMetrics(session.messages, message);
      
      // 4. 更新 EMA 基线
      const baselineResult = await studentBaselineService.updateBaseline(userId, {
        responseTime: metrics.responseTime,
        messageLength: metrics.messageLength,
        interactionInterval: metrics.interactionInterval,
        aiScore: undefined  // 稍后 AI 评估后更新
      });
      
      // 5. AI 评估认知状态
      const aiAssessment = await aiStateAssessmentService.assessCognitiveState(
        updatedMessages
      );
      
      // 6. 综合 AI 和 EMA
      const finalState = await aiStateAssessmentService.integrateAIandEMA(
        aiAssessment,
        baselineResult.zScores,
        baselineResult.anomaly,
        updatedMessages
      );
      
      // 7. 更新 AI 评分基线
      const finalBaseline = await studentBaselineService.updateBaseline(userId, {
        aiScore: finalState.cognitive
      });
      
      // 8. 保存会话（消息 + 状态）
      const updatedSession = await prisma.learning_sessions.update({
        where: { id: sessionId },
        data: {
          messages: JSON.stringify(updatedMessages),
          state: JSON.stringify(finalState)
        }
      });
      
      logger.info('添加消息并评估状态', {
        sessionId,
        userId,
        cognitive: finalState.cognitive,
        stress: finalState.stress,
        engagement: finalState.engagement,
        anomaly: finalState.anomaly
      });
      
      return {
        session: {
          id: updatedSession.id,
          userId: updatedSession.userId,
          goalId: updatedSession.goalId || undefined,
          messages: updatedMessages,
          state: finalState,
          createdAt: updatedSession.createdAt,
          updatedAt: updatedSession.updatedAt
        },
        state: finalState,
        metrics: {
          responseTime: metrics.responseTime,
          messageLength: metrics.messageLength,
          interactionInterval: metrics.interactionInterval
        },
        zScores: finalBaseline.zScores,
        anomaly: {
          hasAnomaly: finalBaseline.anomaly.hasAnomaly,
          reasoning: finalBaseline.anomaly.reasoning
        }
      };
    } catch (error: any) {
      logger.error('添加消息并评估状态失败:', error.message);
      throw error;
    }
  }
  
  /**
   * 获取会话状态历史
   */
  async getSessionStateHistory(
    sessionId: string,
    limit: number = 50
  ): Promise<StudentStateAssessment[]> {
    try {
      // 注：当前设计没有单独存储每条消息的状态
      // 未来可以扩展：每次状态评估单独存表
      const session = await this.getSession(sessionId);
      if (!session) {
        return [];
      }
      
      // 返回最近的状态（目前只有一个）
      return session.state ? [session.state] : [];
    } catch (error: any) {
      logger.error('获取状态历史失败:', error.message);
      return [];
    }
  }
  
  /**
   * 获取用户的所有活跃会话
   */
  async getActiveSessions(userId: string): Promise<LearningSession[]> {
    try {
      const sessions = await prisma.learning_sessions.findMany({
        where: {
          userId,
          updatedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 最近 7 天
          }
        },
        orderBy: {
          updatedAt: 'desc'
        },
        take: 20
      });
      
      return sessions.map(session => ({
        id: session.id,
        userId: session.userId,
        goalId: session.goalId || undefined,
        messages: JSON.parse(session.messages),
        state: JSON.parse(session.state),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }));
    } catch (error: any) {
      logger.error('获取活跃会话失败:', error.message);
      return [];
    }
  }
  
  /**
   * 关闭会话并进行评估
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      // 1. 获取会话数据
      const session = await prisma.learning_sessions.findUnique({
        where: { id: sessionId }
      });
      
      if (!session) {
        throw new Error('会话不存在');
      }
      
      // 2. 解析会话消息和知识点
      let messages: any[] = [];
      let knowledgePoints: any[] = [];
      
      try {
        messages = session.messages ? JSON.parse(session.messages) : [];
        const state = session.state ? JSON.parse(session.state) : {};
        knowledgePoints = Array.isArray(state.knowledgePoints) ? state.knowledgePoints : [];
      } catch (error: any) {
        logger.warn('解析会话数据失败', { sessionId, error: error.message });
      }
      
      // 3. 计算会话时长
      const durationMinutes = session.endTime && session.startTime
        ? Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000))
        : 1;
      
      // 4. 调用评估 Agent
      let evaluationResult: any = null;
      let finalState: any = null;
      
      try {
        evaluationResult = await sessionEvaluationAgent.evaluate({
          messages,
          knowledgePoints,
          sessionInfo: {
            subject: session.goalId || '综合',
            topic: session.taskId || '未知主题',
            durationMinutes,
            userMessageCount: messages.filter(m => m.role === 'user').length,
            assistantMessageCount: messages.filter(m => m.role === 'assistant' || m.role === 'ai').length,
          }
        });
        
        // 5. 更新学习状态
        finalState = await learningStateService.calculateAndUpdateFromSessionScore(
          session.userId,
          {
            sessionLss: evaluationResult.evaluation.sessionLss,
            durationMinutes,
            confidence: evaluationResult.evaluation.confidence,
          }
        );
        
        logger.info('小测会话评估完成', {
          sessionId,
          sessionLss: evaluationResult.evaluation.sessionLss,
          sessionKtl: evaluationResult.evaluation.sessionKtl,
          sessionLf: evaluationResult.evaluation.sessionLf,
          confidence: evaluationResult.evaluation.confidence
        });
      } catch (error: any) {
        logger.error('小测会话评估失败', { sessionId, error: error.message });
        // 评估失败不影响会话关闭
      }
      
      // 6. 保存评估结果到 state
      const currentState = session.state ? JSON.parse(session.state) : {};
      const updatedState = {
        ...currentState,
        lss: finalState?.lss || 0,
        ktl: finalState?.ktl || 0,
        lf: finalState?.lf || 0,
        lsb: finalState?.lsb || 0,
        sessionLss: evaluationResult?.evaluation.sessionLss || 0,
        sessionKtl: evaluationResult?.evaluation.sessionKtl || 0,
        sessionLf: evaluationResult?.evaluation.sessionLf || 0,
        evaluationConfidence: evaluationResult?.evaluation.confidence || 0,
        evaluationSource: evaluationResult?.source || 'fallback',
        evaluationReasoning: evaluationResult?.evaluation.reasoning || '',
        messageCount: messages.length,
        duration: durationMinutes,
        knowledgePoints
      };
      
      // 7. 更新会话
      await prisma.learning_sessions.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          state: JSON.stringify(updatedState),
          updatedAt: new Date()
        }
      });
      
      logger.info('关闭会话', { sessionId, hasEvaluation: !!evaluationResult });
    } catch (error: any) {
      logger.error('关闭会话失败:', error.message);
      throw error;
    }
  }
}

// 导出单例
export const learningSessionService = new LearningSessionService();