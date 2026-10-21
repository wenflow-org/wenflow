/* eslint-disable no-console -- 一次性离线分析 CLI：只读本地 JSON 产物，不联网、不调模型、不落 DB */
/**
 * 交叉编码重排器（bge-reranker-v2-m3）的**上线工作点标定**：把 answerability-report.json
 * 当成一份「已测过的分数表」，重算 clean AUC、阈值曲线、以及三套阈值策略的对比。
 *
 * 为什么单独写一份而不复用 eval-goal-material-answerability.ts 的结论打印：
 *   那份脚本的 job 是「跑测量」（要联网、要调模型、要花额度），它的指标口径固定（只用锚点分组）；
 *   本脚本的 job 是「从已有分数表里做决策分析」——纯离线、可反复跑、口径可切换，
 *   并且额外回答生产上线必须回答的问题：绝对阈值 vs 每 query 归一化、能不能弃权、标定漂移怎么兜。
 *
 * 口径约定（都在下面的 VARIANTS / SETS 里显式列出，不打闷包）：
 *   label 复核缺失（null）两种处理：
 *     exclude        —— 丢掉这 17 条（默认，与 eval 脚本的 clean 口径一致）
 *     includeAnchor  —— 把 null 行退回锚点标签（pos→可答，其余→不可答）
 *   真值集合三种：
 *     raw-anchor            —— 完全用锚点 kind 当真值（pos=可答）——噪声最大，只作对照
 *     clean-anchor-restricted —— 正例=pos 且 label=true；负例=非 pos 且 label=false（eval 脚本口径）
 *     clean-label-only      —— 正例=所有 label=true；负例=所有 label=false（闸门上线口径：
 *                              「这段材料能不能答」是块的属性，跟它当初被怎么抽出来无关）
 *
 * 跑法（不需要后端服务、不需要任何 API key）：
 *   cd backend && npx ts-node --transpile-only src/scripts/analyze-reranker-operating-point.ts
 *   ... --report=<其他 answerability-report.json>
 *   ... --no-write            只打印，不落 data.json
 * 产物：doc/local/DECISION-MODEL-STUDY-2026-10-18/G-reranker-operating-point.data.json（本脚本的原始数字）
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_REPORT = path.resolve(
  __dirname,
  '../../../doc/local/GOAL-MATERIAL-EVAL-2026-10-18/answerability-report.json'
);
const OUT_DIR = path.resolve(__dirname, '../../../doc/local/DECISION-MODEL-STUDY-2026-10-18');
const OUT_JSON = path.join(OUT_DIR, 'G-reranker-operating-point.data.json');

type Kind = 'pos' | 'hard_neg' | 'easy_neg';

interface Row {
  kind: Kind;
  probeKind: string;
  topic: string;
  question: string;
  chunkTitle: string;
  cosine: number;
  judge: number;
  label: boolean | null;
}

// ───────────────────────────── 统计基元 ─────────────────────────────

/** 线性插值分位数（type-7，与 numpy 默认一致）。 */
function quantile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** AUC（正例分更高=1），并列按 0.5 计。 */
function auc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) {
    if (p > n) wins += 1;
    else if (p === n) wins += 0.5;
  }
  return wins / (pos.length * neg.length);
}

