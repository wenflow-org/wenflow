/**
 * ContentAgent v3.0 集成模块
 * 
 * 将 ContentAgent v3.0 集成到学习流程协调者
 * 实现完整的学习对话流程管理
 * 
 * 核心流程：
 * 1. 获取学生状态（集成 LSS/KTL/LF/LSB）
 * 2. ContentAgent 生成对话内容
 * 3. 等待学生回答
 * 4. AssessmentAgent 评估学生回答
 * 5. ProgressAgent 更新学习进度
 * 6. 更新学生状态
 * 7. 循环直到对话目标达成
 */

import { ContentAgentV3 } from '../content-agent-v3';
import progressAgentHandler from '../progress-agent';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import { learningStateService, LearningStateMetrics } from '../../services/learning/learning-state.service';
import { studentBaselineService } from '../../services/student-baseline.service';
import { learningSessionService } from '../../services/learning/learning-session.service';
import { createEventBus, EventBus } from '../../gateway/event-bus';

// ==================== 类型定义 ====================

/**
 * 对话阶段
 */
export type DialogueStage = 'DIAGNOSIS' | 'DEEPENING' | 'CONSOLIDATE' | 'REMEDIAL' | 'COMPLETE';

/**
 * 对话消息
 */
interface DialogueMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/**
 * 评估结果
 */
interface AssessmentResult {
  score: number;           // 0-100
  understandingLevel: 'excellent' | 'good' | 'fair' | 'poor';
  misconceptions: string[];
  feedback: string;
}

/**
 * 评估参数
 */
interface EvaluationParams {
  expectedUnderstanding: string;
  assessmentCriteria: {
    excellent: string;
    good: string;
    fair: string;
    poor: string;
  };
  keyConcepts: string[];
  commonMisconceptions: string[];
  remedialThreshold: number;
  advancementThreshold: number;
}

/**
 * 对话状态
 */
interface DialogueState {
  currentRound: number;
  conversationStage: DialogueStage;
  conversationHistory: DialogueMessage[];
  goalAchieved: boolean;
  lastAssessment?: AssessmentResult;
  lastEvaluationParams?: EvaluationParams;
}

/**
 * 对话结果
 */
export interface DialogueResult {
  success: boolean;
  totalRounds: number;
  finalState: {
    userId: string;
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  };
  conversationHistory: DialogueMessage[];
  assessments: AssessmentResult[];
}

/**
 * 学生响应
 */
export interface StudentResponse {
  content: string;
  responseTime?: number;     // 响应时间（秒）
  attempts?: number;         // 尝试次数
}

/**
 * ContentAgent 输出
 */
interface ContentAgentOutput {
  content: {
    uiType: string;
    question: string;
    options?: string[];
    inputHint?: string;
  };
  evaluationParams: EvaluationParams;
  stateChangeSuggestions: {
    taskProgress: number;
    cognitiveStateChanges: Record<string, number>;
    learningMetrics?: {
      lssChange?: number;
      ktlChange?: number;
      lfChange?: number;
    };
    nextStepSuggestion: 'continue' | 'remedial' | 'complete';
  };
  internal: {
    strategy: string;
    strategyReason: string;
    conversationStage: string;
    difficulty: number;
    estimatedMinutes: number;
    qualityScore: number;
  };
}

/**
 * 集成参数
 */
interface IntegrationParams {
  userId: string;
  taskId: string;
  pathId?: string;
  sessionId?: string;
}

/**
 * 响应结果
 */
interface ResponseResult {
  success: boolean;
  content: ContentAgentOutput['content'];
  assessment?: AssessmentResult;
  dialogueState?: DialogueState;
  shouldContinue: boolean;
}

// ==================== ContentAgent 集成类 ====================

export class ContentAgentIntegration {
  private contentAgent: ContentAgentV3;
  private eventBus: EventBus;
  
  constructor() {
    this.contentAgent = new ContentAgentV3();
    this.eventBus = createEventBus(prisma);
  }

