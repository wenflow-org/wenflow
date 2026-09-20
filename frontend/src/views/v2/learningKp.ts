/**
 * 知识点面板域（V2LearningPage.vue 拆分）：状态判定纯函数 + 面板汇总 computeds
 */
import { computed, type Ref } from 'vue';

export function isMastered(kp: Record<string, any>) {
  return ['mastered', 'completed', 'done'].includes(String(kp.status || '').toLowerCase());
}
function isCurrent(kp: Record<string, any>) {
  return ['learning', 'in_progress', 'current', 'teaching'].includes(String(kp.status || '').toLowerCase());
}
/** 单点完成度 0-100：已掌握算满；否则取 progress（夹取到 0-100） */
function kpProgressPct(kp: Record<string, any>) {
  if (isMastered(kp)) return 100;
  const raw = Number(kp.progress);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(raw)));
  return 0;
}
export function kpCls(kp: Record<string, any>) {
  return { 'kp__item--done': isMastered(kp), 'kp__item--current': isCurrent(kp) };
}
export function kpStatusText(kp: Record<string, any>) {
  if (isMastered(kp)) return '已掌握';
  const pct = kpProgressPct(kp);
  if (isCurrent(kp)) return pct > 0 ? `学习中 · ${pct}%` : '学习中';
  return pct > 0 ? `进行中 · ${pct}%` : '待学习';
}

export function useKnowledgePanel(knowledgePoints: Ref<Array<Record<string, any>>>) {
  const masteredCount = computed(() => knowledgePoints.value.filter(isMastered).length);
  /** 进行中（未掌握且已有进度）的点数 */
  const inProgressCount = computed(
    () => knowledgePoints.value.filter((kp) => !isMastered(kp) && kpProgressPct(kp) > 0).length
  );
  /** 加权完成度：按各点 progress 求均值（不再只数 mastered，避免 80-90% 显示成 0%） */
  const weightedProgressPct = computed(() => {
    const list = knowledgePoints.value;
    if (!list.length) return 0;
    return Math.round(list.reduce((sum, kp) => sum + kpProgressPct(kp), 0) / list.length);
  });
  return { masteredCount, inProgressCount, weightedProgressPct };
}
