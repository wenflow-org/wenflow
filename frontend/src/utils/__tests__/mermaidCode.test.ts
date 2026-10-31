import { describe, expect, it } from 'vitest';
import { normalizeMermaidLabels } from '../mermaidCode';

describe('normalizeMermaidLabels', () => {
  it('给含函数括号的 flowchart 节点标签补引号', () => {
    const source = [
      'flowchart TD',
      '  A[Excel 源表文件] --> B[pd.read_excel(路径)<br/>header 填几]',
      '  B --> C[df.columns<br/>列名清单]',
      '  B --> D[df.head()<br/>前几行数据]',
    ].join('\n');
    const out = normalizeMermaidLabels(source);
    expect(out).toContain('B["pd.read_excel(路径)<br/>header 填几"]');
    expect(out).toContain('D["df.head()<br/>前几行数据"]');
    // 不含括号的标签保持原样
    expect(out).toContain('A[Excel 源表文件]');
    expect(out).toContain('C[df.columns<br/>列名清单]');
  });

  it('已加引号或没有括号的标签不重复处理', () => {
    const source = 'flowchart TD\n  A["already(quoted)"] --> B[plain]';
    expect(normalizeMermaidLabels(source)).toBe(source);
  });
});
