/**
 * 开场景卡片视图域（V2LearningPage.vue 拆分）：
 * resumed / continuation / relearn / review 场景的标签、主按钮文案、副文案与弱项提醒
 */
import { computed, type Ref } from 'vue';

const SCENE_META: Record<string, { tag: string; primary: string }> = {
  resume: { tag: '继续上课', primary: '从这继续' },
  continuation: { tag: '接着学', primary: '开始本节' },
  relearn: { tag: '重新学', primary: '重新开始本节' },
  review: { tag: '今日复习', primary: '开始复习' },
  first: { tag: '开始上课', primary: '开始' },
};

export function useOpeningSceneViews(openingScene: Ref<Record<string, any> | null>) {
  const sceneTag = computed(() => SCENE_META[openingScene.value?.kind]?.tag || '开始上课');
  const scenePrimaryText = computed(() => SCENE_META[openingScene.value?.kind]?.primary || '开始');
  const sceneDefaultTitle = computed(() => {
    const k = openingScene.value?.kind;
    if (k === 'resume') return '继续这节课，从上次离开的地方接着学';
    if (k === 'continuation') return '接着上一课往下学';
    if (k === 'relearn') return '重新学这一课，把上次没掌握的补上';
    if (k === 'review') return '今日复习：回捞快忘的知识点';
    return '开始这节课';
  });
  /** 副文案：依据 kind 给一句人话引导 */
  const sceneLead = computed(() => {
    const sc = openingScene.value;
    if (!sc) return '';
    const k = sc.kind;
    if (k === 'resume') return '你的进度还在，接着上次的内容继续，不用从头开始。';
    if (k === 'continuation') {
      const rel = sc.recap?.relation;
      if (rel === 'prev-milestone') return `上节课在「${sc.recap?.sourceTitle || '上一阶段'}」结束，这节课是它的下一步。`;
      return '上一课刚结束，这节课接着往下推进。';
    }
    if (k === 'relearn') return sc.attempt && sc.attempt > 1 ? `这是你第 ${sc.attempt} 次学这节课，重点补上次没掌握的。` : '从头再学一遍这节课。';
    if (k === 'review') return '把快到遗忘点的知识先捞回来，再继续新内容。';
    return '';
  });
  const sceneUnresolved = computed<string[]>(() => {
    const r = openingScene.value?.recap;
    return Array.isArray(r?.unresolved) ? (r.unresolved as string[]).slice(0, 3) : [];
  });
  /** 前序掌握较弱的阶段提醒（at-risk / partial） */
  const sceneMasteryWarn = computed(() => {
    const list: Array<{ stage: number; title: string; state: string }> = openingScene.value?.mastery || [];
    const weak = list.filter((m) => m.state === 'at-risk' || m.state === 'partial').slice(0, 2);
    if (!weak.length) return '';
    return weak.map((m) => `第 ${m.stage} 阶段「${m.title}」还不太稳`).join('；');
  });
  /** 开场行动台标题：跟随进入方式，避免每次都是冷冰冰的「开场建议」 */
  const quickReplyKicker = computed(() => {
    const k = openingScene.value?.kind;
    if (k === 'review') return '复习方式';
    if (k === 'relearn') return '这次怎么学';
    if (k === 'continuation') return '接着怎么学';
    if (k === 'resume') return '从哪继续';
    return '怎么开始';
  });
  return {
    sceneTag, scenePrimaryText, sceneDefaultTitle, sceneLead,
    sceneUnresolved, sceneMasteryWarn, quickReplyKicker
  };
}