  /**
   * 获取学生状态
   */
  private async getStudentState(userId: string): Promise<{
    basic: any;
    metrics: LearningStateMetrics | null;
  }> {
    try {
      // 1. 获取基础认知状态
      const basicState = {
        userId,
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.3,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed'
      };
      
      // 2. 获取学习状态指标（LSS/KTL/LF/LSB）
      const metrics = await learningStateService.getCurrentState(userId);
      
      // 3. 获取 EMA 基线
      const baseline = await studentBaselineService.getOrCreateBaseline(userId);
      
      // 4. 合并状态
      const fullState = {
        ...basicState,
        currentLSS: metrics?.lss ?? 5,
        currentKTL: metrics?.ktl ?? 5,
        currentLF: metrics?.lf ?? 3,
        currentLSB: metrics?.lsb ?? 2,
        // EMA 基线
        responseTimeBaseline: baseline.responseTime.ema,
        messageLengthBaseline: baseline.messageLength.ema,
        aiScoreBaseline: baseline.aiScore.ema,
        // 派生指标
        isBaselineStable: baseline.responseTime.updateCount > 5,
        hasAnomaly: false  // TODO: 实现异常检测
      };
      
      logger.debug('[ContentAgentIntegration] 获取学生状态完成', {
        userId,
        lss: fullState.currentLSS.toFixed(2),
        ktl: fullState.currentKTL.toFixed(2),
        lf: fullState.currentLF.toFixed(2),
        lsb: fullState.currentLSB.toFixed(2)
      });
      
      return {
        basic: fullState,
        metrics
      };
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 获取学生状态失败:', error.message);
      
      // 降级处理
      return {
        basic: {
          userId,
          currentLSS: 5,
          currentKTL: 5,
          currentLF: 3,
          currentLSB: 2
        },
        metrics: null
      };
    }
  }

  /**
   * 获取任务信息
   */
  private async getTaskInfo(taskId: string): Promise<{
    id: string;
    title: string;
    description: string;
    subject?: string;
    objective?: string;
    type?: string;
  }> {
    try {
      const task = await prisma.subtasks.findUnique({
        where: { id: taskId },
        include: {
          milestones: {
            include: {
              learning_paths: true
            }
          },
          learningContents: true
        }
      });
      
      if (!task) {
        throw new Error('任务不存在');
      }
      
      // 从 learningContents 获取内容
      const content = task.learningContents[0];
      let contentObj: any = {};
      if (content?.content) {
        try {
          contentObj = JSON.parse(content.content);
        } catch {
          // 忽略解析错误
        }
      }
      
      return {
        id: task.id,
        title: task.title,
        description: task.description || '',
        subject: task.milestones?.learning_paths?.subject || undefined,
        objective: contentObj.cognitiveObjective || task.description || '',
        type: task.status
      };
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 获取任务信息失败:', error.message);
      throw error;
    }
  }

  /**
   * 初始化对话
   */
  private async initializeDialogue(
    userId: string,
    taskId: string
  ): Promise<{
    sessionId: string;
    dialogueState: DialogueState;
  }> {
    // 1. 创建或获取学习会话
    const activeSessions = await learningSessionService.getActiveSessions(userId);
    let sessionId: string;
    
    if (activeSessions.length > 0) {
      // 复用现有会话
      sessionId = activeSessions[0].id;
    } else {
      // 创建新会话
      const session = await learningSessionService.createSession(userId);
      sessionId = session.id;
    }
    
    // 2. 初始化对话状态
    const dialogueState: DialogueState = {
      currentRound: 0,
      conversationStage: 'DIAGNOSIS',
      conversationHistory: [],
      goalAchieved: false
    };
    
    logger.info('[ContentAgentIntegration] 对话初始化完成', {
      userId,
      taskId,
      sessionId
    });
    
    return { sessionId, dialogueState };
  }

