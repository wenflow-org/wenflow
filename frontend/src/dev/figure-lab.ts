import { createApp, h } from 'vue';
import TeachingFigure from '@/components/TeachingFigure.vue';

// 载荷走 base64（含 UTF-8）。query 里的 `+` 会被浏览器当空格，这里先还原成 base64 字符集，
// 再按字节解成 UTF-8——旧实现用 escape/decodeURIComponent，遇到 `+` 直接 URI malformed。
const raw = new URLSearchParams(location.search).get('f');
if (raw) {
  const b64 = raw.trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const figure = JSON.parse(new TextDecoder().decode(bytes));
  createApp({ render: () => h('div', { class: 'card' }, [h(TeachingFigure, { figure })]) }).mount('#app');
}
