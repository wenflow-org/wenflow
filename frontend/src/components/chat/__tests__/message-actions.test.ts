/**
 * MessageActions 回归：点赞/踩/重新生成/复制操作条的位置口径。
 *
 * 2026-09-27 用户反馈：原绝对定位在气泡右上角（top:6 right:6 浮层），
 * hover 展开时会压住气泡正文末行。改为文档流内的独立行（气泡下方展开），
 * 这里锁两件事：
 *  1. .msg-actions 不再是 position:absolute（脱离文档流才会遮内容）；
 *  2. 触屏模式常显、桌面 hover 驱动的既有口径不回归。
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import MessageActions from '../MessageActions.vue';

const styleSource = readFileSync(resolve(process.cwd(), 'src/components/chat/MessageActions.vue'), 'utf-8');

describe('MessageActions 位置口径', () => {
  it('样式不再是绝对定位浮层（不允许遮住气泡正文）', () => {
    const block = styleSource.slice(styleSource.indexOf('.msg-actions {'), styleSource.indexOf('}', styleSource.indexOf('.msg-actions {')));
    expect(block).not.toContain('position: absolute');
  });

  it('触屏模式（hover:none）操作条常显', async () => {
    const w = mount(MessageActions, { props: { show: false } });
    // jsdom 默认 matchMedia 不存在 → touchMode=false；模拟触屏声明
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({ matches: q === '(hover: none)', media: q, addEventListener() {}, removeEventListener() {} }),
    });
    // 重新挂载让 onMounted 读取到 mock
    const w2 = mount(MessageActions, { props: { show: false } });
    await nextTick();
    expect(w2.find('.msg-actions').isVisible()).toBe(true);
    w.unmount();
    w2.unmount();
  });

  it('桌面 hover 驱动：show=false 不显示，show=true 显示', async () => {
    // 上个用例的全局 matchMedia mock 会泄漏（touchMode 常显），还原成「不支持的媒体查询」
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
    });
    const w = mount(MessageActions, { props: { show: false } });
    // v-show 口径直接断言内联样式（isVisible 会被本环境的 transition-stub 祖先干扰）
    const styleOf = () => w.find('.msg-actions').attributes('style') ?? '';
    expect(styleOf()).toContain('display: none');
    await w.setProps({ show: true });
    await nextTick();
    expect(styleOf()).not.toContain('display: none');
    w.unmount();
  });

  it('四枚操作齐备：有用/不佳/重新生成/复制', () => {
    const w = mount(MessageActions, { props: { show: true } });
    const labels = w.findAll('button').map((b) => b.attributes('aria-label') || b.attributes('title') || '');
    expect(labels.some((l) => l.includes('有用'))).toBe(true);
    expect(labels.some((l) => l.includes('不佳'))).toBe(true);
    expect(labels.some((l) => l.includes('重新生成'))).toBe(true);
    expect(labels.some((l) => l.includes('复制'))).toBe(true);
    w.unmount();
  });
});
