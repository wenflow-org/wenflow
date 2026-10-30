/**
 * 给 LLM 看的评审包（体积受控版）。
 *
 * 为什么不用 HTML：30 张图 base64 内嵌 = 850KB，其中 90% 是 base64 膨胀（1.33×）与
 * 重复的 CSS/结构；模型读一屏上下文就烧掉几万 token，真正有价值的判词只占几十行。
 *
 * 产物（默认输出到 outputs/llm-pack/）：
 *   1) figures-sheet-N.png   3×2 缩略拼版，每格标 #序号；6 张拼版覆盖 30 图
 *   2) manifest.md           紧凑文本清单：每图一行（#序号 / 图型 / 课程 / 判词 / 病灶）
 *   3) figures.json          逐图结构化数据（图型/spec 摘要/该轮对话/评审字段），给需要精确引用的场合
 *
 * 用法：node outputs/e2e/llm-pack.mjs <version> [outDir] [--only=fix,drop] [--n=1,5,9]
 *   version 例如 v8 → 读 outputs/e2e/v8-review.json + frontend/figure-out/v8-final-items.json
 *                        + frontend/figure-out/v8-pngs/
 *   --only  只打包指定判词的图（fix/drop/keep），默认全量
 *   --n     只打包指定序号（1 起），默认全量
 * 子集模式会把包缩到几 KB：讨论「哪几张有问题」时不需要把 30 张全塞进上下文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const outDirArg = args.find((a, i) => i > 0 && !a.startsWith('--') && args[i - 1] !== '--only' && args[i - 1] !== '--n');
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const nArg = (args.find((a) => a.startsWith('--n=')) || '').split('=')[1];
if (!version) throw new Error('用法: llm-pack.mjs <version> [outDir] [--only=fix,drop] [--n=1,5,9]');
const outDir = path.resolve(ROOT, outDirArg || 'outputs/llm-pack');
fs.mkdirSync(outDir, { recursive: true });

const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e', `${version}-review.json`), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/figure-out', `${version}-final-items.json`), 'utf8'));
const pngDir = path.join(ROOT, 'frontend/figure-out', `${version}-pngs`);

const COLS = 3;
const ROWS = 2;
const PER_SHEET = COLS * ROWS;
const CELL_W = 480;   // 缩略宽度：整图 620px 渲染宽缩到 480（结构可辨，标签小字靠 manifest 补）
const PAD = 8;

// 读 PNG 尺寸（IHDR：宽高各 4 字节，偏移 16/20）
const pngSize = (file) => {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

const onlySet = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim()).filter(Boolean)) : null;
const nSet = nArg ? new Set(nArg.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x))) : null;
const results = review.results.filter((r) => {
  if (nSet && !nSet.has(r.i + 1)) return false;
  if (onlySet) {
    const v = r.error ? 'error' : r.verdict;
    if (!onlySet.has(v)) return false;
  }
  return true;
});
if (!results.length) throw new Error('过滤后没有图（检查 --only / --n 参数）');
const filteredNote = onlySet || nSet
  ? `> 本包是**子集**：${onlySet ? `判词 ∈ {${[...onlySet].join(',')}}` : ''}${onlySet && nSet ? ' + ' : ''}${nSet ? `序号 ∈ {${[...nSet].join(',')}}` : ''}，共 ${results.length} 张（全量 ${review.results.length} 张）。
`
  : '';
const sheets = [];
for (let start = 0; start < results.length; start += PER_SHEET) {
  const group = results.slice(start, start + PER_SHEET);
  // 每格按最大高度对齐，避免拼版里图被拉伸
  const cells = group.map((r) => {
    const file = path.join(pngDir, `${r.i}.png`);
    if (!fs.existsSync(file)) return null;
    const { w, h } = pngSize(file);
    const scale = CELL_W / w;
    return { file, w: CELL_W, h: Math.round(h * scale) };
  });
  const rowHs = [];
  for (let r = 0; r < ROWS; r += 1) {
    const slice = cells.slice(r * COLS, r * COLS + COLS).filter(Boolean);
    rowHs.push(slice.length ? Math.max(...slice.map((c) => c.h)) : 0);
  }
  const sheetW = COLS * CELL_W + (COLS + 1) * PAD;
  const sheetH = rowHs.reduce((a, b) => a + b, 0) + (ROWS + 1) * PAD;
  const idx = sheets.length;
  const outFile = path.join(outDir, `figures-sheet-${idx + 1}.png`);

  // 用 ffmpeg 的 overlay 链拼版：每格先 scale 再 pad 到格位，最后 xstack
  const inputs = [];
  const filters = [];
  const layout = [];
  group.forEach((r, k) => {
    const cell = cells[k];
    const col = k % COLS;
    const row = Math.floor(k / COLS);
    const x = PAD + col * (CELL_W + PAD);
    const y = PAD + rowHs.slice(0, row).reduce((a, b) => a + b, 0) + row * PAD;
    layout.push({ x, y, cell, r });
    if (cell) inputs.push('-i', cell.file);
  });
  if (!inputs.length) continue;

  // 简化路径：把所有图按顺序 scale 到统一宽，然后用 xstack 指定 layout（缺格留空）
  // 因为每个格子高度不同，这里改用 overlay 逐层叠加（空白底 + 每格 overlay）
  let filter = `color=c=white:s=${sheetW}x${sheetH}[base]`;
  let prev = 'base';
  let inputIdx = 0;
  for (const L of layout) {
    if (!L.cell) continue;
    const label = `v${inputIdx}`;
    // 序号徽标：黑底白字，左上角——manifest 按 #序号 索引，图上必须能对上
    const tagged = `t${inputIdx}`;
    filter += `;[${inputIdx}:v]scale=${L.cell.w}:-1,drawtext=text='#${L.r.i + 1}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=5[${tagged}]`;
    const outLabel = `o${inputIdx}`;
    filter += `;[${prev}][${tagged}]overlay=${L.x}:${L.y}[${outLabel}]`;
    prev = outLabel;
    inputIdx += 1;
  }
  // pal8（256 色）+ 最高压缩：教学图是白底纯色块+文字，调色板几乎无损失，体积降 5~8 倍
  const args = [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', filter,
    '-map', `[${prev}]`,
    '-frames:v', '1',
    '-pix_fmt', 'pal8',
    '-compression_level', '100',
    outFile,
  ];
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (!fs.existsSync(outFile)) {
    console.error(`拼版 ${idx + 1} 失败:`, (res.stderr || '').slice(0, 300));
    continue;
  }
  sheets.push({ file: outFile, count: group.length, from: group[0].i + 1, to: group[group.length - 1].i + 1 });
  console.log(`sheet ${idx + 1}: #${group[0].i + 1}–#${group[group.length - 1].i + 1} → ${path.relative(ROOT, outFile)}`);
}

// 文本清单：每图一行，压到模型能一次读完的长度
const verdictCN = { keep: '保留', fix: '要修', drop: '删掉' };
const lines = results.map((r) => {
  const it = items[r.i] || {};
  const kind = r.kind || it.figure?.kind || '?';
  const v = r.error ? '出错' : verdictCN[r.verdict] || '—';
  const score = r.error ? '—' : `${r.usefulness}/${r.geometry}/${r.readability}`;
  const worst = r.worstIssue && r.worstIssue !== 'none' ? String(r.worstIssue).replace(/\s+/g, ' ').slice(0, 110) : '';
  return `#${r.i + 1}\t${kind}\t${it.course || ''}\t${v}\t${score}\t${worst}`;
});

const judged = results.filter((r) => !r.error);
const stat = (pred) => judged.filter(pred).length;
const summary = [
  `# ${version.toUpperCase()} 教学图评审包（给 LLM 的精简版）`,
  '',
  ...(filteredNote ? [filteredNote] : []),
  `- 图数：${items.length}｜已判：${judged.length}｜保留 ${stat((r) => r.verdict === 'keep')} / 要修 ${stat((r) => r.verdict === 'fix')} / 删掉 ${stat((r) => r.verdict === 'drop')}`,
  `- 均分：有用 ${(judged.reduce((n, r) => n + (r.usefulness || 0), 0) / judged.length).toFixed(2)} · 几何 ${(judged.reduce((n, r) => n + (r.geometry || 0), 0) / judged.length).toFixed(2)} · 可读 ${(judged.reduce((n, r) => n + (r.readability || 0), 0) / judged.length).toFixed(2)}`,
  `- 红灯：伪视觉 ${Math.round((stat((r) => r.redundant) / judged.length) * 100)}% · 泄题 ${Math.round((stat((r) => r.leak) / judged.length) * 100)}% · 元话 ${Math.round((stat((r) => r.meta) / judged.length) * 100)}%`,
  '',
  `## 拼版（看图用这些，不要看单张 PNG）`,
  ...sheets.map((s) => `- ${path.basename(s.file)}：#${s.from}–#${s.to}（${s.count} 格，3×2，格宽 ${CELL_W}px）`),
  '',
  `## 逐图清单（制表符分隔：#序号 图型 课程 判 有用/几何/可读 最该修）`,
  '```',
  ...lines,
  '```',
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'manifest.md'), summary, 'utf8');

// 结构化数据：spec 只留前 600 字（够引用，不灌满上下文）
const compact = results.map((r) => {
  const it = items[r.i] || {};
  return {
    n: r.i + 1,
    kind: r.kind || it.figure?.kind,
    course: it.course,
    taskType: it.taskType,
    verdict: r.verdict || (r.error ? 'error' : null),
    scores: r.error ? null : { usefulness: r.usefulness, geometry: r.geometry, readability: r.readability },
    flags: r.error ? null : { redundant: !!r.redundant, leak: !!r.leak, meta: !!r.meta },
    oneLine: r.oneLine || r.error || '',
    worstIssue: r.worstIssue || '',
    spec: JSON.stringify(it.figure?.spec ?? {}).slice(0, 600),
    teacher: String(it.context?.teacher ?? '').slice(0, 400),
  };
});
fs.writeFileSync(path.join(outDir, 'figures.json'), JSON.stringify(compact, null, 1), 'utf8');

const sizeOf = (f) => (fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) : 0);
const sheetTotal = sheets.reduce((n, s) => n + sizeOf(s.file), 0);
console.log(`\n打包完成 → ${path.relative(ROOT, outDir)}`);
console.log(`  manifest.md  ${sizeOf(path.join(outDir, 'manifest.md'))}KB`);
console.log(`  figures.json ${sizeOf(path.join(outDir, 'figures.json'))}KB`);
console.log(`  拼版 ${sheets.length} 张 合计 ${sheetTotal}KB`);
console.log(`  原 HTML 约 ${sizeOf(path.join(ROOT, 'outputs', `${version}-review.html`))}KB → 现约 ${sheetTotal + sizeOf(path.join(outDir, 'manifest.md'))}KB`);
