/**
 * WenFlow 设计体系包 ↔ 仓库令牌对账
 *
 * 包（D:\wenflow\WenFlow-Design-System\colors_and_type.css）= 语言来源
 * 仓（frontend/src/styles/tokens.css）= --wf-* 唯一落地点
 *
 * 两边结构相同：:root（亮）+ 暗色块（覆盖）。有效值 = 亮值被暗值覆盖。
 * 比较三桶：① 同名不同值（分叉）② 包有仓无 ③ 仓有包无
 */
import { readFileSync } from 'node:fs';

const PKG = 'D:/wenflow/WenFlow-Design-System/colors_and_type.css';
const REPO = 'D:/wenflow/wenflow/frontend/src/styles/tokens.css';

function parseCss(file) {
  const s = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // 顶层块（深度 0→1→0）：选择器 = 上一个顶层边界（';' 或 '}'）之后到 '{' 之前
  const blocks = [];
  let depth = 0, selStart = 0, bodyStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (depth === 0) { bodyStart = i + 1; blocks.push({ sel: s.slice(selStart, i).trim(), body: '' }); }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) { blocks[blocks.length - 1].body = s.slice(bodyStart, i); selStart = i + 1; }
      if (depth < 0) depth = 0;
    } else if (c === ';' && depth === 0) {
      selStart = i + 1;
    }
  }
  const pick = (pred) => { for (const b of blocks) if (pred(b.sel)) return b.body; return ''; };
  const rootBody = pick((x) => /:root/.test(x));
  const darkBody = pick((x) => /\.dark|data-theme/.test(x));
  const vars = (body) => {
    const m = {};
    for (const r of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g)) m[r[1]] = r[2].trim();
    return m;
  };
  return { light: vars(rootBody), dark: vars(darkBody), sels: blocks.map((b) => b.sel).slice(0, 6) };
}

const norm = (v) => v.replace(/\s+/g, ' ').replace(/!important/g, '').trim().toLowerCase();

const pkg = parseCss(PKG);
const repo = parseCss(REPO);

const effPkgL = { ...pkg.light };
const effPkgD = { ...pkg.light, ...pkg.dark };
const effRepoL = { ...repo.light };
const effRepoD = { ...repo.light, ...repo.dark };

const names = new Set([...Object.keys(effPkgL), ...Object.keys(effRepoL)]);
const lightDiff = [], darkDiff = [], pkgOnly = [], repoOnly = [];
for (const n of [...names].sort()) {
  const inP = n in effPkgL, inR = n in effRepoL;
  if (inP && !inR) { pkgOnly.push(n); continue; }
  if (inR && !inP) { repoOnly.push(n); continue; }
  const pl = norm(effPkgL[n]), rl = norm(effRepoL[n]);
  if (pl !== rl) lightDiff.push({ n, pkg: effPkgL[n], repo: effRepoL[n] });
  const pd = norm(effPkgD[n] ?? ''), rd = norm(effRepoD[n] ?? '');
  if ((n in pkg.dark || n in repo.dark) && pd !== rd) darkDiff.push({ n, pkg: effPkgD[n], repo: effRepoD[n] });
}

console.log(`包 tokens: 亮 ${Object.keys(pkg.light).length} / 暗覆盖 ${Object.keys(pkg.dark).length}`);
console.log(`仓 tokens: 亮 ${Object.keys(repo.light).length} / 暗覆盖 ${Object.keys(repo.dark).length}`);
console.log(`\n① 同名不同值（亮）: ${lightDiff.length}`);
for (const d of lightDiff) console.log(`   ${d.n.padEnd(34)} 包=${d.pkg}   仓=${d.repo}`);
console.log(`\n① 同名不同值（暗，仅两处暗块都声明的）: ${darkDiff.length}`);
for (const d of darkDiff) console.log(`   ${d.n.padEnd(34)} 包=${d.pkg}   仓=${d.repo}`);
console.log(`\n② 包有仓无: ${pkgOnly.length}`);
console.log('   ' + pkgOnly.join(' '));
console.log(`\n③ 仓有包无: ${repoOnly.length}`);
console.log('   ' + repoOnly.join(' '));
