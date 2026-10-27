/**
 * Token 估算：给「能不能把这份评审包喂给模型」一个可算的数字。
 *
 * 口径（保守，偏高估）：
 *   - 文本：CJK/全角字符 1 字 ≈ 1 token，其余按 4 字符 ≈ 1 token（贴近 GPT/Claude 实测均值）
 *   - base64：每 4 字符 ≈ 1 token（base64 是连续 ASCII，几乎无压缩红利）
 *   - 图片：Anthropic 公式 ceil(w/1.5)*ceil(h/1.5)/750（约等于按 1.5px 分块后每块 1 token）
 * 只用来比较量级，不追求与某家分词器完全一致。
 *
 * 用法：node outputs/e2e/token-estimate.mjs <file...>
 */
import fs from 'node:fs';
import path from 'node:path';

const isCJK = (ch) => {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3000 && c <= 0x303f) || // CJK 标点
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xff00 && c <= 0xffef) || // 全角
    (c >= 0x2000 && c <= 0x206f)
  );
};

export function textTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCJK(ch)) cjk += 1;
    else other += 1;
  }
  return Math.round(cjk + other / 4);
}

export function imageTokens(w, h) {
  return Math.ceil(Math.ceil(w / 1.5) * Math.ceil(h / 1.5) / 750);
}

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

const files = process.argv.slice(2);
// 作为模块被 import 时（llm-brief 复用口径）不执行 CLI 逻辑
const isCLI = files.length > 0 && !process.env.WF_TOKEN_IMPORT_ONLY;
if (isCLI) {
let total = 0;
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log(`${f}\t(missing)`);
    continue;
  }
  const buf = fs.readFileSync(f);
  const ext = path.extname(f).toLowerCase();
  let tokens = 0;
  let note = '';
  if (ext === '.png') {
    const { w, h } = pngSize(buf);
    tokens = imageTokens(w, h);
    note = `${w}×${h}`;
  } else if (ext === '.html') {
    // HTML 里的 base64 按 base64 规则计，其余按文本
    const text = buf.toString('utf8');
    const b64 = (text.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g) || []).reduce((n, m) => n + m.length, 0);
    tokens = Math.round(b64 / 4) + textTokens(text.slice(0, text.length - b64));
    note = `其中 base64 约 ${Math.round(b64 / 4)} token`;
  } else {
    tokens = textTokens(buf.toString('utf8'));
  }
  total += tokens;
  console.log(`${path.basename(f).padEnd(28)} ${String(Math.round(buf.length / 1024)).padStart(6)}KB  ${String(tokens).padStart(8)} tok  ${note}`);
}
console.log(`${'合计'.padEnd(28)} ${''.padStart(6)}  ${String(total).padStart(8)} tok`);
}
export { isCJK, pngSize };
