/**
 * Quick Learn Propagation Report
 *
 * 学习传播报告：回答“这节课到底留下了什么，以及这些东西后来有没有被系统使用”。
 * 全部由确定性代码计算（快照/投影字段级 diff + 生命周期事实），不引入 AI 裁判。
 *
 * 设计要点：传播报告由确定性代码计算（快照/投影字段级 diff + 生命周期事实），不引入 AI 裁判。
 */

import type { LearnerSnapshot, TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { changedTopLevelFields, diffCollection, diffMetrics } from './snapshot-diff';

export const QUICK_LEARN_REPORT_SCHEMA_VERSION = 'quick-learn-report-v1';

export interface QuickLearnTranscriptEntry {
  turn: number;
  learner: string;
  teacher: string;
  isCompletion: boolean;
  autoEnded?: boolean;
  strategies?: string[];
  knowledgePoints?: string[];
  phaseFocus?: string;
  degraded?: boolean;
}

export interface QuickLearnLifecycleInput {
  sessionStarted: boolean;
  sessionClosed: boolean;
  wrapupGenerated: boolean;
  wrapupSource: 'model' | 'fallback' | 'failed' | null;
  completionReached: boolean;
  divergence: 'teacher_ready_learner_not' | 'learner_ready_teacher_not' | null;
  taskCompleted: boolean;
  outboxConsumerDone: boolean;
  projectionWaitMs: number;
  warnings: string[];
}

export interface QuickLearnRunInfo {
  runId: string;
  mode: string;
  profileId: string;
  userId: string;
  pathId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  turns: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

const METRIC_FIELDS = ['lss', 'ktl', 'lf', 'lsb'];

const GOAL_PROBE_STATIC_CONCLUSION =
  'Goal 当前不读取 Learner Snapshot（已知产品缺口）；本节课数据不会影响新 Goal。';
const GOAL_PROBE_STATIC_EVIDENCE =
  'backend/src/skills/goal-conversation/index.ts: buildGoalConversationUserPayload 仅发送 userInput/state/conversationContext';

export interface BuildPropagationReportInput {
  run: QuickLearnRunInfo;
  lifecycle: QuickLearnLifecycleInput;
  preSnapshot: LearnerSnapshot | null;
  postSnapshot: LearnerSnapshot | null;
  nextTask: { taskId: string; title: string } | null;
  preNextProjection: TeachingLearnerProjection | null;
  postNextProjection: TeachingLearnerProjection | null;
  transcript: QuickLearnTranscriptEntry[];
}

export function buildPropagationReport(input: BuildPropagationReportInput) {
  const { preSnapshot, postSnapshot } = input;

  const metricsDelta = diffMetrics(
    preSnapshot?.dynamicState?.metrics as unknown as Record<string, unknown> | undefined,
    postSnapshot?.dynamicState?.metrics as unknown as Record<string, unknown> | undefined,
    METRIC_FIELDS
  );

  const preSignals = preSnapshot?.knowledgeMemory?.globalSignals as unknown as Record<string, unknown> | undefined;
  const postSignals = postSnapshot?.knowledgeMemory?.globalSignals as unknown as Record<string, unknown> | undefined;
  const mastered = diffCollection(preSignals?.masteredConcepts, postSignals?.masteredConcepts);
  const fragile = diffCollection(preSignals?.fragileConcepts, postSignals?.fragileConcepts);
  const struggling = diffCollection(preSignals?.strugglingConcepts, postSignals?.strugglingConcepts);

  const preBackground = preSnapshot?.knowledgeMemory?.globalBackground as unknown as Record<string, unknown> | undefined;
  const postBackground = postSnapshot?.knowledgeMemory?.globalBackground as unknown as Record<string, unknown> | undefined;
  const confusions = diffCollection(preBackground?.recurringConfusions, postBackground?.recurringConfusions);
  const preLedgerLength = Array.isArray(preBackground?.conceptLedger) ? preBackground.conceptLedger.length : 0;
  const postLedgerLength = Array.isArray(postBackground?.conceptLedger) ? postBackground.conceptLedger.length : 0;

  const controlStateChanged = changedTopLevelFields(
    preSnapshot?.learningControlState as unknown as Record<string, unknown> | undefined,
    postSnapshot?.learningControlState as unknown as Record<string, unknown> | undefined
  );

  const teachingHintsChanged = changedTopLevelFields(
    preSnapshot?.teachingHints as unknown as Record<string, unknown> | undefined,
    postSnapshot?.teachingHints as unknown as Record<string, unknown> | undefined
  ).length > 0;

  const preSignal = preSnapshot?.replanSignal as unknown as Record<string, unknown> | undefined;
  const postSignal = postSnapshot?.replanSignal as unknown as Record<string, unknown> | undefined;
  const replanSignalChanged = changedTopLevelFields(preSignal, postSignal).length > 0;

  const nextTaskChangedFields = input.nextTask
    ? changedTopLevelFields(
        input.preNextProjection as unknown as Record<string, unknown> | undefined,
        input.postNextProjection as unknown as Record<string, unknown> | undefined
      )
    : [];

  return {
    schemaVersion: QUICK_LEARN_REPORT_SCHEMA_VERSION,
    run: input.run,
    lifecycle: input.lifecycle,
    learnerDelta: {
      metrics: metricsDelta,
      knowledge: {
        newMastered: mastered.added,
        lostMastered: mastered.removed,
        newFragile: fragile.added,
        resolvedFragile: fragile.removed,
        newStruggling: struggling.added,
        resolvedStruggling: struggling.removed,
        newRecurringConfusions: confusions.added,
        resolvedRecurringConfusions: confusions.removed,
        conceptLedgerBefore: preLedgerLength,
        conceptLedgerAfter: postLedgerLength,
      },
      controlState: {
        before: preSnapshot?.learningControlState ?? null,
        after: postSnapshot?.learningControlState ?? null,
        changed: controlStateChanged,
      },
      teachingHintsChanged,
      freshness: {
        before: preSnapshot?.freshness?.basedOn ?? null,
        after: postSnapshot?.freshness?.basedOn ?? null,
      },
    },
    downstream: {
      nextTask: input.nextTask
        ? {
            taskId: input.nextTask.taskId,
            title: input.nextTask.title,
            projectionChanged: nextTaskChangedFields.length > 0,
            changedFields: nextTaskChangedFields,
          }
        : null,
      replan: {
        before: preSignal ?? null,
        after: postSignal ?? null,
        signalChanged: replanSignalChanged,
        projectionAvailable: !!postSnapshot?.knowledgeMemory?.currentPath,
      },
      goal: {
        consumesLearnerSnapshot: false,
        conclusion: GOAL_PROBE_STATIC_CONCLUSION,
        evidence: GOAL_PROBE_STATIC_EVIDENCE,
      },
    },
    transcript: input.transcript,
  };
}

export type QuickLearnPropagationReport = ReturnType<typeof buildPropagationReport>;
