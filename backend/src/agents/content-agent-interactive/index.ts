import { v4 as uuidv4 } from 'uuid';
import { BaseAgent, IBaseAgentConfig } from '../../core/agent/BaseAgent';
import { IAgentCapabilities, IAgentInput, IAgentOutput } from '../../core/agent/ILearningAgent';
import { logger } from '../../utils/logger';
import learningStateService from '../../services/learning/state-tracking.service';
import { studentBaselineService } from '../../services/student-baseline.service';
import prisma from '../../config/database';

import {
  ACTIVATION_PROMPT,
  ACTIVATION_EXAMPLES,
  SEGMENT_1_PROMPT,
  SEGMENT_2_PROMPT,
  SEGMENT_3_PROMPT,
  UNDERSTANDING_CHECK_PROMPT,
  SCAFFOLDING_PROMPTS,
} from './prompts';

export type InteractiveStage =
  | 'ACTIVATION'
  | 'SEGMENT_1'
  | 'SEGMENT_2'
  | 'SEGMENT_3'
  | 'CHECK';

export interface ContentSegment {
  stage: InteractiveStage;
  content: string;
  thinkingPause?: {
    question: string;
    type: 'open' | 'choice';
    options?: string[];
  };
}

export interface UserResponse {
  stage: InteractiveStage;
  response: string;
  timestamp: Date;
  skipped: boolean;
}

export interface InteractiveSession {
  sessionId: string;
  userId: string;
  taskId: string;
  stage: InteractiveStage;
  segments: ContentSegment[];
  userResponses: UserResponse[];
  understandingScore: number | null;
  skippedActivation: boolean;
  learningProfile: {
    preferredExamples: string[];
    painPoints: string[];
  };
  taskInfo?: {
    topic: string;
    description: string;
    goal?: string;
  };
}

export interface UnderstandingAssessment {
  level: 'passed' | 'vague' | 'deviation';
  feedback: string;
  needReview: boolean;
  keyPointsMissed?: string[];
  strengths?: string[];
}

export interface InteractiveAgentOutput {
  stage: InteractiveStage;
  content: ContentSegment;
  isComplete: boolean;
  understandingAssessment?: UnderstandingAssessment;
  session: InteractiveSession;
}

export interface StartInput {
  userId: string;
  taskId: string;
  topic: string;
  description?: string;
  goal?: string;
}

