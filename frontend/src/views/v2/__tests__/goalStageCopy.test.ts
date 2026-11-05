/**
 * 目标阶段的收尾问句判据与两行入口文案（2026-10-31 用户走查）。
 *
 * 现场：方案已就绪的同一轮，导师又问「按调色在前、抠图在后这个顺序来，可以吗？」
 * 并给了三条回答该问题的快选；用户看不出该回答还是该确认。
 *
 * 语料取自 prompt_call_logs 里 136 个真实 proposing 回合的回复收尾。
 */
import { describe, expect, it } from 'vitest';
import { isAwaitingAnswer, proposalEntryCopy } from '../goalStageCopy';

describe('isAwaitingAnswer：proposing 且收尾问句是「向你要信息」', () => {
  it('确认式问句不算「要信息」——导师是在请你拍板（实测语料 5 条）', () => {
    [
      '你觉得这个方向和量级合适吗，还是想先压缩到只讲「加速器到底做了什么」这一小段？',
      '这个方向你看对不对？',
      '按「调色在前、抠图在后」这个顺序来，可以吗？',
      '这版方向先这么定，你看要不要调整？',
      '下面这版方向你看看哪里要调？',
    ].forEach((tail) => expect(`${tail} → ${isAwaitingAnswer('proposing', tail)}`).toBe(`${tail} → false`));
  });

  it('真正要信息的问句才算', () => {
    expect(isAwaitingAnswer('proposing', '回到你上面说的：你之前考过 CPA 吗？')).toBe(true);
    expect(isAwaitingAnswer('proposing', '你手上现在是三个平台都有导出权限吗？')).toBe(true);
  });

  it('proposing 但回复是陈述（无问号收尾）→ 不在提问', () => {
    expect(isAwaitingAnswer('proposing', '这一版就两段：先调色，再抠图。你看完直接确认就行。')).toBe(false);
  });

  it('尾随空白/换行不影响判定', () => {
    expect(isAwaitingAnswer('proposing', '你之前考过 CPA 吗？\n')).toBe(true);
  });

  it('问号在句中（不是收尾提问）不算', () => {
    expect(isAwaitingAnswer('proposing', '什么叫「高级感」？这一版就按这个来。')).toBe(false);
  });

  it('understanding 阶段提问不算——那时入口条本来就不展示', () => {
    expect(isAwaitingAnswer('understanding', '你平时用 PS 吗？')).toBe(false);
  });

  it('stage 缺失/空文本不误判', () => {
    expect(isAwaitingAnswer(null, '可以吗？')).toBe(false);
    expect(isAwaitingAnswer('proposing', '')).toBe(false);
  });
});

describe('proposalEntryCopy：确认入口条只说确认这一件事', () => {
  it('导师在要信息时：不再宣称「方案已就绪」，按钮也不再说「并确认」', () => {
    const copy = proposalEntryCopy(true);
    expect(copy.button).toBe('查看当前方案');
    expect(copy.hint).not.toContain('已就绪');
  });

  it('方案就绪时：入口只剩「查看并确认」，不再有提示句', () => {
    const copy = proposalEntryCopy(false);
    expect(copy.button).toBe('查看并确认');
    expect(copy.hint).toBe('');
  });
});

describe('proposalEntryCopy：有未答自测时把这件事挑明（2026-11-02 业务口径）', () => {
  it('有未答题：提示写明还有几道可选自测，按钮不变', () => {
    const copy = proposalEntryCopy(false, 2);
    expect(copy.hint).toContain('2 道快速自测');
    expect(copy.hint).toContain('校准起点');
    expect(copy.button).toBe('查看方案');
  });

  it('无未答题：同样没有提示句', () => {
    expect(proposalEntryCopy(false, 0).hint).toBe('');
  });

  it('导师仍在问会改方案的问题时：优先播报「回答导师」，不掺自测', () => {
    const copy = proposalEntryCopy(true, 2);
    expect(copy.hint).toContain('导师这一问');
    expect(copy.hint).not.toContain('快速自测');
  });
});
