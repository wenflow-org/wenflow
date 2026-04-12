/**
 * AI Teaching Orchestrator - AI 原生授课协调器
 * 
 * 职责：
 * 1. 调用认知分析 Agent 进行实时分析
 * 2. 调用统一 AI 生成响应（包含分析、策略、知识点）
 * 3. 采集对话数据
 * 4. 会话结束时计算 LSS 指标
 */

import { logger } from '../../utils/logger';
import learningStateService, {
  LearningStateMetrics,
  LSSInputs,
  DialogueAnalysis,
} from '../learning/learning-state.service';
import CognitiveAnalysisAgent, { CognitiveAnalysisResult } from '../../agents/standard/CognitiveAnalysisAgent';
import { peerAgent } from '../../agents/peer-agent';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import prisma from '../../config/database';
import { summaryAgent, type SummaryOutput } from '../../agents/summary-agent';
import { sessionEvaluationAgent } from '../../agents/session-evaluation-agent';

export type TeachingMode = 'tutor' | 'peer' | 'debate';

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingSession {
  sessionId: string;
  userId: string;
  subject: string;
  topic: string;
  startTime: Date;
  mode: TeachingMode;
  taskType: 'reading' | 'practice' | 'project' | 'quiz';
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    analysis?: CognitiveAnalysisResult;
  }>;
  currentState?: LearningStateMetrics;
  consecutiveErrors: number;
  lastActivity: Date;
  knowledgePoints: KnowledgePointStatus[];
  userProfile?: any;
}

export interface TeachingContext {
  userId: string;
  sessionId: string;
  subject: string;
  topic: string;
  difficulty: number;
  taskType?: 'reading' | 'practice' | 'project' | 'quiz';
  mode?: TeachingMode;
  taskId?: string;
}

export class AITeachingOrchestrator {
  private sessions: Map<string, TeachingSession> = new Map();
  private peerMessages: Map<string, Array<{role: string, content: string}>> = new Map();
  private cognitiveAgent: CognitiveAnalysisAgent;
  private idleTimeoutMs = 30 * 60 * 1000;

  constructor() {
    this.cognitiveAgent = new CognitiveAnalysisAgent();
    setInterval(() => this.checkIdleSessions(), 60 * 1000);
  }

  /**
   * 判断是否需要触发伴学
   * 改进：加入上下文判断，避免误触发
   */
  private shouldTriggerPeer(
    analysis: CognitiveAnalysisResult, 
    consecutiveErrors: number,
    session: TeachingSession,
    studentMessage: string
  ): boolean {
    const messageCount = session.messages.filter(m => m.role === 'user').length;
    
    // 条件 0: 轮次条件 - 至少 3 轮对话后才考虑触发
    // 刚开始学习时理解度低是正常的
    if (messageCount < 3) {
      return false;
    }

    // 条件 1: 学生主动求助（最高优先级）
    const helpKeywords = ['不懂', '不会', '为什么', '怎么', '帮助', '请教', '不明白', '不理解', '搞不懂', '不理解'];
    if (helpKeywords.some(kw => studentMessage.includes(kw))) {
      logger.info(`[AITeaching] 学生主动求助，触发伴学`);
      return true;
    }

    // 条件 2: 连续错误 ≥ 2 次（且不是刚开始）
    if (consecutiveErrors >= 2) {
      logger.info(`[AITeaching] 连续错误 ${consecutiveErrors} 次，触发伴学`);
      return true;
    }

    // 条件 3: 理解度持续低（连续 2 轮 < 0.4，且轮次 > 3）
    const recentAnalyses = session.messages
      .filter(m => m.role === 'assistant' && m.analysis)
      .slice(-2)
      .map(m => m.analysis!);
    
    if (recentAnalyses.length >= 2) {
      const avgUnderstanding = recentAnalyses.reduce((sum, a) => sum + a.understanding, 0) / recentAnalyses.length;
      if (avgUnderstanding < 0.4 && analysis.understanding < 0.4) {
        logger.info(`[AITeaching] 理解度持续低 (${avgUnderstanding.toFixed(2)})，触发伴学`);
        return true;
      }
    }

    // 条件 4: 理解度下降趋势（从高到低，说明遇到困难）
    if (recentAnalyses.length >= 2) {
      const prevUnderstanding = recentAnalyses[recentAnalyses.length - 2]?.understanding || 0.5;
      const currUnderstanding = analysis.understanding;
      if (prevUnderstanding > 0.6 && currUnderstanding < 0.4) {
        logger.info(`[AITeaching] 理解度下降 (${prevUnderstanding.toFixed(2)} -> ${currUnderstanding.toFixed(2)})，触发伴学`);
        return true;
      }
    }

    return false;
  }

  /**
   * 选择伴学策略
   */
  private selectPeerStrategy(analysis: CognitiveAnalysisResult, consecutiveErrors: number): 'feynman' | 'debate' | 'counterexample' | 'analogy' | 'error-analysis' {
    if (consecutiveErrors >= 2) {
      return 'error-analysis';
    }

    if (analysis.understanding < 0.4) {
      return 'feynman';
    }

    if (analysis.cognitiveLevel === 'remember') {
      return 'analogy';
    }

    if (analysis.confusionPoints.length > 0) {
      return 'debate';
    }

    return 'counterexample';
  }

  private extractAnalysis(content: string): CognitiveAnalysisResult {
    const match = content.match(/<analysis>\s*({.*?})\s*<\/analysis>/s);
    if (!match) return this.getDefaultAnalysis();
    try {
      const parsed = JSON.parse(match[1]);
      return {
        cognitiveLevel: parsed.cognitiveLevel || 'understand',
        levelScore: parsed.levelScore || 2,
        understanding: parsed.understanding || 0.5,
        confusionPoints: Array.isArray(parsed.confusionPoints) ? parsed.confusionPoints : [],
        engagement: parsed.engagement || 0.5,
        emotionalState: parsed.emotionalState || 'neutral',
        knowledgeGaps: Array.isArray(parsed.knowledgeGaps) ? parsed.knowledgeGaps : [],
        learningStyle: parsed.learningStyle || 'mixed',
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      };
    } catch {
      return this.getDefaultAnalysis();
    }
  }

