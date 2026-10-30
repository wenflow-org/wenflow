/**
 * 知识图谱节点标签折行。
 *
 * 画布标签固定两行：优先按自然词边界折，英文单词/标识符不拆断；
 * 只有超过两行时才在第二行末尾加省略号，第一行不加。
 */
const WORD_CHAR = /[A-Za-z0-9_./:%+-]/;

/** ASCII 按 1 个宽度单位，中文/全角按 2 个；perLine 以「中文字数」计。 */
function charUnits(ch: string): number {
  return ch.charCodeAt(0) > 0xff ? 2 : 1;
}

function textUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += charUnits(ch);
  return n;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const ch of text) {
    if (WORD_CHAR.test(ch)) {
      word += ch;
      continue;
    }
    if (word) {
      tokens.push(word);
      word = '';
    }
    tokens.push(ch);
  }
  if (word) tokens.push(word);
  return tokens;
}

function truncateToUnits(text: string, maxUnits: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const next = charUnits(ch);
    if (used + next > maxUnits - 2) break;
    out += ch;
    used += next;
  }
  return `${out}…`;
}

export function wrapGraphLabel(text: string, perLine: number): string {
  const value = String(text ?? '');
  if (!value) return value;
  const maxUnits = Math.max(4, perLine) * 2;
  const lines: string[] = [];
  let line = '';
  let used = 0;

  for (const token of tokenize(value)) {
    const tokenUnits = textUnits(token);
    const nextIsCjk = token.charCodeAt(0) > 0xff;
    const prevIsLatin = /[A-Za-z0-9_./:%+-]$/.test(line);
    if (line && prevIsLatin && nextIsCjk && used >= maxUnits - 3) {
      lines.push(line);
      line = '';
      used = 0;
    }
    if (line && used + tokenUnits > maxUnits) {
      lines.push(line);
      line = '';
      used = 0;
    }
    line += token;
    used += tokenUnits;
  }
  if (line) lines.push(line);

  if (lines.length <= 1) return lines[0] ?? value;
  if (lines.length === 2) return `${lines[0]}\n${lines[1]}`;
  return `${lines[0]}\n${truncateToUnits(lines.slice(1).join(''), maxUnits)}`;
}
