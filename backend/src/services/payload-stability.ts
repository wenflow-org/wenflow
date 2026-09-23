/**
 * Payload 稳定前缀 SSOT（Context Mechanism §2/§4 收口）
 *
 * 目标：把「稳定键前置、逐次变化键后置」从**各 skill 的手写约定**升级为
 * **单源声明 + 门禁**，防止后续改动把易变键挪回前缀位置（前缀缓存能力回归）。
 *
 * - 本文件声明每个 skill payload 的 **leading 稳定键**（按实际输出顺序）；
 * - 门禁 `prompts:payload-prefix:check` 用**真实遥测**校验最近 payload 的首键是否落在声明内。
 *
 * 维护：新增/调整某 skill 的键序时，同步更新本表（否则门禁会报不一致）。
 */
export interface PayloadStabilitySpec {
  /** 期望出现在 payload 最前面的稳定键（按声明顺序） */
  readonly stable: readonly string[];
  /** 为什么这些键稳定（供人审阅） */
  readonly note: string;
}

export const PAYLOAD_STABILITY: Readonly<Record<string, PayloadStabilitySpec>> = {
  'teaching-turn': {
    stable: ['scenario', 'promptDirectives', 'learner'],
    note: 'scenario(洁)/promptDirectives/learner 跨回合稳定；controls/knowledge/对话等逐回合变化后置',
  },
  'stage-designer': {
    stable: ['cognitiveCore', 'normalizedInput', 'materials'],
    note: '跨里程碑不变；milestone/previousMilestone/repairHints 后置（materials 是整条路径的投影，同样逐里程碑不变）',
  },
  'path-reviewer': {
    stable: ['prerequisiteTree', 'goalContext'],
    note: '整条路径不变的前提知识树与目标上下文；pathPlan 后置',
  },
  'adaptive-guidance-copy': {
    stable: ['view', 'path'],
    note: '视图名与路径投影逐次稳定；learner/learningState/wrapup/advisory 后置',
  },
  'virtual-learner-learn-turn-simulator': {
    stable: ['task', 'personaAnchorHint', 'story', 'learner'],
    note: '任务说明/人设锚点/故事/画像为常量或慢变；回合状态后置',
  },
  'virtual-learner-goal-dialogue-simulator': {
    stable: ['personaAnchorHint', 'task', 'learner', 'story'],
    note: '人设锚点/任务/画像/故事稳定；可见对话与回合状态后置',
  },
  'virtual-learner-path-evaluator': {
    stable: ['task', 'personaAnchorHint', 'goalState', 'learner'],
    note: '任务/锚点/目标态/画像稳定；路径提案与回合状态后置',
  },
  'virtual-learner-persona-designer': {
    stable: ['candidatePersonas', 'preferredLevels', 'recentPersonaHints', 'existingPersonaSeed'],
    note: '候选池/偏好/提示稳定；已有种子后置',
  },
  'teaching-opening-generator': {
    stable: ['learner', 'openingMode'],
    note: '学习者摘要与开场模式跨回合稳定；任务上下文后置',
  },
  'learner-progress-report': {
    stable: ['signals', 'metrics'],
    note: '信号与指标为输入摘要；task 后置',
  },
  'learning-predictor': {
    stable: ['fatigueSignal', 'knowledgeStateSummary'],
    note: '疲劳信号与历史摘要稳定；taskContext 后置',
  },
};

export interface PayloadStabilityIssue {
  skillId: string;
  kind: 'map-invalid' | 'first-key-violation';
  detail: string;
}

/** 校验声明表本身的一致性（非空、无重复键） */
export function validateStabilityMap(
  map: Readonly<Record<string, PayloadStabilitySpec>> = PAYLOAD_STABILITY
): PayloadStabilityIssue[] {
  const issues: PayloadStabilityIssue[] = [];
  for (const [skillId, spec] of Object.entries(map)) {
    if (!spec || !Array.isArray(spec.stable) || spec.stable.length === 0) {
      issues.push({ skillId, kind: 'map-invalid', detail: 'stable 为空' });
      continue;
    }
    const dupes = spec.stable.filter((key, index) => spec.stable.indexOf(key) !== index);
    if (dupes.length > 0) {
      issues.push({ skillId, kind: 'map-invalid', detail: `stable 含重复键：${[...new Set(dupes)].join(',')}` });
    }
  }
  return issues;
}

/** 单条 payload 的首键是否落在声明的稳定段内 */
export function isFirstKeyStable(skillId: string, firstKey: string | undefined): boolean {
  const spec = PAYLOAD_STABILITY[skillId];
  if (!spec) return true; // 未声明的 skill 不参与护栏
  if (!firstKey) return false;
  return spec.stable.includes(firstKey);
}
