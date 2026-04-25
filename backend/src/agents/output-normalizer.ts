import type { AgentOutput } from './protocol';

function asErrorMessage(error: AgentOutput['error']): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  return error.message;
}

export function normalizeAgentOutput(agentId: string, raw: any): AgentOutput {
  const base: AgentOutput = {
    ...(raw || {}),
    success: !!raw?.success,
    schemaVersion: raw?.schemaVersion || 'agent-output-v1'
  };

  if (base.userVisible && base.internal) {
    return base;
  }

  if (raw?.goalConversation) {
    return {
      ...base,
      userVisible: raw.goalConversation.userVisible,
      internal: raw.goalConversation.internal,
      renderHints: {
        ...(raw.goalConversation.internal?.quickReplies ? { quickReplies: raw.goalConversation.internal.quickReplies } : {})
      }
    };
  }

  if (raw?.output && typeof raw.output === 'object') {
    const visibleFromOutput =
      raw.output.message ||
      raw.output.reasoning ||
      raw.output.topicSummary ||
      raw.output.learningEvaluation;

    return {
      ...base,
      userVisible: base.userVisible || visibleFromOutput,
      internal: base.internal || { output: raw.output }
    };
  }

  if (raw?.path) {
    return {
      ...base,
      userVisible: base.userVisible || `学习路径已生成：${raw.path?.name || '未命名路径'}`,
      internal: base.internal || {
        core: {
          stage: 'completed',
          confidence: base.metadata?.confidence || 0.8,
          isCompleted: true
        },
        ext: {
          path: {
            path: raw.path,
            totalMilestones: raw.path?.milestones?.length || raw.path?.totalMilestones || 0
          }
        },
        path: raw.path
      },
      renderHints: {
        component: 'learning-path'
      }
    };
  }

  if (raw?.progress) {
    const reasoning = raw.progress?.metrics?.reasoning;
    const suggestion = raw.progress?.metrics?.suggestion;
    return {
      ...base,
      userVisible: base.userVisible || reasoning || suggestion || '学习进度已更新',
      internal: base.internal || { progress: raw.progress },
      renderHints: {
        component: 'progress-report'
      }
    };
  }

  if (raw?.profile || raw?.learner) {
    const learnerPayload = raw?.learner || {
      profile: raw.profile,
      changes: raw.changes,
      personalization: raw.personalization,
      config: raw.config,
      promptEnhancement: raw.promptEnhancement,
      contentHints: raw.contentHints
    };
    return {
      ...base,
      userVisible: base.userVisible || '学习者模型已更新',
      internal: base.internal || {
        ext: {
          learner: learnerPayload
        },
        learner: learnerPayload
      }
    };
  }

  if (!base.userVisible) {
    base.userVisible = base.success ? `${agentId} 执行完成` : (asErrorMessage(base.error) || `${agentId} 执行失败`);
  }

  if (!base.internal) {
    base.internal = {};
  }

  return base;
}
