/**
 * 总览状态条结论文案合成（store.mergeStatusHeadline；M-1，2026-10-29 夜审）。
 *
 * 缺陷：statusHeadline 此前把健康检查计数直接拼进 base——「运行平稳」+「（1 项异常）」
 * 与红点取色同条出现，再同屏几条红色待办就是三个互相打架的结论。
 * 规则钉死：error 级事实在场（健康检查 error / 仿真 bad / error 级待办）时，平稳/空闲类
 * 措辞一律改口「需要关注」；仅 warn 档事实保留 base 只括注数量（2026-10-24 行为不变）。
 */
import { describe, expect, it } from 'vitest';
import { mergeStatusHeadline } from '../store';

describe('mergeStatusHeadline（状态条结论与取色一致）', () => {
  it('error 级事实在场：「运行平稳」改口「需要关注（N 项异常）」，不再自相矛盾', () => {
    expect(mergeStatusHeadline({
      base: '运行平稳',
      reasons: ['1 项异常'],
      hasErrorFact: true,
    })).toBe('需要关注（1 项异常）');
  });

  it('「系统空闲」同理改口（0 调用不代表没事，2026-10-26 语义延续）', () => {
    expect(mergeStatusHeadline({
      base: '系统空闲',
      reasons: ['1 项异常'],
      hasErrorFact: true,
    })).toBe('需要关注（1 项异常）');
  });

  it('仅 warn 档事实：保留「运行平稳」只括注数量（2026-10-24 行为不回退）', () => {
    expect(mergeStatusHeadline({
      base: '运行平稳',
      reasons: ['2 项需关注'],
      hasErrorFact: false,
    })).toBe('运行平稳（2 项需关注）');
  });

  it('base 已是「需要关注」：不重复括注', () => {
    expect(mergeStatusHeadline({
      base: '需要关注',
      reasons: ['1 项异常'],
      hasErrorFact: true,
    })).toBe('需要关注');
  });

  it('无健康/仿真括注但确有 error 级待办：结论同样不得自称平稳', () => {
    expect(mergeStatusHeadline({
      base: '运行平稳',
      reasons: [],
      hasErrorFact: true,
    })).toBe('需要关注');
  });

  it('无任何事实：base 原样返回（运行平稳就是平稳）', () => {
    expect(mergeStatusHeadline({
      base: '运行平稳',
      reasons: [],
      hasErrorFact: false,
    })).toBe('运行平稳');
  });

  it('多项事实：括注以「 · 」相连，error 级在场时整体改口', () => {
    expect(mergeStatusHeadline({
      base: '运行平稳',
      reasons: ['1 项异常', '仿真需关注'],
      hasErrorFact: true,
    })).toBe('需要关注（1 项异常 · 仿真需关注）');
  });

  it('base 为空（统计未就绪）：原样返回，不造结论', () => {
    expect(mergeStatusHeadline({ base: '', reasons: [], hasErrorFact: false })).toBe('');
  });
});
