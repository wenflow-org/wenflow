import { describe, expect, it } from 'vitest';
import { normalizePipeTables } from '../markdownTables';
import { renderAiMessageHtml } from '../sanitize';

describe('normalizePipeTables', () => {
  it('给缺少分隔行的连续管道表补上分隔行', () => {
    const src = ['|行|A列|B列|C列|', '|1|运营周报|||', '|2|日期|渠道|曝光量|'].join('\n');
    expect(normalizePipeTables(src)).toBe([
      '|行|A列|B列|C列|',
      '| --- | --- | --- | --- |',
      '|1|运营周报|||',
      '|2|日期|渠道|曝光量|',
    ].join('\n'));
  });

  it('已有分隔行的表格不重复插入', () => {
    const src = ['|A|B|', '|---|---|', '|1|2|'].join('\n');
    expect(normalizePipeTables(src)).toBe(src);
  });

  it('代码围栏里的管道行保持原样', () => {
    const src = ['```', '|a|b|', '|1|2|', '```'].join('\n');
    expect(normalizePipeTables(src)).toBe(src);
  });

  it('单行管道文本不当作表格', () => {
    const src = '参数是 |a|b| 这种写法';
    expect(normalizePipeTables(src)).toBe(src);
  });

  it('接入 AI 消息渲染后输出真正的 table，不再裸露管道符', () => {
    const html = renderAiMessageHtml('|行|A列|B列|\n|1|运营周报||\n|2|日期|渠道|');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>行</th>');
    expect(html).toContain('<td>运营周报</td>');
    expect(html).not.toContain('|行|A列|B列|');
  });
});