/** 可复现的 LCG（不引第三方依赖，保证每次跑出同一组 CI）。 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 分层 bootstrap：正/负两侧各自有放回重抽，返回 [p2.5, p97.5]。 */
function aucCi(pos: number[], neg: number[], iters = 2000, seed = 20261019): [number, number] {
  const rng = makeRng(seed);
  const out: number[] = [];
  for (let it = 0; it < iters; it += 1) {
    const rp: number[] = [];
    for (let i = 0; i < pos.length; i += 1) rp.push(pos[Math.floor(rng() * pos.length)]);
    const rn: number[] = [];
    for (let i = 0; i < neg.length; i += 1) rn.push(neg[Math.floor(rng() * neg.length)]);
    out.push(auc(rp, rn));
  }
  return [quantile(out, 0.025), quantile(out, 0.975)];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const f = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');

// ───────────────────────────── 载入 + 真值口径 ─────────────────────────────

type NullMode = 'exclude' | 'includeAnchor';
type SetName = 'raw-anchor' | 'clean-anchor-restricted' | 'clean-label-only';

/** 某行在给定 null 处理下的真值：true=可答 / false=不可答 / null=丢弃。 */
function truthOf(row: Row, mode: NullMode): boolean | null {
  if (row.label === true || row.label === false) return row.label;
  return mode === 'includeAnchor' ? row.kind === 'pos' : null;
}

interface TruthSet {
  name: SetName;
  pos: Row[];
  neg: Row[];
  hardNeg: Row[];
  easyNeg: Row[];
}

function buildSet(rows: Row[], name: SetName, mode: NullMode): TruthSet {
  const labeled = rows
    .map((r) => ({ r, t: truthOf(r, mode) }))
    .filter((x): x is { r: Row; t: boolean } => x.t !== null);
  let pos: Row[];
  let neg: Row[];
  if (name === 'raw-anchor') {
    pos = labeled.filter((x) => x.r.kind === 'pos').map((x) => x.r);
    neg = labeled.filter((x) => x.r.kind !== 'pos').map((x) => x.r);
  } else if (name === 'clean-anchor-restricted') {
    pos = labeled.filter((x) => x.r.kind === 'pos' && x.t).map((x) => x.r);
    neg = labeled.filter((x) => x.r.kind !== 'pos' && !x.t).map((x) => x.r);
  } else {
    pos = labeled.filter((x) => x.t).map((x) => x.r);
    neg = labeled.filter((x) => !x.t).map((x) => x.r);
  }
  return {
    name,
    pos,
    neg,
    hardNeg: neg.filter((r) => r.kind === 'hard_neg'),
    easyNeg: neg.filter((r) => r.kind === 'easy_neg'),
  };
}

// ───────────────────────────── 阈值策略 ─────────────────────────────

interface PolicyRow {
  policy: string;
  family: 'absolute' | 'per-query';
  tpr: number;
  hardNegReject: number;
  easyNegReject: number;
  allNegReject: number;
  keepRate: number;
  keptPos: number;
  missedPos: number;
  nPos: number;
  nHardNeg: number;
}

function evalPolicy(
  label: string,
  family: PolicyRow['family'],
  set: TruthSet,
  keepFn: (r: Row) => boolean
): PolicyRow {
  const keep = keepFn;
  const pos = set.pos;
  const hard = set.hardNeg;
  const easy = set.easyNeg;
  const allNeg = set.neg;
  const keptPos = pos.filter(keep).length;
  const keptHard = hard.filter(keep).length;
  const keptEasy = easy.filter(keep).length;
  const keptNeg = allNeg.filter(keep).length;
  const keptAll = pos.filter(keep).length + allNeg.filter(keep).length;
  const nAll = pos.length + allNeg.length;
  return {
    policy: label,
    family,
    tpr: pos.length ? keptPos / pos.length : NaN,
    hardNegReject: hard.length ? 1 - keptHard / hard.length : NaN,
    easyNegReject: easy.length ? 1 - keptEasy / easy.length : NaN,
    allNegReject: allNeg.length ? 1 - keptNeg / allNeg.length : NaN,
    keepRate: nAll ? keptAll / nAll : NaN,
    keptPos,
    missedPos: pos.length - keptPos,
    nPos: pos.length,
    nHardNeg: hard.length,
  };
}

/** 绝对分阈值：score(r) = judge，保留 judge ≥ t。 */
function absolutePolicy(set: TruthSet, t: number, field: 'judge' | 'cosine' = 'judge'): PolicyRow {
  return evalPolicy(`${field === 'judge' ? '重排原始分' : '余弦'} ≥ ${t}`, 'absolute', set, (r) =>
    (field === 'judge' ? r.judge : r.cosine) >= t
  );
}

/** 每 query z-score：z=(s-mean_q)/sd_q，保留 z ≥ zMin。 */
function zPolicy(set: TruthSet, zMin: number): PolicyRow {
  const byQ = groupByQuestion([...set.pos, ...set.neg]);
  const z = new Map<Row, number>();
  for (const [, rows] of byQ) {
    const vs = rows.map((r) => r.judge);
    const m = mean(vs);
    const d = sd(vs);
    for (const r of rows) z.set(r, d > 1e-12 ? (r.judge - m) / d : 0);
  }
  return evalPolicy(`每 query z-score ≥ ${zMin}`, 'per-query', set, (r) => (z.get(r) ?? -Infinity) >= zMin);
}

/** 每 query 取前 k（按分位/保留比例）：k 为保留比例，nKeep=round(k*n) 至少 1 条。 */
function topKPolicy(set: TruthSet, k: number): PolicyRow {
  const byQ = groupByQuestion([...set.pos, ...set.neg]);
  const keepSet = new Set<Row>();
  for (const [, rows] of byQ) {
    const n = rows.length;
    const nKeep = Math.min(n, Math.max(1, Math.round(k * n)));
    const sorted = [...rows].sort((a, b) => b.judge - a.judge);
    // 并列按原序先来先得（跨编码分几乎无并列；本样本实测 0 处并列）
    for (const r of sorted.slice(0, nKeep)) keepSet.add(r);
  }
  return evalPolicy(`每 query 保留前 ${pct(k)}（nKeep=round(k·n)，本样本 n=3）`, 'per-query', set, (r) =>
    keepSet.has(r)
  );
}

/** 每 query 取前 k 且绝对分 ≥ floor 的合取式（既排序又留弃权能力）。 */
function hybridPolicy(set: TruthSet, k: number, floor: number): PolicyRow {
  const byQ = groupByQuestion([...set.pos, ...set.neg]);
  const keepSet = new Set<Row>();
  for (const [, rows] of byQ) {
    const n = rows.length;
    const nKeep = Math.min(n, Math.max(1, Math.round(k * n)));
    const sorted = [...rows].sort((a, b) => b.judge - a.judge);
    for (const r of sorted.slice(0, nKeep)) if (r.judge >= floor) keepSet.add(r);
  }
  return evalPolicy(`每 query 前 ${pct(k)} 且分 ≥ ${floor}`, 'per-query', set, (r) => keepSet.has(r));
}

function groupByQuestion(rows: Row[]): Array<[string, Row[]]> {
  const g = new Map<string, Row[]>();
  for (const r of rows) {
    const list = g.get(r.question) ?? [];
    list.push(r);
    g.set(r.question, list);
  }
  return [...g.entries()];
}

// ───────────────────────────── main ─────────────────────────────

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function main(): void {
  const reportPath = arg('report') ?? DEFAULT_REPORT;
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const rows: Row[] = (raw.pairs as Array<Record<string, unknown>>).map((p) => ({
    kind: p.kind as Kind,
    probeKind: String(p.probeKind ?? ''),
    topic: String(p.topic ?? ''),
    question: String(p.question ?? ''),
    chunkTitle: String(p.chunkTitle ?? ''),
    cosine: Number(p.cosine),
    judge: Number(p.judge),
    label: (p.label === true ? true : p.label === false ? false : null) as boolean | null,
  }));

  console.log('# 交叉编码重排器工作点标定（离线重算）');
  console.log(`\n数据：${reportPath}`);
  console.log(`生成时间 ${raw.generatedAt}｜判定器 ${raw.judge}｜配对数 ${rows.length}｜query 数 ${new Set(rows.map((r) => r.question)).size}`);

  const byKindLabel: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.kind}|${String(r.label)}`;
    byKindLabel[key] = (byKindLabel[key] ?? 0) + 1;
  }
  console.log(`\nkind × label 计数：${JSON.stringify(byKindLabel)}`);
  console.log(
    `锚点噪声：正例被复核判「答不了」 ${byKindLabel['pos|false'] ?? 0}/60＝${pct((byKindLabel['pos|false'] ?? 0) / 60)}` +
      `｜同主题难负例被复核判「能答」 ${byKindLabel['hard_neg|true'] ?? 0}/60＝${pct((byKindLabel['hard_neg|true'] ?? 0) / 60)}` +
      `｜易负例被复核判「能答」 ${byKindLabel['easy_neg|true'] ?? 0}/60`
  );

  // ── 1. 分数分位数 ──
  console.log('\n## 1. 分数分位数（judge = 重排器原始分）');
  console.log('\n| 组 | n | min | 25% | 50% | 75% | max | 均值 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const k of ['pos', 'hard_neg', 'easy_neg'] as const) {
    const xs = rows.filter((r) => r.kind === k).map((r) => r.judge);
    console.log(
      `| ${k} | ${xs.length} | ${f(quantile(xs, 0), 5)} | ${f(quantile(xs, 0.25))} | ${f(quantile(xs, 0.5))} | ${f(quantile(xs, 0.75))} | ${f(quantile(xs, 1))} | ${f(mean(xs))} |`
    );
  }
  const allNegRaw = rows.filter((r) => r.kind !== 'pos').map((r) => r.judge);
  console.log(
    `| 全部负例 | ${allNegRaw.length} | ${f(quantile(allNegRaw, 0), 5)} | ${f(quantile(allNegRaw, 0.25))} | ${f(quantile(allNegRaw, 0.5))} | ${f(quantile(allNegRaw, 0.75))} | ${f(quantile(allNegRaw, 1))} | ${f(mean(allNegRaw))} |`
  );
  // clean（label）口径的分位数——上线闸门真正面对的两堆分布
  const cleanSet = buildSet(rows, 'clean-label-only', 'exclude');
  console.log('\nclean 口径（label=true 当正例 / label=false 当负例，排除 null）：');
  console.log('\n| 组 | n | min | 25% | 50% | 75% | max | 均值 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [label, xs] of [
    ['正例（可答）', cleanSet.pos.map((r) => r.judge)],
    ['同主题难负例', cleanSet.hardNeg.map((r) => r.judge)],
    ['易负例', cleanSet.easyNeg.map((r) => r.judge)],
    ['全部负例', cleanSet.neg.map((r) => r.judge)],
  ] as Array<[string, number[]]>) {
    console.log(
      `| ${label} | ${xs.length} | ${f(quantile(xs, 0), 5)} | ${f(quantile(xs, 0.25))} | ${f(quantile(xs, 0.5))} | ${f(quantile(xs, 0.75))} | ${f(quantile(xs, 1))} | ${f(mean(xs))} |`
    );
  }
  // 锚点噪声里最危险的一类：被复核判「能答」的同主题负例——它们的分数会不会抬高 AUC？
  const hardTrue = rows.filter((r) => r.kind === 'hard_neg' && r.label === true);
  const hardFalse = rows.filter((r) => r.kind === 'hard_neg' && r.label === false);
  console.log(
    `\n同主题难负例里被判「能答」的 ${hardTrue.length} 条 judge：${hardTrue.map((r) => f(r.judge, 4)).join(', ')}`
  );
  console.log(`（其余 ${hardFalse.length} 条判「不能答」的 judge 中位 ${f(quantile(hardFalse.map((r) => r.judge), 0.5))}、最高 ${f(Math.max(...hardFalse.map((r) => r.judge)))}）`);
  const cosPos = rows.filter((r) => r.kind === 'pos').map((r) => r.cosine);
  const cosNeg = rows.filter((r) => r.kind !== 'pos').map((r) => r.cosine);
  console.log(
    `| 余弦·正例 | ${cosPos.length} | ${f(quantile(cosPos, 0))} | ${f(quantile(cosPos, 0.25))} | ${f(quantile(cosPos, 0.5))} | ${f(quantile(cosPos, 0.75))} | ${f(quantile(cosPos, 1))} | ${f(mean(cosPos))} |`
  );
  console.log(
    `| 余弦·全部负例 | ${cosNeg.length} | ${f(quantile(cosNeg, 0))} | ${f(quantile(cosNeg, 0.25))} | ${f(quantile(cosNeg, 0.5))} | ${f(quantile(cosNeg, 0.75))} | ${f(quantile(cosNeg, 1))} | ${f(mean(cosNeg))} |`
  );
  const aboveHalf = rows.filter((r) => r.judge >= 0.5);
  console.log(
    `\n分 ≥0.5 的行：${aboveHalf.length}/${rows.length}（其中正例 ${aboveHalf.filter((r) => r.kind === 'pos').length}/60＝${pct(aboveHalf.filter((r) => r.kind === 'pos').length / 60)}，` +
      `难负例 ${aboveHalf.filter((r) => r.kind === 'hard_neg').length}/60，易负例 ${aboveHalf.filter((r) => r.kind === 'easy_neg').length}/60）`
  );
  // 每 query 分数和 → 判断上游是「逐对 sigmoid」还是「候选内 softmax」
  const sums = groupByQuestion(rows).map(([, rs]) => rs.reduce((a, r) => a + r.judge, 0));
  console.log(
    `每 query 分数和：min ${f(Math.min(...sums))} / 中位 ${f(quantile(sums, 0.5))} / max ${f(Math.max(...sums))}（softmax 口径应恒＝1；实测仅 ${sums.filter((s) => Math.abs(s - 1) < 0.01).length}/${sums.length} 条落在 1 附近）`
  );

  // ── 2. AUC 三种口径 + null 两种处理 ──
  console.log('\n## 2. AUC：真值口径 × label 缺失处理');
  console.log('\n| 真值口径 | null 处理 | 正例 | 负例(全部) | 负例(同主题) | AUC vs 全部负例 | 95% CI | AUC vs 同主题难负例 | 95% CI |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const sets: Record<string, TruthSet> = {};
  for (const setName of ['raw-anchor', 'clean-anchor-restricted', 'clean-label-only'] as SetName[]) {
    for (const mode of ['exclude', 'includeAnchor'] as NullMode[]) {
      const set = buildSet(rows, setName, mode);
      sets[`${setName}|${mode}`] = set;
      const p = set.pos.map((r) => r.judge);
      const n = set.neg.map((r) => r.judge);
      const h = set.hardNeg.map((r) => r.judge);
      const ciAll = aucCi(p, n);
      const ciHard = aucCi(p, h);
      console.log(
        `| ${setName} | ${mode} | ${p.length} | ${n.length} | ${h.length} | ${f(auc(p, n))} | [${f(ciAll[0], 3)}, ${f(ciAll[1], 3)}] | ${f(auc(p, h))} | [${f(ciHard[0], 3)}, ${f(ciHard[1], 3)}] |`
      );
    }
  }
  // 余弦对照（clean-label-only / exclude）
  const primary = sets['clean-label-only|exclude'];
  const cosAucAll = auc(primary.pos.map((r) => r.cosine), primary.neg.map((r) => r.cosine));
  const cosAucHard = auc(primary.pos.map((r) => r.cosine), primary.hardNeg.map((r) => r.cosine));
  console.log(`\n余弦对照（clean-label-only / exclude）：AUC vs 全部负例 ${f(cosAucAll)}｜vs 同主题难负例 ${f(cosAucHard)}`);

  // ── 2b. 「0.958（锚点限制口径）vs 0.895（闸门口径）」的差异归因 ──
  const labeledRows = rows.filter((r) => r.label === true || r.label === false);
  const scopePos = {
    anchorPos: labeledRows.filter((r) => r.kind === 'pos' && r.label === true),
    allTrue: labeledRows.filter((r) => r.label === true),
  };
  const scopeNeg = {
    nonPosFalse: labeledRows.filter((r) => r.kind !== 'pos' && r.label === false),
    allFalse: labeledRows.filter((r) => r.label === false),
  };
  console.log('\n### 2b. 口径差异归因：为什么「锚点限制口径 0.958」不是闸门该用的数');
  console.log('\n| 正例集合 | 负例集合 | 正/负 | AUC |');
  console.log('| --- | --- | --- | --- |');
  for (const [pl, ps] of Object.entries(scopePos)) {
    for (const [nl, ns] of Object.entries(scopeNeg)) {
      console.log(`| ${pl}（${ps.length}） | ${nl}（${ns.length}） | ${ps.length}/${ns.length} | ${f(auc(ps.map((r) => r.judge), ns.map((r) => r.judge)))} |`);
    }
  }
  const addedPos = scopePos.allTrue.filter((r) => r.kind !== 'pos');
  const addedNeg = scopeNeg.allFalse.filter((r) => r.kind === 'pos');
  console.log(
    `\n两个口径相差的 9 条正例（hard_neg/easy_neg 里被复核判「能答」的）judge：${addedPos.map((r) => f(r.judge, 4)).join(', ')}（中位 ${f(quantile(addedPos.map((r) => r.judge), 0.5))}）`
  );
  console.log(
    `两个口径相差的 7 条负例（pos 里被复核判「答不了」的）judge：${addedNeg.map((r) => f(r.judge, 4)).join(', ')}（中位 ${f(quantile(addedNeg.map((r) => r.judge), 0.5))}）`
  );

  // ── 3. 每 query 结构 ──
  console.log('\n## 3. 每 query 结构（60 个 query × 3 个候选＝pos/hard_neg/easy_neg）');
  const byQ = groupByQuestion(rows);
  const rank1: Record<string, number> = { pos: 0, hard_neg: 0, easy_neg: 0 };
  const rankDist: Record<string, number[]> = { pos: [0, 0, 0], hard_neg: [0, 0, 0], easy_neg: [0, 0, 0] };
  let matchedPosWinHard = 0;
  let matchedPairs = 0;
  let zeroAnswerable = 0;
  const zeroAnswerableMax: number[] = [];
  const answerableMax: number[] = [];
  let cleanTop1Hit = 0;
  for (const [, rs] of byQ) {
    const sorted = [...rs].sort((a, b) => b.judge - a.judge);
    if (sorted[0]) rank1[sorted[0].kind] += 1;
    sorted.forEach((r, i) => {
      if (i < 3) rankDist[r.kind][i] += 1;
    });
    const p = rs.find((r) => r.kind === 'pos');
    const h = rs.find((r) => r.kind === 'hard_neg');
    if (p && h) {
      matchedPairs += 1;
      if (p.judge > h.judge) matchedPosWinHard += 1;
      else if (p.judge === h.judge) matchedPosWinHard += 0.5;
    }
    const truth = rs.filter((r) => truthOf(r, 'exclude') === true);
    if (!truth.length) {
      zeroAnswerable += 1;
      zeroAnswerableMax.push(sorted[0]?.judge ?? 0);
    } else {
      answerableMax.push(Math.max(...truth.map((r) => r.judge)));
      if (sorted[0] && truth.includes(sorted[0])) cleanTop1Hit += 1;
    }
  }
  console.log(`\n重排分 rank-1 归属（锚点口径）：pos ${rank1.pos}｜hard_neg ${rank1.hard_neg}｜easy_neg ${rank1.easy_neg}`);
  console.log(
    `各 kind 的名次分布（第1/第2/第3）：pos ${rankDist.pos.join('/')}｜hard_neg ${rankDist.hard_neg.join('/')}｜easy_neg ${rankDist.easy_neg.join('/')}`
  );
  console.log(`同 query 内 pos 战胜同主题难负例（配对胜率）：${matchedPosWinHard}/${matchedPairs}＝${pct(matchedPosWinHard / matchedPairs)}`);
  console.log(
    `复核后「这个 query 一个可答块都没有」的 query 数：${zeroAnswerable}/${byQ.length}（这些 query 上任何「每 query 必留前 k」的策略都必然留下 1 条不可答块）`
  );
  console.log(`  ↳ 这些 query 的候选最高分：${zeroAnswerableMax.map((x) => f(x, 3)).join(', ')}`);
  console.log(
    `  ↳ 有可答块的 query 共 ${answerableMax.length} 个，其可答块最高分：min ${f(Math.min(...answerableMax))} / 25% ${f(quantile(answerableMax, 0.25))} / 中位 ${f(quantile(answerableMax, 0.5))}`
  );
  console.log(`复核后 top-1 命中率（有可答块的 query 里，rank-1 恰为可答块）：${cleanTop1Hit}/${answerableMax.length}＝${pct(cleanTop1Hit / answerableMax.length)}`);

  // ── 4. 绝对分阈值曲线 ──
  console.log('\n## 4. 策略 A：绝对分阈值（clean-label-only / exclude）');
  console.log(
    `\n正例 ${primary.pos.length}｜同主题难负例 ${primary.hardNeg.length}｜易负例 ${primary.easyNeg.length}｜全部负例 ${primary.neg.length}`
  );
  console.log('\n| 阈值 | 正例通过 TPR | 同主题难负例拒绝 | 易负例拒绝 | 全部负例拒绝 | 审计样本保留率 | 漏掉的可答块 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  const grid = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7];
  const absRows: PolicyRow[] = [];
  const absByT = new Map<number, PolicyRow>();
  for (const t of grid) {
    const row = absolutePolicy(primary, t);
    absRows.push(row);
    absByT.set(t, row);
    console.log(
      `| ${t} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(row.easyNegReject)} | ${pct(row.allNegReject)} | ${pct(row.keepRate)} | ${row.missedPos}/${row.nPos} |`
    );
  }
  // 运营视角：给定「同主题难负例拒绝率」目标，最小阈值能给到的 TPR
  console.log('\n给定目标反推（在同主题难负例拒绝率 ≥ 目标的阈值里取最小者）：');
  const opTargets: Array<[string, number]> = [
    ['≥ 70%', 0.7],
    ['≥ 80%', 0.8],
    ['≥ 90%', 0.9],
    ['≥ 95%', 0.95],
  ];
  for (const [label, target] of opTargets) {
    const cand = grid
      .filter((t) => (absByT.get(t)?.hardNegReject ?? -1) >= target)
      .sort((a, b) => a - b);
    const minT = cand[0];
    const pick = minT === undefined ? null : absByT.get(minT) ?? null;
    console.log(
      pick && minT !== undefined
        ? `  难负例拒绝 ${label}：阈值 ${minT} → TPR ${pct(pick.tpr)}，保留率 ${pct(pick.keepRate)}，漏掉 ${pick.missedPos}/${pick.nPos} 个可答块`
        : `  难负例拒绝 ${label}：网格内无满足点`
    );
  }
  // 平衡准确率 / Youden 最优点（细网格）
  const fine = Array.from({ length: 400 }, (_, i) => 0.0005 + (i * (0.95 - 0.0005)) / 399);
  let bestBal: { t: number; bal: number; row: PolicyRow } | null = null;
  for (const t of fine) {
    const row = absolutePolicy(primary, t);
    const bal = (row.tpr + row.allNegReject) / 2;
    if (!bestBal || bal > bestBal.bal) bestBal = { t, bal, row };
  }
  if (bestBal) {
    console.log(
      `\n平衡准确率最优点（审计样本 58 正 / 105 负，先验被强行拉平）：阈值 ${f(bestBal.t)} → TPR ${pct(bestBal.row.tpr)}｜全部负例拒绝 ${pct(bestBal.row.allNegReject)}｜平衡准确率 ${f(bestBal.bal, 3)}`
    );
    console.log('（注意：这个最优点是「1:2 审计样本」下的均衡点，不是生产最优点——生产里可答块是少数，代价函数不对称。）');
  }

  // ── 4b. 阈值 × query 级效果（生产关心的是「这个 query 还有没有证据」，不是单块 TPR） ──
  const queryInfo = byQ.map(([q, rs]) => {
    const truthRows = rs.filter((r) => truthOf(r, 'exclude') === true);
    const top1 = Math.max(...rs.map((r) => r.judge));
    return { q, rows: rs, hasAnswerable: truthRows.length > 0, truthRows, top1 };
  });
  const qPos = queryInfo.filter((x) => x.hasAnswerable);
  const qNeg = queryInfo.filter((x) => !x.hasAnswerable);
  /** 任意「保留判据」在 query 级上的代价：覆盖率 / 弃权率 / 本该弃权者正确弃权。 */
  const queryStats = (
    keepFn: (r: Row) => boolean
  ): { coverage: number; abstainRate: number; correctAbstain: number } => {
    const covered = qPos.filter((x) => x.truthRows.some(keepFn)).length;
    const abstained = queryInfo.filter((x) => x.rows.every((r) => !keepFn(r))).length;
    const correct = qNeg.filter((x) => x.rows.every((r) => !keepFn(r))).length;
    return {
      coverage: covered / qPos.length,
      abstainRate: abstained / queryInfo.length,
      correctAbstain: correct / Math.max(1, qNeg.length),
    };
  };
  console.log('\n### 4b. query 级效果（阈值作用在块上，但代价落在 query 上）');
  console.log(
    `\n可答 query ${qPos.length} 个｜「一个可答块都没有」的 query ${qNeg.length} 个｜query 级 AUC（top-1 分区分「有可答块 / 无」）${f(
      auc(
        qPos.map((x) => x.top1),
        qNeg.map((x) => x.top1)
      )
    )}`
  );
  console.log('\n| 阈值 | 单块 TPR | 有可答块的 query 里至少留住 1 块的覆盖率 | 全部 query 的弃权率 | 本该弃权的 query 里正确弃权 |');
  console.log('| --- | --- | --- | --- | --- |');
  const queryLevel: Array<Record<string, number>> = [];
  for (const t of [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3, 0.5]) {
    const row = absolutePolicy(primary, t);
    const s = queryStats((r) => r.judge >= t);
    queryLevel.push({ threshold: t, tpr: row.tpr, ...s });
    console.log(
      `| ${t} | ${pct(row.tpr)} | ${Math.round(s.coverage * qPos.length)}/${qPos.length}＝${pct(s.coverage)} | ${Math.round(s.abstainRate * queryInfo.length)}/${queryInfo.length}＝${pct(s.abstainRate)} | ${Math.round(s.correctAbstain * qNeg.length)}/${qNeg.length}＝${pct(s.correctAbstain)} |`
    );
  }
  console.log(
    '\n注意：本样本每个 query 只有 3 个候选；生产候选池是 topK×3（默认 18，上限 30）。' +
      '\n按单块误收率 FPR 外推，「18 个候选里一条都不漏」的概率 ≈ (1-FPR)^18——本表最后两列在生产池上会显著变差，不能直接搬。'
  );
  const fprAt = (t: number): number => 1 - absolutePolicy(primary, t).allNegReject;
  for (const t of [0.02, 0.05, 0.1, 0.2, 0.3]) {
    const fpr = fprAt(t);
    console.log(
      `  阈值 ${t}：单块 FPR ${pct(fpr)} → 池子 18 块时「至少漏进 1 块」≈ ${pct(1 - Math.pow(1 - fpr, 18))}（纯负池近似，仅量级参考）`
    );
  }

  // ── 4d. 两族策略在 query 级同一张表上对比（决定「能不能弃权」） ──
  console.log('\n### 4d. 两族策略的 query 级代价对比（同为「每 query 3 候选」样本）');
  console.log('\n| 策略 | 单块 TPR | 单块难负例拒绝 | 覆盖率 | 弃权率 | 本该弃权者正确弃权 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const zKeep = (zMin: number) => {
    const byQ2 = groupByQuestion([...primary.pos, ...primary.neg]);
    const z = new Map<Row, number>();
    for (const [, rs] of byQ2) {
      const vs = rs.map((r) => r.judge);
      const m = mean(vs);
      const d = sd(vs);
      for (const r of rs) z.set(r, d > 1e-12 ? (r.judge - m) / d : 0);
    }
    return (r: Row): boolean => (z.get(r) ?? -Infinity) >= zMin;
  };
  const topKeep = (k: number) => {
    const keepSet = new Set<Row>();
    for (const [, rs] of groupByQuestion([...primary.pos, ...primary.neg])) {
      const nKeep = Math.min(rs.length, Math.max(1, Math.round(k * rs.length)));
      for (const r of [...rs].sort((a, b) => b.judge - a.judge).slice(0, nKeep)) keepSet.add(r);
    }
    return (r: Row): boolean => keepSet.has(r);
  };
  const hybridKeep = (k: number, floor: number) => {
    const top = topKeep(k);
    return (r: Row): boolean => top(r) && r.judge >= floor;
  };
  const cmp: Array<[string, (r: Row) => boolean]> = [
    ['绝对分 ≥ 0.01', (r) => r.judge >= 0.01],
    ['绝对分 ≥ 0.02（推荐）', (r) => r.judge >= 0.02],
    ['绝对分 ≥ 0.05', (r) => r.judge >= 0.05],
    ['每 query z ≥ 0', zKeep(0)],
    ['每 query z ≥ 0.5', zKeep(0.5)],
    ['每 query 前 34%（n=3 时＝top-1）', topKeep(0.34)],
    ['每 query 前 50%', topKeep(0.5)],
    ['每 query 前 34% 且 ≥ 0.05', hybridKeep(0.34, 0.05)],
    ['每 query 前 67% 且 ≥ 0.05', hybridKeep(0.67, 0.05)],
  ];
  const cmpRows: Array<Record<string, number | string>> = [];
  for (const [label, keepFn] of cmp) {
    const row = evalPolicy(label, label.startsWith('绝对') ? 'absolute' : 'per-query', primary, keepFn);
    const s = queryStats(keepFn);
    cmpRows.push({
      policy: label,
      tpr: row.tpr,
      hardNegReject: row.hardNegReject,
      keepRate: row.keepRate,
      coverage: s.coverage,
      abstainRate: s.abstainRate,
      correctAbstain: s.correctAbstain,
    });
    console.log(
      `| ${label} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(s.coverage)} | ${pct(s.abstainRate)} | ${pct(s.correctAbstain)} |`
    );
  }

  // ── 4c. 余弦阈值对照（同一样本，clean-label-only / exclude） ──
  console.log('\n### 4c. 余弦阈值对照');
  console.log('\n| 余弦阈值 | 正例通过 TPR | 同主题难负例拒绝 | 全部负例拒绝 | 审计样本保留率 |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const t of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]) {
    const row = absolutePolicy(primary, t, 'cosine');
    console.log(`| ${t} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(row.allNegReject)} | ${pct(row.keepRate)} |`);
  }

  // ── 5. 策略 B：每 query 归一化 ──
  console.log('\n## 5. 策略 B：每 query 归一到同一尺度');
  console.log('\n### B1. 每 query z-score 阈值');
  console.log('\n| z 阈值 | 正例通过 TPR | 同主题难负例拒绝 | 易负例拒绝 | 审计样本保留率 | 漏掉的可答块 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const zRows: PolicyRow[] = [];
  for (const z of [-1, -0.5, 0, 0.5, 1, 1.5]) {
    const row = zPolicy(primary, z);
    zRows.push(row);
    console.log(
      `| ${z} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(row.easyNegReject)} | ${pct(row.keepRate)} | ${row.missedPos}/${row.nPos} |`
    );
  }
  console.log('\n### B2. 每 query 保留前 k%（本样本 n=3，nKeep=round(k·n)，保留率因此被样本结构锁死）');
  console.log('\n| 保留比例 k | 实际 nKeep | 正例通过 TPR | 同主题难负例拒绝 | 易负例拒绝 | 审计样本保留率 | 漏掉的可答块 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  const kRows: PolicyRow[] = [];
  for (const k of [0.34, 0.5, 0.67, 0.8, 1]) {
    const row = topKPolicy(primary, k);
    kRows.push(row);
    console.log(
      `| ${pct(k)} | ${Math.max(1, Math.round(k * 3))} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(row.easyNegReject)} | ${pct(row.keepRate)} | ${row.missedPos}/${row.nPos} |`
    );
  }
  console.log('\n### B3. 合取式：每 query 前 k% 且 绝对分 ≥ 下限（既能排序、又能弃权）');
  console.log('\n| 策略 | 正例通过 TPR | 同主题难负例拒绝 | 易负例拒绝 | 审计样本保留率 | 漏掉的可答块 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const hybridRows: PolicyRow[] = [];
  for (const [k, floor] of [
    [1, 0.03],
    [0.67, 0.05],
    [0.67, 0.1],
    [0.5, 0.1],
    [0.34, 0.05],
    [0.34, 0.1],
  ] as Array<[number, number]>) {
    const row = hybridPolicy(primary, k, floor);
    hybridRows.push(row);
    console.log(
      `| 每 query 前 ${pct(k)} 且分 ≥ ${floor} | ${pct(row.tpr)} | ${pct(row.hardNegReject)} | ${pct(row.easyNegReject)} | ${pct(row.keepRate)} | ${row.missedPos}/${row.nPos} |`
    );
  }

  // ── 6. null 敏感性 + 生产先验敏感性 ──
  console.log('\n## 6. 敏感性');
  console.log('\n### 6.1 label 为 null 的 17 条：排除 vs 纳入（按锚点回填）');
  console.log('\n| 真值口径 | null 处理 | AUC 全部负例 | AUC 同主题难负例 | 阈值 0.01 的 TPR | 阈值 0.01 的难负例拒绝 | 阈值 0.1 的 TPR | 阈值 0.1 的难负例拒绝 | 阈值 0.3 的 TPR | 阈值 0.3 的难负例拒绝 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const nullSens: Array<Record<string, number | string>> = [];
  for (const setName of ['clean-label-only', 'clean-anchor-restricted'] as SetName[]) {
    for (const mode of ['exclude', 'includeAnchor'] as NullMode[]) {
      const set = sets[`${setName}|${mode}`];
      const p = set.pos.map((r) => r.judge);
      const n = set.neg.map((r) => r.judge);
      const h = set.hardNeg.map((r) => r.judge);
      const a01 = absolutePolicy(set, 0.01);
      const a10 = absolutePolicy(set, 0.1);
      const a30 = absolutePolicy(set, 0.3);
      nullSens.push({
        set: setName,
        mode,
        nPos: p.length,
        nNeg: n.length,
        aucAll: auc(p, n),
        aucHard: auc(p, h),
        tpr01: a01.tpr,
        rej01: a01.hardNegReject,
        tpr10: a10.tpr,
        rej10: a10.hardNegReject,
        tpr30: a30.tpr,
        rej30: a30.hardNegReject,
      });
      console.log(
        `| ${setName} | ${mode} | ${f(auc(p, n))} | ${f(auc(p, h))} | ${pct(a01.tpr)} | ${pct(a01.hardNegReject)} | ${pct(a10.tpr)} | ${pct(a10.hardNegReject)} | ${pct(a30.tpr)} | ${pct(a30.hardNegReject)} |`
      );
    }
  }
  const nullRows = rows.filter((r) => r.label === null);
  console.log(
    `\n这 17 条的 judge：pos ${nullRows.filter((r) => r.kind === 'pos').map((r) => f(r.judge, 4)).join(', ')}`
  );
  console.log(`hard_neg ${nullRows.filter((r) => r.kind === 'hard_neg').map((r) => f(r.judge, 4)).join(', ')}`);
  console.log(`easy_neg ${nullRows.filter((r) => r.kind === 'easy_neg').map((r) => f(r.judge, 4)).join(', ')}`);

  console.log('\n### 6.2 生产先验敏感性：审计样本是 1:1:1，生产候选中可答块是少数');
  console.log('保留率(k) 与「留下的块里真能答的比例」(precision) 随候选池可答先验 p 变化（p 为候选里真可答块占比）：');
  console.log('\n| 阈值 | 审计样本 TPR | 审计样本 FPR | p=5% 保留率 | p=5% precision | p=10% 保留率 | p=20% 保留率 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const t of [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3]) {
    const row = absolutePolicy(primary, t);
    const fpr = 1 - row.allNegReject;
    const keepAt = (p: number): number => row.tpr * p + fpr * (1 - p);
    const precAt = (p: number): number => {
      const k = keepAt(p);
      return k > 0 ? (row.tpr * p) / k : NaN;
    };
    console.log(
      `| ${t} | ${pct(row.tpr)} | ${pct(fpr)} | ${pct(keepAt(0.05))} | ${pct(precAt(0.05))} | ${pct(keepAt(0.1))} | ${pct(keepAt(0.2))} |`
    );
  }

  // ── 7. JSON 原始数字 ──
  const payload = {
    generatedAt: new Date().toISOString(),
    source: reportPath,
    sourceGeneratedAt: raw.generatedAt,
    sourceJudge: raw.judge,
    counts: {
      pairs: rows.length,
      queries: byQ.length,
      byKindLabel,
      nullLabels: nullRows.length,
    },
    quantiles: {
      judge: Object.fromEntries(
        (['pos', 'hard_neg', 'easy_neg'] as const).map((k) => {
          const xs = rows.filter((r) => r.kind === k).map((r) => r.judge);
          return [k, { n: xs.length, min: quantile(xs, 0), p25: quantile(xs, 0.25), p50: quantile(xs, 0.5), p75: quantile(xs, 0.75), max: quantile(xs, 1), mean: mean(xs) }];
        })
      ),
      cosine: {
        pos: { min: quantile(cosPos, 0), p25: quantile(cosPos, 0.25), p50: quantile(cosPos, 0.5), p75: quantile(cosPos, 0.75), max: quantile(cosPos, 1) },
        neg: { min: quantile(cosNeg, 0), p25: quantile(cosNeg, 0.25), p50: quantile(cosNeg, 0.5), p75: quantile(cosNeg, 0.75), max: quantile(cosNeg, 1) },
      },
    },
    perQuerySumOfScores: { min: Math.min(...sums), median: quantile(sums, 0.5), max: Math.max(...sums) },
    auc: Object.fromEntries(
      Object.entries(sets).map(([key, set]) => {
        const p = set.pos.map((r) => r.judge);
        const n = set.neg.map((r) => r.judge);
        const h = set.hardNeg.map((r) => r.judge);
        return [
          key,
          {
            nPos: p.length,
            nNeg: n.length,
            nHardNeg: h.length,
            aucAllNeg: auc(p, n),
            aucHardNeg: auc(p, h),
            ciAll: aucCi(p, n),
            ciHard: aucCi(p, h),
          },
        ];
      })
    ),
    cosineAuc: { allNeg: cosAucAll, hardNeg: cosAucHard },
    scopeDecomposition: {
      matrix: Object.fromEntries(
        Object.entries(scopePos).flatMap(([pl, ps]) =>
          Object.entries(scopeNeg).map(([nl, ns]) => [
            `${pl}__${nl}`,
            { nPos: ps.length, nNeg: ns.length, auc: auc(ps.map((r) => r.judge), ns.map((r) => r.judge)) },
          ])
        )
      ),
      addedPositives: addedPos.map((r) => ({ kind: r.kind, judge: r.judge, question: r.question })),
      addedNegatives: addedNeg.map((r) => ({ kind: r.kind, judge: r.judge, question: r.question })),
    },
    perQuery: { rank1, rankDist, matchedPosWinHard, matchedPairs, zeroAnswerableQueries: zeroAnswerable, zeroAnswerableMax, cleanTop1Hit, answerableQueries: answerableMax.length },
    queryLevel: {
      nQueryPos: qPos.length,
      nQueryNeg: qNeg.length,
      aucTop1:
        auc(
          qPos.map((x) => x.top1),
          qNeg.map((x) => x.top1)
        ) || null,
      curve: queryLevel,
    },
    policies: { absolute: absRows, zScore: zRows, topK: kRows, hybrid: hybridRows },
    bestBalancedThreshold: bestBal,
    nullSensitivity: nullSens,
  };
  if (!process.argv.includes('--no-write')) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
    console.log(`\n[written] ${OUT_JSON}`);
  }
}

main();
