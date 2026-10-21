import { createApp, h } from 'vue';
import TeachingFigure from '@/components/TeachingFigure.vue';

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: Record<string, unknown>;
  source?: { trigger?: string; reason?: string | null; kindHint?: string | null } | null;
  context?: { student?: string; teacher?: string };
}

const res = await fetch('/figure-out/figures.json');
const items = (await res.json()) as GalleryItem[];

const REASON_LABEL: Record<string, string> = {
  'ascii-structure': '上一轮用字符画了结构',
  'position-description': '学生刚描述完位置关系',
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

/** 出图动机：模型自己给的一句话（为什么画）+ 编排层触发源（谁让它画的） */
const motiveBlock = (item: GalleryItem) => {
  const why = typeof item.figure.why === 'string' ? (item.figure.why as string) : '';
  const src = item.source;
  const trigger = src
    ? src.trigger === 'opportunity'
      ? `编排层给了出图时机${src.reason ? `（${REASON_LABEL[src.reason] ?? src.reason}）` : ''}${
          src.kindHint ? `，建议 ${src.kindHint}` : ''
        }`
      : '模型自己判断要画（编排层没给时机）'
    : '';
  if (!why && !trigger) {
    return h('div', { class: 'motive motive--empty' }, [
      h('span', { class: 'motive__label' }, '动机'),
      h('span', {}, '旧数据未记录（契约在 2026-10-21 之后才写 why / 触发源）'),
    ]);
  }
  return h('div', { class: 'motive' }, [
    why ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '为什么画'), h('span', {}, why)]) : null,
    trigger ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '谁触发的'), h('span', {}, trigger)]) : null,
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
