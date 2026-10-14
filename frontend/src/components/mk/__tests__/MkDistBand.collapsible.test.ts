/**
 * MkDistBand 折叠档（2026-10-14 用户：学习状态页置信度分布「做成可以折叠展开的区域，默认折叠」）。
 *
 * 折叠是**可选档**：六处调用方里只有学习状态页开它，其余五处（教学会话 / 目标对话 / 记忆复习 /
 * 学习路径 / 虚拟学习者运行条）走原来的裸 div 结构——断言两条路径的根节点/头节点元素，
 * 防「改共享原语顺手把别处也折了」。
 *
 * 折叠实现走共享 .mk-section__summary（原生 details/summary，键盘天然可用），
 * 本用例只钉结构与初始态；旋转指示等视觉规则在 mk-primitives.css，由页面走查覆盖。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MkDistBand from '../MkDistBand.vue';

const BINS = [
  { key: '0', label: '< 25%', n: 2, tone: 'var(--mk-red)' },
  { key: '1', label: '25–49%', n: 1, tone: 'var(--mk-amber)' },
  { key: '2', label: '50–74%', n: 0, tone: 'var(--mk-faint)' }
];

function mountBand(props: Record<string, unknown> = {}) {
  return mount(MkDistBand, { props: { bins: BINS, title: '置信度分布', sub: '共 3 位', unit: '人', ...props } });
}

describe('MkDistBand 折叠档', () => {
  it('默认（未开 collapsible）：根与头仍是 div —— 其余五处调用方结构不变', () => {
    const w = mountBand();
    expect(w.element.tagName).toBe('DIV');
    expect(w.find('.mk-distband__head').element.tagName).toBe('DIV');
    expect(w.classes()).not.toContain('mk-distband--fold');
    expect(w.find('.mk-distband__head').classes()).not.toContain('mk-section__summary');
    // 分段与图例照旧常显
    expect(w.findAll('.stageband__legend .sbl')).toHaveLength(3);
    expect(w.findAll('.mk-distband__seg')).toHaveLength(2); // 0 值档不出段
  });

  it('collapsible：根 details / 头 summary，默认折叠（无 open），卡体内容仍在文档里', () => {
    const w = mountBand({ collapsible: true, card: true });
    expect(w.element.tagName).toBe('DETAILS');
    expect(w.classes()).toContain('mk-distband--fold');
    const head = w.find('.mk-distband__head');
    expect(head.element.tagName).toBe('SUMMARY');
    expect(head.classes()).toContain('mk-section__summary');
    // 默认折叠 = 不带 open 属性（原生 details 的收起态）
    expect(w.attributes('open')).toBeUndefined();
    expect(w.element.hasAttribute('open')).toBe(false);
    // 折叠只影响可见性，图例计数不丢
    expect(w.findAll('.stageband__legend .sbl')).toHaveLength(3);
    expect(w.find('.mk-distband__sub').text()).toBe('共 3 位');
  });

  it('collapsible + defaultOpen：初始展开（open 属性在）', () => {
    const w = mountBand({ collapsible: true, defaultOpen: true });
    expect(w.element.tagName).toBe('DETAILS');
    expect(w.element.hasAttribute('open')).toBe(true);
  });

  it('defaultOpen 在未开折叠时不生效（不把裸条也渲染成 details）', () => {
    const w = mountBand({ defaultOpen: true });
    expect(w.element.tagName).toBe('DIV');
    expect(w.element.hasAttribute('open')).toBe(false);
  });
});
