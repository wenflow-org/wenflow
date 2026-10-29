/**
 * 兼容 AI 漏写表头分隔行的管道表。
 *
 * 模型经常输出：
 *   |行|A列|B列|
 *   |1|运营周报||
 * 而 Markdown/GFM 需要第二行是 |---|---| 才会渲染成 <table>，否则整段原样露出管道符。
 * 这里只对「连续两行以上、行首行尾都是 |」的块补分隔行；代码围栏内不处理。
 */
export function normalizePipeTables(source: string): string {
  const lines = String(source ?? '').split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
  const isPipeRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  const isSeparator = (line: string) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  const separatorFor = (header: string) => {
    const cells = header.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return `| ${cells.map(() => '---').join(' | ')} |`;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence || !isPipeRow(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [];
    let j = i;
    while (j < lines.length && !isFence(lines[j]) && isPipeRow(lines[j])) {
      block.push(lines[j]);
      j += 1;
    }

    out.push(block[0]);
    if (block.length >= 2 && !isSeparator(block[1])) {
      out.push(separatorFor(block[0]));
    }
    out.push(...block.slice(1));
    i = j;
  }

  return out.join('\n');
}
