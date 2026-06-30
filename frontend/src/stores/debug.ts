import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export interface GoalDebugData {
  requestLog: any[];
  promptVersion?: number;
  parseMode?: string;
  attemptCount?: number;
  actualRetryCount?: number;
  formatFailureCount?: number;
  capturedAt: number;
}

export interface TeachingDebugTrace {
  sessionId: string;
  promptDebug: any;
  peerDebug?: any;
  analysis?: any;
  traceId?: string;
  capturedAt: number;
}

export const useDebugStore = defineStore('debug', () => {
  const currentTraceId = ref<string | null>(null);
  const goalDebugData = shallowRef<GoalDebugData | null>(null);
  const teachingDebugTraces = ref<TeachingDebugTrace[]>([]);
  const lastCaptureUrl = ref<string | null>(null);
  const lastCaptureTime = ref<number | null>(null);

  function setTraceId(traceId: string | null) {
    currentTraceId.value = traceId;
  }

  function captureGoalDebug(data: any, url: string) {
    goalDebugData.value = {
      requestLog: data?.requestLog || [],
      promptVersion: data?.promptVersion,
      parseMode: data?.parseMode,
      attemptCount: data?.attemptCount,
      actualRetryCount: data?.actualRetryCount,
      formatFailureCount: data?.formatFailureCount,
      capturedAt: Date.now(),
    };
    lastCaptureUrl.value = url;
    lastCaptureTime.value = Date.now();
  }

  function captureTeachingDebug(sessionId: string, data: any, url: string, traceId?: string) {
    teachingDebugTraces.value.push({
      sessionId,
      promptDebug: data?.promptDebug || null,
      peerDebug: data?.peerDebug || null,
      analysis: data?.analysis || null,
      traceId: traceId || currentTraceId.value || undefined,
      capturedAt: Date.now(),
    });
    if (teachingDebugTraces.value.length > 50) {
      teachingDebugTraces.value = teachingDebugTraces.value.slice(-50);
    }
    lastCaptureUrl.value = url;
    lastCaptureTime.value = Date.now();
  }

  function captureAdaptiveGuidanceDebug(data: any, url: string) {
    goalDebugData.value = {
      requestLog: [],
      capturedAt: Date.now(),
      ...data,
    };
    lastCaptureUrl.value = url;
    lastCaptureTime.value = Date.now();
  }

  function clear() {
    currentTraceId.value = null;
    goalDebugData.value = null;
    teachingDebugTraces.value = [];
    lastCaptureUrl.value = null;
    lastCaptureTime.value = null;
  }

  return {
    currentTraceId,
    goalDebugData,
    teachingDebugTraces,
    lastCaptureUrl,
    lastCaptureTime,
    setTraceId,
    captureGoalDebug,
    captureTeachingDebug,
    captureAdaptiveGuidanceDebug,
    clear,
  };
});
