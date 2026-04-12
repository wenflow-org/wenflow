/**
 * 对话学习服务
 * 
 * 基于 ContentAgent v3.0 实现对话式学习流程
 * 支持多轮对话、学生回答评估、状态追踪
 * 
 * 核心功能：
 * 1. 开始对话学习任务
 * 2. 提交学生回答并获取反馈
 * 3. 获取提示
 * 4. 跳过任务
 * 5. 获取对话状态
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { ContentAgentV3 } from '../../agents/content-agent-v3';
import { learningStateService } from './learning-state.service';
import { studentBaselineService } from '../student-baseline.service';
import { learningSessionService } from './learning-session.service';

// ==================== 类型定义 ====================

/**
 * 对话消息
 */
interface DialogueMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
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
 * 对话内容
 */
interface DialogueContent {
  uiType: string;
  question: string;
  options?: string[];
  inputHint?: string;
  hint?: string;
}

/**
 * 评估结果
 */
interface AssessmentResult {
  score: number;
  understandingLevel: 'excellent' | 'good' | 'fair' | 'poor';
  misconceptions: string[];
  feedback: string;
}

/**
 * 对话状态
 */
interface DialogueSessionState {
  sessionId: string;
  userId: string;
  taskId: string;
  status: 'active' | 'completed' | 'skipped';
  round: number;
  history: DialogueMessage[];
  content: DialogueContent;
  evaluationParams: EvaluationParams;
}

/**
 * 开始对话任务参数
 */
interface StartDialogueTaskParams {
  userId: string;
  taskId: string;
  pathId: string;
}

/**
 * 开始对话任务结果
 */
interface StartDialogueTaskResult {
  sessionId: string;
  content: DialogueContent;
  evaluationParams: EvaluationParams;
}

/**
 * 提交回答参数
 */
interface SubmitResponseParams {
  sessionId: string;
  userId: string;
  response: string;
  selectedOption?: number;
}

/**
 * 提交回答结果
 */
interface SubmitResponseResult {
  feedback: string;
  nextQuestion?: DialogueContent;
  dialogueComplete: boolean;
  assessmentResult: AssessmentResult;
}

/**
 * 提示结果
 */
interface HintResult {
  hint: string;
}

/**
 * 跳过任务结果
 */
interface SkipTaskResult {
  success: boolean;
}

// ==================== 对话学习服务类 ====================

export class DialogueLearningService {
  private contentAgent: ContentAgentV3;

  constructor() {
    this.contentAgent = new ContentAgentV3();
  }

