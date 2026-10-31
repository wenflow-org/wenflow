/**
 * Goal 对话「completed 硬阻断补充说明重判」与确认链路共用段（2026-10-29 抽自 goal-conversation.service）。
 *
 * 为什么单独成文件：死路修复（H-1/H-2、M-10/M-11）新增的 ~240 行（重判全流程 +
 * bindGeneratingPath / kickPathGeneration 确认共用段）顶破了 services-layering 对
 * goal-conversation.service 的基线；抽出来后 service 只保留状态机判断与薄委托调用。
 *
 * 依赖注入约定（与 goal-conversation.lifecycle.ts 同款）：本模块**不 import service**，
 * 用到的 service 私有方法（callAI / saveMessage / updateCollectedData 等）以 deps 回调
 * 由 service 在调用点 `.bind(this)` 注入，避免循环依赖；prisma / logger / 学习服务 /
 * 路径编排器等横切依赖直接 import（与 service 同一模块，单测按同一路径 mock 即可生效）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import pathOrchestrator, { GoalPathRequest } from '../../coordinators/path.coordinator';
import {
  isHardBlockResponseTriage,
  resolveResponseTriageFromCollectedData,
  triageGoalResponse,
} from './response-triage';
import { buildCompletedConversationResult, buildHardBlockMessage } from './goal-conversation.exit';
import learningService from './learning.service';

/** service 侧 GoalConversationOptions 的结构子集（重判链路只读 meta / systemPromptOverrides 并原样透传） */
interface RejudgeConversationOptions {
  meta?: Record<string, number> | null;
  systemPromptOverrides?: {
    goalAgent?: string;
    pathAgent?: string;
  };
}

/** 会话行的最小结构面（本模块只读 id；prisma 行天然满足） */
interface ConversationRef {
  id: string;
}

/** 模型回合信封的最小结构面（callAI 实际返回更宽的形状，调用点断言收窄仅发生在类型层面） */
interface AiTurnResponse {
  userVisible: string;
  internal?: unknown;
  debug?: { attemptCount?: number } | null;
}

/**
 * service 以 `.bind(this)` 注入的私有方法集合（避免本模块反向依赖 service）。
 * 参数/返回口径取本模块真正用到的最小面；service 侧更宽的签名在参数双向协变（仓库 strict 关闭）下天然兼容。
 */
export interface GoalConversationRejudgeDeps {
  createGeneratingPlaceholderPath: (conversation: ConversationRef, seedResult: unknown) => Promise<{ id: string }>;
  updateConversationLifecycle: (
    conversationId: string,
    stage: 'understanding' | 'proposing' | 'ready' | 'completed',
    options?: {
      status?: string;
      completedAt?: Date | null;
      learningPathId?: string | null;
      learningPath?: { id: string; status?: string } | null;
      appendMessage?: { role: 'user' | 'ai'; content: string };
      mutateCollectedData?: (data: Record<string, unknown>) => void;
      /** 传值 = revision 条件更新（CAS）；失配返回 false 且不写入（审计 §1.4） */
      expectedRevision?: number;
    }
  ) => Promise<boolean>;
  buildGoalPathRequest: (
    conversation: ConversationRef,
    seedResult: unknown,
    existingPathId?: string,
    systemPromptOverrides?: RejudgeConversationOptions['systemPromptOverrides']
  ) => Promise<GoalPathRequest>;
  callAI: (
    conversationId: string,
    userInput: string,
    isFirst: boolean,
    userId?: string,
    options?: RejudgeConversationOptions
  ) => Promise<unknown>;
  withConversationId: (result: unknown, conversationId: string) => unknown;
  getStructuredOutputValid: (aiResponse: unknown) => boolean;
  throwStructuredOutputInvalid: (result: unknown) => never;
  saveMessage: (
    conversationId: string,
    role: string,
    content: string,
    meta?: Record<string, number> | null,
    extra?: { quickReplies?: unknown }
  ) => Promise<void>;
  getGoalExt: (internal: unknown) => { quickReplies?: unknown };
  updateCollectedData: (conversationId: string, aiResponse: unknown) => Promise<void>;
  buildConfirmedResult: (
    conversationId: string,
    data: Record<string, unknown>,
    learningPath: { id: string; status?: string } | null
  ) => unknown;
}

