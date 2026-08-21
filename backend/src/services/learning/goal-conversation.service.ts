// 对话式学习目标收集服务 - 问题穿透模式 V2
// 核心理念：穿透表象，找到真问题，渐进式收集信息
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { executeSkill } from '../../skills';
import { goalConversationAgentDefinition } from '../../skills/goal-conversation';
import pathOrchestrator, { GoalPathRequest } from '../../coordinators/path.coordinator';
import { buildGoalPathVisibleSummary } from './goal-path-visible-summary';
import { assembleGoalHandoff } from '../../services/field-dispatcher';
import learningService from './learning.service';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';

interface GoalConversationOptions {
  contextMode?: 'recent' | 'full';
  confirmProposal?: boolean;
  systemPromptOverrides?: {
    goalAgent?: string;
    pathAgent?: string;
  };
  /** 前端交互特征（认知负荷量测 · 前端情报层）：随用户消息落库，供后续多目标核算等使用 */
  meta?: Record<string, number> | null;
}

interface GoalNormalizedStateV1 {
  version: '1.0';
  learnerIntent: {
    surfaceGoal: string | null;
    realProblem: string | null;
    motivation: string | null;
  };
  baseline: {
    currentLevel: string | null;
    priorKnowledgeStructure: string | null;
  };
  constraints: {
    availableTime: string | null;
    deadlineText: string | null;
  };
  successCriteria: {
    observableResult: string | null;
    acceptanceCheck: string | null;
  };
  proposal: {
    learningDirection: string | null;
    firstDeliverable: string | null;
  };
}

function buildGoalNormalizedState(data: any): GoalNormalizedStateV1 {
  const understanding = data?.understanding || {};
  const confirmedProposal = data?.confirmedProposal || {};
  return {
    version: '1.0',
    learnerIntent: {
      surfaceGoal: typeof understanding?.surface_goal === 'string' ? understanding.surface_goal : null,
      realProblem: typeof understanding?.real_problem === 'string' ? understanding.real_problem : null,
      motivation: typeof understanding?.motivation === 'string' ? understanding.motivation : null,
    },
    baseline: {
      currentLevel: typeof understanding?.background?.current_level === 'string' ? understanding.background.current_level : null,
      priorKnowledgeStructure: typeof understanding?.cognitive_profile?.prior_knowledge_structure === 'string'
        ? understanding.cognitive_profile.prior_knowledge_structure
        : null,
    },
    constraints: {
      availableTime: typeof understanding?.background?.available_time === 'string' ? understanding.background.available_time : null,
      deadlineText: typeof understanding?.deadline_text === 'string' ? understanding.deadline_text : null,
    },
    successCriteria: {
      observableResult: typeof understanding?.success_criteria?.observable_result === 'string'
        ? understanding.success_criteria.observable_result
        : null,
      acceptanceCheck: typeof understanding?.success_criteria?.acceptance_check === 'string'
        ? understanding.success_criteria.acceptance_check
        : null,
    },
    proposal: {
      learningDirection: typeof confirmedProposal?.learning_direction === 'string' ? confirmedProposal.learning_direction : null,
      firstDeliverable: typeof confirmedProposal?.first_deliverable === 'string' ? confirmedProposal.first_deliverable : null,
    },
  };
}

/**
 * 问题穿透对话系统设计 V2：
 *
 * 1. 角色定位：学习规划顾问（规划"学什么"），不是咨询师（告诉"怎么做"）
 * 2. 问题穿透：用户说的不是真正的问题，要找到真问题
 * 3. 渐进收集：五维度信息分阶段收集，每次只问1-2个问题
 * 4. 用户参与：方案轮廓先确认，再生成详细路径
 */
class GoalConversationService {
  private readonly RECENT_CONTEXT_LIMIT = 20;
  private readonly MAX_FORMAT_RETRIES = 2;

