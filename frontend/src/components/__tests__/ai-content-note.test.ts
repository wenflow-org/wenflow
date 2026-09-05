/**
 * AiContentNote（P3-5：AI 免责文案统一格式）回归测试：
 * 默认文案全站统一（含 ⓘ 图标），自定义文案透传。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AiContentNote from '../AiContentNote.vue';

describe('AiContentNote（AI 免责提示统一格式）', () => {
  it('默认文案：统一措辞「内容由 AI 生成，仅供参考，请仔细甄别」', () => {
    const w = mount(AiContentNote);
    expect(w.text()).toContain('内容由 AI 生成，仅供参考，请仔细甄别');
  });

  it('带 ⓘ 图标（统一格式标识，区别于裸文本）', () => {
    const w = mount(AiContentNote);
    expect(w.find('svg').exists()).toBe(true);
  });

  it('自定义文案透传（部分位置需叠加上下文前缀）', () => {
    const w = mount(AiContentNote, { props: { text: '本次对话内容由 AI 生成' } });
    expect(w.text()).toBe('本次对话内容由 AI 生成');
  });

  it('role=note 语义标注', () => {
    const w = mount(AiContentNote);
    expect(w.attributes('role')).toBe('note');
  });
});
