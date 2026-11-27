import { stripDanglingFigureReferences } from '../dangling-figure-reference';

/**
 * 悬空图引用剥离的兜底（2026-11-26 真课 A4 实录）：
 * 整合回合回复以「板上的图已经全露出来了」开头，本轮没有下发 figure，引擎判为悬空引用，
 * 剥掉「板上」后只剩「的图已经全露出来了」——比原句更难读，句子直接断裂。
 * 这里的契约是：删不干净（残留以虚词起头 / 不足半句）就原样返回，交给「板存在则不剥」的上游闸。
 */
describe('stripDanglingFigureReferences：删不干净就返回原文', () => {
  it('指代是句首主语的一部分 → 原样返回', () => {
    const reply = '板上的图已经全露出来了，现在把三段串起来看。';
    expect(stripDanglingFigureReferences(reply)).toBe(reply);
  });

  it('完整指代句可以删，且删完仍有可读正文', () => {
    const reply = '我把两条对比画在下面这张图里。先看第一段：糖酵解在细胞质基质里完成。';
    const out = stripDanglingFigureReferences(reply);
    expect(out).not.toContain('这张图');
    expect(out).toContain('糖酵解在细胞质基质里完成');
  });

  it('空输入原样返回', () => {
    expect(stripDanglingFigureReferences('')).toBe('');
    expect(stripDanglingFigureReferences(null)).toBe('');
  });
});
