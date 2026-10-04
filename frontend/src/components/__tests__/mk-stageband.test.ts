/**
 * 状态构成条原语 MkStageband（2026-10-04 抽共享组件）：
 * 收编前 OpsHub 自搓 `.ow-state__seg` 与全局 `.stageband` 在四项上分叉
 * （高度/gap/轨道色/子元素），muted 档还写死 #c3cbda/#404244。
 * 本测试钉死组件契约：tone 词汇→token、size 档、图例开关、title/aria。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MkStageband from '@/components/mk/MkStageband.vue';

const SEGS = [
  { key: 'a', label: '生效中', count: 3, pct: '60%', tone: 'info' },
  { key: 'b', label: '草稿', count: 1, pct: '20%', tone: 'warn' },
  { key: 'c', label: '已下线', count: 1, pct: '20%', tone: 'muted' },
];

describe('MkStageband 状态构成条', () => {
  it('tone 语义名解析为 token（含历史别名 muted→faint、info→blue）', () => {
    const w = mount(MkStageband, { props: { segments: SEGS } });
    const styles = w.findAll('.stageband > span').map((s) => s.attributes('style') ?? '');
    expect(styles[0]).toContain('var(--mk-blue)'); // info
    expect(styles[1]).toContain('var(--mk-amber)'); // warn
    expect(styles[2]).toContain('var(--mk-faint)'); // muted —— 收编前是硬编码 #c3cbda
    expect(styles[0]).toContain('width: 60%');
    w.unmount();
  });

  it('裸 CSS 色值原样透传（调用点可直接传 var(--mk-purple)）；缺省 tone = blue', () => {
    const w = mount(MkStageband, {
      props: { segments: [{ key: 'x', label: '2天后', count: 2, pct: '100%', tone: 'var(--mk-purple)' }, { key: 'y', label: '默认' }] }
    });
    const styles = w.findAll('.stageband > span').map((s) => s.attributes('style') ?? '');
    expect(styles[0]).toContain('var(--mk-purple)');
    expect(styles[1]).toContain('var(--mk-blue)');
    expect(styles[1]).toContain('width: 0%'); // 缺省 pct 不占宽
    w.unmount();
  });

  it('size 两档：md 缺省不加类，sm 走 stageband--sm（8px 紧凑档）', () => {
    const md = mount(MkStageband, { props: { segments: SEGS } });
    expect(md.find('.stageband').classes()).not.toContain('stageband--sm');
    md.unmount();
    const sm = mount(MkStageband, { props: { segments: SEGS, size: 'sm' } });
    expect(sm.find('.stageband').classes()).toContain('stageband--sm');
    sm.unmount();
  });

  it('legend 缺省渲染图例（色块+名+数）；legend=false 收掉（页面自带行式图例时）', () => {
    const w = mount(MkStageband, { props: { segments: SEGS } });
    expect(w.findAll('.stageband__legend .sbl')).toHaveLength(3);
    expect(w.findAll('.sbl__n').map((n) => n.text())).toEqual(['3', '1', '1']);
    w.unmount();
    const bare = mount(MkStageband, { props: { segments: SEGS, legend: false } });
    expect(bare.find('.stageband__legend').exists()).toBe(false);
    bare.unmount();
  });

  it('aria：给 label 才设 role=img；title 缺省 =「名 数」', () => {
    const w = mount(MkStageband, { props: { segments: SEGS, label: '公告状态构成' } });
    expect(w.find('.stageband').attributes('role')).toBe('img');
    expect(w.find('.stageband').attributes('aria-label')).toBe('公告状态构成');
    expect(w.find('.stageband > span').attributes('title')).toBe('生效中 3');
    w.unmount();
    const noLabel = mount(MkStageband, { props: { segments: SEGS } });
    expect(noLabel.find('.stageband').attributes('role')).toBeUndefined();
    noLabel.unmount();
  });

  it('title 可覆盖（页面给口径说明）', () => {
    const w = mount(MkStageband, { props: { segments: [{ key: 'a', label: '已逾期', count: 2, tone: 'bad', title: '到期时间早于今天 · 2' }] } });
    expect(w.find('.stageband > span').attributes('title')).toBe('到期时间早于今天 · 2');
    w.unmount();
  });
});