/**
 * 确认链路共用段（2026-10-29 抽取）：建占位路径 → 认领生成 run → 以 revision CAS 把路径
 * 原子绑定到会话。两个调用方：proposing 阶段的 confirmProposal 硬规则、
 * completed 硬阻断会话的补充说明重判通过（rejudgeHardBlockedCompletion）。
 * 返回 bound=false 表示 CAS 失配（并发写赢了自己），占位路径由调用方负责作废。
 */
export async function bindGeneratingPath(
  deps: GoalConversationRejudgeDeps,
  input: {
    conversation: ConversationRef;
    data: Record<string, unknown>;
    appendMessage?: { role: 'user' | 'ai'; content: string };
    expectedRevision?: number;
    onBound?: (currentData: Record<string, unknown>) => void;
    systemPromptOverrides?: RejudgeConversationOptions['systemPromptOverrides'];
  }
) {
  const seedResult = {
    userVisible: '',
    internal: {
      core: {
        stage: 'ready',
        confidence: input.data.confidence || 0.9,
        isCompleted: true
      },
      ext: {
        goalConversation: {
          understanding: input.data.understanding || {},
          nextQuestions: [],
          collected: input.data.collected || {}
        }
      }
    }
  };

  const placeholderPath = await deps.createGeneratingPlaceholderPath(input.conversation, seedResult);
  const runId = await learningService.claimPathCoreGeneration(placeholderPath.id, null);

  // 原子确认（审计 §1.4）：以 revision 条件把「确认权 + 占位路径」一次性绑定；
  // 并发/重试的落败方 CAS 失配：不写库、不推进对话（占位路径由调用方作废并读最新状态兜底）。
  const bound = await deps.updateConversationLifecycle(input.conversation.id, 'completed', {
    status: 'completed',
    completedAt: new Date(),
    learningPathId: placeholderPath.id,
    learningPath: { id: placeholderPath.id, status: 'generating' },
    ...(input.appendMessage ? { appendMessage: input.appendMessage } : {}),
    ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
    ...(input.onBound ? { mutateCollectedData: input.onBound } : {}),
  });

  return { bound, placeholderPath, runId, seedResult };
}

/** 确认链路共用段：绑定成功后异步跑 Path 生成（失败回调作废占位路径，供 markActiveGenerationFailed 兜底）。 */
export async function kickPathGeneration(
  deps: GoalConversationRejudgeDeps,
  input: {
    conversation: ConversationRef;
    seedResult: unknown;
    pathId: string;
    runId: string;
    systemPromptOverrides?: RejudgeConversationOptions['systemPromptOverrides'];
  }
) {
  pathOrchestrator.runGoalAsync(
    {
      ...await deps.buildGoalPathRequest(input.conversation, input.seedResult, input.pathId, input.systemPromptOverrides),
      generationRunId: input.runId,
      createdPlaceholder: true
    },
    {
      onSuccess: () => {
        logger.info('硬规则触发：异步学习路径生成成功', { conversationId: input.conversation.id, pathId: input.pathId });
      },
      onError: async (pathError) => {
        logger.error('硬规则触发：异步学习路径生成失败', { conversationId: input.conversation.id, pathId: input.pathId, error: String(pathError) });
        await learningService.markActiveGenerationFailed(input.pathId, pathError, input.runId);
      }
    }
  );
}

