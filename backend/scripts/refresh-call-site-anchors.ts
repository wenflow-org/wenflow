/**
 * dev 工具：重生成 check-data-source.ts 的 CALL_SITE_MANIFEST 行号锚点
 *
 * 为什么需要它：manifest 里是手写的 `file:line` 证据锚点，代码重构后必然漂移——漂移的后果不是
 * 报错而是**静默失明**（取不到调用点 ⇒ 该 skill 的声明表全被判"疑似已改数据源"）。
 * check-data-source.ts 现在会在漂移时告警（W5-锚点漂移），本工具用来把锚点刷回真实位置。
 *
 * 口径：对每个 skillId，先从其定义模块（backend/src/skills/<id>/index.ts）取出 `*Definition` 导出名，
 * 再全仓搜索 `executeSkill(<name>` / `executeSkillWithResult(<name>` 的调用行。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/refresh-call-site-anchors.ts            # 打印建议锚点（只读）
 *   npx ts-node --transpile-only scripts/refresh-call-site-anchors.ts --verify   # 只报告当前 manifest 的漂移
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_SCRIPT = path.join(ROOT, 'backend', 'src', 'scripts', 'check-data-source.ts');
const SRC_ROOT = path.join(ROOT, 'backend', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(p, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** skillId → 其定义模块里**声明导出**的 *Definition 标识符（只认 export const，避免把 import 的名字也算进来） */
function definitionNames(skillId: string): string[] {
  const candidates = [
    path.join(SRC_ROOT, 'skills', skillId, 'index.ts'),
    path.join(SRC_ROOT, 'skills', skillId, 'definition.ts'),
    path.join(SRC_ROOT, 'skills', 'v4-aux-skills', 'index.ts'),
  ];
  const words = skillId.split('-').filter(Boolean);
  const names = new Set<string>();
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*Definition)\b/g)) {
      const name = m[1];
      // 共享模块（v4-aux-skills）里只取与本 skill 名字相关的定义
      if (file.includes('v4-aux-skills') && !words.every((w) => name.toLowerCase().includes(w))) continue;
      names.add(name);
    }
  }
  return [...names];
}

interface Anchor { file: string; line: number }

function parseManifest(text: string): Map<string, Anchor[]> {
  const result = new Map<string, Anchor[]>();
  const blockStart = text.indexOf('const CALL_SITE_MANIFEST');
  const blockEnd = text.indexOf('\n};', blockStart);
  const block = text.slice(blockStart, blockEnd);
  const keyRe = /^  '([^']+)': \[/gm;
  let m: RegExpExecArray | null;
  const keys: Array<{ id: string; at: number }> = [];
  while ((m = keyRe.exec(block))) keys.push({ id: m[1], at: m.index });
  for (let i = 0; i < keys.length; i += 1) {
    const slice = block.slice(keys[i].at, i + 1 < keys.length ? keys[i + 1].at : block.length);
    const anchors: Anchor[] = [];
    for (const a of slice.matchAll(/\{ file: '([^']+)', line: (\d+) \}/g)) {
      anchors.push({ file: a[1], line: Number(a[2]) });
    }
    result.set(keys[i].id, anchors);
  }
  return result;
}

const allFiles = walk(SRC_ROOT);
const fileCache = new Map<string, string[]>();
const linesOf = (rel: string): string[] => {
  if (!fileCache.has(rel)) {
    const abs = path.join(ROOT, rel);
    fileCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8').split(/\r?\n/) : []);
  }
  return fileCache.get(rel)!;
};

const VERIFY_ONLY = process.argv.includes('--verify');
const text = fs.readFileSync(CHECK_SCRIPT, 'utf-8');
const manifest = parseManifest(text);

let drifted = 0;
let resolved = 0;

for (const [skillId, anchors] of manifest) {
  const names = definitionNames(skillId);
  const found: Anchor[] = [];
  for (const file of allFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    // manifest 只记**生产**调用点：探针/回放脚本、以及 prompt-ops 的"试跑"工具都不算
    if (rel.includes('/scripts/')) continue;
    if (rel.includes('routes/admin/prompt-ops.ts')) continue;
    const lines = linesOf(rel);
    lines.forEach((line, idx) => {
      if (!/executeSkill(WithResult)?\(/.test(line)) return;
      if (names.some((n) => line.includes(n))) found.push({ file: rel, line: idx + 1 });
    });
  }
  const isResolvable = (a: Anchor) => {
    const lines = linesOf(a.file);
    const idx = a.line - 1;
    for (let d = 0; d <= 80; d += 1) {
      for (const i of [idx - d, idx + d]) {
        if (i >= 0 && i < lines.length && /executeSkill/.test(lines[i])) return true;
      }
    }
    return false;
  };
  const bad = anchors.filter((a) => !isResolvable(a));
  drifted += bad.length;
  resolved += anchors.length - bad.length;
  if (!VERIFY_ONLY) {
    console.log(`  '${skillId}': [`);
    for (const a of found) console.log(`    { file: '${a.file}', line: ${a.line} },`);
    if (!found.length) console.log(`    // 未找到 executeSkill 调用点：确认该 skill 是否仍由代码直调`);
    console.log('  ],');
  } else if (bad.length) {
    console.log(`'${skillId}': 漂移 ${bad.length}/${anchors.length} 条 → ${bad.map((a) => `${a.file}:${a.line}`).join(', ')}`);
  }
}

if (VERIFY_ONLY) {
  console.log(`\n锚点：命中 ${resolved} 条，漂移 ${drifted} 条`);
} else {
  console.log(`\n（只读输出；命中 ${resolved} 条，漂移 ${drifted} 条。把上面各段替换 check-data-source.ts 的 CALL_SITE_MANIFEST）`);
}
