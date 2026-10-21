import { createApp, h } from 'vue';
import TeachingFigure from '@/components/TeachingFigure.vue';

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: Record<string, unknown>;
  context?: { student?: string; teacher?: string };
}

const res = await fetch('/figure-out/figures.json');
const items = (await res.json()) as GalleryItem[];

const textBlock = (label: string, text: string | undefined, cls: string) =>
  text
    ? h('div', { class: `ctx ctx--${cls}` }, [
        h('span', { class: 'ctx__label' }, label),
        h('span', { class: 'ctx__text', title: text }, text),
      ])
    : null;

const card = (item: GalleryItem, i: number) =>
  h('div', { class: 'item' }, [
    h('div', { class: 'meta' }, [
      h('b', String((item.figure as { kind?: string }).kind ?? '?')),
      ` · #${i + 1} · ${item.user ?? '—'} · ${item.topic ?? '—'}`,
    ]),
    textBlock('学生', item.context?.student, 'student'),
    textBlock('老师', item.context?.teacher, 'teacher'),
    h(TeachingFigure, { figure: item.figure as never }),
  ]);

createApp({ render: () => h('div', { class: 'grid' }, items.map(card)) }).mount('#app');
