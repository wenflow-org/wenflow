/**
 * 源头问题类型标注报告（**只读**，node:sqlite 直查，不依赖 Prisma 生成客户端）
 *
 * 用途：量化 `virtual_learner_profiles.profile.storyPool[].goalSeed.primaryBlockType`
 * 的**覆盖率**与**分布**，并与已有的 AI 盲评产物做**一致性交叉核对**：
 *
 *   1. 覆盖率   —— 样本数 / storyPool 非空数 / primaryBlockType 有值数 / recurrence /
 *                  blockTypeEvidence。**这是 L1 提示词改动是否生效的主指标**（改动前必然 0%）。
 *   2. 分布     —— primaryBlockType 各取值计数 & 百分比；recurrence 分布。
 *   3. 交叉核对 —— 与 AI 盲评（results[].primary / needsLearningPath）逐例对比：
 *                  一致率、交叉表、不一致明细；
 *                  以及"源头误判率" = AI 判 needsLearningPath=false 的样本里源头标成
 *                  capability 的比例（后续接负向出口的关键指标）。
 *   4. 句式体检 —— realProblem 命中「缺乏|缺少|不足|无法」等能力缺口措辞的比例（辅助，
 *                  加新提示词后应下降；脚本只统计不判断）。
 *
 * 只读：不写库、不改仓库其它文件（`--out` 只写 backend/vlab-runs/，该目录已 gitignore）。
 *
 * 用法：
 *   node scripts/vl-blocktype-report.mjs --tag=vl50
 *   node scripts/vl-blocktype-report.mjs --tag=vl50 --audit=backend/vlab-runs/xxx.json
 *   node scripts/vl-blocktype-report.mjs --tag=vl50 --out=backend/vlab-runs/vl50-blocktype-report.json
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const TAG = String(arg('tag') || 'vl50');
const AUDIT_DEFAULT = path.join(ROOT, 'backend', 'vlab-runs', `${TAG}-ai-audit-deepseek-v4-flash-x3.json`);
const AUDIT = String(arg('audit') || AUDIT_DEFAULT);
const OUT_RAW = arg('out');
const OUT_FILE = OUT_RAW ? (OUT_RAW === true ? path.join(ROOT, 'backend', 'vlab-runs', `${TAG}-blocktype-report.json`) : String(OUT_RAW)) : null;

/** 五分类（源头标注 & AI 盲评共用同一套） */
const BLOCK_TYPES = ['capability', 'oneoff_operation', 'environment_tooling', 'permission_process', 'emotion_relationship'];
/** 能力缺口措辞（realProblem 句式体检，命中即视为"仍像能力不足"） */
const GAP_TERMS = ['缺乏', '缺少', '不足', '无法'];
const GAP_RE = new RegExp(GAP_TERMS.join('|'));

const jparse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const norm = (v) => { if (v === null || v === undefined) return null; const s = String(v).trim(); return s ? s.toLowerCase() : null; };
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
const dist = (m) => [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => `${k}:${v}`).join('  ');
const bucket = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const pad = (s, n) => String(s ?? '').padEnd(n);
const padL = (s, n) => String(s ?? '').padStart(n);

/** primaryBlockType 优先取 goalSeed 内，其次兼容故事顶层；recurrence / blockTypeEvidence 同理。 */
function pickField(story, key) {
  const gs = story && story.goalSeed && typeof story.goalSeed === 'object' ? story.goalSeed : null;
  if (gs && gs[key] !== null && gs[key] !== undefined && String(gs[key]).trim()) return gs[key];
  if (story && story[key] !== null && story[key] !== undefined && String(story[key]).trim()) return story[key];
  return null;
}

