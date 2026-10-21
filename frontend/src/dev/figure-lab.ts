import { createApp, h } from 'vue';
import TeachingFigure from '@/components/TeachingFigure.vue';

const raw = new URLSearchParams(location.search).get('f');
if (raw) {
  const figure = JSON.parse(decodeURIComponent(escape(atob(raw))));
  createApp({ render: () => h('div', { class: 'card' }, [h(TeachingFigure, { figure })]) }).mount('#app');
}
