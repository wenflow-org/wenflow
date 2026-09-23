/**
 * 教学回合共享原语（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：teaching-agent 身份常量、教学态版本守卫、消息时间戳追加、教学回合输入组装
 * （buildTeachingTurnInput：上下文压缩 + 三路背景注入 + 暖场/检查点挂载）、
 * 模型输出提取三件套。供 AITeachingCoordinator 与 teaching-turn-engine 共用，
 * 独立成模块以避免二者互相 import 形成环。
 */
import { assembleTeachingTurnChannels } from '../field-dispatcher';
import { teachingContextCompressionService } from './TeachingContextCompressionService';
import { parseSessionArtifacts } from './checkpoint-shared';
import { pendingWarmupForModel } from './teaching-warmup';
import { shouldEmitCheckpoint, summarizeCheckpointHistory } from './teaching-checkpoint';
import {
  LearnStage,
  buildLearnerStateContext,
  buildPathBackgroundContext,
  buildTeachingControlContext,
} from './teaching-classroom-flow';
import type { TeachingMode } from './AITeachingCoordinator';
import { TeachingSessionConflictError, type TeachingSessionRecord, type TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingScenarioContext, TeachingTemporalGap } from './TeachingContextBuilder';
import type { TeachingTurnInput } from '../../skills/teaching-turn';
import type { AnchorProbePlan } from '../learner/anchor-probe';
import { buildAnchorPromptTarget, type AnchorPromptTarget } from './anchor-probe-emit';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';

function toMessageRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

export const AI_TEACHING_AGENT_ID = 'teaching-agent';

export function requireTeachingRevision(revision: number | undefined): number {
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new TeachingSessionConflictError('缺少有效的课堂 revision', 'TEACHING_REVISION_REQUIRED');
  }
  return Number(revision);
}

export function appendTimestamp(messages: Array<{ role: string; content: string; timestamp?: string; analysis?: any; checkpoint?: boolean; meta?: Record<string, number> | null }>): TeachingSessionMessage[] {
  return messages.map((message) => ({
    role: toMessageRole(message.role),
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString(),
    ...(message.analysis ? { analysis: message.analysis } : {}),
    ...(message.checkpoint ? { checkpoint: true } : {}),
    ...(message.meta && Object.keys(message.meta).length > 0 ? { meta: message.meta } : {})
  }));
}