  /**
   * 评估学生回答（简化版 AssessmentAgent）
   */
  private async assessStudentResponse(
    studentResponse: string,
    evaluationParams: EvaluationParams,
    conversationHistory: DialogueMessage[]
  ): Promise<AssessmentResult> {
    try {
      // TODO: 调用独立的 AssessmentAgent
      // 这里先实现简化版评估逻辑
      
      const response = studentResponse.toLowerCase();
      const keyConcepts = evaluationParams.keyConcepts;
      
      // 1. 检查关键概念匹配
      let conceptMatches = 0;
      for (const concept of keyConcepts) {
        if (response.includes(concept.toLowerCase())) {
          conceptMatches++;
        }
      }
      
      const conceptRatio = conceptMatches / keyConcepts.length;
      
      // 2. 检查回答长度（过短可能表示不理解）
      const lengthScore = Math.min(1, response.length / 50);
      
      // 3. 综合评分
      const score = (conceptRatio * 0.6 + lengthScore * 0.4) * 100;
      
      // 4. 确定理解等级
      let understandingLevel: AssessmentResult['understandingLevel'];
      if (score >= 90) {
        understandingLevel = 'excellent';
      } else if (score >= 70) {
        understandingLevel = 'good';
      } else if (score >= 50) {
        understandingLevel = 'fair';
      } else {
        understandingLevel = 'poor';
      }
      
      // 5. 检测潜在误解
      const misconceptions: string[] = [];
      if (conceptRatio < 0.5) {
        misconceptions.push('未掌握关键概念');
      }
      if (lengthScore < 0.3) {
        misconceptions.push('回答过于简短，可能理解不充分');
      }
      
      // 6. 生成反馈
      const feedback = this.generateFeedback(
        score,
        understandingLevel,
        evaluationParams
      );
      
      return {
        score,
        understandingLevel,
        misconceptions,
        feedback
      };
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 评估学生回答失败:', error.message);
      
      // 降级处理
      return {
        score: 50,
        understandingLevel: 'fair',
        misconceptions: [],
        feedback: '请继续分享你的想法'
      };
    }
  }

  /**
   * 生成反馈
   */
  private generateFeedback(
    score: number,
    understandingLevel: string,
    evaluationParams: EvaluationParams
  ): string {
    const encouragement = [
      '很好！',
      '不错的思考！',
      '继续加油！',
      '你理解得很到位！'
    ];
    
    const guidance = [
      '让我们继续深入探讨...',
      '你能再详细解释一下吗？',
      '试着从另一个角度思考...',
      '这个想法很有意思，那么...'
    ];
    
    const randomEncouragement = encouragement[Math.floor(Math.random() * encouragement.length)];
    const randomGuidance = guidance[Math.floor(Math.random() * guidance.length)];
    
    if (score >= 80) {
      return `${randomEncouragement}${randomGuidance}`;
    } else if (score >= 60) {
      return `你的理解基本正确。${randomGuidance}`;
    } else {
      return `让我们一起再思考一下这个问题。${evaluationParams.expectedUnderstanding}`;
    }
  }

  /**
   * 更新对话状态
   */
  private updateDialogueState(
    currentState: DialogueState,
    assessmentResult: AssessmentResult,
    evaluationParams: EvaluationParams
  ): DialogueState {
    const score = assessmentResult.score;
    const threshold = evaluationParams.advancementThreshold;
    
    // 确定下一阶段
    let nextStage: DialogueStage = currentState.conversationStage;
    
    if (score >= threshold) {
      // 达到进阶阈值，进入下一阶段
      switch (currentState.conversationStage) {
        case 'DIAGNOSIS':
          nextStage = 'DEEPENING';
          break;
        case 'DEEPENING':
          nextStage = 'CONSOLIDATE';
          break;
        case 'CONSOLIDATE':
          nextStage = 'COMPLETE';
          break;
        case 'REMEDIAL':
          nextStage = 'DIAGNOSIS';  // 补救后重新诊断
          break;
      }
    } else if (score < evaluationParams.remedialThreshold) {
      // 低于补救阈值，进入补救模式
      nextStage = 'REMEDIAL';
    }
    
    // 检查是否完成
    const goalAchieved = nextStage === 'COMPLETE';
    
    return {
      currentRound: currentState.currentRound + 1,
      conversationStage: nextStage,
      conversationHistory: currentState.conversationHistory,
      goalAchieved,
      lastAssessment: assessmentResult,
      lastEvaluationParams: evaluationParams
    };
  }