  private extractStrategies(content: string): string[] {
    const match = content.match(/<strategies>\s*(\[.*?\])\s*<\/strategies>/s);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private extractKnowledgePoint(content: string): string | null {
    const match = content.match(/<kp>(.+?)<\/kp>/s);
    return match ? match[1].trim() : null;
  }

  private cleanResponse(content: string): string {
    return content
      .replace(/<analysis>\s*{.*?}\s*<\/analysis>/gs, '')
      .replace(/<strategies>\s*\[.*?\]\s*<\/strategies>/gs, '')
      .replace(/<kp>.+?<\/kp>/gs, '')
      .replace(/<knowledge_points>[\s\S]*?<\/knowledge_points>/gs, '')
      .replace(/<completion>.+?<\/completion>/gs, '')
      .replace(/<\s*\/?\s*course_complete\b[^>]*>/gi, '')
      .trim();
  }

  private extractKnowledgePoints(content: string): KnowledgePointStatus[] {
    const match = content.match(/<knowledge_points>\s*(\[.*?\])\s*<\/knowledge_points>/s);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item: any) => ({
        name: item.name || '',
        status: ['pending', 'learning', 'mastered', 'review'].includes(item.status) ? item.status : 'pending',
        progress: Math.max(0, Math.min(100, item.progress || 0)),
      }));
    } catch {
      return [];
    }
  }

  private updateKnowledgePoints(
    existing: KnowledgePointStatus[],
    incoming: KnowledgePointStatus[],
    analysis: CognitiveAnalysisResult
  ): KnowledgePointStatus[] {
    if (incoming.length === 0) return existing;

    const updated = [...existing];
    for (const incomingKp of incoming) {
      const existingIdx = updated.findIndex(kp => kp.name === incomingKp.name);
      if (existingIdx >= 0) {
        if (incomingKp.status === 'mastered') {
          updated[existingIdx] = { ...incomingKp };
        } else if (incomingKp.status === 'learning') {
          updated[existingIdx] = { ...incomingKp, progress: Math.max(updated[existingIdx].progress, incomingKp.progress) };
        } else if (incomingKp.status === 'review' && updated[existingIdx].status !== 'mastered') {
          updated[existingIdx] = { ...incomingKp };
        }
      } else {
        updated.push(incomingKp);
      }
    }
    return updated;
  }

  async startSession(context: TeachingContext): Promise<TeachingSession & { welcomeMessage: string }> {
    const session: TeachingSession = {
      sessionId: context.sessionId,
      userId: context.userId,
      subject: context.subject,
      topic: context.topic,
      startTime: new Date(),
      mode: context.mode || 'tutor',
      taskType: context.taskType || 'practice',
      messages: [],
      consecutiveErrors: 0,
      lastActivity: new Date(),
      knowledgePoints: [],
    };

    try {
      const goalConv = await prisma.goal_conversations.findFirst({
        where: { userId: context.userId },
        orderBy: { createdAt: 'desc' },
      });
      if (goalConv?.collectedData) {
        const data = JSON.parse(goalConv.collectedData);
        session.userProfile = data.understanding || {};
      }
    } catch (error) {
      logger.warn(`[AITeaching] 获取用户 Profile 失败：${error}`);
    }

    this.sessions.set(context.sessionId, session);

    const currentState = await learningStateService.getCurrentState(context.userId);
    if (currentState) {
      session.currentState = currentState;
    }

    const welcomeMessage = await this.generateWelcomeMessage(session);

    session.messages.push({
      role: 'assistant',
      content: welcomeMessage,
      timestamp: new Date(),
    });

    try {
      await prisma.learning_sessions.create({
        data: {
          id: context.sessionId,
          userId: context.userId,
          goalId: context.subject,
          taskId: context.taskId || context.topic,
          messages: JSON.stringify(session.messages),
          state: JSON.stringify({ ...(currentState || {}), knowledgePoints: session.knowledgePoints }),
          status: 'active',
        },
      });
      logger.info(`[AITeaching] 会话已持久化到 DB: ${context.sessionId}, taskId: ${context.taskId || 'none'}`);
    } catch (error) {
      logger.error(`[AITeaching] 会话持久化失败：${error}`);
    }

    logger.info(`[AITeaching] 会话开始：${context.sessionId}, 用户：${context.userId}, 模式：${session.mode}`);

    return { ...session, welcomeMessage };
  }

  private async restoreSessionFromDB(sessionId: string): Promise<TeachingSession | null> {
    try {
      const dbSession = await prisma.learning_sessions.findUnique({
        where: { id: sessionId },
      });

      if (!dbSession || dbSession.status !== 'active') {
        logger.warn(`[AITeaching] 会话恢复失败：${sessionId} 不存在或状态为 ${dbSession?.status || 'unknown'}`);
        return null;
      }

      let messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        analysis?: CognitiveAnalysisResult;
      }> = [];
      try {
        messages = dbSession.messages ? JSON.parse(dbSession.messages) : [];
        messages = messages.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      } catch (error) {
        logger.error(`[AITeaching] 消息解析失败：${error}`);
        messages = [];
      }

      let stateData: any = {};
      try {
        stateData = dbSession.state ? JSON.parse(dbSession.state) : {};
      } catch (error) {
        logger.error(`[AITeaching] 状态解析失败：${error}`);
      }

      const knowledgePoints: KnowledgePointStatus[] = Array.isArray(stateData.knowledgePoints)
        ? stateData.knowledgePoints
        : [];

      let userProfile: any = undefined;
      try {
        const goalConv = await prisma.goal_conversations.findFirst({
          where: { userId: dbSession.userId },
          orderBy: { createdAt: 'desc' },
        });
        if (goalConv?.collectedData) {
          const data = JSON.parse(goalConv.collectedData);
          userProfile = data.understanding || {};
        }
      } catch (error) {
        logger.warn(`[AITeaching] 恢复用户 Profile 失败：${error}`);
      }

      const session: TeachingSession = {
        sessionId: dbSession.id,
        userId: dbSession.userId,
        subject: dbSession.goalId || '',
        topic: dbSession.taskId || '',
        startTime: dbSession.startTime,
        mode: 'tutor',
        taskType: 'practice',
        messages,
        currentState: stateData,
        consecutiveErrors: 0,
        lastActivity: new Date(),
        knowledgePoints,
        userProfile,
      };

      this.sessions.set(sessionId, session);

      logger.info(`[AITeaching] 会话已从数据库恢复：${sessionId}, 消息数：${messages.length}`);

      return session;
    } catch (error) {
      logger.error(`[AITeaching] 会话恢复异常：${error}`);
      return null;
    }
  }

  private async generateWelcomeMessage(session: TeachingSession): Promise<string> {
    const systemPrompt = `你是一位经验丰富的 AI 教师。现在要开始一堂新课。
请生成一段开场白，要求：
1. 用"先行组织者"策略：先给出高层次框架，让新知识有地方挂靠
2. 简要说明今天学习什么、为什么重要、和已有知识的联系
3. 提出一个引导性问题，激发思考
4. 语气亲切专业，不要过于正式
5. 使用 Markdown 格式，适当加粗重点
6. 控制在 200 字以内`;

    try {
      const client = getOpenAIClient();
      const response = await client.chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `学科：${session.subject}\n主题：${session.topic}\n请生成开场白。` },
        ],
        temperature: 0.8,
        max_tokens: 500,
      });

      return response.choices[0]?.message.content || this.getDefaultWelcome(session);
    } catch (error) {
      logger.error(`[AITeaching] 欢迎词生成失败：${error}`);
      return this.getDefaultWelcome(session);
    }
  }

  private getDefaultWelcome(session: TeachingSession): string {
    return `欢迎来到 **${session.subject}** 课堂！\n\n今天我们学习的主题是：**${session.topic}**\n\n请随时提问或回答我的问题，我会根据你的学习状态调整教学方式。`;
  }

  private generateProfileEnhancement(profile: any): string {
    if (!profile) return '';

    const parts: string[] = [];

    const learningStyle = profile.learning_style;
    if (learningStyle?.preferred_format) {
      const formatMap: Record<string, string> = {
        'video': '视频示例和演示',
        'reading': '文字说明和阅读材料',
        'practice': '动手练习和实战项目',
        'mixed': '多种形式结合',
      };
      parts.push(`- 学习者偏好 **${learningStyle.preferred_format}**，请多使用${formatMap[learningStyle.preferred_format] || '多种形式'}`);
    }

    if (profile.cognitive_profile?.metacognition_level) {
      const metaMap: Record<string, string> = {
        'high': '较高，可以提出反思性问题促进深度思考',
        'medium': '中等，适时引导元认知反思',
        'low': '待提升，多提供结构化总结和明确的思考框架',
      };
      parts.push(`- 学习者元认知能力 **${profile.cognitive_profile.metacognition_level}**，${metaMap[profile.cognitive_profile.metacognition_level] || ''}`);
    }

    if (profile.emotional_profile?.confidence_level) {
      const confidenceMap: Record<string, string> = {
        'confident': '较高，可以直接挑战更高难度',
        'moderate': '中等，给予适度鼓励和正向反馈',
        'anxious': '较低，多给予鼓励和安全感，降低初始难度',
      };
      parts.push(`- 学习者自信心 **${profile.emotional_profile.confidence_level}**，${confidenceMap[profile.emotional_profile.confidence_level] || ''}`);
    }

    if (learningStyle?.theory_vs_practice) {
      const approachMap: Record<string, string> = {
        'theory-first': '先讲解理论原理，再展示应用',
        'practice-first': '先从实践入手，再归纳理论',
        'balanced': '理论与实践交替进行',
      };
      parts.push(`- 学习者偏好 **${learningStyle.theory_vs_practice}**，请${approachMap[learningStyle.theory_vs_practice] || '灵活调整'}`);
    }

    if (parts.length === 0) return '';

    return `\n【个性化教学要求】\n${parts.join('\n')}`;
  }

  async processStudentMessage(
    sessionId: string,
    message: string,
    lssInputs?: Partial<LSSInputs>
  ): Promise<{
    analysis: CognitiveAnalysisResult;
    aiResponse: string;
    strategies: string[];
    knowledgePoint: string | null;
    knowledgePoints: KnowledgePointStatus[];
    isCompletion: boolean;
    currentState: LearningStateMetrics;
    peerTriggered: boolean;
    peerMessage?: string;
  }> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.restoreSessionFromDB(sessionId);
      if (!session) {
        throw new Error('会话不存在或已结束，请重新开始授课');
      }
    }

    session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    session.lastActivity = new Date();

    const { aiResponse, strategies, knowledgePoint, knowledgePoints, isCompletion, analysis } = await this.generateResponse(
      message,
      session
    );

    if (analysis.emotionalState === 'frustrated' || analysis.understanding < 0.3) {
      session.consecutiveErrors++;
    } else {
      session.consecutiveErrors = 0;
    }

    session.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date(),
      analysis: analysis,
    });

    // 判断是否需要触发伴学
    let peerMessage: string | undefined;
    let triggerPeer = this.shouldTriggerPeer(analysis, session.consecutiveErrors, session, message);
    if (triggerPeer) {
      const strategy = this.selectPeerStrategy(analysis, session.consecutiveErrors);
      const tutorContext = session.messages.filter(m => m.role === 'assistant').slice(-5).map(m => ({ role: m.role, content: m.content }));
      
      try {
        const peerResult = await peerAgent.discuss({
          topic: session.topic,
          strategy,
          studentMessage: message,
          tutorContext,
          cognitiveLevel: analysis.cognitiveLevel,
          understanding: analysis.understanding,
        });

        peerMessage = peerResult.message;

        // 插入同伴消息
        session.messages.push({
          role: 'peer' as any,
          content: peerMessage,
          timestamp: new Date(),
        });

        logger.info(`[AITeaching] 触发伴学：sessionId=${sessionId}, strategy=${strategy}`);
      } catch (error: any) {
        logger.error(`[AITeaching] 同伴消息生成失败：${error.message}`);
        // 同伴消息生成失败，不触发伴学
        triggerPeer = false;
      }
    }

    const lssInput: LSSInputs = {
      difficulty: analysis.cognitiveLevel === 'remember' ? 3 : analysis.cognitiveLevel === 'understand' ? 4 : analysis.cognitiveLevel === 'apply' ? 5 : analysis.cognitiveLevel === 'analyze' ? 6 : analysis.cognitiveLevel === 'evaluate' ? 7 : 8,
      cognitiveLoad: Math.min(10, (analysis.levelScore || 2) * 1.5 * (1 - analysis.understanding + 0.5)),
      efficiency: analysis.engagement || 0.5,
      timeSpent: 1,
      expectedTime: 15,
      completionRate: 1.0,
      taskType: session.taskType,
    };

    const currentState = await learningStateService.calculateAndUpdate(
      session.userId,
      lssInput
    );

    try {
      await prisma.learning_sessions.update({
        where: { id: sessionId },
        data: {
          messages: JSON.stringify(session.messages),
          state: JSON.stringify({ ...currentState, knowledgePoints: session.knowledgePoints }),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error(`[AITeaching] 消息持久化失败：${error}`);
    }

    logger.info(`[AITeaching] 消息处理完成：${sessionId}, 策略：${strategies.join(', ') || 'none'}`);

    return {
      analysis,
      aiResponse,
      strategies,
      knowledgePoint,
      knowledgePoints,
      isCompletion,
      currentState,
      peerTriggered: triggerPeer,
      peerMessage: peerMessage,
    };
  }

  private async generateResponse(
    studentMessage: string,
    session: TeachingSession
  ): Promise<{ aiResponse: string; strategies: string[]; knowledgePoint: string | null; knowledgePoints: KnowledgePointStatus[]; isCompletion: boolean; analysis: CognitiveAnalysisResult }> {
    const modePrompts: Record<TeachingMode, string> = {
      tutor: `你是 AI 导师，负责讲解和指导。根据学生的认知水平和情绪状态调整你的教学方式。`,
      peer: `你是学习伙伴，和学生一起探索问题。语气平等，像同学讨论，不要直接给答案。`,
      debate: `你是辩论对手，通过提出反方观点和挑战性问题来帮助学生深化理解。保持尊重但敢于质疑。`,
    };

    const profileEnhancement = this.generateProfileEnhancement(session.userProfile);

    const topicBoundary = `
【主题边界】
你正在教授"${session.subject} - ${session.topic}"课程。
只讨论与当前主题直接相关的内容。
如果学生提问偏离主题，礼貌地引导回当前知识点。
不要展开与当前知识点无关的延伸内容。`;

    const knowledgePointRules = `
【知识点管理规则】
- 知识点状态：pending（未开始）、learning（学习中）、mastered（已掌握）、review（需要复习）
- 进度规则：
  * 首次提及某个概念：progress = 20%，status = learning
  * 详细讲解中（学生提问或练习）：progress += 20-30%
  * 学生理解（回答正确或应用）：progress += 30%
  * 完全掌握：progress = 100%，status = mastered
- 必须在每次回复中输出完整的知识点列表，包括已经掌握的和正在学习的
- 示例：<knowledge_points>[{"name":"数据获取渠道","status":"learning","progress":60},{"name":"关键指标分析","status":"pending","progress":0}]</knowledge_points>

【课程完成判定】
- 当所有知识点都已讲解完毕，且学生理解良好时，在回复末尾输出：<course_complete/>
- 不要在 completion 标签中输出总结内容，只输出空标记即可
- 示例回复末尾：
  ...教学内容...
  <knowledge_points>[{"name":"xxx","status":"mastered","progress":100}]</knowledge_points>
  <course_complete/>`;

    const systemPrompt = `${modePrompts[session.mode]}
当前主题：${session.subject} - ${session.topic}
${session.knowledgePoints.length > 0 ? `当前知识点状态:\n${JSON.stringify(session.knowledgePoints)}` : ''}
${profileEnhancement}
${topicBoundary}
${knowledgePointRules}

【教学原则】
- 一个主题包含多个知识点，知识点之间自然过渡
- 每讲完一个知识点，用 <kp>知识点名称</kp> 标签标注
- 学生可以随时中断学习（关浏览器、离开），下次回来可以继续
- 如果检测到学生疲劳或困惑严重，可以建议短暂休息，但不要建议结束整个主题
- 回复用 Markdown 格式，适当使用加粗、列表、代码块
- 不要偏离主题${session.topic}，如果学生提问无关内容，礼貌引导回主题

请在回复中依次输出以下结构化标签：
1. <analysis>{"cognitiveLevel":"understand|apply|analyze|evaluate|create","levelScore":1-6,"understanding":0-1,"confusionPoints":[],"engagement":0-1,"emotionalState":"positive|neutral|frustrated|confused"}</analysis>
2. <kp>当前知识点名称</kp>（如果讲完了一个知识点）
3. <knowledge_points>[{"name":"知识点名称","status":"pending|learning|mastered|review","progress":0-100}]</knowledge_points>（所有知识点状态）
4. <course_complete/>（仅当所有知识点已掌握时输出）
5. <strategies>["strategy1", "strategy2"]</strategies>（使用的教学策略）
可用策略：socratic-questioning, analogy, example, decomposition, visualization, storytelling, challenge, reflection, scaffolding, direct-instruction`;

    const historyMessages: ChatMessage[] = session.messages
      .slice(-10)
      .filter((m: any) => m.role !== 'peer')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    try {
      const client = getOpenAIClient();
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
      ];

      const response = await client.chatCompletion({
        messages,
        temperature: 0.4,
        max_tokens: 8000,
      });

      const rawContent = response.choices[0]?.message.content || '';
      const strategies = this.extractStrategies(rawContent);
      const knowledgePoint = this.extractKnowledgePoint(rawContent);
      const incomingKnowledgePoints = this.extractKnowledgePoints(rawContent);
      const isCompletion = /<\s*\/?\s*course_complete\b[^>]*>/i.test(rawContent);
      const analysis = this.extractAnalysis(rawContent);
      const cleanedContent = this.cleanResponse(rawContent);

      const updatedKnowledgePoints = this.updateKnowledgePoints(
        session.knowledgePoints,
        incomingKnowledgePoints,
        analysis
      );
      session.knowledgePoints = updatedKnowledgePoints;

      return { aiResponse: cleanedContent, strategies, knowledgePoint, knowledgePoints: updatedKnowledgePoints, isCompletion, analysis };
    } catch (error) {
      logger.error(`[AITeaching] AI 响应生成失败：${error}`);
      throw new Error('AI_TEACHING_RESPONSE_FAILED');
    }
  }

  private generateDefaultResponse(
    message: string,
    analysis: CognitiveAnalysisResult,
    session: TeachingSession
  ): string {
    const levelResponses: Record<string, string> = {
      remember: `关于${session.topic}的基本概念，${message.includes('?') ? '你问得很好。' : ''}记住关键是...`,
      understand: `理解了你的问题。${session.topic}的核心在于...`,
      apply: `实践是检验理解的好方法。你可以尝试...`,
      analyze: `你的分析思路很好。让我们深入看看...`,
      evaluate: `这是个值得评估的问题。从多个角度来看...`,
      create: `很有创意的想法！如果要实现它，我们需要...`,
    };

    return levelResponses[analysis.cognitiveLevel] || `好的，让我们继续学习${session.topic}。`;
  }

  private estimateDifficulty(analysis: CognitiveAnalysisResult): number {
    const levelScores: Record<string, number> = {
      remember: 3,
      understand: 4,
      apply: 5,
      analyze: 6,
      evaluate: 7,
      create: 8,
    };

    return levelScores[analysis.cognitiveLevel] || 5;
  }

  private calculateCognitiveLoad(analysis: CognitiveAnalysisResult): number {
    const baseLoad = analysis.levelScore * 1.5;
    const confusionBonus = analysis.confusionPoints.length * 0.5;
    return Math.min(10, baseLoad + confusionBonus);
  }

  private calculateEfficiency(analysis: CognitiveAnalysisResult): number {
    return (analysis.understanding * 0.7 + analysis.engagement * 0.3);
  }

  private getDefaultAnalysis(): CognitiveAnalysisResult {
    return {
      cognitiveLevel: 'understand' as any,
      levelScore: 2,
      understanding: 0.5,
      confusionPoints: [],
      engagement: 0.5,
      emotionalState: 'neutral',
      knowledgeGaps: [],
      learningStyle: 'mixed',
      topics: [],
      questions: [],
    };
  }

  getSession(sessionId: string): TeachingSession | undefined {
    return this.sessions.get(sessionId);
  }

  async setMode(sessionId: string, mode: TeachingMode): Promise<TeachingSession> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.restoreSessionFromDB(sessionId);
      if (!session) {
        throw new Error('会话不存在或已结束');
      }
    }
    session.mode = mode;
    logger.info(`[AITeaching] 会话模式已切换：${sessionId}, 新模式：${mode}`);
    return session;
  }

  async evaluateSession(sessionId: string): Promise<{
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
    sessionLss: number;
    sessionKtl: number;
    sessionLf: number;
    confidence: number;
    evaluationSource: 'model';
    messageCount: number;
    avgUnderstanding: number;
    avgCognitiveLevel: string;
    duration: number;
  }> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.restoreSessionFromDB(sessionId);
      if (!session) {
        throw new Error('会话不存在或已结束');
      }
    }

    const durationSeconds = Math.floor(
      (new Date().getTime() - session.startTime.getTime()) / 1000
    );
    const duration = Math.max(1, Math.round(durationSeconds / 60));

    const assistantMessages = session.messages.filter(m => m.role === 'assistant');
    // 排除欢迎消息（第一条 assistant 消息），因为它是 AI 生成的开场白，不是真实的教学交互
    const teachingMessages = assistantMessages.slice(1);
    const analyses: Array<{
      cognitiveLevel: string;
      levelScore: number;
      understanding: number;
      engagement: number;
    }> = [];

    for (const msg of teachingMessages) {
      const analysis = (msg as any).analysis || this.extractAnalysis(msg.content);
      if (analysis.cognitiveLevel && analysis.understanding !== undefined) {
        analyses.push({
          cognitiveLevel: analysis.cognitiveLevel,
          levelScore: analysis.levelScore || 2,
          understanding: analysis.understanding,
          engagement: analysis.engagement || 0.5,
        });
      }
    }

    const messageCount = analyses.length;
    const avgUnderstanding = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + a.understanding, 0) / analyses.length
      : 0.5;

    const levelCounts: Record<string, number> = {};
    for (const a of analyses) {
      levelCounts[a.cognitiveLevel] = (levelCounts[a.cognitiveLevel] || 0) + 1;
    }
    let avgCognitiveLevel = 'understand';
    let maxCount = 0;
    for (const [level, count] of Object.entries(levelCounts)) {
      if (count > maxCount) {
        maxCount = count;
        avgCognitiveLevel = level;
      }
    }

    const avgEngagement = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + a.engagement, 0) / analyses.length
      : 0.5;

    const levelScores: Record<string, number> = {
      remember: 3,
      understand: 4,
      apply: 5,
      analyze: 6,
      evaluate: 7,
      create: 8,
    };
    const evaluationResult = await sessionEvaluationAgent.evaluate({
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      knowledgePoints: session.knowledgePoints,
      sessionInfo: {
        subject: session.subject,
        topic: session.topic,
        durationMinutes: duration,
        userMessageCount: session.messages.filter((message) => message.role === 'user').length,
        assistantMessageCount: session.messages.filter((message) => message.role === 'assistant').length,
      },
    });

    const sessionLss = evaluationResult.evaluation.sessionLss;
    const sessionKtl = evaluationResult.evaluation.sessionKtl;
    const sessionLf = evaluationResult.evaluation.sessionLf;
    const confidence = evaluationResult.evaluation.confidence;

    const finalState = await learningStateService.calculateAndUpdateFromSessionScore(
      session.userId,
      {
        sessionLss,
        durationMinutes: duration,
        confidence,
      }
    );

    session.currentState = finalState;

    const sessionStatePayload = {
      ...finalState,
      knowledgePoints: session.knowledgePoints,
      sessionLss,
      sessionKtl,
      sessionLf,
      evaluationConfidence: confidence,
      evaluationSource: evaluationResult.source,
      evaluationReasoning: evaluationResult.evaluation.reasoning,
    };

    await prisma.learning_sessions.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        endTime: new Date(),
        duration,
        messages: JSON.stringify(session.messages),
        state: JSON.stringify(sessionStatePayload),
        updatedAt: new Date(),
      },
    });
    logger.info(
      `[AITeaching] 会话评估完成：${sessionId}, source=${evaluationResult.source}, sessionLss=${sessionLss.toFixed(2)}, confidence=${confidence.toFixed(2)}, LSB=${finalState.lsb.toFixed(2)}`
    );

    return {
      lss: finalState.lss,
      ktl: finalState.ktl,
      lf: finalState.lf,
      lsb: finalState.lsb,
      sessionLss,
      sessionKtl,
      sessionLf,
      confidence,
      evaluationSource: evaluationResult.source,
      messageCount,
      avgUnderstanding,
      avgCognitiveLevel,
      duration,
    };
  }

  async endSession(sessionId: string): Promise<{
    summary: SummaryOutput;
    summarySource: 'model' | 'fallback';
    finalState: LearningStateMetrics | null;
    duration: number;
    evaluation?: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
      sessionLss: number;
      sessionKtl: number;
      sessionLf: number;
      confidence: number;
      evaluationSource: 'model';
      messageCount: number;
      avgUnderstanding: number;
      avgCognitiveLevel: string;
      duration: number;
    };
  }> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.restoreSessionFromDB(sessionId);
      if (!session) {
        throw new Error('会话不存在或已结束');
      }
    }

    const durationSeconds = Math.floor(
      (new Date().getTime() - session.startTime.getTime()) / 1000
    );
    const duration = Math.max(1, Math.round(durationSeconds / 60));

    let evaluation: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
      sessionLss: number;
      sessionKtl: number;
      sessionLf: number;
      confidence: number;
      evaluationSource: 'model';
      messageCount: number;
      avgUnderstanding: number;
      avgCognitiveLevel: string;
      duration: number;
    } | undefined;

    try {
      evaluation = await this.evaluateSession(sessionId);
    } catch (error) {
      logger.error(`[AITeaching] 会话评估失败：${error}`);
    }

    let summary: SummaryOutput;
    let summarySource: 'model' | 'fallback' = 'fallback';
    try {
      const summaryResult = await summaryAgent.generate({
        messages: session.messages,
        knowledgePoints: session.knowledgePoints,
        learningState: evaluation ? {
          lss: evaluation.lss,
          ktl: evaluation.ktl,
          lf: evaluation.lf,
          lsb: evaluation.lsb,
        } : undefined,
        sessionInfo: {
          subject: session.subject,
          topic: session.topic,
          duration,
          messageCount: session.messages.filter(m => m.role === 'user').length,
        },
      });
      summary = summaryResult.summary;
      summarySource = summaryResult.source;
      logger.info(`[AITeaching] 结构化总结生成成功：${sessionId}`);
    } catch (error) {
      logger.error(`[AITeaching] 结构化总结生成失败：${error}`);
      summary = this.buildFallbackSummary(session, evaluation, duration);
      summarySource = 'fallback';
      logger.warn(`[AITeaching] 使用兜底总结：${sessionId}`);
    }

    try {
      const dbSession = await prisma.learning_sessions.findUnique({
        where: { id: sessionId },
        select: { state: true },
      });

      let currentState: any = {};
      if (dbSession?.state) {
        try {
          currentState = JSON.parse(dbSession.state);
        } catch {
          currentState = {};
        }
      }

      await prisma.learning_sessions.update({
        where: { id: sessionId },
        data: {
          state: JSON.stringify({
            ...currentState,
            knowledgePoints: session.knowledgePoints,
            summary,
            summaryVersion: 'v2',
            summarySource,
          }),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error(`[AITeaching] 总结持久化失败：${error}`);
    }

    this.sessions.delete(sessionId);

    logger.info(`[AITeaching] 会话结束：${sessionId}, 时长：${duration}分钟`);

    return {
      summary,
      summarySource,
      finalState: session.currentState || null,
      duration,
      evaluation,
    };
  }

  async getSessionHistory(userId: string): Promise<Array<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messageCount: number;
  }>> {
    const sessions = await prisma.learning_sessions.findMany({
      where: {
        userId,
        goalId: { not: null },
      },
      orderBy: { startTime: 'desc' },
      take: 50,
    });

    const taskTitles = await Promise.all(
      sessions.map(async s => {
        if (!s.taskId) return null;
        try {
          const task = await prisma.subtasks.findUnique({
            where: { id: s.taskId },
            select: { title: true },
          });
          return task?.title || null;
        } catch {
          return null;
        }
      })
    );

    return sessions.map((s, index) => {
      let messages: any[] = [];
      try {
        messages = s.messages ? JSON.parse(s.messages) : [];
      } catch {}
      return {
        id: s.id,
        subject: s.goalId || '',
        topic: taskTitles[index] || s.taskId || '',
        taskId: s.taskId,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
        status: s.status,
        messageCount: messages.length,
      };
    });
  }

  async getSessionDetail(sessionId: string, userId: string): Promise<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messages: Array<{ role: string; content: string; timestamp: Date; analysis?: any }>;
    state: any;
    knowledgePoints?: any[];
  } | null> {
    const session = await prisma.learning_sessions.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) return null;

    let messages: any[] = [];
    let state: any = {};
    let knowledgePoints: any[] = [];
    let topic = session.taskId || '';
    try {
      messages = session.messages ? JSON.parse(session.messages) : [];
      state = session.state ? JSON.parse(session.state) : {};
      knowledgePoints = Array.isArray(state.knowledgePoints) ? state.knowledgePoints : [];
      if (session.taskId) {
        const task = await prisma.subtasks.findUnique({
          where: { id: session.taskId },
          select: { title: true },
        });
        topic = task?.title || topic;
      }
    } catch (error: any) {
      logger.error(`[AITeaching] 解析会话详情失败：${error.message}`);
      messages = [];
      state = {};
    }

    return {
      id: session.id,
      subject: session.goalId || '',
      topic,
      taskId: session.taskId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      status: session.status,
      messages,
      state,
      knowledgePoints,
    };
  }

  async getLatestTaskEvaluation(taskId: string, userId: string): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    endTime: Date | null;
    duration: number;
    messageCount: number;
    knowledgePoints: any[];
    summary: SummaryOutput;
    summarySource?: 'model' | 'fallback';
    evaluation: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
      sessionLss?: number;
      sessionKtl?: number;
      sessionLf?: number;
      confidence?: number;
      evaluationSource?: 'model';
      messageCount?: number;
      avgUnderstanding?: number;
      avgCognitiveLevel?: string;
      duration?: number;
    };
  } | null> {
    const session = await prisma.learning_sessions.findFirst({
      where: {
        userId,
        taskId,
        status: 'completed',
        id: { startsWith: 'teaching_' },
      },
      orderBy: { endTime: 'desc' },
    });

    if (!session) {
      return null;
    }

    let parsedState: any = {};
    let parsedMessages: Array<{ role: string }> = [];
    try {
      parsedState = session.state ? JSON.parse(session.state) : {};
    } catch {
      parsedState = {};
    }

    try {
      parsedMessages = session.messages ? JSON.parse(session.messages) : [];
    } catch {
      parsedMessages = [];
    }

    const summary = parsedState.summary;
    const knowledgePoints = Array.isArray(parsedState.knowledgePoints)
      ? parsedState.knowledgePoints
      : [];

    const normalizedSummary = this.normalizePersistedSummary(
      summary,
      knowledgePoints,
      session.goalId || '',
      session.taskId || '',
      session.duration || 0,
      parsedMessages.filter((m) => m.role === 'user').length,
    );

    if (!normalizedSummary) {
      return null;
    }

    const evaluation = {
      lss: Number(parsedState.lss || 0),
      ktl: Number(parsedState.ktl || 0),
      lf: Number(parsedState.lf || 0),
      lsb: Number(parsedState.lsb || 0),
      sessionLss: parsedState.sessionLss,
      sessionKtl: parsedState.sessionKtl,
      sessionLf: parsedState.sessionLf,
      confidence: parsedState.evaluationConfidence,
      evaluationSource: parsedState.evaluationSource,
      messageCount: parsedState.messageCount,
      avgUnderstanding: parsedState.avgUnderstanding,
      avgCognitiveLevel: parsedState.avgCognitiveLevel,
      duration: parsedState.duration,
    };

    let topic = session.taskId || '';
    if (session.taskId) {
      try {
        const task = await prisma.subtasks.findUnique({
          where: { id: session.taskId },
          select: { title: true },
        });
        topic = task?.title || topic;
      } catch {
        // ignore topic fallback failures
      }
    }

    return {
      sessionId: session.id,
      subject: session.goalId || '',
      topic,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration || 0,
      messageCount: parsedMessages.filter((m) => m.role === 'user').length,
      knowledgePoints,
      summary: normalizedSummary,
      summarySource: parsedState.summarySource,
      evaluation,
    };
  }

  private buildFallbackSummary(
    session: TeachingSession,
    evaluation: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
      sessionLss: number;
      sessionKtl: number;
      sessionLf: number;
      confidence: number;
      evaluationSource: 'model';
      messageCount: number;
      avgUnderstanding: number;
      avgCognitiveLevel: string;
      duration: number;
    } | undefined,
    duration: number,
  ): SummaryOutput {
    const mastered = session.knowledgePoints.filter((kp) => kp.status === 'mastered').length;
    const total = session.knowledgePoints.length;

    const knowledgeItems = session.knowledgePoints.map((kp) => ({
      name: kp.name,
      status: kp.status,
      progress: kp.progress,
      evidence: kp.status === 'mastered'
        ? `课堂中已通过问答验证“${kp.name}”的应用理解。`
        : `课堂中已覆盖“${kp.name}”，建议继续补充练习。`,
    }));

    const keyTakeaways = [
      `完成 ${mastered}/${total || 0} 个核心知识点学习目标。`,
      '能够将课堂框架迁移到真实场景进行分析。',
      '形成了下一步实践验证的明确动作清单。',
    ];

    const actionPlan = [
      '本周选 1 个真实账号，用课程框架完成一次完整拆解并记录结论。',
      '发布 1 次小范围测试内容，观察互动与私信反馈是否匹配预期。',
      '整理 10 条用户问题，按主题分组后提炼 2 个可收费的服务方向。',
    ];

    const strengths = [
      '课堂互动积极，能快速抓住关键结构。',
      '能把抽象概念转成可执行动作，迁移能力较好。',
    ];

    const improvements = [
      '建议增加跨案例对比，提升边界判断稳定性。',
      '建议补一轮课后复盘，验证方法在新场景的可复用性。',
    ];

    return {
      topicSummary: `本节课围绕“${session.topic}”完成系统学习，聚焦从内容价值到变现路径的转化逻辑。通过互动问答与案例拆解，已形成可复用的分析框架和下一步实践方向。`,
      knowledgeSummary: `本节课已完成 ${mastered}/${total || 0} 个知识点掌握，建议继续通过真实案例巩固迁移能力。`,
      practiceAdvice: actionPlan.map((item, index) => `${index + 1}. ${item}`).join('\n'),
      learningEvaluation: `亮点：${strengths.join('；')}。改进建议：${improvements.join('；')}。`,
      knowledgeItems,
      keyTakeaways,
      actionPlan,
      evaluationHighlights: {
        strengths,
        improvements,
      },
      metricInterpretation: {
        session: `本节学习时长 ${duration} 分钟，重点看即时投入和课堂产出。`,
        longTerm: '长期指标受历史累计影响，不等于单节课程成绩。',
      },
      summaryVersion: 'v2',
    };
  }

  private normalizePersistedSummary(
    rawSummary: any,
    knowledgePoints: any[],
    subject: string,
    topic: string,
    duration: number,
    messageCount: number,
  ): SummaryOutput | null {
    if (!rawSummary
      || typeof rawSummary.topicSummary !== 'string'
      || typeof rawSummary.knowledgeSummary !== 'string'
      || typeof rawSummary.practiceAdvice !== 'string'
      || typeof rawSummary.learningEvaluation !== 'string') {
      return null;
    }

    if (rawSummary.summaryVersion === 'v2') {
      return rawSummary as SummaryOutput;
    }

    const fallbackSession: TeachingSession = {
      sessionId: 'normalized',
      userId: 'normalized',
      subject,
      topic,
      startTime: new Date(),
      mode: 'tutor',
      taskType: 'practice',
      messages: Array.from({ length: messageCount }, () => ({
        role: 'user' as const,
        content: '',
        timestamp: new Date(),
      })),
      currentState: undefined,
      consecutiveErrors: 0,
      lastActivity: new Date(),
      knowledgePoints: Array.isArray(knowledgePoints) ? knowledgePoints : [],
      userProfile: undefined,
    };

    const normalized = this.buildFallbackSummary(fallbackSession, undefined, duration);
    return {
      ...normalized,
      topicSummary: rawSummary.topicSummary,
      knowledgeSummary: rawSummary.knowledgeSummary,
      practiceAdvice: rawSummary.practiceAdvice,
      learningEvaluation: rawSummary.learningEvaluation,
    };
  }

  getActiveSessions(): TeachingSession[] {
    return Array.from(this.sessions.values());
  }

  cleanupExpiredSessions(maxAgeMinutes: number = 60): number {
    const now = new Date().getTime();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      const age = now - session.startTime.getTime();
      if (age > maxAgeMinutes * 60 * 1000) {
        this.sessions.delete(sessionId);
        this.peerMessages.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  private async checkIdleSessions(): Promise<void> {
    const now = new Date().getTime();
    for (const [sessionId, session] of this.sessions) {
      const idleTime = now - session.lastActivity.getTime();
      if (idleTime > this.idleTimeoutMs) {
        logger.info(`[AITeaching] 会话超时自动结束：${sessionId}, 空闲 ${Math.round(idleTime / 60000)} 分钟`);
        try {
          const durationSeconds = Math.floor(
            (session.lastActivity.getTime() - session.startTime.getTime()) / 1000
          );
          const duration = Math.max(1, Math.round(durationSeconds / 60));
          await prisma.learning_sessions.update({
            where: { id: sessionId },
            data: {
              status: 'timeout',
              endTime: session.lastActivity,
              duration,
              messages: JSON.stringify(session.messages),
              state: JSON.stringify(session.currentState || {}),
              updatedAt: new Date(),
            },
          });
        } catch (error) {
          logger.error(`[AITeaching] 超时会话保存失败：${error}`);
        }
        this.sessions.delete(sessionId);
        this.peerMessages.delete(sessionId);
      }
    }
  }

  async processPeerMessage(
    sessionId: string,
    message: string
  ): Promise<{
    peerResponse: string;
  }> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.restoreSessionFromDB(sessionId);
      if (!session) {
        throw new Error('会话不存在或已结束');
      }
    }

    if (!this.peerMessages.has(sessionId)) {
      this.peerMessages.set(sessionId, []);
    }
    const peerHistory = this.peerMessages.get(sessionId)!;

    peerHistory.push({
      role: 'user',
      content: message,
    });

    const tutorMessages = session.messages
      .filter(m => m.role === 'assistant')
      .slice(-5)
      .map(m => `导师：${m.content}`);

    const contextSection = tutorMessages.length > 0
      ? `\n## 导师最近的讲解\n${tutorMessages.join('\n')}`
      : '';

    const systemPrompt = `你是学习伙伴，和用户一起探索这个问题。
你可以：
- 主动分享你的想法（"我在想..."）
- 提出疑问（"等等，这里我不太懂..."）
- 请用户讲解（"你能不能给我讲讲..."）
- 不要直接给正确答案，而是引导用户自己发现
- 语气平等，像同学之间的讨论
当前学习主题是：${session.subject} - ${session.topic}
${contextSection}`;

    const client = getOpenAIClient();
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...peerHistory.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const response = await client.chatCompletion({
      messages,
      temperature: 0.8,
      max_tokens: 500,
    });

    const peerResponse = response.choices[0]?.message.content || '';

    peerHistory.push({
      role: 'assistant',
      content: peerResponse,
    });

    logger.info(`[AITeaching] 学习伙伴消息处理完成：${sessionId}`);

    return {
      peerResponse,
    };
  }
}

export const aiTeachingOrchestrator = new AITeachingOrchestrator();
export default aiTeachingOrchestrator;