export async function buildTeachingTurnInput(
  session: TeachingSessionRecord,
  context: TeachingScenarioContext,
  options: { anchorTarget?: AnchorProbePlan | null } = {},
): Promise<TeachingTurnInput> {
  const compression = teachingContextCompressionService.compress(session.messages);
  const teachingState = session.teachingState || {};
  const classroomContext = teachingState.classroomContext || {};
  const learnerStateContext = teachingState.learnerStateContext || buildLearnerStateContext(context, teachingState);
  const teachingControlContext = teachingState.teachingControlContext || buildTeachingControlContext(
    (classroomContext?.stage?.current as LearnStage) || 'opening',
    context,
    learnerStateContext,
    parseSessionArtifacts(teachingState),
  );
  const classroomEventContext = {
    recentEvents: Array.isArray(teachingState.classroomEventHistory)
      ? teachingState.classroomEventHistory.slice(-5)
      : [],
  };

  const scenario: TeachingTurnInput['scenario'] = {
    subject: context.subject,
    topic: context.topic,
    taskTitle: context.taskTitle,
    taskDescription: context.taskDescription,
    taskType: context.taskType,
    taskProfile: context.taskProfile,
    currentTaskContext: context.currentTaskContext,
    cognitiveFrame: context.cognitiveFrame,
    teachingStrategyGuidance: context.teachingStrategyGuidance,
    materials: context.materials ?? null,
    pathTitle: context.pathProgress.pathTitle,
    pathSummary: context.pathProgress.pathSummary,
    currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
    currentStageNumber: context.pathProgress.currentStageNumber,
    currentTaskOrder: context.pathProgress.currentTaskOrder,
    totalTasksInMilestone: context.pathProgress.totalTasksInMilestone,
    taskKnowledgeScope: context.taskKnowledgeScope,
    pathBackgroundContext: buildPathBackgroundContext(context),
    learningSignal: context.learningSignal,
    lastLessonRecap: context.lastLessonRecap,
    priorLearningContext: context.priorLearningContext,
    learnerInsights: context.learnerInsights ?? null,
    // 检查点历史（写侧 2026-09-17 起补 title/type）：让模型知道哪些点没通过，换表征再确认
    checkpointHistory: summarizeCheckpointHistory(teachingState.checkpointHistory),
    memoryWarmup: pendingWarmupForModel(context.memoryWarmup),
    learnerPrediction: context.learnerPrediction
      ? {
          stallRisk: context.learnerPrediction.stallRisk,
          predictedTone: context.learnerPrediction.predictedTone,
          suggestedDepth: context.learnerPrediction.suggestedDepth,
          focusConcepts: context.learnerPrediction.focusConcepts,
          rationale: context.learnerPrediction.rationale,
          reliability: context.learnerPrediction.reliability,
        }
      : undefined,
    interactionProfile: context.interactionProfile
      ? {
          current: (context.interactionProfile.current ?? null) as Record<string, number> | null,
          history: (context.interactionProfile.history ?? []).map((h) => ({
            role: h.role,
            timestamp: h.timestamp,
            meta: (h.meta ?? null) as Record<string, number> | null,
            textLength: h.textLength,
          })),
          absent: context.interactionProfile.absent,
        }
      : undefined,
    contextCompression: compression.compressed ? {
      enabled: true,
      estimatedTokens: compression.estimatedTokens,
      triggerTokens: compression.triggerTokens,
      recap: compression.recap,
    } : undefined,
    taskMode: context.taskMode,
    priorMisconceptions: context.priorMisconceptions,
    behavioralProfile: context.behavioralProfile,
  };

  // L2 声明化装配（只读对账）：状态池形状由 sandbox-resolver 的 teaching provider 声明，
  // 本链只提供原始 context。缺键打 warn，不阻断。
  try {
    const { checkAgentSandboxRefsFromContext } = await import('../sandbox-resolver.service');
    await checkAgentSandboxRefsFromContext(
      'teaching-turn',
      'teaching',
      {
        sessionMessages: session.messages.map((item) => ({ role: item.role, content: item.content })),
        sessionId: session.id,
        mode: session.mode,
        topic: context.topic,
        learnerProjection: context.learnerProjection,
        knowledgeState: session.knowledgeState,
        classroomContext,
        teachingControlContext,
        classroomEventContext,
        scenario: scenario as Record<string, unknown>,
        interactionProfile: (context as any).interactionProfile,
      },
      { warnContext: { sessionId: session.id } }
    );
  } catch {
    // 对账失败不影响主流程
  }

  // 配置式输入通道（P2 声明 + 本链运行时消费）：routings 表 teaching-agent 通道行抽值优先，缺失回退既有组装
  const { channels } = await assembleTeachingTurnChannels({ session, teachingState, context }).catch(() => ({ channels: {}, skipped: [] }));

  const anchorTarget = options.anchorTarget ?? null;
  const controls: TeachingTurnInput['controls'] & {
    anchorProbe?: AnchorPromptTarget;
    /** 真实侧时间信号（跨会话长间隔）：无前序会话时为 undefined，不注入该字段 */
    temporalGap?: TeachingTemporalGap;
  } = {
    mode: session.mode as TeachingMode,
    teachingControlContext: channels['controls.teachingControlContext'] || teachingControlContext,
    // 出题触发由代码给（2026-09-17）：模型只出题与答案键，不再自行决定"什么时候探测"
    emitCheckpoint: shouldEmitCheckpoint(session, teachingState),
  };
  // 独立锚题探针（Q13/B4）：仅当本轮由代码选定目标时注入——提示词据此把本次检查点改成
  // 对该概念的独立复测（见 prompts/core/teaching-turn.yaml 的锚题约束）。目标为 null 时不注入任何字段。
  if (anchorTarget) {
    controls.anchorProbe = buildAnchorPromptTarget(anchorTarget);
  }
  // 真实侧时间信号（Q19 真实侧）：有前序会话才注入；无前序时字段缺失，提示词行为不变。
  if (context.temporalGap) {
    controls.temporalGap = context.temporalGap;
  }

  return {
    messages: compression.messages,
    learner: channels['learner.learnerProjection'] || context.learnerProjection,
    scenario,
    classroomContext: channels['classroomContext'] || classroomContext,
    classroomEventContext,
    knowledge: {
      points: (channels['knowledge.state'] && Array.isArray(channels['knowledge.state'])
        ? channels['knowledge.state']
        : session.knowledgeState),
    },
    controls
  };
}

export function extractTeachingOutput(agentOutput: any): TeachingTurnOutput {
  return (
    agentOutput?.internal?.ext?.teachingTurnOutcome?.artifact
    || agentOutput?.internal?.ext?.teaching
  ) as TeachingTurnOutput;
}

export function extractPeerDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.peer || null;
}

export function extractTeachingPromptDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.promptDebug || null;
}