  /**
   * 更新学习进度（调用 ProgressAgent）
   */
  private async updateProgress(
    userId: string,
    taskId: string,
    dialogueState: DialogueState,
    assessmentResult: AssessmentResult
  ): Promise<void> {
    try {
      // 调用 ProgressAgent
      const progressResult = await progressAgentHandler(
        {
          type: 'custom' as const,
          goal: 'track_learning_progress',
          metadata: {
            action: 'task_complete',
            taskId,
            data: {
              difficulty: 5,
              timeSpent: 30,
              subjectiveDifficulty: 5,
              score: assessmentResult.score,
              attempts: 1
            }
          }
        },
        {
          userId,
          sessionId: taskId,
          metadata: {
            agentId: 'content-agent-integration'
          }
        }
      );
      
      if (progressResult.success) {
        logger.info('[ContentAgentIntegration] 进度更新完成', {
          userId,
          taskId,
          progress: progressResult.progress
        });
        
        // 发布事件
        await this.eventBus.emit({
          type: 'learning:progress:change' as any,
          source: 'content-agent-integration',
          userId,
          data: {
            taskId,
            dialogueRound: dialogueState.currentRound,
            assessmentScore: assessmentResult.score
          }
        });
      }
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 更新进度失败:', error.message);
      // 不阻断主流程
    }
  }

  /**
   * 更新学生状态（LSS/KTL/LF/LSB）
   */
  private async updateStudentState(
    userId: string,
    dialogueState: DialogueState,
    assessmentResult: AssessmentResult
  ): Promise<void> {
    try {
      // 计算 LSS 输入
      const lssInputs = {
        difficulty: 5,
        cognitiveLoad: 5,
        efficiency: assessmentResult.score / 100,
        timeSpent: 30,
        expectedTime: 30,
        completionRate: dialogueState.currentRound > 0 ? 0.8 : 0.5,
        taskType: 'practice' as const
      };
      
      // 更新学习状态
      await learningStateService.calculateAndUpdate(userId, lssInputs);
      
      logger.info('[ContentAgentIntegration] 学生状态更新完成', {
        userId,
        round: dialogueState.currentRound,
        score: assessmentResult.score
      });
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 更新学生状态失败:', error.message);
      // 不阻断主流程
    }
  }