/**
 * completed 硬阻断会话的补充说明重判（2026-10-29 H-1/H-2、M-10/M-11 修复）。
 *
 * 背景：确认被分诊硬阻断后会话强制 completed，旧逻辑对后续 /reply 一律 0 秒重放同一段
 * 拒绝文案（buildCompletedConversationResult 短路，新消息不被读取、库中零痕迹），而文案却
 * 承诺「补充说明后我会重新判断」——用户做无用功后死路。本方法让承诺成真：
 *   1. 新消息照常入对话（用户补充 + 模型回合都落库）；
 *   2. 模型按「原目标 + 补充说明」重新提取 understanding，updateCollectedData 内重算分诊；
 *   3. 仍硬阻断 → 返回更新后的拒绝文案（明说重判仍不通过，建议换知识型框架重开对话）；
 *      硬阻断解除 → 复用确认链路生成路径并回写 learningPathId（同一会话只允许一条活路径，
 *      learningPathId 回写 + CAS 双保险，重复补充说明只会拿到已有路径）。
 *
 * 返回 null = 不适用重判（存档分诊非硬阻断），调用方回落既有 completed 行为（不回归）。
 * 与 proposing 确认分支「不允许再次确认放行」的关系：那条规则拦的是对同一份旧证据的重复
 * 确认动作，这里重判的是用户补充后的新证据，二者不冲突。
 */