const STAGE_ORDER: InteractiveStage[] = ['ACTIVATION', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3', 'CHECK'];

const KEY_CONCEPTS_MAP: Record<string, string[]> = {
  default: ['核心概念', '基本原理', '应用场景'],
  management: ['计划', '组织', '领导', '控制', '目标导向'],
  programming: ['变量', '函数', '循环', '条件判断', '数据结构'],
  data: ['数据收集', '数据清洗', '数据分析', '数据可视化'],
  design: ['用户体验', '视觉层次', '交互设计', '可用性'],
};

export class InteractiveContentAgent extends BaseAgent {
  readonly id = 'content-agent-interactive';
  readonly name = 'Interactive Content Agent';
  readonly version = '1.0.0';
  readonly description = '互动式内容生成 Agent，支持多阶段互动教学';
  readonly subject = 'general';
  readonly capabilities: IAgentCapabilities = {
    tags: ['interactive', 'content-generation', 'adaptive-learning'],
    subjects: ['all'],
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'next', 'respond', 'skip', 'check'] },
        sessionId: { type: 'string' },
        response: { type: 'string' },
        taskInfo: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string' },
        content: { type: 'object' },
        isComplete: { type: 'boolean' },
        understandingAssessment: { type: 'object' },
      },
    },
  };

  private sessions: Map<string, InteractiveSession> = new Map();

  constructor(config?: IBaseAgentConfig) {
    super(config);
  }

  protected async execute(input: IAgentInput): Promise<IAgentOutput> {
    const action = input.params?.action || 'start';
    const sessionId = input.params?.sessionId;
    const response = input.params?.response;
    const taskInfo = input.params?.taskInfo;
    const userId = input.context?.userId || 'anonymous';
    const taskId = input.context?.taskId || 'default-task';

    try {
      let result: InteractiveAgentOutput;

      switch (action) {
        case 'start':
          result = await this.startSession({
            userId,
            taskId,
            topic: taskInfo?.topic || input.prompt,
            description: taskInfo?.description,
            goal: taskInfo?.goal,
          });
          break;
        case 'next':
          if (!sessionId || !this.sessions.has(sessionId)) {
            return this.createErrorOutput('会话不存在', 'SESSION_NOT_FOUND', '请先开始新会话');
          }
          result = await this.getNextContent(this.sessions.get(sessionId)!);
          break;
        case 'respond':
          if (!sessionId || !this.sessions.has(sessionId)) {
            return this.createErrorOutput('会话不存在', 'SESSION_NOT_FOUND', '请先开始新会话');
          }
          result = await this.submitResponse(this.sessions.get(sessionId)!, response || '');
          break;
        case 'skip':
          if (!sessionId || !this.sessions.has(sessionId)) {
            return this.createErrorOutput('会话不存在', 'SESSION_NOT_FOUND', '请先开始新会话');
          }
          result = await this.skipStage(this.sessions.get(sessionId)!);
          break;
        case 'check':
          if (!sessionId || !this.sessions.has(sessionId)) {
            return this.createErrorOutput('会话不存在', 'SESSION_NOT_FOUND', '请先开始新会话');
          }
          const checkResult = await this.checkUnderstanding(this.sessions.get(sessionId)!);
          result = {
            stage: 'CHECK',
            content: {
              stage: 'CHECK',
              content: checkResult.feedback,
            },
            isComplete: true,
            understandingAssessment: checkResult,
            session: this.sessions.get(sessionId)!,
          };
          break;
        default:
          return this.createErrorOutput('未知操作', 'INVALID_ACTION', `不支持的操作: ${action}`);
      }

      this.sessions.set(result.session.sessionId, result.session);

      return this.createOutput(
        result.content.content,
        {
          stage: result.stage,
          content: result.content,
          isComplete: result.isComplete,
          understandingAssessment: result.understandingAssessment,
          sessionId: result.session.sessionId,
        }
      );
    } catch (error: any) {
      logger.error(`[${this.id}] 执行失败:`, error);
      return this.createErrorOutput(
        '处理过程中出现错误',
        'EXECUTION_ERROR',
        error.message
      );
    }
  }

  async startSession(input: StartInput): Promise<InteractiveAgentOutput> {
    const sessionId = uuidv4();

    const session: InteractiveSession = {
      sessionId,
      userId: input.userId,
      taskId: input.taskId,
      stage: 'ACTIVATION',
      segments: [],
      userResponses: [],
      understandingScore: null,
      skippedActivation: false,
      learningProfile: {
        preferredExamples: [],
        painPoints: [],
      },
      taskInfo: {
        topic: input.topic,
        description: input.description || '',
        goal: input.goal,
      },
    };

    const userLevel = await this.getUserLevel(input.userId);
    const activationContent = await this.generateActivationQuestion(
      input.topic,
      input.description || '',
      userLevel
    );

    const segment: ContentSegment = {
      stage: 'ACTIVATION',
      content: activationContent,
      thinkingPause: {
        question: activationContent,
        type: 'open',
      },
    };

    session.segments.push(segment);

    logger.info(`[${this.id}] 开始新会话: ${sessionId}, 主题: ${input.topic}`);

    return {
      stage: 'ACTIVATION',
      content: segment,
      isComplete: false,
      session,
    };
  }

  async getNextContent(session: InteractiveSession): Promise<InteractiveAgentOutput> {
    const nextStage = this.getNextStage(session.stage);

    if (!nextStage) {
      return {
        stage: session.stage,
        content: session.segments[session.segments.length - 1],
        isComplete: true,
        session,
      };
    }

    session.stage = nextStage;

    const userLevel = await this.getUserLevel(session.userId);
    const segment = await this.generateContentSegment(
      session,
      nextStage,
      userLevel
    );

    session.segments.push(segment);

    logger.info(`[${this.id}] 会话 ${session.sessionId} 进入阶段: ${nextStage}`);

    return {
      stage: nextStage,
      content: segment,
      isComplete: nextStage === 'CHECK',
      session,
    };
  }

  async submitResponse(
    session: InteractiveSession,
    response: string
  ): Promise<InteractiveAgentOutput> {
    const currentStage = session.stage;

    session.userResponses.push({
      stage: currentStage,
      response,
      timestamp: new Date(),
      skipped: false,
    });

    if (currentStage === 'ACTIVATION') {
      this.extractLearningProfile(session, response);
    }

    return this.getNextContent(session);
  }

  async skipStage(session: InteractiveSession): Promise<InteractiveAgentOutput> {
    const currentStage = session.stage;

    session.userResponses.push({
      stage: currentStage,
      response: '',
      timestamp: new Date(),
      skipped: true,
    });

    if (currentStage === 'ACTIVATION') {
      session.skippedActivation = true;
    }

    logger.info(`[${this.id}] 会话 ${session.sessionId} 跳过阶段: ${currentStage}`);

    return this.getNextContent(session);
  }

  async checkUnderstanding(session: InteractiveSession): Promise<UnderstandingAssessment> {
    const lastResponse = session.userResponses.find(
      r => r.stage === 'CHECK'
    );

    if (!lastResponse || lastResponse.skipped) {
      return {
        level: 'vague',
        feedback: '没有收到你的理解总结。建议你可以重新回顾一下内容。',
        needReview: true,
      };
    }

    const keyConcepts = this.getKeyConcepts(session.taskInfo?.topic || '');
    const assessment = await this.assessUnderstanding(
      lastResponse.response,
      keyConcepts,
      session.taskInfo?.topic || ''
    );

    session.understandingScore = assessment.level === 'passed' ? 0.8 :
      assessment.level === 'vague' ? 0.5 : 0.2;

    await this.saveSessionResult(session, assessment);

    return assessment;
  }

  private async generateActivationQuestion(
    topic: string,
    description: string,
    userLevel: string
  ): Promise<string> {
    const categoryKey = this.detectCategory(topic);
    const exampleQuestion = ACTIVATION_EXAMPLES[categoryKey] || ACTIVATION_EXAMPLES.default;

    try {
      const prompt = ACTIVATION_PROMPT
        .replace('{topic}', topic)
        .replace('{description}', description || '无详细描述')
        .replace('{userLevel}', userLevel);

      const response = await this.callAI([
        { role: 'system', content: '你是一位友好的学习引导者，擅长用开放式问题激发学习兴趣。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.8 });

      return response.content.trim() || exampleQuestion;
    } catch (error) {
      logger.warn(`[${this.id}] 生成激活问题失败，使用示例问题`);
      return exampleQuestion;
    }
  }

  private async generateContentSegment(
    session: InteractiveSession,
    stage: InteractiveStage,
    userLevel: string
  ): Promise<ContentSegment> {
    const topic = session.taskInfo?.topic || '未知主题';
    const description = session.taskInfo?.description || '';
    const previousContent = session.segments.map(s => s.content).join('\n\n');
    const userResponses = session.userResponses.map(r => `${r.stage}: ${r.response}`).join('\n');

    let prompt: string;
    const systemPrompt = '你是一位经验丰富的教学设计师，擅长用通俗的语言和生动的例子讲解概念。';

    switch (stage) {
      case 'SEGMENT_1':
        prompt = SEGMENT_1_PROMPT
          .replace('{topic}', topic)
          .replace('{description}', description)
          .replace('{userResponse}', userResponses)
          .replace('{userLevel}', userLevel);
        break;
      case 'SEGMENT_2':
        prompt = SEGMENT_2_PROMPT
          .replace('{topic}', topic)
          .replace('{previousContent}', previousContent)
          .replace('{userResponses}', userResponses);
        break;
      case 'SEGMENT_3':
        prompt = SEGMENT_3_PROMPT
          .replace('{topic}', topic)
          .replace('{previousContent}', previousContent)
          .replace('{userResponses}', userResponses);
        break;
      case 'CHECK':
        return {
          stage: 'CHECK',
          content: '## 📝 理解检查\n\n现在，请用你自己的话总结一下今天学到的内容。不用太长，把最核心的几点说出来就行。',
          thinkingPause: {
            question: '请用自己的话总结今天学到的内容',
            type: 'open',
          },
        };
      default:
        return {
          stage,
          content: `## 继续学习\n\n让我们继续探索 ${topic} 的更多内容。`,
        };
    }

    try {
      const response = await this.callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ], { temperature: 0.7, maxTokens: 800 });

      const content = response.content.trim();

      const segment: ContentSegment = {
        stage,
        content,
        thinkingPause: stage === 'SEGMENT_2' ? {
          question: '你觉得上面的内容里，哪个例子让你印象最深？',
          type: 'open',
        } : undefined,
      };

      return segment;
    } catch (error) {
      logger.error(`[${this.id}] 生成内容段落失败:`, error);
      return {
        stage,
        content: `## ${this.getStageTitle(stage)}\n\n抱歉，内容生成遇到了问题。让我们直接进入下一个环节。`,
      };
    }
  }

  private async assessUnderstanding(
    response: string,
    keyConcepts: string[],
    topic: string
  ): Promise<UnderstandingAssessment> {
    try {
      const prompt = UNDERSTANDING_CHECK_PROMPT
        .replace('{keyConcepts}', keyConcepts.join(', '))
        .replace('{topic}', topic)
        .replace('{userResponse}', response);

      const aiResponse = await this.callAI([
        { role: 'system', content: '你是一位教育评估专家，负责客观评估学生的理解程度。只返回 JSON 格式的结果。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });

      const result = this.parseJSON<UnderstandingAssessment>(aiResponse.content);

      return {
        level: result.level || 'vague',
        feedback: result.feedback || '感谢你的回答。',
        needReview: result.needReview ?? false,
        keyPointsMissed: result.keyPointsMissed,
        strengths: result.strengths,
      };
    } catch (error) {
      logger.error(`[${this.id}] 评估理解程度失败:`, error);

      const hasKeyWords = keyConcepts.some(concept =>
        response.toLowerCase().includes(concept.toLowerCase())
      );

      return {
        level: hasKeyWords ? 'passed' : 'vague',
        feedback: hasKeyWords
          ? '你提到了一些关键概念，继续保持！'
          : '也许你可以再多想想这个主题的核心要点是什么？',
        needReview: !hasKeyWords,
      };
    }
  }

  private getNextStage(currentStage: InteractiveStage): InteractiveStage | null {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) {
      return null;
    }
    return STAGE_ORDER[currentIndex + 1];
  }

  private getStageTitle(stage: InteractiveStage): string {
    const titles: Record<InteractiveStage, string> = {
      ACTIVATION: '🎯 激活认知',
      SEGMENT_1: '📚 核心概念',
      SEGMENT_2: '🔍 深入理解',
      SEGMENT_3: '💡 实战应用',
      CHECK: '📝 理解检查',
    };
    return titles[stage];
  }

  private detectCategory(topic: string): string {
    const topicLower = topic.toLowerCase();
    if (topicLower.includes('管理') || topicLower.includes('management')) return 'management';
    if (topicLower.includes('编程') || topicLower.includes('programming') || topicLower.includes('代码')) return 'programming';
    if (topicLower.includes('数据') || topicLower.includes('data')) return 'data';
    if (topicLower.includes('设计') || topicLower.includes('design')) return 'design';
    return 'default';
  }

  private getKeyConcepts(topic: string): string[] {
    const categoryKey = this.detectCategory(topic);
    return KEY_CONCEPTS_MAP[categoryKey] || KEY_CONCEPTS_MAP.default;
  }

  private extractLearningProfile(session: InteractiveSession, response: string): void {
    if (response.includes('例子') || response.includes('场景')) {
      session.learningProfile.preferredExamples.push('concrete-examples');
    }
    if (response.includes('不太清楚') || response.includes('不了解')) {
      session.learningProfile.painPoints.push('概念模糊');
    }
  }

  private async getUserLevel(userId: string): Promise<string> {
    try {
      const baselineStats = await studentBaselineService.getBaselineStats(userId);
      if (!baselineStats.isStable) {
        return 'beginner';
      }

      const state = await learningStateService.getCurrentState(userId);
      if (!state) {
        return 'beginner';
      }

      if (state.ktl > 7) return 'advanced';
      if (state.ktl > 4) return 'intermediate';
      return 'beginner';
    } catch {
      return 'beginner';
    }
  }

  private async saveSessionResult(
    session: InteractiveSession,
    assessment: UnderstandingAssessment
  ): Promise<void> {
    try {
      await prisma.agent_call_logs.create({
        data: {
          id: uuidv4(),
          agentId: this.id,
          userId: session.userId,
          input: JSON.stringify({
            taskId: session.taskId,
            topic: session.taskInfo?.topic,
          }),
          output: JSON.stringify({
            understandingScore: session.understandingScore,
            assessment,
            stageCount: session.segments.length,
          }),
          success: true,
          durationMs: 0,
          calledAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn(`[${this.id}] 保存会话结果失败:`, error);
    }
  }

  getSession(sessionId: string): InteractiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export default new InteractiveContentAgent();