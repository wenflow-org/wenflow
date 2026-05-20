// 对话式学习目标收集服务 - 问题穿透模式 V2
// 核心理念：穿透表象，找到真问题，渐进式收集信息
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runGoalConversationAgent } from '../../agents/goal-conversation-agent';
import pathOrchestrator, { GoalPathRequest } from '../../orchestrators/path.orchestrator';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';

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

  private buildPreviousState(data: any, fallbackStage: string) {
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

  private throwStructuredOutputInvalid(result: any): never {
    const error: any = new Error('STRUCTURED_OUTPUT_INVALID');
    error.status = 422;
    error.code = 'STRUCTURED_OUTPUT_INVALID';
    error.result = result;
    throw error;
  }

  /**
   * 开始新的对话会话（新格式：分离 userVisible 和 internal）
   */
  async startConversation(userId: string, initialGoal: string, options?: { contextMode?: 'recent' | 'full' }) {
    try {
      logger.info('开始问题穿透对话会话', { userId, initialGoal });

// 创建对话会话
      const conversation = await prisma.goal_conversations.create({
        data: {
          id: `gc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId,
          description: initialGoal,
          stage: 'understanding',
          messages: '[]', // 初始化为空 JSON 数组
          collectedData: JSON.stringify({
            messages: [],       // 对话历史
            collected: {},      // 已收集的信息
            understanding: {},  // 问题理解状态
            confidence: 0,
            confirmedProposal: null,
            structuredData: null,
            confidenceScores: null,
            learningPath: null
          })
        }
      });

      // 让AI生成第一个回复
      const aiResponse = await this.callAI(conversation.id, initialGoal, true, userId, options);
      const responseWithConversationId = this.withConversationId(aiResponse, conversation.id);

      // 首轮用户输入始终保留，便于用户重试；只有结构化成功才写入 AI 回复和状态
      await this.saveMessage(conversation.id, 'user', initialGoal);

      if (!this.getStructuredOutputValid(aiResponse)) {
        logger.warn('开始对话结构化输出失败，状态未更新', {
          conversationId: conversation.id,
          userId,
          attemptCount: aiResponse?.debug?.attemptCount || 0
        });
        this.throwStructuredOutputInvalid(responseWithConversationId);
      }

      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据
      await this.updateCollectedData(conversation.id, aiResponse);

      logger.info('对话会话创建成功', {
        conversationId: conversation.id,
        stage: this.getCore(aiResponse.internal).stage,
        confidence: this.getCore(aiResponse.internal).confidence
      });

      const core = this.getCore(responseWithConversationId.internal);
      const goalExt = this.getGoalExt(responseWithConversationId.internal);

      return {
        userVisible: aiResponse.userVisible,
        internal: {
          core: {
            conversationId: conversation.id,
            stage: core.stage,
            confidence: core.confidence,
            isCompleted: core.stage === 'ready'
          },
          ext: {
            goalConversation: goalExt
          }
        }
      };
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
    options?: { contextMode?: 'recent' | 'full' }
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

        // 确认意图硬规则：proposing 阶段 + 用户确认 -> 直接生成路径（不依赖模型）
        const confirmIntent = /^(好|好的|行|可以|是的|对|确认|就这样|没问题|开始生成|生成学习路径|可以生成)/i.test(userReply.trim());
        const adjustIntent = /(调整|修改|换个方向|再想想|先不要|不对)/.test(userReply);

        if (conversation.stage === 'proposing' && confirmIntent && !adjustIntent) {
          const data = JSON.parse(conversation.collectedData || '{}');
          const understanding = data.understanding || {};
          
          // 保存用户确认消息
          await this.saveMessage(conversation.id, 'user', userReply);

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

            pathOrchestrator.runGoalAsync(
              this.buildGoalPathRequest(conversation, seedResult, placeholderPath.id),
              {
                onSuccess: () => {
                  logger.info('硬规则触发：异步学习路径生成成功', { conversationId, pathId: placeholderPath.id });
                },
                onError: async (pathError) => {
                  logger.error('硬规则触发：异步学习路径生成失败', { conversationId, pathId: placeholderPath.id, error: String(pathError) });
                  try {
                    await prisma.learning_paths.update({
                      where: { id: placeholderPath.id },
                      data: { status: 'failed', updatedAt: new Date() }
                    });
                  } catch (e) {
                    logger.error('更新失败状态出错', e);
                  }
                }
              }
            );

            await prisma.goal_conversations.update({
              where: { id: conversationId },
              data: {
                stage: 'completed',
                status: 'completed',
                completedAt: new Date(),
                learningPathId: placeholderPath.id
              }
            });

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

      // 用户输入保留，结构化失败时仅保留用户消息，不推进状态/AI历史。
      await this.saveMessage(conversation.id, 'user', userReply);

      if (!this.getStructuredOutputValid(aiResponse)) {
        logger.warn('继续对话结构化输出失败，状态未更新', {
          conversationId,
          userId,
          attemptCount: aiResponse?.debug?.attemptCount || 0,
          previousStage: conversation.stage
        });
        this.throwStructuredOutputInvalid(responseWithConversationId);
      }

      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据
      await this.updateCollectedData(conversation.id, aiResponse);
      void learnerSnapshotRefreshService.refresh({
        userId,
        scope: 'global'
      });
      const core = this.getCore(responseWithConversationId.internal);
      const goalExt = this.getGoalExt(responseWithConversationId.internal);

      // 如果对话完成，先生成学习路径
      if (core.stage === 'ready') {
        try {
            const placeholderPath = await this.createGeneratingPlaceholderPath(conversation, responseWithConversationId);

            pathOrchestrator.runGoalAsync(
            this.buildGoalPathRequest(conversation, responseWithConversationId, placeholderPath.id),
            {
              onSuccess: () => {
                logger.info('异步学习路径生成成功', {
                  conversationId,
                  pathId: placeholderPath.id
                });
              },
              onError: async (pathError) => {
                logger.error('异步学习路径生成失败', {
                  conversationId,
                  pathId: placeholderPath.id,
                  error: (pathError as any)?.message || String(pathError)
                });

                try {
                  await prisma.learning_paths.update({
                    where: { id: placeholderPath.id },
                    data: {
                      status: 'failed',
                      updatedAt: new Date()
                    }
                  });
                } catch (updateError) {
                  logger.error('更新占位路径失败状态失败', updateError);
                }
              }
            }
          );

          // 学习路径生成成功后，再更新状态
          await prisma.goal_conversations.update({
            where: { id: conversationId },
            data: {
              stage: 'completed',
              status: 'completed',
              completedAt: new Date(),
              learningPathId: placeholderPath.id
            }
          });

          void learnerSnapshotRefreshService.refresh({
            userId,
            pathId: placeholderPath.id,
            scope: 'path'
          });

          // 新格式返回：completed 状态
          return {
            userVisible: `${responseWithConversationId.userVisible}\n\n⏳ 学习路径已开始生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。`,
            internal: {
              core: {
                conversationId,
                stage: 'completed',
                confidence: core.confidence,
                isCompleted: true,
                learningPath: {
                  id: placeholderPath.id,
                  status: 'generating'
                }
              },
              ext: {
                goalConversation: {
                  ...goalExt,
                  quickReplies: goalExt.quickReplies || []
                }
              }
            }
          };
        } catch (pathError) {
          // 学习路径生成失败，返回错误但不标记完成
          logger.error('学习路径生成失败，对话仍保留在 proposing 状态', pathError);
          return {
            userVisible: '抱歉，生成学习路径时遇到了问题。请稍后重试，或者点击"重试"按钮。',
            internal: {
              core: {
                conversationId,
                stage: 'proposing',
                confidence: core.confidence,
                isCompleted: false
              },
              ext: {
                goalConversation: goalExt
              },
              error: '学习路径生成失败，请重试'
            }
          };
        }
      }

      // 非完成状态，正常更新
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: core.stage,
          status: 'active'
        }
      });

      // 新格式返回：正常对话状态
      return {
        userVisible: responseWithConversationId.userVisible,
        internal: {
          core: {
            conversationId,
            stage: core.stage,
            confidence: core.confidence,
            isCompleted: false
          },
          ext: {
            goalConversation: goalExt
          }
        }
      };

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
    options?: { contextMode?: 'recent' | 'full' }
  ) {
    const startTime = Date.now();

    try {
      // 获取对话历史
      const conversation = await prisma.goal_conversations.findUnique({
        where: { id: conversationId }
      });

      const data = JSON.parse(conversation.collectedData);
      const history = data.messages || [];
      const previousUnderstanding = data.understanding || {};
      const previousState = this.buildPreviousState(data, conversation.stage);

      // 正式链路固定使用完整可见历史 + state-first，与测试模式保持一致。
      const contextMode = 'full';
      const selectedHistory = history;

      // 调用专用 GoalConversationAgent
      const aiResponse = await runGoalConversationAgent({
        input: userInput,
        userId: userId || 'anonymous',
        conversationHistory: selectedHistory.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })),
        previousUnderstanding,
        previousStage: data.stage || conversation.stage,
        previousState,
        maxFormatRetries: this.MAX_FORMAT_RETRIES
      });

        logger.info('AI响应', {
        contextMode,
        historyCount: selectedHistory.length,
        stage: this.getCore(aiResponse.internal).stage,
        confidence: this.getCore(aiResponse.internal).confidence,
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
  private async saveMessage(conversationId: string, role: string, content: string) {
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId }
    });

    const data = JSON.parse(conversation.collectedData);
    data.messages = data.messages || [];
    data.messages.push({
      role,
      content,
      time: new Date().toISOString()
    });

    await prisma.goal_conversations.update({
      where: { id: conversationId },
      data: { collectedData: JSON.stringify(data) }
    });
  }

  /**
   * 更新收集的数据 - 问题穿透模式（新格式）
   */
  private async updateCollectedData(conversationId: string, aiResponse: {
    userVisible: string;
    internal: any;
  }) {
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId }
    });

    const data = JSON.parse(conversation.collectedData);

    const core = this.getCore(aiResponse.internal);
    const goalExt = this.getGoalExt(aiResponse.internal);

    // 合并已收集的信息（从 ext.goalConversation.collected）
    data.collected = { ...data.collected, ...goalExt.collected };
    data.confidence = core.confidence;

    // 保存 understanding 供前端展示
    data.understanding = goalExt.understanding || data.understanding || {};

    // 保存 stage
    data.stage = core.stage;

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

    if (core.learningPath !== undefined) {
      data.learningPath = core.learningPath || null;
    }

    await prisma.goal_conversations.update({
      where: { id: conversationId },
      data: { collectedData: JSON.stringify(data) }
    });

    const conversationOwner = await prisma.goal_conversations.findUnique({
      where: { id: conversationId },
      select: { userId: true }
    });

    if (conversationOwner?.userId) {
      void learnerSnapshotRefreshService.refresh({
        userId: conversationOwner.userId,
        scope: 'global'
      });
    }
  }

  private buildGoalPathRequest(
    conversation: any,
    aiResponse: any,
    existingPathId?: string
  ): GoalPathRequest {
    const data = JSON.parse(conversation.collectedData);
    const goalExt = this.getGoalExt(aiResponse.internal);
    const core = this.getCore(aiResponse.internal);
    const understanding = goalExt.understanding || data.understanding || {};
    const structuredData = goalExt.structuredData ?? data.structuredData ?? null;
    const confirmedProposal = goalExt.confirmedProposal ?? data.confirmedProposal ?? null;
    const confidenceScores = goalExt.confidenceScores ?? data.confidenceScores ?? null;
    const conversationHistory = Array.isArray(data.messages)
      ? data.messages
          .map((message: any) => ({
            role: message?.role === 'user' ? 'user' : 'assistant',
            content: typeof message?.content === 'string' ? message.content : ''
          }))
          .filter((message: { role: string; content: string }) => message.content)
      : [];

    return {
      userId: conversation.userId,
      sourceConversationId: conversation.id,
      existingPathId: existingPathId || conversation.learningPathId || undefined,
      source: 'goal',
      mode: 'generate',
      rawGoal: conversation.description,
      understanding,
      collected: data.collected || {},
      structuredData,
      confirmedProposal,
      confidenceScores,
      conversationHistory,
      finalUserVisible: aiResponse.userVisible || null,
      stage: core.stage,
      confidence: core.confidence,
    };
  }

  private buildPlaceholderPromptTemplatePayload(conversation: any, aiResponse: any, existingPathId: string) {
    const goalPathRequest = this.buildGoalPathRequest(conversation, aiResponse, existingPathId);

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
  private async generateLearningPath(conversation: any, aiResponse: any) {
    try {
      const learningPath = await pathOrchestrator.generateFromGoal(
        this.buildGoalPathRequest(conversation, aiResponse, conversation.learningPathId || undefined)
      );

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
  async regeneratePath(conversationId: string, userId: string, adjustments?: string) {
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
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: 'proposing',
          status: 'active',
          completedAt: null
        }
      });

      // 重新生成学习路径
      const learningPath = await this.generateLearningPath(conversation, {
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
      });

      // 更新状态为完成
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: 'completed',
          status: 'completed',
          completedAt: new Date(),
          learningPathId: learningPath?.id
        }
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