export async function rejudgeHardBlockedCompletion(
  deps: GoalConversationRejudgeDeps,
  conversation: { id: string; collectedData: string | null; learningPathId: string | null },
  userReply: string,
  userId: string,
  options?: RejudgeConversationOptions
  // 抽出前签名即 `Promise<any | null>`：continueConversation 的返回联合依赖这里的 any 收口
  // （any | T = any），消费方（simulation.execution.ts 等）按宽松信封读取 internal.core.*。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const data = JSON.parse(conversation.collectedData || '{}');
  const storedTriage = resolveResponseTriageFromCollectedData(data);
  if (!storedTriage || !isHardBlockResponseTriage(storedTriage, data.understanding)) {
    return null;
  }

  logger.info('[goal-conversation] 硬阻断会话收到补充说明，重新分诊', {
    conversationId: conversation.id,
    userId,
    replyPreview: userReply.slice(0, 40),
  });

  // 调模型把补充说明并进 understanding（先不写当前用户消息，避免本轮输入重复进入上下文）
  const aiResponse = (await deps.callAI(conversation.id, userReply, false, userId, options)) as AiTurnResponse;
  const responseWithConversationId = deps.withConversationId(aiResponse, conversation.id);

  if (!deps.getStructuredOutputValid(aiResponse)) {
    // 422 恢复信封前先持久化本轮用户消息，保证补充说明不丢（与普通回合同款兜底）
    await deps.saveMessage(conversation.id, 'user', userReply, options?.meta);
    logger.warn('[goal-conversation] 硬阻断重判结构化输出失败，状态未更新', {
      conversationId: conversation.id,
      userId,
      attemptCount: aiResponse?.debug?.attemptCount || 0
    });
    deps.throwStructuredOutputInvalid(responseWithConversationId);
  }

  // 追加进对话：用户补充说明 + 模型回合（补充说明从此在库有痕迹，不再被短路丢弃）
  await deps.saveMessage(conversation.id, 'user', userReply, options?.meta);
  await deps.saveMessage(conversation.id, 'ai', aiResponse.userVisible, null, { quickReplies: deps.getGoalExt(aiResponse.internal).quickReplies });

  // 持久化更新后的 understanding，并重算落库分诊结论（updateCollectedData 内重算 RESPONSE_TRIAGE_KEY）
  await deps.updateCollectedData(conversation.id, responseWithConversationId);

  // 重读最新状态做重判（与落库口径一致：understanding / responseTriage 都取刚写入的值）
  const latest = await prisma.goal_conversations.findUnique({ where: { id: conversation.id } });
  if (!latest) {
    throw new Error('对话会话不存在');
  }
  const latestData = JSON.parse(latest.collectedData || '{}');

  // 幂等护栏：重判期间路径已被并发写绑定（另一条补充说明的赢家）→ 复用已有路径，不再建第二条
  if (latest.learningPathId) {
    const boundPath = await prisma.learning_paths.findFirst({ where: { id: latest.learningPathId } });
    return deps.buildConfirmedResult(
      conversation.id,
      latestData,
      boundPath ? { id: boundPath.id, status: boundPath.status } : null
    );
  }

  const rejudgedTriage = resolveResponseTriageFromCollectedData(latestData)
    || triageGoalResponse(latestData.understanding || {});
  if (isHardBlockResponseTriage(rejudgedTriage, latestData.understanding)) {
    // 仍被拦：恢复终态语义（stage 列写回 completed，status 保持 completed），返回更新后的拒绝文案
    await deps.updateConversationLifecycle(conversation.id, 'completed', { status: 'completed' });
    logger.info('[goal-conversation] 硬阻断重判仍不通过', {
      conversationId: conversation.id,
      mode: rejudgedTriage.mode,
      confidence: rejudgedTriage.confidence
    });
    return {
      userVisible: buildHardBlockMessage(rejudgedTriage, { rejudged: true }),
      internal: {
        core: {
          conversationId: conversation.id,
          stage: 'completed' as const,
          confidence: latestData.confidence || 0,
          isCompleted: true,
          learningPath: null
        },
        ext: {
          goalConversation: {
            understanding: latestData.understanding || {},
            nextQuestions: [] as string[],
            quickReplies: [] as string[],
            collected: latestData.collected || {},
            responseTriage: rejudgedTriage
          }
        }
      }
    };
  }

  // 重判通过：复用确认链路生成路径（硬阻断是唯一无条件闸门，解除即放行，
  // 与 generate 直连入口同口径；confirmProposal 的确认计量不适用本链路，不落 lastConfirmation）
  const { bound, placeholderPath, runId, seedResult } = await bindGeneratingPath(deps, {
    conversation: latest,
    data: latestData,
    expectedRevision: latest.revision
  });
  if (!bound) {
    // CAS 失配：并发写赢了自己。作废自己的占位路径后按最新状态返回（赢家可能已绑路径）。
    await learningService
      .markActiveGenerationFailed(placeholderPath.id, new Error('并发重判，本条占位路径作废'), runId)
      .catch(() => undefined);
    const refreshed = await prisma.goal_conversations.findUnique({ where: { id: conversation.id } });
    if (refreshed?.learningPathId) {
      const refreshedData = refreshed.collectedData ? JSON.parse(refreshed.collectedData) : latestData;
      const winnerPath = await prisma.learning_paths.findFirst({ where: { id: refreshed.learningPathId } });
      return deps.buildConfirmedResult(
        conversation.id,
        refreshedData,
        winnerPath ? { id: winnerPath.id, status: winnerPath.status } : null
      );
    }
    return buildCompletedConversationResult({
      conversationId: conversation.id,
      collectedData: refreshed?.collectedData ?? null,
      learningPathId: refreshed?.learningPathId ?? null,
      findPath: (id) => prisma.learning_paths.findFirst({ where: { id } }),
    });
  }

  await kickPathGeneration(deps, {
    conversation: latest,
    seedResult,
    pathId: placeholderPath.id,
    runId,
    systemPromptOverrides: options?.systemPromptOverrides
  });

  return {
    userVisible: '已收到你的补充说明，重新判断后可以生成学习路径，正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
    internal: {
      core: {
        conversationId: conversation.id,
        stage: 'completed' as const,
        confidence: latestData.confidence || 0.9,
        isCompleted: true,
        learningPath: { id: placeholderPath.id, status: 'generating' }
      },
      ext: {
        goalConversation: {
          understanding: latestData.understanding || {},
          nextQuestions: [] as string[],
          quickReplies: [] as string[],
          collected: latestData.collected || {},
          responseTriage: rejudgedTriage
        }
      }
    }
  };
}
