export interface ReplanSignalLike {
  shouldSuggest?: boolean;
  priority?: 'none' | 'low' | 'medium' | 'high';
  recommendation?: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope?: 'none' | 'next_milestone' | 'downstream_path';
  rationale?: string;
  reasonCodes?: string[];
}

export function getReplanPriorityText(priority?: ReplanSignalLike['priority']) {
  return ({ high: '高优先级', medium: '中优先级', low: '低优先级', none: '无需调整' } as const)[priority || 'none'];
}

export function getReplanRecommendationText(recommendation?: ReplanSignalLike['recommendation']) {
  return ({
    keep: '保持原计划',
    reinforce: '先补强再推进',
    slow_down: '先放慢节奏',
    resequence: '调整后续顺序',
    accelerate: '压缩下一阶段',
  } as const)[recommendation || 'keep'];
}

export function getReplanScopeText(scope?: ReplanSignalLike['scope']) {
  return ({
    none: '无需调整范围',
    next_milestone: '影响下一阶段',
    downstream_path: '影响后续路径',
  } as const)[scope || 'none'];
}

export function getReplanActionText(signal?: ReplanSignalLike | null) {
  const recommendation = signal?.recommendation;
  if (recommendation === 'accelerate') return '下一阶段可以考虑压缩成更聚焦的推进版本。';
  if (recommendation === 'resequence') return '建议优先调整后续阶段顺序，再进入新内容。';
  if (recommendation === 'slow_down') return '建议先放慢节奏，确认是否插入补强版本。';
  if (recommendation === 'reinforce') return '建议在进入下一阶段前，先补强关键基础。';
  return '当前无需调整路径。';
}

export function getReplanReasonCodeLabels(codes: string[] = []) {
  const labels: Record<string, string> = {
    fatigue_high: '疲劳偏高',
    lsb_negative: '状态失衡',
    recent_trend_declining: '近期趋势下滑',
    fragile_concepts: '脆弱知识点',
    struggling_concepts: '持续卡点',
    blocked_foundations: '不稳定前置',
    prerequisite_gaps: '前置缺口',
    stable_mastery: '掌握稳定',
    ready_to_accelerate: '可加速推进',
  };
  return codes.map((code) => labels[code] || code);
}
