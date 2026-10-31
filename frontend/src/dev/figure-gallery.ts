import { createApp, h } from 'vue';
import TeachingFigure from '@/components/TeachingFigure.vue';

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: Record<string, unknown>;
  source?: { trigger?: string; reason?: string | null; kindHint?: string | null; ruleWhy?: string | null; matched?: string[] } | null;
  context?: { student?: string; teacher?: string };
}

const res = await fetch('/figure-out/figures.json');
const items = (await res.json()) as GalleryItem[];

const REASON_LABEL: Record<string, string> = {
  'ascii-structure': '上一轮用字符画了结构',
  'position-description': '学生刚描述完位置关系',
  'time-order': '学生在描述事件先后',
  'structure-content': '上一轮在讲结构化关系',
  'task-structure': '任务本身就是结构化关系',
  'recap-cadence': '连续多轮没出图，收一张',
};

const textBlock = (label: string, text: string | undefined, cls: string) =>
  text
    ? h('div', { class: `ctx ctx--${cls}` }, [
        h('span', { class: 'ctx__label' }, label),
        h('span', { class: 'ctx__text', title: text }, text),
      ])
    : null;

/**
 * 出图动机（2026-10-21 改版）：主证据来自**代码判据**——谁触发的、命中哪段原文、建议什么图型；
 * 模型自己写的 why 降级成「模型自述」，有就显示、没有不影响。
 */
const motiveBlock = (item: GalleryItem) => {
  const src = item.source;
  const modelWhy = typeof item.figure.why === 'string' ? (item.figure.why as string) : '';
  const actualKind = String((item.figure as { kind?: string }).kind ?? '');
  if (!src && !modelWhy) {
    return h('div', { class: 'motive motive--empty' }, [
      h('span', { class: 'motive__label' }, '动机'),
      h('span', {}, '旧数据未记录（代码留痕从 2026-10-21 起写入）'),
    ]);
  }
  const triggerText = src
    ? src.trigger === 'opportunity'
      ? src.ruleWhy || REASON_LABEL[src.reason || ''] || src.reason || '编排层给了出图时机'
      : '模型自己判断要画（编排层没给时机）'
    : '';
  const matchedText = src?.matched?.length ? src.matched.join('、') : '';
  const hintText = src?.kindHint
    ? src.kindHint === actualKind
      ? `建议 ${src.kindHint} → 采用`
      : `建议 ${src.kindHint} → 模型改用 ${actualKind}`
    : '';
  return h('div', { class: 'motive' }, [
    triggerText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '为什么调用'), h('span', {}, triggerText)])
      : null,
    matchedText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '命中依据'), h('span', {}, matchedText)])
      : null,
    hintText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '图型'), h('span', {}, hintText)])
      : null,
    modelWhy
      ? h('div', { class: 'motive__row motive__row--soft' }, [h('span', { class: 'motive__label' }, '模型自述'), h('span', {}, modelWhy)])
      : null,
  ]);
};

const card = (item: GalleryItem, i: number) =>
  h('div', { class: 'item' }, [
    h('div', { class: 'meta' }, [
      h('b', String((item.figure as { kind?: string }).kind ?? '?')),
      ` · #${i + 1} · ${item.user ?? '—'} · ${item.topic ?? '—'}`,
    ]),
    motiveBlock(item),
    textBlock('学生', item.context?.student, 'student'),
    textBlock('老师', item.context?.teacher, 'teacher'),
    h(TeachingFigure, { figure: item.figure as never }),
  ]);

createApp({ render: () => h('div', { class: 'grid' }, items.map(card)) }).mount('#app');