  /**
   * 执行学习对话流程（核心方法）
   * 
   * 这是主入口，执行完整的多轮对话流程
   */
  async executeLearningDialogue(
    params: IntegrationParams
  ): Promise<DialogueResult> {
    const { userId, taskId, pathId, sessionId } = params;
    const assessments: AssessmentResult[] = [];
    
    try {
      logger.info('[ContentAgentIntegration] 开始执行学习对话', {
        userId,
        taskId,
        pathId
      });
      
      // 1. 获取学生状态
      const { basic: studentState } = await this.getStudentState(userId);
      
      // 2. 获取任务信息
      const taskInfo = await this.getTaskInfo(taskId);
      
      // 3. 初始化对话
      const { sessionId: sessionIdCreated, dialogueState } = await this.initializeDialogue(
        userId,
        taskId
      );
      
      const actualSessionId = sessionId || sessionIdCreated;
      
      // 4. 多轮对话循环（最多 8 轮）
      const maxRounds = 8;
      
      while (!dialogueState.goalAchieved && dialogueState.currentRound < maxRounds) {
        // 6. 执行 ContentAgent（使用公共方法 run）
    // 4.1 ContentAgent 生成对话内容（使用公共方法 run）
        const contentResult = await this.contentAgent.run({
          taskId,
          taskTitle: taskInfo.title,
          taskDescription: taskInfo.description,
          subject: taskInfo.subject,
          cognitiveObjective: taskInfo.objective || taskInfo.description,
          studentState,
          conversationHistory: dialogueState.conversationHistory,
          currentRound: dialogueState.currentRound + 1,
          previousRoundResult: dialogueState.lastAssessment ? {
            score: dialogueState.lastAssessment.score,
            understandingLevel: dialogueState.lastAssessment.understandingLevel,
            misconceptions: dialogueState.lastAssessment.misconceptions
          } : undefined,
          sessionId: actualSessionId
        } as any);
        
        const contentOutput = contentResult as unknown as ContentAgentOutput;
        
        logger.info('[ContentAgentIntegration] 第' + (dialogueState.currentRound + 1) + '轮内容生成', {
          strategy: contentOutput.internal.strategy,
          stage: contentOutput.internal.conversationStage,
          uiType: contentOutput.content.uiType
        });
        
        // 4.2 这里应该将内容返回给前端，等待学生回答
        // 在实际使用中，这里会 yield 内容，然后等待前端调用 respond 方法
        // 为了简化，我们假设学生立即回答
        
        // 4.3 模拟等待学生回答（实际应该由前端触发）
        const studentResponse = await this.waitForStudentResponse(actualSessionId);
        
        if (!studentResponse) {
          logger.warn('[ContentAgentIntegration] 未收到学生回答，终止对话');
          break;
        }
        
        // 4.4 添加消息到会话
        await learningSessionService.addMessageAndAssessState(
          actualSessionId,
          {
            role: 'assistant',
            content: contentOutput.content.question,
            timestamp: new Date().toISOString()
          },
          userId
        );
        
        await learningSessionService.addMessageAndAssessState(
          actualSessionId,
          {
            role: 'user',
            content: studentResponse.content,
            timestamp: new Date().toISOString()
          },
          userId
        );
        
        // 4.5 AssessmentAgent 评估学生回答
        const assessmentResult = await this.assessStudentResponse(
          studentResponse.content,
          contentOutput.evaluationParams,
          dialogueState.conversationHistory
        );
        
        assessments.push(assessmentResult);
        
        logger.info('[ContentAgentIntegration] 学生回答评估', {
          score: assessmentResult.score,
          understandingLevel: assessmentResult.understandingLevel,
          misconceptions: assessmentResult.misconceptions.join(', ')
        });
        
        // 4.6 更新对话状态
        const newDialogueState = this.updateDialogueState(
          dialogueState,
          assessmentResult,
          contentOutput.evaluationParams
        );
        
        Object.assign(dialogueState, newDialogueState);
        
        // 4.7 ProgressAgent 更新学习进度
        await this.updateProgress(
          userId,
          taskId,
          dialogueState,
          assessmentResult
        );
        
        // 4.8 更新学生状态
        await this.updateStudentState(
          userId,
          dialogueState,
          assessmentResult
        );
        
        // 4.9 刷新学生状态
        const newState = await this.getStudentState(userId);
        Object.assign(studentState, newState.basic);
      }
      
      // 5. 对话完成
      const finalMetrics = await learningStateService.getCurrentState(userId);
      
      const result: DialogueResult = {
        success: dialogueState.goalAchieved,
        totalRounds: dialogueState.currentRound,
        finalState: {
          userId,
          lss: finalMetrics?.lss ?? 5,
          ktl: finalMetrics?.ktl ?? 5,
          lf: finalMetrics?.lf ?? 3,
          lsb: finalMetrics?.lsb ?? 2
        },
        conversationHistory: dialogueState.conversationHistory,
        assessments
      };
      
      logger.info('[ContentAgentIntegration] 学习对话完成', {
        userId,
        taskId,
        success: result.success,
        totalRounds: result.totalRounds
      });
      
      return result;
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 执行学习对话失败:', error.message);
      
      throw error;
    }
  }

  /**
   * 等待学生回答
   * 
   * 在实际使用中，这个方法应该：
   * 1. 将内容推送给前端（通过 WebSocket 或 SSE）
   * 2. 等待前端提交回答
   * 3. 返回学生回答
   * 
   * 当前简化版：返回 null，表示需要前端主动调用 respond 方法
   */
  private async waitForStudentResponse(
    sessionId: string
  ): Promise<StudentResponse | null> {
    // TODO: 实现 WebSocket 或 SSE 推送
    // 当前由前端主动调用 /tasks/:taskId/respond 端点
    
    return null;
  }

  /**
   * 处理学生回答（供前端调用）
   */
  async processStudentResponse(
    params: IntegrationParams & {
      sessionId: string;
      studentResponse: string;
    }
  ): Promise<ResponseResult> {
    const { userId, taskId, sessionId, studentResponse } = params;
    
    try {
      // TODO: 从会话状态中恢复对话上下文
      // 当前简化处理
      
      return {
        success: true,
        content: {
          uiType: 'input',
          question: '请继续分享你的想法'
        },
        shouldContinue: true
      };
    } catch (error: any) {
      logger.error('[ContentAgentIntegration] 处理学生回答失败:', error.message);
      
      return {
        success: false,
        content: {
          uiType: 'input',
          question: '遇到了一些问题，请重试'
        },
        shouldContinue: false
      };
    }
  }
}

export default ContentAgentIntegration;
