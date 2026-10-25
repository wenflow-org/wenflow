#!/usr/bin/env node
/**
 * 离线 LLM 评审入口（课堂质量 / 路径生成质量）
 *
 * 用法（仓库根执行）：
 *   node backend/scripts/offline-eval/run.mjs --selftest
 *   node backend/scripts/offline-eval/run.mjs --target=classroom --limit=20 --days=30 --k=3
 *   node backend/scripts/offline-eval/run.mjs --target=path --limit=20 --days=30 --k=3
 *   node backend/scripts/offline-eval/run.mjs --target=all --limit=10 --dry-run
 *
 * 速率：默认 10 RPM（--rpm=10 / OFFLINE_EVAL_RPM=10），每次请求开始（含重试）占一个名额。
 * 并发：--conc=4，同案例 K 次判读串行，实际在途 ≤ conc。
 *
 * 环境变量（只从环境读取，禁止写进源码）：
 *   OFFLINE_EVAL_API_URL  默认 https://newapi.wenflow.org/v1/chat/completions
 *   OFFLINE_EVAL_API_KEY  必填
 *   OFFLINE_EVAL_MODEL    默认 deepseek-v4.1-flash（决策模型）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  argNum, chat, ci95, clip, configureRateLimit, DEFAULT_DB, ensureDir, extractJson, getChatStats,
  hasVerbatimQuote, loadEnvFile, makeJudgeVersion as buildJudgeVersion, mapPool, mean, openDb, pct,
  printCaseProgress, REPO_ROOT, resetChatStats, round3, scoreBand, weightedScore,
} from './lib.mjs';
import {
  aggregateClassroomJudgments, buildClassroomPrompt, CLASSROOM_JUDGE_NAME, DIMENSIONS as CLASSROOM_DIMS,
  DIMENSION_LABELS as CLASSROOM_LABELS, FLAG_KEYS as CLASSROOM_FLAGS, FLAG_LABELS as CLASSROOM_FLAG_LABELS,
  selectClassroomCases, validateClassroomVerdict, WEIGHTS as CLASSROOM_WEIGHTS,
} from './classroom.mjs';
import {
  aggregatePathJudgments, buildPathPrompt, DIMENSIONS as PATH_DIMS, DIMENSION_LABELS as PATH_LABELS,
  FLAG_KEYS as PATH_FLAGS, FLAG_LABELS as PATH_FLAG_LABELS, PATH_JUDGE_NAME,
  selectPathCases, validatePathVerdict, WEIGHTS as PATH_WEIGHTS,
} from './path.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((raw) => {
  if (!raw.startsWith('--')) return [raw, true];
  const body = raw.slice(2);
  const eq = body.indexOf('=');
  return eq < 0 ? [body, true] : [body.slice(0, eq), body.slice(eq + 1)];
}));

loadEnvFile(); // 密钥只从环境/本地 .env 读取；不覆盖已有环境变量

const TARGET = String(args.target || 'all');
const LIMIT = argNum(args, 'limit', 20);
const DAYS = argNum(args, 'days', 30);
const K = Math.max(1, argNum(args, 'k', 3));
const CONC = Math.max(1, argNum(args, 'conc', 4));
const RPM = Math.max(1, argNum(args, 'rpm', Number(process.env.OFFLINE_EVAL_RPM) || 10));
const TEMPERATURE = Number(args.temp ?? 0.2);
const MODEL = String(args.model || process.env.OFFLINE_EVAL_MODEL || 'deepseek-v4.1-flash');
const DB = resolve(String(args.db || DEFAULT_DB));
const MIN_MSGS = argNum(args, 'min-msgs', 6);
const MIN_TASKS = argNum(args, 'min-tasks', 3);
const SCOPE = String(args.scope || 'all');
const EMAIL_LIKE = args['email-like'] ? String(args['email-like']) : null;
const DRY = Boolean(args['dry-run']);
const SELFTEST = Boolean(args.selftest);
const IDS_FILE = args.ids ? resolve(String(args.ids)) : null;
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const OUT = resolve(String(args.out || join(REPO_ROOT, 'doc', 'local', 'runs', 'offline-eval', STAMP)));

function readIds() {
  if (!IDS_FILE) return null;
  if (!existsSync(IDS_FILE)) throw new Error(`--ids 文件不存在：${IDS_FILE}`);
  return readFileSync(IDS_FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function judgeMessages(prompt) {
  return [
    { role: 'system', content: '你是严格的独立评审员。只输出一个 JSON 对象，不输出解释文字或 markdown 代码块。' },
    { role: 'user', content: prompt },
  ];
}

async function judgeOnce(prompt, validator, block) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await chat(judgeMessages(prompt), {
        model: MODEL, temperature: TEMPERATURE, maxTokens: 32000, timeoutMs: 300000,
      });
      const text = String(resp?.choices?.[0]?.message?.content || '');
      if (!text.trim()) throw new Error('empty response');
      const parsed = extractJson(text);
      return validator(parsed, block);
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, errors: [`judge_failed: ${String(lastError?.message || lastError)}`], dimensions: {}, flags: {}, issues: [], invalidQuotes: [] };
}

async function runTarget(target, cases, buildPrompt, validate, aggregate) {
  resetChatStats();
  const results = [];
  let done = 0;
  await mapPool(cases, CONC, async (c) => {
    const resolved = [];
    // K 次判读逐次串行：把并发上限收敛到 CONC，配合全局 RPM 闸门避免同案例突发。
    for (let k = 0; k < K; k++) {
      resolved.push(await judgeOnce(buildPrompt(c.block), validate, c.block));
    }
    const aggregateResult = aggregate(resolved);
    const row = {
      kind: target,
      id: c.id,
      uid: c.uid,
      email: c.email,
      virtual: c.virtual,
      subject: c.subject || null,
      title: c.topic || c.title || null,
      msgCount: c.msgCount ?? null,
      taskCount: c.taskCount ?? null,
      createdAt: c.createdAt,
      judgments: resolved.map((j) => ({
        ok: j.ok,
        errors: j.errors,
        dimensions: j.dimensions,
        flags: j.flags,
        issues: j.issues,
        invalidQuotes: j.invalidQuotes,
        overall: j.overall,
        verdict: j.verdict,
        confidence: j.confidence,
      })),
      aggregate: aggregateResult,
      metrics: c.metrics || null,
    };
    results.push(row);
    done += 1;
    printCaseProgress(target, done, cases.length, row.id);
    return row;
  });
  return results;
}

function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [round3(Math.max(0, center - half)), round3(Math.min(1, center + half))];
}

function summarize(target, results, dims, labels, flags, flagLabels, weights) {
  const scored = results.filter((r) => r.aggregate);
  const n = scored.length;
  const passed = scored.filter((r) => r.aggregate.verdict === 'pass').length;
  // 硬失败 flag（未答收口/总结失真/错答放行/编造）会把 pass 率压得很低；
  // softPass 只看均分 ≥0.70，用来区分「系统性收口缺陷」与「整体质量差」。
  const softPassed = scored.filter((r) => Number.isFinite(r.aggregate.overall) && r.aggregate.overall >= 0.70).length;
  const dimensions = {};
  for (const key of dims) {
    const xs = scored.map((r) => r.aggregate.dimensions[key]).filter((v) => Number.isFinite(v));
    dimensions[key] = { mean: round3(mean(xs)), ci95: round3(ci95(xs)), n: xs.length, label: labels[key], weight: weights[key] };
  }
  const flagStats = {};
  for (const key of flags) {
    const hits = scored.filter((r) => r.aggregate.flags[key]).length;
    flagStats[key] = { count: hits, rate: pct(hits, n), label: flagLabels[key] };
  }
  const byScope = {};
  for (const scope of ['virtual', 'real']) {
    const subset = scored.filter((r) => (scope === 'virtual' ? r.virtual : !r.virtual));
    if (!subset.length) continue;
    byScope[scope] = {
      n: subset.length,
      passRate: pct(subset.filter((r) => r.aggregate.verdict === 'pass').length, subset.length),
      overall: round3(mean(subset.map((r) => r.aggregate.overall))),
    };
  }
  const issueCounts = new Map();
  for (const row of scored) {
    for (const issue of row.aggregate.issues) {
      const key = `${issue.dimension}|${issue.severity}`;
      issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
    }
  }
  const topIssues = [...issueCounts.entries()]
    .map(([key, count]) => { const [dimension, severity] = key.split('|'); return { dimension, severity, count }; })
    .sort((a, b) => b.count - a.count).slice(0, 10);
  const bands = {};
  for (const row of scored) {
    const band = scoreBand(row.aggregate.overall);
    bands[band] = (bands[band] || 0) + 1;
  }
  return {
    target,
    n,
    invalid: results.length - n,
    pass: passed,
    passRate: pct(passed, n),
    passCi: wilson(passed, n),
    softPass: softPassed,
    softPassRate: pct(softPassed, n),
    overall: round3(mean(scored.map((r) => r.aggregate.overall))),
    overallCi: round3(ci95(scored.map((r) => r.aggregate.overall))),
    dimensions,
    flags: flagStats,
    byScope,
    bands,
    topIssues,
    lowCases: scored
      .filter((r) => r.aggregate.verdict === 'fail')
      .sort((a, b) => (a.aggregate.overall ?? 1) - (b.aggregate.overall ?? 1))
      .slice(0, 10)
      .map((r) => ({ id: r.id, title: r.title, overall: round3(r.aggregate.overall), flags: Object.entries(r.aggregate.flags).filter(([, v]) => v).map(([k]) => k) })),
  };
}

function renderReport(target, summary, judgeVersion, cases) {
  const lines = [];
  lines.push(`# 离线 LLM 评审报告 · ${target}`, '');
  lines.push(`- 时间：${new Date().toISOString()}`);
  lines.push(`- 决策模型：\`${MODEL}\`（K=${K}，temperature=${TEMPERATURE}）`);
  lines.push(`- judgeVersion：\`${judgeVersion}\``);
  lines.push(`- 样本：${summary.n}（虚拟 ${summary.byScope.virtual?.n ?? 0} / 真实 ${summary.byScope.real?.n ?? 0}），无效 ${summary.invalid}`);
  lines.push(`- 结论：pass ${summary.pass}/${summary.n} = **${summary.passRate ?? 'n/a'}**（95% CI ${summary.passCi[0]}–${summary.passCi[1]}）｜均分 **${summary.overall ?? 'n/a'}**`);
  lines.push(`- 软通过（均分 ≥0.70，不看硬失败 flag）：${summary.softPass}/${summary.n} = ${summary.softPassRate ?? 'n/a'}`);
  lines.push('');
  lines.push('## 维度均分', '', '| 维度 | 均分 | 95% CI | 权重 |', '|---|---:|---|---:|');
  for (const [key, d] of Object.entries(summary.dimensions)) {
    lines.push(`| ${d.label} (${key}) | ${d.mean ?? 'n/a'} | ${d.ci95 ?? ''} | ${d.weight} |`);
  }
  lines.push('', '## 二元问题', '', '| 问题 | 命中 | 比例 |', '|---|---:|---:|');
  for (const [key, f] of Object.entries(summary.flags)) {
    lines.push(`| ${f.label} (${key}) | ${f.count} | ${f.rate ?? 'n/a'} |`);
  }
  lines.push('', '## 分数带', '', '| 档位 | 数量 |', '|---|---:|');
  for (const [band, count] of Object.entries(summary.bands)) lines.push(`| ${band} | ${count} |`);
  if (summary.topIssues.length) {
    lines.push('', '## 高频 issue（维度+严重度）', '', '| 维度 | 严重度 | 次数 |', '|---|---|---:|');
    for (const it of summary.topIssues) lines.push(`| ${it.dimension} | ${it.severity} | ${it.count} |`);
  }
  if (summary.lowCases.length) {
    lines.push('', '## 低分/失败案例（前 10）', '', '| 案例 | 标题 | 均分 | flags |', '|---|---|---:|---|');
    for (const c of summary.lowCases) lines.push(`| ${c.id} | ${clip(c.title || '', 40)} | ${c.overall} | ${c.flags.join(',') || '-'} |`);
  }
  lines.push('', '## 口径与边界', '');
  lines.push('- 评审是 LLM 判断，不是人工真值；维度分只应在同一 judgeVersion 内横向比较。');
  lines.push('- 判 true 的 flag 已做逐字引文核验；引文不在案例块中的 flag 已降级为 false。');
  lines.push('- 样本以虚拟学习者为主时，结论只代表「模拟行为质量」，不能直接外推真实学习者。');
  lines.push('- 每案例 K 次独立判读：维度取中位数、flag 取多数、verdict 由聚合值重算。');
  lines.push('');
  return lines.join('\n');
}

function judgeVersionFor(target) {
  if (target === 'classroom') {
    return buildJudgeVersion({ name: CLASSROOM_JUDGE_NAME, promptText: buildClassroomPrompt(''), model: MODEL, temperature: TEMPERATURE, k: K });
  }
  return buildJudgeVersion({ name: PATH_JUDGE_NAME, promptText: buildPathPrompt(''), model: MODEL, temperature: TEMPERATURE, k: K });
}

function selftest() {
  let passed = 0;
  const total = 14;
  const assert = (cond, label) => {
    if (!cond) throw new Error(`selftest failed: ${label}`);
    passed += 1;
  };

  const block = '学员: 我觉得力越大速度越大\n老师: 你指的是合力还是单个力？我们先看一个反例：匀速运动时合力为零。\n检查点 cp1 正确 A 作答 B';
  const good = {
    dimensions: { goalAlignment: 0.9, diagnosis: 0.8, explanation: 0.8, responsiveness: 0.9, scaffolding: 0.7, accuracy: 0.9, closure: 0.8 },
    flags: { wrongAnswerPassed: true },
    evidence: { wrongAnswerPassed: ['正确 A 作答 B'] },
    issues: [{ dimension: 'diagnosis', severity: 'high', quote: '正确 A 作答 B', suggestion: '先纠错再推进' }],
    confidence: 0.8,
  };
  const v1 = validateClassroomVerdict(good, block);
  assert(v1.ok && v1.flags.wrongAnswerPassed === true, 'classroom quote verified');
  assert(v1.verdict === 'fail', 'classroom hard fail on wrongAnswerPassed');

  const noQuote = validateClassroomVerdict({ ...good, evidence: { wrongAnswerPassed: ['不存在的引文'] } }, block);
  assert(noQuote.flags.wrongAnswerPassed === false && noQuote.invalidQuotes.includes('wrongAnswerPassed'), 'classroom quote downgrade');
  assert(noQuote.verdict === 'pass', 'classroom pass after downgrade');

  const clamped = validateClassroomVerdict({
    ...good,
    flags: {},
    dimensions: { ...good.dimensions, diagnosis: 1.7 },
    evidence: {},
  }, block);
  assert(clamped.dimensions.diagnosis === 1, 'dimension clamp');

  const hardFlag = validateClassroomVerdict({
    dimensions: good.dimensions,
    flags: { unclosedComplete: true },
    evidence: { unclosedComplete: ['检查点 cp1 正确 A 作答 B'] },
    issues: [],
  }, block);
  assert(hardFlag.flags.unclosedComplete === true && hardFlag.verdict === 'fail', 'unclosedComplete hard fail');

  const bad = validateClassroomVerdict({ dimensions: { goalAlignment: 0.5 } }, block);
  assert(!bad.ok && bad.errors.length === 6, 'missing dimensions reported');

  const pathBlock = '预算 600 分钟｜实际/预算比 2.80\n阶段 1：入门\n  1. 了解基本概念｜验收：（无）';
  const p1 = validatePathVerdict({
    dimensions: { goalAlignment: 0.3, integrity: 0.3, granularity: 0.3, specificity: 0.3, progression: 0.3, feasibility: 0.9 },
    flags: { budgetMismatch: true, placeholderTask: true },
    evidence: { budgetMismatch: ['实际/预算比 2.80'], placeholderTask: ['验收：（无）'] },
    issues: [{ dimension: 'specificity', severity: 'high', quote: '验收：（无）', suggestion: '补可验收产出' }],
  }, pathBlock);
  assert(p1.ok && p1.flags.budgetMismatch && p1.flags.placeholderTask, 'path flags verified');
  assert(p1.verdict === 'fail' && p1.overall < 0.7, 'path low score fail');

  // v2 硬门 flag：体力活陷阱/承诺违约一票否决（均分再高也 fail），对话摘录可作引文源
  const v2Block = '【对话承诺摘录（产出本路径的目标对话，末 14 条）】\n👤 我每周也就下班后半小时\n🤖 第一周半小时搭好两列表算出第一版预测\n【结构事实（代码统计，可直接引用）】\n任务 7｜总预计 335 分钟\n阶段 1 任务 1：逐行确认每条记录落在星期几和哪个小时格子里并计数';
  const v2Hard = validatePathVerdict({
    dimensions: { goalAlignment: 0.9, integrity: 0.9, granularity: 0.9, specificity: 0.9, progression: 0.9, feasibility: 0.9 },
    flags: { manualLaborTrap: true, promiseConsistency: true },
    evidence: {
      manualLaborTrap: ['逐行确认每条记录落在星期几和哪个小时格子里并计数'],
      promiseConsistency: ['我每周也就下班后半小时'],
    },
    issues: [],
  }, v2Block);
  assert(v2Hard.ok && v2Hard.flags.manualLaborTrap && v2Hard.flags.promiseConsistency, 'v2 flags verified');
  assert(v2Hard.verdict === 'fail' && v2Hard.softVerdict === 'pass', 'v2 hard gate vetoes despite high average');

  const v2NoQuote = validatePathVerdict({
    dimensions: { goalAlignment: 0.9, integrity: 0.9, granularity: 0.9, specificity: 0.9, progression: 0.9, feasibility: 0.9 },
    flags: { asyncTimeLock: true },
    evidence: { asyncTimeLock: ['记录里不存在的引文'] },
    issues: [],
  }, v2Block);
  assert(v2NoQuote.flags.asyncTimeLock === false && v2NoQuote.verdict === 'pass', 'v2 flag without quote downgraded');

  const agg = aggregatePathJudgments([
    p1,
    validatePathVerdict({
      dimensions: { goalAlignment: 0.9, integrity: 0.9, granularity: 0.9, specificity: 0.9, progression: 0.9, feasibility: 0.9 },
      flags: {}, evidence: {}, issues: [],
    }, pathBlock),
  ]);
  assert(agg.samples === 2 && agg.dimensions.goalAlignment === 0.6 && agg.verdict === 'fail', 'median aggregation + majority flag');

  assert(hasVerbatimQuote(block, ['正确 A 作答 B']) && weightedScore({ a: 1, b: 0.5 }, { a: 0.5, b: 0.5 }) === 0.75, 'quote + weighted score');

  console.log(`[selftest] ${passed}/${total} 通过｜不调模型、不写盘`);
}

async function main() {
  if (SELFTEST) { selftest(); return; }
  if (!['classroom', 'path', 'all'].includes(TARGET)) throw new Error(`--target 只能是 classroom/path/all（收到 ${TARGET}）`);
  configureRateLimit(RPM);
  const db = openDb(DB);
  const ids = readIds();
  const targets = TARGET === 'all' ? ['classroom', 'path'] : [TARGET];
  console.log(`[offline-eval] target=${TARGET} limit=${LIMIT} days=${DAYS} k=${K} conc=${CONC} rpm=${RPM} model=${MODEL}`);
  console.log(`[db] ${DB}`);

  const payloads = {};
  for (const target of targets) {
    const cases = target === 'classroom'
      ? selectClassroomCases(db, { limit: LIMIT, days: DAYS, scope: SCOPE, emailLike: EMAIL_LIKE, minMsgs: MIN_MSGS, ids })
      : selectPathCases(db, { limit: LIMIT, days: DAYS, scope: SCOPE, emailLike: EMAIL_LIKE, minTasks: MIN_TASKS, ids });
    payloads[target] = cases;
    console.log(`[sample] ${target}: ${cases.length} 例｜计划调用 ≈ ${cases.length * K}`);
    if (DRY) {
      for (const c of cases.slice(0, 5)) console.log(`  - ${c.id}｜${clip(c.topic || c.title || '', 50)}｜${c.msgCount ? `${c.msgCount} msgs` : `${c.taskCount} tasks`}`);
      continue;
    }
    if (!cases.length) continue;
    ensureDir(OUT);
    const buildPrompt = target === 'classroom' ? buildClassroomPrompt : buildPathPrompt;
    const validate = target === 'classroom' ? validateClassroomVerdict : validatePathVerdict;
    const aggregate = target === 'classroom' ? aggregateClassroomJudgments : aggregatePathJudgments;
    const judgeVersion = judgeVersionFor(target);
    console.log(`[judge] ${judgeVersion}`);
    const results = await runTarget(target, cases, buildPrompt, validate, aggregate);
    const dims = target === 'classroom' ? CLASSROOM_DIMS : PATH_DIMS;
    const labels = target === 'classroom' ? CLASSROOM_LABELS : PATH_LABELS;
    const flags = target === 'classroom' ? CLASSROOM_FLAGS : PATH_FLAGS;
    const flagLabels = target === 'classroom' ? CLASSROOM_FLAG_LABELS : PATH_FLAG_LABELS;
    const weights = target === 'classroom' ? CLASSROOM_WEIGHTS : PATH_WEIGHTS;
    const summary = summarize(target, results, dims, labels, flags, flagLabels, weights);
    summary.judgeVersion = judgeVersion;
    summary.model = MODEL;
    summary.k = K;
    summary.calls = getChatStats();
    summary.generatedAt = new Date().toISOString();

    writeFileSync(join(OUT, `${target}-verdicts.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    writeFileSync(join(OUT, `${target}-summary.json`), JSON.stringify(summary, null, 2), 'utf8');
    writeFileSync(join(OUT, `report-${target}.md`), renderReport(target, summary, judgeVersion, cases), 'utf8');
    console.log(`[done] ${target}｜n=${summary.n}｜pass=${summary.passRate}｜soft=${summary.softPassRate}｜overall=${summary.overall}｜calls=${summary.calls.calls} fail=${summary.calls.failures}`);
    console.log(`[out] ${OUT}`);
  }
  if (DRY) console.log('[dry-run] 未调用模型、未写盘');
}

main().catch((error) => {
  console.error('[offline-eval] 失败:', error?.message || error);
  process.exit(1);
});