  private sanitizeVisibleContent(text: string): string {
    if (!text) return '';

    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /**
   * S2 数据质量修复：判断会话是否"开始未完成"（collectedData.messages 中尚无任何 AI 回复）。
   * start 流程先建行再调 AI，AI 失败/超时后重试会堆出多条同 description 的 active 空会话；
   * 这类会话可安全复用（没有沉淀任何真实对话），而有 AI 回复的会话代表已完成过一次 start，
   * 后续 start 属于用户显式"规划新目标"，必须新建，保留前端新对话语义。
   */
  private hasAiReplyInCollectedData(conversation: { collectedData: string | null }): boolean {
    try {
      const data = JSON.parse(conversation.collectedData || '{}');
      const messages = Array.isArray(data.messages) ? data.messages : [];
      return messages.some((m: any) => m?.role === 'ai' || m?.role === 'assistant');
    } catch {
      return false;
    }
  }

  private hasContinueDiscussIntent(text: string) {
    return /(不过|但是|但我|但还是|我担心|还是担心|还有个问题|还有一个问题|我还想问|我还想补充|能先说一下|能不能先说一下|具体怎么|要是|如果到时候|万一)/.test(text || '');
  }




  private static readonly GOAL_STAGES = ['understanding', 'proposing', 'ready', 'completed'] as const;

  private getCore(internal: any): { stage: string; confidence: number; isCompleted: boolean; conversationId?: string | null; learningPath?: any } {
    const core = internal?.core || {};
    return {
      stage: core.stage || 'understanding',
      confidence: typeof core.confidence === 'number' ? core.confidence : 0,
      isCompleted: !!core.isCompleted,
      conversationId: core.conversationId ?? null,
      learningPath: core.learningPath || null
    };
  }

  private getGoalExt(internal: any): {
    understanding: any;
    nextQuestions: string[];
    quickReplies?: any[];
    collected: any;
    structuredData?: any;
    confirmedProposal?: any;
    confidenceScores?: any;
  } {
    const ext = internal?.ext?.goalConversation || {};
    return {
      understanding: ext.understanding || {},
      nextQuestions: Array.isArray(ext.nextQuestions) ? ext.nextQuestions : [],
      quickReplies: Array.isArray(ext.quickReplies) ? ext.quickReplies : undefined,
      collected: ext.collected || {},
      structuredData: ext.structuredData,
      confirmedProposal: ext.confirmedProposal,
      confidenceScores: ext.confidenceScores
    };
  }

  private getStructuredOutputValid(aiResponse: any): boolean {
    return aiResponse?.debug?.structuredOutputValid === true;
  }

  /** 优先 runtimeEnvelope.businessState.phase，否则 internal.core.stage */
  private resolveStageFromResponse(aiResponse: any): string {
    const phase = aiResponse?.runtimeEnvelope?.businessState?.phase;
    if (typeof phase === 'string' && (GoalConversationService.GOAL_STAGES as readonly string[]).includes(phase)) {
      return phase;
    }
    return this.getCore(aiResponse?.internal).stage;
  }

  private resolveConfidenceFromResponse(aiResponse: any): number {
    const envelopeConf = aiResponse?.runtimeEnvelope?.businessState?.confidence;
    if (typeof envelopeConf === 'number' && Number.isFinite(envelopeConf)) return envelopeConf;
    return this.getCore(aiResponse?.internal).confidence;
  }

  private buildPreviousState(data: any, fallbackStage: string) {
    const next = data?.runtimeNextState && typeof data.runtimeNextState === 'object'
      ? data.runtimeNextState
      : (data?.runtimeEnvelope?.contextUpdate?.nextState && typeof data.runtimeEnvelope.contextUpdate.nextState === 'object'
        ? data.runtimeEnvelope.contextUpdate.nextState
        : null);

    if (next) {
      return {
        stage: next.stage || data?.stage || fallbackStage || 'understanding',
        confidence: typeof next.confidence === 'number' ? next.confidence : (typeof data?.confidence === 'number' ? data.confidence : 0),
        understanding: next.understanding || data?.understanding || {},
        collected: next.collected || data?.collected || {},
        structuredData: next.structuredData !== undefined ? next.structuredData : (data?.structuredData ?? null),
        confirmedProposal: next.confirmedProposal !== undefined ? next.confirmedProposal : (data?.confirmedProposal ?? null),
        confidenceScores: next.confidenceScores !== undefined ? next.confidenceScores : (data?.confidenceScores ?? null)
      };
    }

    return {
      stage: data?.stage || fallbackStage || 'understanding',
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
      understanding: data?.understanding || {},
      collected: data?.collected || {},
      structuredData: data?.structuredData ?? null,
      confirmedProposal: data?.confirmedProposal ?? null,
      confidenceScores: data?.confidenceScores ?? null
    };
  }

  private withConversationId(result: any, conversationId: string) {
    return {
      ...result,
      runtimeEnvelope: result?.runtimeEnvelope || null,
      internal: {
        ...(result?.internal || {}),
        core: {
          ...(result?.internal?.core || {}),
          conversationId
        },
        ext: result?.internal?.ext || {
          goalConversation: {
            understanding: {},
            nextQuestions: [],
            collected: {}
          }
        }
      }
    };
  }

  private toServiceResult(aiResponse: any, conversationId: string, overrides?: {
    stage?: string;
    isCompleted?: boolean;
    learningPath?: any;
    userVisible?: string;
  }) {
    const stage = overrides?.stage || this.resolveStageFromResponse(aiResponse);
    const confidence = this.resolveConfidenceFromResponse(aiResponse);
    const goalExt = this.getGoalExt(aiResponse?.internal);
    return {
      userVisible: overrides?.userVisible ?? aiResponse?.userVisible ?? '',
      runtimeEnvelope: aiResponse?.runtimeEnvelope || null,
      internal: {
        core: {
          conversationId,
          stage,
          confidence,
          isCompleted: overrides?.isCompleted ?? (stage === 'ready' || stage === 'completed'),
          ...(overrides?.learningPath !== undefined ? { learningPath: overrides.learningPath } : {})
        },
        ext: {
          goalConversation: goalExt
        }
      }
    };
  }

  private throwStructuredOutputInvalid(result: any): never {
    const error: any = new Error('STRUCTURED_OUTPUT_INVALID');
    error.status = 422;
    error.code = 'STRUCTURED_OUTPUT_INVALID';
    error.result = result;
    throw error;
  }

  private async updateConversationLifecycle(
    conversationId: string,
    stage: 'understanding' | 'proposing' | 'ready' | 'completed',
    options: {
      status?: string;
      completedAt?: Date | null;
      learningPathId?: string | null;
      learningPath?: { id: string; status?: string } | null;
      appendMessage?: { role: 'user' | 'ai'; content: string };
      mutateCollectedData?: (data: Record<string, any>) => void;
    } = {}
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const conversation = await tx.goal_conversations.findUnique({
        where: { id: conversationId }
      });
      if (!conversation) throw new Error('对话会话不存在');

      const collectedData = JSON.parse(conversation.collectedData || '{}');
      collectedData.stage = stage;
      options.mutateCollectedData?.(collectedData);

      if (options.learningPath !== undefined) {
        collectedData.learningPath = options.learningPath;
      }

      if (options.appendMessage) {
        collectedData.messages = Array.isArray(collectedData.messages) ? collectedData.messages : [];
        collectedData.messages.push({
          role: options.appendMessage.role,
          content: this.sanitizeVisibleContent(options.appendMessage.content),
          time: new Date().toISOString()
        });
      }

      await tx.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage,
          collectedData: JSON.stringify(collectedData),
          // S1 数据质量修复：messages 列与 collectedData.messages 双写，
          // 避免 messages 列停留在初始 '[]'（schema 必填列，真实历史只写进了 collectedData）
          ...(options.appendMessage ? { messages: JSON.stringify(collectedData.messages) } : {}),
          status: options.status,
          completedAt: options.completedAt,
          learningPathId: options.learningPathId
        }
      });
    });
  }

  /**
   * 开始新的对话会话（新格式：分离 userVisible 和 internal）
   */
  async startConversation(userId: string, initialGoal: string, options?: GoalConversationOptions) {
    try {
      logger.info('开始问题穿透对话会话', { userId, initialGoal });

      // S2 数据质量修复（防重复 active 会话堆积）：
      // 同 userId + 同 description 且仍 active 的会话若"开始未完成"（无 AI 回复，start 失败/超时后的残留），
      // 直接复用而非新建，避免重试/超时重发把同 description 的空会话越堆越多。
      // 注意：不覆盖"有真实对话历史"的会话 —— 前端有显式"规划新目标"入口（V2GoalConversation.vue/Profile.vue），
      // 用户重复输入相同目标属合法新对话，必须新建。
      let conversation = await prisma.goal_conversations.findFirst({
        where: { userId, description: initialGoal, status: 'active' },
        orderBy: { createdAt: 'desc' }
      });

      if (conversation && !this.hasAiReplyInCollectedData(conversation)) {
        logger.warn('复用未完成的相同目标会话（防止重复 active 会话堆积）', {
          userId,
          initialGoal,
          existingConversationId: conversation.id
        });
      } else {
        conversation = await prisma.goal_conversations.create({
          data: {
            id: `gc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId,
            description: initialGoal,
            stage: 'understanding',
            messages: '[]', // 初始化为空 JSON 数组（后续 append 双写同步，见 saveMessage/updateConversationLifecycle）
            collectedData: JSON.stringify({
              messages: [],       // 对话历史
              collected: {},      // 已收集的信息
              understanding: {},  // 问题理解状态
              stage: 'understanding',
              confidence: 0,
              confirmedProposal: null,
              structuredData: null,
              confidenceScores: null,
              learningPath: null
            })
          }
        });
      }

      // 让AI生成第一个回复
      const aiResponse = await this.callAI(conversation.id, initialGoal, true, userId, options);
      const responseWithConversationId = this.withConversationId(aiResponse, conversation.id);

      if (!this.getStructuredOutputValid(aiResponse)) {
        // 422 恢复信封前先持久化本轮用户消息，避免刷新恢复后上下文丢失（AI 回复不落库）
        await this.saveMessage(conversation.id, 'user', initialGoal);
        logger.warn('开始对话结构化输出失败，状态未更新', {
          conversationId: conversation.id,
          userId,
          attemptCount: aiResponse?.debug?.attemptCount || 0
        });
        this.throwStructuredOutputInvalid(responseWithConversationId);
      }

      await this.saveMessage(conversation.id, 'user', initialGoal);
      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据（stage 优先取 runtimeEnvelope.phase）
      await this.updateCollectedData(conversation.id, responseWithConversationId);

      const stage = this.resolveStageFromResponse(responseWithConversationId);
      logger.info('对话会话创建成功', {
        conversationId: conversation.id,
        stage,
        confidence: this.resolveConfidenceFromResponse(responseWithConversationId)
      });

      return this.toServiceResult(responseWithConversationId, conversation.id, { stage });
    } catch (error) {
      logger.error('开始对话会话失败:', error);
      throw error;
    }
  }

  /**
   * 用户回复，推进对话（新格式：分离 userVisible 和 internal）
   */
async continueConversation(
    conversationId: string,
    userReply: string,
    userId: string,
    options?: GoalConversationOptions
  ) {
      try {
        // 获取当前对话状态
        const conversation = await prisma.goal_conversations.findFirst({
          where: { id: conversationId, userId }
        });

        if (!conversation) {
          throw new Error('对话会话不存在');
        }

        // 如果已经完成，直接返回
        if (conversation.status === 'completed') {
          const data = JSON.parse(conversation.collectedData);
          let learningPath = null;
          
          // 查询学习路径状态
          if (conversation.learningPathId) {
            const path = await prisma.learning_paths.findFirst({
              where: { id: conversation.learningPathId }
            });
            if (path) {
              learningPath = {
                id: path.id,
                status: path.status
              };
            }
          }
          
          return {
            userVisible: '学习路径已经生成，可以去查看啦！',
            internal: {
              core: {
                conversationId,
                stage: 'completed',
                confidence: data.confidence || 0,
                isCompleted: true,
                learningPath
              },
              ext: {
                goalConversation: {
                  understanding: data.understanding || {},
                  nextQuestions: [],
                  quickReplies: [],
                  collected: data.collected || {}
                }
              }
            }
          };
        }

        // 只接受 UI 显式确认动作，不再依赖自然语言文本猜测“行/可以”是否代表确认。
        const confirmProposal = options?.confirmProposal === true;

        if (conversation.stage === 'proposing' && confirmProposal) {
          const data = JSON.parse(conversation.collectedData || '{}');
          const understanding = data.understanding || {};
          
          try {
            const seedResult = {
              userVisible: '',
              internal: {
                core: {
                  stage: 'ready',
                  confidence: data.confidence || 0.9,
                  isCompleted: true
                },
                ext: {
                  goalConversation: {
                    understanding,
                    nextQuestions: [],
                    collected: data.collected || {}
                  }
                }
              }
            };

            const placeholderPath = await this.createGeneratingPlaceholderPath(conversation, seedResult);
            const runId = await learningService.claimPathCoreGeneration(placeholderPath.id, null);

            await this.updateConversationLifecycle(conversationId, 'completed', {
              status: 'completed',
              completedAt: new Date(),
              learningPathId: placeholderPath.id,
              learningPath: { id: placeholderPath.id, status: 'generating' },
              appendMessage: { role: 'user', content: userReply }
            });

            pathOrchestrator.runGoalAsync(
              {
                ...await this.buildGoalPathRequest(conversation, seedResult, placeholderPath.id, options?.systemPromptOverrides),
                generationRunId: runId,
                createdPlaceholder: true
              },
              {
                onSuccess: () => {
                  logger.info('硬规则触发：异步学习路径生成成功', { conversationId, pathId: placeholderPath.id });
                },
                onError: async (pathError) => {
                  logger.error('硬规则触发：异步学习路径生成失败', { conversationId, pathId: placeholderPath.id, error: String(pathError) });
                  await learningService.markActiveGenerationFailed(placeholderPath.id, pathError, runId);
                }
              }
            );

            return {
              userVisible: '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
              internal: {
                core: {
                  conversationId,
                  stage: 'completed',
                  confidence: 0.95,
                  isCompleted: true,
                  learningPath: { id: placeholderPath.id, status: 'generating' }
                },
                ext: {
                  goalConversation: {
                    understanding,
                    nextQuestions: [],
                    quickReplies: [],
                    collected: data.collected || {}
                  }
                }
              }
            };
          } catch (pathError) {
            logger.error('硬规则触发生成路径失败', pathError);
            throw pathError;
          }
        }

      // 调用AI生成回复。先不写当前用户消息，避免本轮输入重复进入上下文。
      const aiResponse = await this.callAI(conversation.id, userReply, false, userId, options);
      const responseWithConversationId = this.withConversationId(aiResponse, conversationId);

      if (!this.getStructuredOutputValid(aiResponse)) {
        // 422 恢复信封前先持久化本轮用户消息，避免刷新恢复后对话上下文丢失（AI 回复不落库）
        await this.saveMessage(conversation.id, 'user', userReply, options?.meta);
        logger.warn('继续对话结构化输出失败，状态未更新', {
          conversationId,
          userId,
          attemptCount: aiResponse?.debug?.attemptCount || 0,
          previousStage: conversation.stage
        });
        this.throwStructuredOutputInvalid(responseWithConversationId);
      }

      await this.saveMessage(conversation.id, 'user', userReply, options?.meta);
      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据（stage 优先取 runtimeEnvelope.phase）
      await this.updateCollectedData(conversation.id, responseWithConversationId);
      const stage = this.resolveStageFromResponse(responseWithConversationId);
      const confidence = this.resolveConfidenceFromResponse(responseWithConversationId);
      const goalExt = this.getGoalExt(responseWithConversationId.internal);

      // 模型自报 ready/completed 不产生学习路径：路径生成只能由用户通过 UI 按钮显式确认触发
      // （见上方 confirmProposal 硬规则路径）。模型自报一律回落 proposing，等待用户确认方案。
      if (stage === 'ready' || stage === 'completed') {
        await this.updateConversationLifecycle(conversationId, 'proposing', {
          status: 'active',
          completedAt: null,
          mutateCollectedData: (data) => {
            data.stage = 'proposing';
          }
        });
        logger.warn('模型自报 ready 已被回落为 proposing，等待用户显式确认', {
          conversationId,
          userId
        });
        return this.toServiceResult(responseWithConversationId, conversationId, {
          stage: 'proposing',
          isCompleted: false,
        });
      }

      // 新格式返回：正常对话状态
      return this.toServiceResult(responseWithConversationId, conversationId, {
        stage,
        isCompleted: false,
      });

    } catch (error) {
      logger.error('继续对话失败:', error);
      throw error;
    }
  }

  private async createGeneratingPlaceholderPath(conversation: any, aiResponse: any) {
    const understanding = this.getGoalExt(aiResponse.internal).understanding || {};
    const realGoal = understanding.real_problem || conversation.description;
    const subject = this.inferSubject(realGoal);
    const title = realGoal && String(realGoal).trim()
      ? `${String(realGoal).trim().slice(0, 28)}学习路径`
      : '个性化学习路径';
    const pathId = `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const promptTemplatePayload = this.buildPlaceholderPromptTemplatePayload(conversation, aiResponse, pathId);

    return prisma.learning_paths.create({
      data: {
        id: pathId,
        userId: conversation.userId,
        title,
        name: title,
        description: realGoal,
        subject,
        status: 'generating',
        difficulty: 'beginner',
        estimatedHours: 0,
        aiGenerated: true,
        aiPromptTemplate: JSON.stringify(promptTemplatePayload),
        updatedAt: new Date()
      }
    });
  }

  /**
   * 调用AI生成回复
   */
  private async callAI(
    conversationId: string,
    userInput: string,
    isFirst: boolean,
    userId?: string,
    options?: GoalConversationOptions
  ) {
    const startTime = Date.now();

    try {
      // 获取对话历史
      const conversation = await prisma.goal_conversations.findUnique({
        where: { id: conversationId }
      });

      const data = JSON.parse(conversation.collectedData);
      const history = data.messages || [];
      const previousState = this.buildPreviousState(data, conversation.stage);
      const previousUnderstanding = previousState.understanding || data.understanding || {};

      // 正式链路固定使用完整可见历史 + state-first，与测试模式保持一致。
      const contextMode = 'full';
      const selectedHistory = history;

      // L2 声明化装配（只读对账）：状态池形状由 sandbox-resolver 的 goal provider 声明，
      // 本链只提供原始 context（previousState + 可见历史）。缺键打 warn，不阻断。
      try {
        const { checkAgentSandboxRefsFromContext } = await import('../sandbox-resolver.service');
        const historyItems = selectedHistory.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: String(msg.content || ''),
        }));
        await checkAgentSandboxRefsFromContext(
          'goal-conversation',
          'goal',
          { previousState, history: historyItems },
          { warnContext: { conversationId } }
        );
      } catch {
        // 对账失败不影响主流程
      }

      // 调用专用 GoalConversationAgent
      const aiResponse = await executeSkill(goalConversationAgentDefinition, {
        input: userInput,
        userId: userId || 'anonymous',
        conversationHistory: selectedHistory.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })),
        previousUnderstanding,
        previousStage: previousState.stage || data.stage || conversation.stage,
        previousState,
        maxFormatRetries: this.MAX_FORMAT_RETRIES,
        confirmProposal: options?.confirmProposal === true,
        systemPromptOverride: options?.systemPromptOverrides?.goalAgent
      });

        logger.debug('AI响应', {
        contextMode,
        historyCount: selectedHistory.length,
        stage: this.resolveStageFromResponse(aiResponse),
        confidence: this.resolveConfidenceFromResponse(aiResponse),
        responseLength: aiResponse.userVisible.length,
        promptVersion: aiResponse?.debug?.promptVersion || 'agent-managed',
        attemptCount: aiResponse?.debug?.attemptCount || 0,
        actualRetryCount: aiResponse?.debug?.actualRetryCount || 0,
        formatFailureCount: aiResponse?.debug?.formatFailureCount || 0,
        structuredOutputValid: this.getStructuredOutputValid(aiResponse)
      });

      return aiResponse;

    } catch (error: any) {
      if (error?.message === 'STRUCTURED_OUTPUT_INVALID' || error?.code === 'STRUCTURED_OUTPUT_INVALID') {
        throw error;
      }
      logger.error('AI调用失败:', error);
      throw error;
    }
  }

  /**
   * 保存消息到历史
   */
  private async saveMessage(conversationId: string, role: string, content: string, meta?: Record<string, number> | null) {
    // 乐观锁：messages/collectedData 是整包 JSON 读改写，同一会话的并发提交
    // （双击/重试）会互相覆盖丢消息。以 revision 条件更新，冲突时重读重放。
    for (let attempt = 0; attempt < 3; attempt++) {
      const conversation = await prisma.goal_conversations.findUnique({
        where: { id: conversationId }
      });
      if (!conversation) {
        throw new Error(`目标会话不存在: ${conversationId}`);
      }

      const data = JSON.parse(conversation.collectedData);
      data.messages = data.messages || [];
      const sanitizedContent = this.sanitizeVisibleContent(content);
      data.messages.push({
        role,
        content: sanitizedContent,
        time: new Date().toISOString(),
        ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
      });

      // S1 数据质量修复：messages 列与 collectedData.messages 双写（追加后整列同步为完整对话数组）。
      // 消费方（admin 详情兜底解析）按 {role, content, time} 数组读取该列，与 collectedData 语义一致。
      const updated = await prisma.goal_conversations.updateMany({
        where: { id: conversationId, revision: conversation.revision },
        data: {
          collectedData: JSON.stringify(data),
          messages: JSON.stringify(data.messages),
          revision: { increment: 1 }
        }
      });
      if (updated.count === 1) return;
    }
    throw new Error('目标会话并发写入冲突（连续 3 次 revision 失配），请重试');
  }

  /**
   * 更新收集的数据 - 问题穿透模式（新格式）
   */
  private async updateCollectedData(conversationId: string, aiResponse: {
    userVisible: string;
    internal: any;
    runtimeEnvelope?: any;
  }) {
    // 乐观锁：与 saveMessage 同理，防止并发回合互相覆盖 collectedData
    for (let attempt = 0; attempt < 3; attempt++) {
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId }
    });
    if (!conversation) {
      throw new Error(`目标会话不存在: ${conversationId}`);
    }

    const data = JSON.parse(conversation.collectedData);

    const core = this.getCore(aiResponse.internal);
    const goalExt = this.getGoalExt(aiResponse.internal);
    const stage = this.resolveStageFromResponse(aiResponse);
    const confidence = this.resolveConfidenceFromResponse(aiResponse);

    // 合并已收集的信息（从 ext.goalConversation.collected）
    data.collected = { ...data.collected, ...goalExt.collected };
    data.confidence = confidence;

    // 保存 understanding 供前端展示
    data.understanding = goalExt.understanding || data.understanding || {};

    // 保存 stage（优先 envelope.phase）
    data.stage = stage;

    // 统一运行契约：落盘最近一次 envelope 快照（state-refresh nextState）
    if (aiResponse.runtimeEnvelope) {
      data.runtimeEnvelope = aiResponse.runtimeEnvelope;
      const nextState = aiResponse.runtimeEnvelope?.contextUpdate?.nextState;
      if (nextState && typeof nextState === 'object') {
        data.runtimeNextState = nextState;
      }
    }

    // 保存待问问题
    if (goalExt.nextQuestions) {
      data.questions_to_ask = goalExt.nextQuestions;
    }

    if (goalExt.confirmedProposal !== undefined) {
      data.confirmedProposal = goalExt.confirmedProposal;
    }

    if (goalExt.structuredData !== undefined) {
      data.structuredData = goalExt.structuredData;
    }

    if (goalExt.confidenceScores !== undefined) {
      data.confidenceScores = goalExt.confidenceScores;
    }

    data.normalizedGoalState = buildGoalNormalizedState(data);

    if (core.learningPath !== undefined) {
      data.learningPath = core.learningPath || null;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.goal_conversations.updateMany({
          where: { id: conversationId, revision: conversation.revision },
          data: {
            collectedData: JSON.stringify(data),
            stage,
            revision: { increment: 1 }
          }
        });
        if (updated.count !== 1) {
          // 触发事务回滚（含未发出的领域事件），外层重读重放
          throw new Error('GOAL_REVISION_CONFLICT');
        }
        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'goal:understanding:updated',
          aggregateType: 'goal',
          aggregateId: conversationId,
          userId: conversation.userId,
          source: 'goal-conversation-service',
          data: {
            conversationId,
            stage,
            confidence,
            understanding: data.understanding,
            normalizedGoalState: data.normalizedGoalState,
            confirmedProposal: data.confirmedProposal || null,
            structuredData: data.structuredData || null
          }
        }));
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('GOAL_REVISION_CONFLICT') || attempt === 2) {
        throw error;
      }
      // revision 冲突：重读最新状态重放
    }
    }
  }

  private async buildGoalPathRequest(
    conversation: any,
    aiResponse: any,
    existingPathId?: string,
    systemPromptOverrides?: GoalConversationOptions['systemPromptOverrides']
  ): Promise<GoalPathRequest> {
    const data = JSON.parse(conversation.collectedData);
    const goalExt = this.getGoalExt(aiResponse.internal);
    const understanding = goalExt.understanding || data.understanding || {};
    const confirmedProposal = goalExt.confirmedProposal ?? data.confirmedProposal ?? null;
    const conversationHistory = Array.isArray(data.messages)
      ? data.messages
          .map((message: any) => ({
            role: message?.role === 'user' ? 'user' : 'assistant',
            content: typeof message?.content === 'string' ? message.content : ''
          }))
          .filter((message: { role: string; content: string }) => message.content)
      : [];

    // 配置式值流转（P1 试点）：按 routings 表 goal-agent 交付行 + pathInRawOutput
    // 从 skill 输出抽取 goal→path 字段，与 visibleSummary 并行产出（golden 验证/后续装配切换）
    const goalHandoffFields = await assembleGoalHandoff(aiResponse).catch((err) => {
      logger.warn('[goal-conversation] assembleGoalHandoff failed, falling back to visibleSummary', {
        conversationId: conversation.id,
        error: (err as Error).message,
      });
      return null;
    });
    if (goalHandoffFields && goalHandoffFields.skipped.length > 0) {
      logger.warn('[goal-conversation] goal→path handoff fields skipped (config-driven extraction)', {
        conversationId: conversation.id,
        skipped: goalHandoffFields.skipped,
      });
    }

    return {
      userId: conversation.userId,
      sourceConversationId: conversation.id,
      existingPathId: existingPathId || conversation.learningPathId || undefined,
      source: 'goal',
      mode: 'generate',
      rawGoal: conversation.description,
      visibleSummary: buildGoalPathVisibleSummary({
        understanding,
        confirmedProposal,
        collected: data.collected || {},
      }),
      ...(goalHandoffFields ? { goalHandoffFields: goalHandoffFields.fields } : {}),
      // goal skill 产出的结构化画像透传（learner.identity/learning_context 等），供 path-planning scenario 判定
      structuredData: (data as any)?.structuredData || null,
      conversationHistory,
      finalUserVisible: aiResponse.userVisible || null,
      systemPromptOverrides: systemPromptOverrides?.pathAgent
        ? { pathAgent: systemPromptOverrides.pathAgent }
        : undefined,
    };
  }

  private async buildPlaceholderPromptTemplatePayload(conversation: any, aiResponse: any, existingPathId: string) {
    const goalPathRequest = await this.buildGoalPathRequest(conversation, aiResponse, existingPathId);

    return {
      source: 'goal',
      mode: 'generate',
      goalFinalPayload: goalPathRequest,
      normalizedInput: null,
      sceneFraming: null,
      suggestedMilestones: [],
      cognitiveDesign: null,
      adjustmentPolicy: null,
      adjustmentEvidence: null,
      generationStatus: {
        sourceConversationId: goalPathRequest.sourceConversationId || null,
        phase: 'core',
        status: 'started',
        message: 'Goal 占位路径已创建，等待 Path 主生成写入正式结果。'
      }
    };
  }

  /**
   * 生成学习路径 - 基于真问题（新格式：从 internal 读取数据）
   */
  private async generateLearningPath(
    conversation: any,
    aiResponse: any,
    systemPromptOverrides?: GoalConversationOptions['systemPromptOverrides']
  ) {
    try {
      const request = await this.buildGoalPathRequest(
        conversation,
        aiResponse,
        conversation.learningPathId || undefined,
        systemPromptOverrides
      );
      if (request.existingPathId) {
        const path = await prisma.learning_paths.findUnique({
          where: { id: request.existingPathId },
          select: { activeGenerationRunId: true }
        });
        if (!path) {
          // Goal 上的 learningPathId 可能因 Path 被重建/删除而过期；降级为新建路径，
          // 由调用方把新 pathId 写回 goal_conversations，恢复 Goal ↔ Path 1:1 指针。
          logger.warn('会话绑定的学习路径已不存在，改为生成新路径', {
            conversationId: conversation.id,
            stalePathId: request.existingPathId
          });
          request.existingPathId = undefined;
        } else {
          request.generationRunId = await learningService.claimPathCoreGeneration(
            request.existingPathId,
            path.activeGenerationRunId
          );
        }
      }
      const learningPath = await pathOrchestrator.generateFromGoal(request);

      const goalExt = this.getGoalExt(aiResponse.internal);
      const understanding = goalExt.understanding || {};
      const structuredData = goalExt.structuredData || null;

      logger.info('学习路径生成成功', {
        pathId: learningPath?.id,
        realProblem: understanding.real_problem,
        hasStructuredData: !!structuredData,
        learnerIdentity: structuredData?.learner?.identity
      });

      // 直接返回学习路径对象（不要包装，因为 continueConversation 已经会包装）
      return learningPath;

    } catch (error) {
      logger.error('生成学习路径失败:', error);
      throw error;
    }
  }

  /**
    * 推断学科
    */
   private inferSubject(goal: string): string {
    if (!goal) return '综合';
    
    const keywords = {
      '编程': ['python', 'java', 'javascript', 'vue', 'react', '编程', '代码', '开发', '自动化'],
      '英语': ['英语', 'english', '四级', '六级', '雅思', '托福', '口语', '日常交流'],
      '心理学': ['心理', '咨询', '阿德勒', '荣格', '弗洛伊德'],
      '数学': ['数学', '代数', '几何', '微积分', '函数', '方程'],
      '经济学': ['经济', '通胀', '利率', '财经', '金融', 'gdp', 'cpi', '货币'],
      '设计': ['设计', 'ui', 'ux', '平面', '产品']
    };

    const lowerGoal = goal.toLowerCase();
    for (const [subject, words] of Object.entries(keywords)) {
      if (words.some(w => lowerGoal.includes(w))) {
        return subject;
      }
    }
    return '综合';
  }

  /**
   * 重新生成学习路径（基于已完成的对话）
   */
  async regeneratePath(
    conversationId: string,
    userId: string,
    adjustments?: string,
    systemPromptOverrides?: GoalConversationOptions['systemPromptOverrides']
  ) {
    try {
      logger.info('重新生成学习路径', { conversationId, userId, adjustments });

      const conversation = await prisma.goal_conversations.findFirst({
        where: { id: conversationId, userId }
      });

      if (!conversation) {
        throw new Error('对话会话不存在');
      }

      const data = JSON.parse(conversation.collectedData || '{}');
      const understanding = data.understanding || {};
      const collected = data.collected || {};

      // 如果有调整建议，更新 understanding
      if (adjustments) {
        understanding.adjustments = adjustments;
        understanding.adjusted_at = new Date().toISOString();
      }

      // 重置状态为 proposing，准备重新生成
      await this.updateConversationLifecycle(conversationId, 'proposing', {
        status: 'active',
        completedAt: null,
        mutateCollectedData: (currentData) => {
          currentData.understanding = understanding;
        }
      });

      const updatedConversation = {
        ...conversation,
        stage: 'proposing',
        status: 'active',
        collectedData: JSON.stringify({
          ...data,
          stage: 'proposing',
          understanding
        })
      };

      // 重新生成学习路径
      const learningPath = await this.generateLearningPath(updatedConversation, {
        userVisible: '正在重新生成学习路径...',
        internal: {
          core: {
            stage: 'ready',
            confidence: data.confidence || 0.8,
            isCompleted: true
          },
          ext: {
            goalConversation: {
              understanding,
              nextQuestions: [],
              collected
            }
          }
        }
      }, systemPromptOverrides);

      // 更新状态为完成
      await this.updateConversationLifecycle(conversationId, 'completed', {
        status: 'completed',
        completedAt: new Date(),
        learningPathId: learningPath?.id,
        learningPath: learningPath?.id
          ? { id: learningPath.id, status: learningPath.status }
          : null
      });

      logger.info('学习路径重新生成成功', {
        conversationId,
        newPathId: learningPath?.id
      });

      return {
        userVisible: adjustments
          ? `已根据您的反馈重新生成学习路径！${adjustments}`
          : '已为您重新生成学习路径！',
        internal: {
          core: {
            conversationId,
            stage: 'completed',
            confidence: 0.9,
            isCompleted: true,
            learningPath
          },
          ext: {
            goalConversation: {
              understanding,
              nextQuestions: [],
              collected
            }
          }
        }
      };
    } catch (error) {
      logger.error('重新生成学习路径失败:', error);
      throw error;
    }
  }

  /**
   * 删除/重置对话（允许用户重新开始）
   */
  async deleteConversation(conversationId: string, userId: string) {
    try {
      const conversation = await prisma.goal_conversations.findFirst({
        where: { id: conversationId, userId }
      });

      if (!conversation) {
        throw new Error('对话会话不存在');
      }

      // 删除对话记录
      await prisma.goal_conversations.delete({
        where: { id: conversationId }
      });

      logger.info('对话已删除', { conversationId, userId });

      return { success: true };
    } catch (error) {
      logger.error('删除对话失败:', error);
      throw error;
    }
  }

  /**
   * 获取对话会话详情
   */
  async getConversation(conversationId: string, userId: string) {
    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: conversationId, userId }
    });

    if (!conversation) {
      throw new Error('对话会话不存在');
    }

    const data = JSON.parse(conversation.collectedData);

    return {
      id: conversation.id,
      description: conversation.description,
      stage: conversation.stage,
      status: conversation.status,
      messages: data.messages || [],
      collected: data.collected || {},
      understanding: data.understanding || {},
      nextQuestions: data.questions_to_ask || [],
      confirmedProposal: data.confirmedProposal || null,
      structuredData: data.structuredData || null,
      confidenceScores: data.confidenceScores || null,
      learningPath: data.learningPath || (conversation.learningPathId ? { id: conversation.learningPathId } : null),
      confidence: data.confidence || 0,
      createdAt: conversation.createdAt,
      completedAt: conversation.completedAt
    };
  }

  /**
   * 快速生成学习路径（跳过对话，用于测试）- 新格式返回
   */
  async quickGeneratePath(userId: string, params: {
    goal: string;
    level: string;
    timePerDay: string;
    learningStyle: string;
  }) {
    logger.info('快速生成学习路径', { userId, params });

    // 构建模拟的 understanding 数据
    const understanding = {
      surface_goal: params.goal,
      real_problem: params.goal,
      motivation: '快速测试',
      urgency: '中',
      background: {
        current_level: params.level,
        available_time: params.timePerDay,
        constraints: [],
        strengths: []
      },
      learning_style: {
        preferred_format: params.learningStyle === 'project-based' ? '动手' : '混合',
        theory_vs_practice: params.learningStyle === 'project-based' ? '实践优先' : '理论与实践结合'
      }
    };

    // 创建一个模拟的 conversation 对象
    const mockConversation = {
      id: 'quick-test',
      userId,
      description: params.goal,
      collectedData: JSON.stringify({
        messages: [],
        collected: understanding,
        understanding
      })
    };

    // 直接调用生成学习路径（使用新格式）
    const pathResult = await this.generateLearningPath(mockConversation as any, {
      userVisible: '快速生成学习路径完成！',
      internal: {
        core: {
          stage: 'ready',
          confidence: 0.9,
          isCompleted: true
        },
        ext: {
          goalConversation: {
            understanding,
            nextQuestions: [],
            collected: understanding
          }
        }
      }
    });

    logger.info('快速生成学习路径成功', {
      pathId: pathResult?.id
    });

    // 新格式返回
    return {
      userVisible: `已为您快速生成学习路径「${pathResult?.name || '未命名'}」！`,
      internal: {
        core: {
          stage: 'completed',
          confidence: 0.9,
          isCompleted: true,
          learningPath: pathResult
        },
        ext: {
          goalConversation: {
            understanding,
            nextQuestions: [],
            collected: understanding
          }
        }
      }
    };
  }

}

export default new GoalConversationService();

/**
 * 从对话生成学习路径（供路由使用）- 新格式适配
 */
export async function generateLearningPathFromConversation(conversationId: string) {
  const conversation = await prisma.goal_conversations.findUnique({
    where: { id: conversationId },
    include: { users: true }
  });

  if (!conversation) {
    throw new Error('对话不存在');
  }

  const service = new GoalConversationService();
  const data = JSON.parse(conversation.collectedData);
  const collected = data.collected || {};
  const understanding = data.understanding || collected;

  // 使用真问题生成学习路径
  const realGoal = understanding.real_problem || collected.real_problem || conversation.description;
  const surfaceGoal = understanding.surface_goal || collected.surface_goal || '';

  // 构造新格式参数
  return await service['generateLearningPath'](conversation, {
    userVisible: '',  // 此场景无对话文本
    internal: {
      core: {
        stage: 'ready',
        confidence: data.confidence || 0.9,
        isCompleted: true
      },
      ext: {
        goalConversation: {
          understanding: {
            ...understanding,
            real_problem: realGoal,
            surface_goal: surfaceGoal
          },
          nextQuestions: [],
          collected
        }
      }
    }
  });
}
