/**
 * 联网正文的结构恢复单测（2026-10-17 真机根因：抓回来的正文没有 ATX 标题 → anchors 恒空）。
 */
import { MAX_DERIVED_HEADINGS, normalizeWebTextStructure } from '../material-web-structure';

describe('normalizeWebTextStructure', () => {
  it('扁平正文：第X篇/第X章/一、/（一）补成对应层级的 ATX；带空白的编号小节也补', () => {
    const text = [
      '如何阅读一本书',
      '第一篇阅读的层次',
      '第一章 阅读的活力与艺术',
      '主动的阅读很重要，要边读边问。',
      '一、阅读的四种层次',
      '（一）基础阅读',
      '4.1 一般要求',
      '1、熟悉教材',
    ].join('\n');

    const result = normalizeWebTextStructure(text);

    expect(result.markdown).toContain('## 第一篇阅读的层次');
    expect(result.markdown).toContain('### 第一章 阅读的活力与艺术');
    expect(result.markdown).toContain('#### 一、阅读的四种层次');
    expect(result.markdown).toContain('##### （一）基础阅读');
    expect(result.markdown).toContain('##### 4.1 一般要求');
    // 不带空白的 `1、xxx` 与编号列表无法区分 → 不补（真机误判 6663 条后收紧的规则）
    expect(result.markdown).toContain('\n1、熟悉教材');
    // 正文句子不能被误标成标题
    expect(result.markdown).toContain('\n主动的阅读很重要，要边读边问。');
    expect(result.headings).toBe(5);
  });

  it('已有 ≥2 个 ATX 标题 → 原样返回（不碰结构良好的 markdown）', () => {
    const text = '# 第一章\n正文\n## 第一节\n正文';
    const result = normalizeWebTextStructure(text);
    expect(result.markdown).toBe(text);
    expect(result.headings).toBe(0);
  });

  it('目录行（点线连页码）、纯页码、带标点的正文不补', () => {
    const text = [
      '目录',
      '第一章 阅读的活力与艺术................5',
      '12',
      '这句话虽然不长，但它是正文。',
      '第二章 阅读的层次 ........ 20',
    ].join('\n');

    const result = normalizeWebTextStructure(text);
    // 只有「目录」是明确的骨架词，会被补成二级标题
    expect(result.markdown).toContain('## 目录');
    expect(result.headings).toBe(1);
    expect(result.markdown).not.toContain('### 第一章');
    expect(result.markdown).not.toContain('### 第二章');
  });

  it('标题数量有上限（防止扁平正文里短行太多导致误标爆炸）', () => {
    const lines = Array.from({ length: MAX_DERIVED_HEADINGS + 20 }, (_, i) => `第${i + 1}章 章节${i + 1}`);
    const result = normalizeWebTextStructure(lines.join('\n'));
    expect(result.headings).toBe(MAX_DERIVED_HEADINGS);
    // 超限后的行保持原样
    expect(result.markdown).toContain(`第${MAX_DERIVED_HEADINGS + 1}章`);
    expect(result.markdown).not.toContain(`### 第${MAX_DERIVED_HEADINGS + 1}章`);
  });

  it('空输入不炸', () => {
    expect(normalizeWebTextStructure('').headings).toBe(0);
  });
});
