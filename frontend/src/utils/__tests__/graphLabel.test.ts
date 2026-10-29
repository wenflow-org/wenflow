import { describe, expect, it } from 'vitest';
import { wrapGraphLabel } from '../graphLabel';

describe('知识图谱标签折行', () => {
  it('两行按中文字数折，不在第一行加省略号', () => {
    expect(wrapGraphLabel('核对源表列名口径', 6)).toBe('核对源表列名\n口径');
  });

  it('英文标识符不拆断', () => {
    expect(wrapGraphLabel('读取Excel表对象', 6)).toBe('读取Excel\n表对象');
  });

  it('超过两行才在第二行末尾省略', () => {
    const out = wrapGraphLabel('流水线固定输入输出后的可重复执行与对数', 6);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith('…')).toBe(false);
    expect(lines[1].endsWith('…')).toBe(true);
  });

  it('短标签保持一行', () => {
    expect(wrapGraphLabel('表头口径', 6)).toBe('表头口径');
  });
});
