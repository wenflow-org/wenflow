export type SessionEvaluationSource = 'model' | 'ai-fallback' | 'failed' | 'unavailable';
export type FinalizeAction = 'end_only' | 'complete_task' | 'complete_review';
export type FinalizationStepStatus = 'not_started' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface SessionFinalizationState {
  sessionClosure: FinalizationStepStatus;
  taskCompletion: FinalizationStepStatus;
  reviewCompletion: FinalizationStepStatus;
  lastAction: FinalizeAction;
  lastOperationId: string;
  lastRequestedAt: string;
  lastCompletedAt?: string;
  lastErrorCode?: string;
}

export function getSessionFinalizationState(
  teachingState: Record<string, any> | null | undefined
): SessionFinalizationState | null {
  const value = teachingState?.finalization;
  return value && typeof value === 'object' ? value as SessionFinalizationState : null;
}

export function updateSessionFinalizationState(
  teachingState: Record<string, any> | null | undefined,
  action: FinalizeAction,
  operationId: string,
  step: 'sessionClosure' | 'taskCompletion' | 'reviewCompletion',
  status: FinalizationStepStatus,
  options: { errorCode?: string; completedAt?: string; requestedAt?: string } = {}
): Record<string, any> {
  const previous = getSessionFinalizationState(teachingState);
  const finalization: SessionFinalizationState = {
    sessionClosure: previous?.sessionClosure || 'not_started',
    taskCompletion: previous?.taskCompletion || 'not_started',
    reviewCompletion: previous?.reviewCompletion || 'not_started',
    lastAction: action,
    lastOperationId: operationId,
    lastRequestedAt: options.requestedAt || previous?.lastRequestedAt || new Date().toISOString(),
    ...(previous?.lastCompletedAt ? { lastCompletedAt: previous.lastCompletedAt } : {}),
    ...(options.errorCode ? { lastErrorCode: options.errorCode } : {})
  };
  finalization[step] = status;
  if (!options.errorCode) delete finalization.lastErrorCode;
  if (options.completedAt) finalization.lastCompletedAt = options.completedAt;

  return {
    ...(teachingState || {}),
    finalization
  };
}

export function hasReliableSessionEvaluation(
  evaluation: unknown,
  source: SessionEvaluationSource
): boolean {
  return source !== 'failed' && source !== 'unavailable' && evaluation !== null && evaluation !== undefined;
}

export function mergeFinalTeachingState(
  currentState: Record<string, any> | null,
  finalMetrics: Record<string, any> | null,
  sessionArtifacts: Record<string, any>
): Record<string, any> {
  const next: Record<string, any> = {
    ...(currentState || {}),
    ...(finalMetrics || {}),
    sessionArtifacts
  };
  // 结束态清理：不再需要待处理检查点（避免详情接口残留 + 阻断后续新会话状态回读）
  delete next.pendingCheckpoint;
  delete next.lastCheckpointTurn;
  if (next.sessionArtifacts && typeof next.sessionArtifacts === 'object') {
    delete next.sessionArtifacts.pendingCheckpoint;
  }
  return next;
}
