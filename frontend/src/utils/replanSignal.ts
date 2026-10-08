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

/* ---------- 路径调整策略（adjustmentPolicy）门控 ----------
   后端口径（learning.helpers.ts parsePathAdjustmentPolicy，随路径 DTO 下发）：
   - 策略存在与否看 aiPromptTemplate JSON 投影：旧路径/全空策略为 null = 不限制；
   - allowedModes 是数组时仅认 expand/compress/replan 三个值，数组即允许集合。
   注意：后端 replan / regenerate 链路目前并不强校验 allowedModes（策略是建议性元数据），
   前端门控与其口径保持一致：无策略全放行，有数组按集合收敛入口。 */

export interface PathAdjustmentPolicyLike {
  allowedModes?: Array<'expand' | 'compress' | 'replan'>;
  recommendedMode?: 'expand' | 'compress' | 'replan' | null;
}

/** 学习者侧调整入口：路径详情弹窗三场景（rebuild/reshape/auto）与学习状态页「采用建议」（走 replan） */
export type LearnerAdjustEntry = 'rebuild' | 'reshape' | 'auto';

export type PathAdjustmentMode = 'expand' | 'compress' | 'replan';

const ADJUSTMENT_MODE_LABELS: Record<PathAdjustmentMode, string> = {
  expand: '扩展内容',
  compress: '压缩内容',
  replan: '重新规划',
};

/** 策略模式级放行判断（学习状态页「采用建议/确认调整」直接按 replan 校验） */
export function adjustmentModeAllowedByPolicy(
  policy: PathAdjustmentPolicyLike | null | undefined,
  mode: PathAdjustmentMode
): boolean {
  const allowed = policy?.allowedModes;
  if (!Array.isArray(allowed)) return true; // 无策略（旧路径 / 字段缺省）= 全放行
  return allowed.includes(mode);
}

/**
 * 入口 → 所需策略模式（动作口径照抄后端）：
 * - rebuild（整条重建，replace-path 全量重规划）与 auto（AI 诊断确认后 replan-stage 重排）→ replan
 * - reshape（保留已学，对剩余阶段做增/减/序的量调整）→ expand 或 compress 任一
 */
export function adjustEntryAllowedByPolicy(
  policy: PathAdjustmentPolicyLike | null | undefined,
  entry: LearnerAdjustEntry
): boolean {
  const needed: PathAdjustmentMode[] = entry === 'reshape'
    ? ['expand', 'compress']
    : ['replan'];
  return needed.some((mode) => adjustmentModeAllowedByPolicy(policy, mode));
}

function adjustmentBlockReasonText(policy: PathAdjustmentPolicyLike | null | undefined): string {
  const allowed = policy?.allowedModes;
  if (!Array.isArray(allowed) || allowed.length === 0) return '这条路径当前未开放任何调整方式';
  return `这条路径当前仅开放：${allowed.map((mode) => ADJUSTMENT_MODE_LABELS[mode]).join('、')}`;
}

/** 策略模式被禁用时的原因副文案；未禁用返回空串 */
export function adjustmentModeBlockReason(
  policy: PathAdjustmentPolicyLike | null | undefined,
  mode: PathAdjustmentMode
): string {
  return adjustmentModeAllowedByPolicy(policy, mode) ? '' : adjustmentBlockReasonText(policy);
}

/** 入口被策略禁用时的原因副文案；未禁用返回空串 */
export function adjustPolicyBlockReason(
  policy: PathAdjustmentPolicyLike | null | undefined,
  entry: LearnerAdjustEntry
): string {
  return adjustEntryAllowedByPolicy(policy, entry) ? '' : adjustmentBlockReasonText(policy);
}

/** 策略推荐模式对应的弹窗入口；replan 建议走 AI 诊断入口而非直接预选破坏性的整建 */
export function recommendedAdjustEntry(
  policy: PathAdjustmentPolicyLike | null | undefined
): LearnerAdjustEntry | null {
  const rec = policy?.recommendedMode;
  if (rec === 'replan') return 'auto';
  if (rec === 'expand' || rec === 'compress') return 'reshape';
  return null;
}
