/**
 * V2ResultState（用户侧整页级空态/失败态，newui/home wf-empty·wf-error 形态）：
 * 锁三件事——tone 决定图标盘配色、动作钮文案与 busy 态、动作事件回传。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import V2ResultState from '@/components/ui/V2ResultState.vue';

describe('V2ResultState', () => {
  it('空态：图标盘 + 标题 + 说明，无动作钮时不渲染按钮', () => {
    const w = mount(V2ResultState, {
      props: { tone: 'empty', title: '还没有学习记录', description: '完成第一次学习后出现。' },
    });
    expect(w.find('.v2result--empty').exists()).toBe(true);
    expect(w.find('.v2result__title').text()).toBe('还没有学习记录');
    expect(w.find('.v2result__desc').text()).toContain('完成第一次学习');
    expect(w.find('.v2result__action').exists()).toBe(false);
  });

  it('失败态：红色图标盘 + 重试钮，点击 emit action，busy 时禁用', async () => {
    const w = mount(V2ResultState, {
      props: { tone: 'error', title: '路径加载失败', actionText: '重试' },
    });
    expect(w.find('.v2result--error').exists()).toBe(true);
    const btn = w.find('.v2result__action');
    expect(btn.text()).toBe('重试');
    await btn.trigger('click');
    expect(w.emitted('action')?.length).toBe(1);

    await w.setProps({ busy: true });
    expect(w.find('.v2result__action').attributes('disabled')).toBeDefined();
  });
});