/** 学习者级聚合：多故事时取众数（同票取故事顺序最先者） */
function majority(values) {
  const counts = new Map();
  for (const v of values) if (v) bucket(counts, v);
  let best = null, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

// ── 只读打开数据库 ────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, p = []) => db.prepare(sql).all(...p);

const learners = all(
  `SELECT p.id AS profileId, p.userId, u.name, p.profile
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.notes LIKE ? OR p.tags LIKE ?
    ORDER BY u.name`,
  [`%${TAG}%`, `%${TAG}%`],
);

// ── 逐学习者读取 storyPool 标注 + realProblem 句式 ────────────────────────────
const rows = [];
let storyTotal = 0;
let storiesWithPrimary = 0, storiesWithRecurrence = 0, storiesWithEvidence = 0;
let storiesWithRealProblem = 0, realProblemGapHit = 0;
const gapTermCounts = new Map(GAP_TERMS.map((t) => [t, 0]));
const primaryStoryDist = new Map();   // 故事级 primaryBlockType 分布
const recurrenceStoryDist = new Map();

for (const l of learners) {
  const prof = jparse(l.profile);
  const stories = Array.isArray(prof.storyPool) ? prof.storyPool : [];
  const primaries = [], recurrences = [], evidences = [];

  for (const s of stories) {
    storyTotal += 1;
    const p = pickField(s, 'primaryBlockType');
    const r = pickField(s, 'recurrence');
    const e = pickField(s, 'blockTypeEvidence');
    if (p) { primaries.push(p); storiesWithPrimary += 1; bucket(primaryStoryDist, norm(p)); }
    if (r) { recurrences.push(r); storiesWithRecurrence += 1; bucket(recurrenceStoryDist, norm(r)); }
    if (e) { evidences.push(e); storiesWithEvidence += 1; }

    const gs = s && s.goalSeed && typeof s.goalSeed === 'object' ? s.goalSeed : {};
    const rp = gs.realProblem ?? s?.realProblem ?? null;
    if (rp && String(rp).trim()) {
      storiesWithRealProblem += 1;
      const text = String(rp);
      if (GAP_RE.test(text)) realProblemGapHit += 1;
      for (const t of GAP_TERMS) if (text.includes(t)) gapTermCounts.set(t, gapTermCounts.get(t) + 1);
    }
  }

  // 学习者级聚合（多故事取众数）
  const primary = majority(primaries.map(norm));
  const recurrence = majority(recurrences.map(norm));

  // 最近一条学习路径的 任务数（用于 audit 同名兜底消歧）
  const lp = all('SELECT id FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [l.userId])[0];
  const taskCount = lp ? all('SELECT COUNT(*) c FROM subtasks s JOIN milestones m ON m.id = s.milestoneId WHERE m.learningPathId=?', [lp.id])[0].c : 0;

  rows.push({
    userId: l.userId, name: l.name, storyCount: stories.length,
    primary, recurrence,
    primaryAll: primaries.map(norm), recurrenceAll: recurrences.map(norm),
    hasEvidence: evidences.length > 0, taskCount,
  });
}

// ── 覆盖率（主指标）────────────────────────────────────────────────────────────
const sampleN = rows.length;
const withStoryPool = rows.filter((r) => r.storyCount > 0).length;
const learnersWithPrimary = rows.filter((r) => r.primary).length;
const learnersWithRecurrence = rows.filter((r) => r.recurrence).length;
const learnersWithEvidence = rows.filter((r) => r.hasEvidence).length;

// ── 学习者级分布（多故事取众数后）─────────────────────────────────────────────
const primaryDist = new Map();
const recurrenceDist = new Map();
for (const r of rows) {
  bucket(primaryDist, r.primary || '(缺失)');
  bucket(recurrenceDist, r.recurrence || '(缺失)');
}

const snapshot = {
  tag: TAG, generatedAt: new Date().toISOString(),
  database: DB, audit: AUDIT,
  coverage: {
    learners: sampleN, withStoryPool, storiesTotal: storyTotal,
    storiesWithPrimary, learnersWithPrimary,
    storiesWithRecurrence, learnersWithRecurrence,
    storiesWithEvidence, learnersWithEvidence,
  },
  distribution: {
    primaryLearner: Object.fromEntries(primaryDist),
    primaryStory: Object.fromEntries(primaryStoryDist),
    recurrenceLearner: Object.fromEntries(recurrenceDist),
    recurrenceStory: Object.fromEntries(recurrenceStoryDist),
  },
  realProblem: {
    storiesWithRealProblem, gapHit: realProblemGapHit,
    gapRate: storiesWithRealProblem ? realProblemGapHit / storiesWithRealProblem : null,
    termCounts: Object.fromEntries(gapTermCounts),
  },
};

// ── 输出：覆盖率 ───────────────────────────────────────────────────────────────
console.log(`== 源头问题类型标注报告（tag=${TAG}）==`);
console.log(`数据库：${path.relative(ROOT, DB)}（只读）`);

console.log('\n【1. 覆盖率】—— L1 提示词是否生效的主指标');
console.log(`样本学习者：${sampleN}`);
console.log(`storyPool 非空：${withStoryPool}（${pct(withStoryPool, sampleN)}）｜故事总数：${storyTotal}`);
console.log(`primaryBlockType 有值：故事 ${storiesWithPrimary}/${storyTotal}（${pct(storiesWithPrimary, storyTotal)}）｜学习者 ${learnersWithPrimary}/${sampleN}（${pct(learnersWithPrimary, sampleN)}）`);
console.log(`recurrence 有值：      故事 ${storiesWithRecurrence}/${storyTotal}（${pct(storiesWithRecurrence, storyTotal)}）｜学习者 ${learnersWithRecurrence}/${sampleN}（${pct(learnersWithRecurrence, sampleN)}）`);
console.log(`blockTypeEvidence 有值：故事 ${storiesWithEvidence}/${storyTotal}（${pct(storiesWithEvidence, storyTotal)}）｜学习者 ${learnersWithEvidence}/${sampleN}（${pct(learnersWithEvidence, sampleN)}）`);

// ── 输出：分布 ─────────────────────────────────────────────────────────────────
console.log('\n【2. 分布】');
console.log(`primaryBlockType（学习者级，多故事取众数）：${dist(primaryDist)}`);
console.log(`primaryBlockType（故事级）：${dist(primaryStoryDist) || '(无)'}`);
console.log(`recurrence（学习者级）：${dist(recurrenceDist)}`);
console.log(`recurrence（故事级）：${dist(recurrenceStoryDist) || '(无)'}`);

// ── 交叉核对：匹配 AI 盲评 ─────────────────────────────────────────────────────
console.log('\n【3. 与 AI 盲评交叉核对】');
console.log(`audit 文件：${path.relative(ROOT, AUDIT)}`);

let audit = null, auditErr = null;
try {
  if (fs.existsSync(AUDIT)) audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
  else auditErr = '文件不存在';
} catch (e) { auditErr = `解析失败：${e.message}`; }

if (!audit || !Array.isArray(audit.results)) {
  console.log(`  ⚠ 跳过交叉核对（${auditErr || 'results 结构不符'}）。覆盖率/分布/句式体检不受影响。`);
  snapshot.crossCheck = { skipped: true, reason: auditErr || 'results 结构不符' };
} else {
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const byName = new Map();
  for (const r of rows) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }

  const used = new Set();
  const howCounts = new Map();
  const matchedPairs = [];     // {audit, db, how}
  const unmatched = [];
  const pending = [];          // 未能按 id/name 命中的 audit（顺序兜底用）

  for (const a of audit.results) {
    let hit = null, how = null;
    if (a.id && byId.has(a.id) && !used.has(a.id)) { hit = byId.get(a.id); how = 'id'; }
    if (!hit && a.name && byName.has(a.name)) {
      const cands = byName.get(a.name).filter((x) => !used.has(x.userId));
      if (cands.length === 1) { hit = cands[0]; how = 'name'; }
      else if (cands.length > 1) {
        const tc = cands.filter((x) => x.taskCount === a.taskCount);
        if (tc.length === 1) { hit = tc[0]; how = 'name+taskCount'; }
        else { hit = cands[0]; how = 'name(歧义取首个)'; }
      }
    }
    if (hit) {
      used.add(hit.userId); matchedPairs.push({ audit: a, db: hit, how }); bucket(howCounts, how);
    } else pending.push(a);
  }
  // 顺序兜底：剩余 audit 依次配尚未使用的学习者
  const remaining = rows.filter((r) => !used.has(r.userId));
  for (const a of pending) {
    const hit = remaining.shift();
    if (hit) { used.add(hit.userId); matchedPairs.push({ audit: a, db: hit, how: 'order' }); bucket(howCounts, 'order'); }
    else unmatched.push(a.name || a.id || '(无名)');
  }

  const matchedN = matchedPairs.length;
  const howStr = [...howCounts.entries()].map(([k, v]) => `${k}:${v}`).join('  ') || '(无)';
  console.log(`匹配方式：${howStr}｜已匹配 ${matchedN}/${audit.results.length}｜未匹配 ${unmatched.length}`);
  if (unmatched.length) console.log(`  未匹配：${unmatched.slice(0, 10).join('、')}${unmatched.length > 10 ? ` …等 ${unmatched.length} 人` : ''}`);

  // AI 侧分布（即便源头全缺失，也给出真实数字）
  const aiPrimaryDist = new Map(), aiNlpDist = new Map();
  for (const { audit: a } of matchedPairs) {
    bucket(aiPrimaryDist, norm(a.primary) || '(未判定)');
    bucket(aiNlpDist, a.needsLearningPath === true ? 'true' : a.needsLearningPath === false ? 'false' : '(缺失)');
  }
  console.log(`AI 盲评 primary 分布（已匹配）：${dist(aiPrimaryDist)}`);
  console.log(`AI 盲评 needsLearningPath 分布（已匹配）：${dist(aiNlpDist)}`);

  // 一致率（仅双方都有值才计入分母）
  const comparable = matchedPairs.filter(({ audit: a, db: d }) => norm(a.primary) && d.primary);
  const agree = comparable.filter(({ audit: a, db: d }) => norm(a.primary) === d.primary).length;

  // 交叉表：行=源头标注，列=AI 盲评
  const srcRows = [...new Set([...BLOCK_TYPES, ...comparable.map(({ db: d }) => d.primary), '(缺失)'])];
  const colKeys = [...BLOCK_TYPES, '(未判定)'];
  const tab = new Map(); // `${src}\t${col}` -> n
  for (const { audit: a, db: d } of matchedPairs) {
    const src = d.primary || '(缺失)';
    const col = norm(a.primary) || '(未判定)';
    const k = `${src}\t${col}`;
    tab.set(k, (tab.get(k) || 0) + 1);
  }
  const rowTotals = new Map();
  for (const { db: d } of matchedPairs) bucket(rowTotals, d.primary || '(缺失)');

  console.log(`\n一致率（源头标注 vs AI 盲评，双方有值）：${agree}/${comparable.length}（${pct(agree, comparable.length)}）`);
  console.log('交叉表（行=源头标注，列=AI 盲评）：');
  const COLW = 21;
  const head = `${pad('源头\\AI', 22)}${colKeys.map((c) => padL(c, COLW)).join('')}${padL('合计', 7)}`;
  console.log(`  ${head}`);
  for (const src of srcRows) {
    if ((rowTotals.get(src) || 0) === 0 && src !== '(缺失)' && !BLOCK_TYPES.includes(src)) continue;
    const cells = colKeys.map((c) => padL(tab.get(`${src}\t${c}`) || 0, COLW)).join('');
    console.log(`  ${pad(src, 20)}${cells}${padL(rowTotals.get(src) || 0, 7)}`);
  }

  // 不一致明细
  const mismatches = comparable.filter(({ audit: a, db: d }) => norm(a.primary) !== d.primary);
  console.log(`\n不一致明细（源头标注 ≠ AI 盲评）：${mismatches.length} 例`);
  for (const { audit: a, db: d } of mismatches.slice(0, 30)) {
    console.log(`  ${pad(d.name, 14)} 源头=${pad(d.primary, 20)} AI=${norm(a.primary)}`);
  }
  if (mismatches.length > 30) console.log(`  …等 ${mismatches.length} 例`);

  // 源头误判率：AI 判"不该做路径"的样本里，源头仍标成 capability 的比例
  const nlpFalse = matchedPairs.filter(({ audit: a }) => a.needsLearningPath === false);
  const nlpFalseWithSrc = nlpFalse.filter(({ db: d }) => d.primary);
  const nlpFalseCapability = nlpFalseWithSrc.filter(({ db: d }) => d.primary === 'capability').length;
  console.log(`\n源头误判率（AI needsLearningPath=false 中源头标成 capability 的比例）：${nlpFalseCapability}/${nlpFalseWithSrc.length}（${pct(nlpFalseCapability, nlpFalseWithSrc.length)}）`);
  console.log(`  分母：已匹配且源头有标注的 needsLP=false 样本 ${nlpFalseWithSrc.length} 个（needsLP=false 总数 ${nlpFalse.length}）`);
  // 辅助：AI 判 needsLP=false 的 AI primary 分布（真实数字，便于人工观察）
  const nlpFalseAi = new Map();
  for (const { audit: a } of nlpFalse) bucket(nlpFalseAi, norm(a.primary) || '(未判定)');
  console.log(`  其中 AI primary 分布：${dist(nlpFalseAi)}`);

  snapshot.crossCheck = {
    skipped: false, auditFile: AUDIT,
    auditTotal: audit.results.length, matched: matchedN, unmatched: unmatched.length,
    matchMethods: Object.fromEntries(howCounts),
    unmatchedNames: unmatched,
    aiPrimaryDist: Object.fromEntries(aiPrimaryDist),
    aiNeedsLearningPathDist: Object.fromEntries(aiNlpDist),
    comparable: comparable.length, agreement: agree,
    agreementRate: comparable.length ? agree / comparable.length : null,
    crossTab: Object.fromEntries(tab),
    mismatches: mismatches.map(({ audit: a, db: d }) => ({ name: d.name, source: d.primary, ai: norm(a.primary) })),
    misjudge: {
      needsLPFalseTotal: nlpFalse.length, denominator: nlpFalseWithSrc.length,
      capabilityCount: nlpFalseCapability,
      rate: nlpFalseWithSrc.length ? nlpFalseCapability / nlpFalseWithSrc.length : null,
      aiPrimaryDist: Object.fromEntries(nlpFalseAi),
    },
  };
}

// ── 输出：realProblem 句式体检 ────────────────────────────────────────────────
console.log('\n【4. realProblem 句式体检】');
console.log(`storyPool 中 realProblem 非空：${storiesWithRealProblem}/${storyTotal}（${pct(storiesWithRealProblem, storyTotal)}）`);
console.log(`命中能力缺口措辞（${GAP_TERMS.join('|')}）：${realProblemGapHit}/${storiesWithRealProblem}（${pct(realProblemGapHit, storiesWithRealProblem)}）`);
console.log(`各措辞命中次数：${dist(gapTermCounts)}`);
console.log('（辅助指标：加新提示词后该比例应下降；本脚本只统计不判断）');

// ── 可选：写 JSON 快照 ─────────────────────────────────────────────────────────
if (OUT_FILE) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\nJSON 快照已写入：${OUT_FILE}`);
}

db.close();