  /**
   * 开始对话学习任务
   */
  async startDialogueTask(
    params: StartDialogueTaskParams
  ): Promise<StartDialogueTaskResult> {
    const { userId, taskId, pathId } = params;

    try {
      logger.info('[DialogueLearningService] 开始对话任务', {
        userId,
        taskId,
        pathId
      });

// 1. 创建对话会话
      const session = await prisma.dialogue_sessions.create({
        data: {
          id: `ds_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId,
          taskId,
          pathId,
          status: 'active',
          round: 0,
          history: JSON.stringify([]),
          content: JSON.stringify({}),
          evaluation_params: JSON.stringify({}),
          updatedAt: new Date()
        }
      });

      const sessionId = session.id;

      // 2. 获取学生状态
      const studentState = await this.getStudentState(userId);

      // 3. 获取任务信息
      const taskInfo = await this.getTaskInfo(taskId);

      // 4. ContentAgent 生成第一轮对话
      const contentResult = await this.contentAgent.run({
        taskId,
        taskTitle: taskInfo.title,
        taskDescription: taskInfo.description,
        subject: taskInfo.subject,
        cognitiveObjective: taskInfo.objective,
        studentState,
        conversationHistory: [],
        currentRound: 1,
        sessionId
      } as any);

      // 解析 ContentAgent 输出
      const output = contentResult as any;
      const content: DialogueContent = output.content || {
        uiType: 'input',
        question: output.userVisible || '请分享你的想法'
      };
      const evaluationParams: EvaluationParams = output.evaluationParams || this.createDefaultEvaluationParams(taskInfo.objective);

      // 5. 保存对话状态
      await prisma.dialogue_sessions.update({
        where: { id: sessionId },
        data: {
          round: 1,
          content: JSON.stringify(content),
          evaluation_params: JSON.stringify(evaluationParams)
        }
      });

      logger.info('[DialogueLearningService] 对话任务启动成功', {
        sessionId,
        strategy: output.internal?.strategy,
        stage: output.internal?.conversationStage
      });

      return {
        sessionId,
        content,
        evaluationParams
      };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 开始对话任务失败:', error.message);
      throw error;
    }
  }

  /**
   * 提交学生回答
   */
  async submitResponse(
    params: SubmitResponseParams
  ): Promise<SubmitResponseResult> {
    const { sessionId, userId, response, selectedOption } = params;

    try {
      logger.info('[DialogueLearningService] 提交学生回答', {
        sessionId,
        userId,
        responseLength: response.length
      });

      // 1. 获取对话状态
      const dialogueState = await this.getDialogueState(sessionId);

      if (dialogueState.status !== 'active') {
        throw new Error('对话已结束');
      }

      // 2. AssessmentAgent 评估学生回答
      const assessmentResult = await this.assessStudentResponse(
        response,
        dialogueState.evaluationParams,
        dialogueState.history
      );

      logger.info('[DialogueLearningService] 评估结果', {
        score: assessmentResult.score,
        understandingLevel: assessmentResult.understandingLevel
      });

      // 3. 判断是否完成对话
      const isComplete = assessmentResult.score >=
        dialogueState.evaluationParams.advancementThreshold * 100;

      // 4. 如果未完成，ContentAgent 生成下一轮
      let nextQuestion: DialogueContent | undefined;

      if (!isComplete) {
        // 获取任务信息
        const taskInfo = await this.getTaskInfo(dialogueState.taskId);

        // 获取学生状态
        const studentState = await this.getStudentState(userId);

        // 调用 ContentAgent 生成下一轮
        const contentResult = await this.contentAgent.run({
          taskId: dialogueState.taskId,
          taskTitle: taskInfo.title,
          taskDescription: taskInfo.description,
          subject: taskInfo.subject,
          cognitiveObjective: taskInfo.objective,
          studentState,
          conversationHistory: dialogueState.history,
          currentRound: dialogueState.round + 1,
          previousRoundResult: {
            score: assessmentResult.score / 100,
            understandingLevel: assessmentResult.understandingLevel,
            misconceptions: assessmentResult.misconceptions
          },
          sessionId
        } as any);

        // 解析输出
        const output = contentResult as any;
        nextQuestion = output.content || {
          uiType: 'input',
          question: output.userVisible || '请继续分享你的想法'
        };

        // 更新对话状态
        const newHistory = [
          ...dialogueState.history,
          {
            role: 'user' as const,
            content: response,
            timestamp: new Date().toISOString()
          },
          {
            role: 'assistant' as const,
            content: nextQuestion.question,
            timestamp: new Date().toISOString()
          }
        ];

        await prisma.dialogue_sessions.update({
          where: { id: sessionId },
          data: {
            round: dialogueState.round + 1,
            history: JSON.stringify(newHistory),
            content: JSON.stringify(nextQuestion),
            evaluation_params: JSON.stringify(output.evaluationParams || dialogueState.evaluationParams)
          }
        });
      } else {
        // 对话完成，更新状态
        await prisma.dialogue_sessions.update({
          where: { id: sessionId },
          data: {
            status: 'completed'
          }
        });

        // 更新任务状态
        await prisma.subtasks.update({
          where: { id: dialogueState.taskId },
          data: {
            status: 'completed',
            completedAt: new Date()
          }
        });
      }

      // 5. 返回结果
      return {
        feedback: assessmentResult.feedback,
        nextQuestion,
        dialogueComplete: isComplete,
        assessmentResult
      };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 提交学生回答失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取提示
   */
  async getHint(sessionId: string): Promise<HintResult> {
    try {
      const dialogueState = await this.getDialogueState(sessionId);

      return {
        hint: dialogueState.content.hint || '再仔细想想，从问题的关键词入手思考'
      };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 获取提示失败:', error.message);
      throw error;
    }
  }

  /**
   * 跳过任务
   */
  async skipTask(sessionId: string): Promise<SkipTaskResult> {
    try {
      await prisma.dialogue_sessions.update({
        where: { id: sessionId },
        data: {
          status: 'skipped'
        }
      });

      return { success: true };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 跳过任务失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取对话状态
   */
  async getDialogueState(
    sessionId: string
  ): Promise<DialogueSessionState> {
    try {
      const session = await prisma.dialogue_sessions.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        throw new Error('对话会话不存在');
      }

      return {
        sessionId: session.id,
        userId: session.userId,
        taskId: session.taskId,
        status: session.status as 'active' | 'completed' | 'skipped',
        round: session.round,
        history: JSON.parse(session.history),
        content: JSON.parse(session.content),
        evaluationParams: JSON.parse(session.evaluation_params)
      };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 获取对话状态失败:', error.message);
      throw error;
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取学生状态
   */
  private async getStudentState(userId: string): Promise<any> {
    try {
      // 获取学习状态指标
      const learningState = await learningStateService.getCurrentState(userId);

      // 获取 EMA 基线
      const baseline = await studentBaselineService.getOrCreateBaseline(userId);

      // 合并状态
      return {
        userId,
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.3,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: learningState?.lss ?? 5,
        currentKTL: learningState?.ktl ?? 5,
        currentLF: learningState?.lf ?? 3,
        currentLSB: learningState?.lsb ?? 2,
        // EMA 基线
        responseTimeBaseline: baseline.responseTime.ema,
        messageLengthBaseline: baseline.messageLength.ema,
        aiScoreBaseline: baseline.aiScore.ema,
        // 派生指标
        isBaselineStable: baseline.responseTime.updateCount > 5,
        hasAnomaly: false
      };
    } catch (error: any) {
      logger.warn('[DialogueLearningService] 获取学生状态失败，使用默认值');

      // 降级处理
      return {
        userId,
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.3,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 5,
        currentKTL: 5,
        currentLF: 3,
        currentLSB: 2
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
        objective: contentObj.cognitiveObjective || task.description || ''
      };
    } catch (error: any) {
      logger.error('[DialogueLearningService] 获取任务信息失败:', error.message);
      throw error;
    }
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

      // 3. 综合评分（0-100）
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
      logger.error('[DialogueLearningService] 评估学生回答失败:', error.message);

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
   * 创建默认评估参数
   */
  private createDefaultEvaluationParams(objective: string): EvaluationParams {
    return {
      expectedUnderstanding: `学生能够${objective}`,
      assessmentCriteria: {
        excellent: '完全理解并能独立应用，能解释原理',
        good: '基本理解，在提示下能够应用',
        fair: '部分理解，需要较多指导',
        poor: '理解困难，需要重新讲解'
      },
      keyConcepts: [objective],
      commonMisconceptions: [
        '概念混淆',
        '应用场景理解不清',
        '步骤顺序错误'
      ],
      remedialThreshold: 0.4,
      advancementThreshold: 0.8
    };
  }
}

// 导出单例
export const dialogueLearningService = new DialogueLearningService();
