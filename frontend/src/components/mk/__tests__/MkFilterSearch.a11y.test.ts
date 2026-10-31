/**
 * 2026-10-23 UI 审查：搜索框的可访问名。
 * 全站列表页的搜索框此前只有 placeholder（8 个页面被扫出「无标签输入」），
 * 读屏拿不到名字；MkFilterSearch 在调用方未给 aria-label 时回落到 placeholder，
 * 显式传入的 aria-label 必须优先（调用方知道更好的上下文）。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MkFilterSearch from '../MkFilterSearch.vue';

describe('MkFilterSearch 可访问名', () => {
  it('没给 aria-label 时用 placeholder 兜底（读屏有名字）', () => {
    const w = mount(MkFilterSearch, { props: { modelValue: '', placeholder: '搜索昵称 / 邮箱 / ID' } });
    const input = w.find('input');
    expect(input.attributes('aria-label')).toBe('搜索昵称 / 邮箱 / ID');
    expect(input.attributes('placeholder')).toBe('搜索昵称 / 邮箱 / ID');
    w.unmount();
  });

  it('显式 aria-label 优先于 placeholder', () => {
    const w = mount(MkFilterSearch, {
      props: { modelValue: '' },
      attrs: { 'aria-label': '搜索目标对话', placeholder: '搜索' },
    });
    expect(w.find('input').attributes('aria-label')).toBe('搜索目标对话');
    w.unmount();
  });

  it('没 placeholder 也没 aria-label 时回落到「搜索」', () => {
    const w = mount(MkFilterSearch, { props: { modelValue: '' } });
    expect(w.find('input').attributes('aria-label')).toBe('搜索');
    w.unmount();
  });
});
