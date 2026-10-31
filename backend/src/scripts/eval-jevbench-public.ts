/* eslint-disable no-console -- 一次性评测 CLI：面向人读的输出，不需要 logger */
/**
 * 跑 **JevBench 公开半集**（MIT，来自 github.com/fstandhartinger/jevbench 的 datasets/public/*.jsonl），
 * 用我们的 SystemOne 调用约定打到任意兼容通道，逐题判分并落盘。
 *
 * 为什么用它：这是目前唯一能做的「第三方同题对照」——官方还发布了逐题成绩
 * （results/v1.2/additions/*-per-task.json 里的 public_tasks，形如 `{"easy-intent-00": ["c", 0.508]}`），
 * 题号与公开集一致，所以别人跑过的模型（如 laya）和我们跑的通道可以在**同一批题**上比。
 *
 * 判分口径（照 jevbench/tasks.py 的字段定义）：
 *   - 一题一个问题，`question.type ∈ {noul, choice, score}`，`expected` 是唯一真值：
 *       noul  → expected 为 "yes"/"no"，模型给 noul 概率，≥0.5 判 yes；
 *       choice→ expected 为标签字符串，模型给 choice + probabilities；
 *       score → expected 为档位下标（int），模型给各档概率，取 argmax 的档位字符串。
 *   - 置信度取该题最大概率（calibration 用）：Brier = mean((conf - correct)^2)、AUC(conf→correct)。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-jevbench-public.ts --split=easy
 *   npx ts-node --transpile-only src/scripts/eval-jevbench-public.ts --split=original --limit=20
 *
 * 环境变量（同 eval-systemone-triage-v2）：
 *   JEVBENCH_DIR       公开集所在目录（默认 <repo>/doc/local/JEVBENCH-PUBLIC）
 *   SYSTEMONE_BASE_URL / SYSTEMONE_MODEL / SYSTEMONE_API_KEY / SYSTEMONE_AUTH_STYLE
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.SYSTEMONE_BASE_URL || 'http://101.43.146.102:30001/v1/systemone';
const API_KEY = process.env.SYSTEMONE_API_KEY || 'public';
const MODEL = process.env.SYSTEMONE_MODEL || 'jev-latest';
const AUTH_HEADER = process.env.SYSTEMONE_AUTH_STYLE === 'raw' ? API_KEY : `Bearer ${API_KEY}`;
const DIR = process.env.JEVBENCH_DIR || path.resolve(__dirname, '..', '..', '..', 'doc', 'local', 'JEVBENCH-PUBLIC');

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface BenchItem {
  id: string;
  family: string;
  state: unknown;
  question: { type: string; instructions?: string; criteria?: unknown };
  labels: string[];
  expected: string | number | null;
}

interface Outcome {
  id: string;
  family: string;
  type: string;
  expected: string | number | null;
  pred: string | null;
  conf: number | null;
  ok: boolean;
  ms: number;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function askOne(item: BenchItem): Promise<{ answers: Record<string, unknown> | null; ms: number; error: string | null }> {
  const started = Date.now();
  // score 题在官方数据里把 criteria 写成数组（第 i 项就是档位 i 的描述），
  // 而 SystemOne 上游要求 criteria 是「标签 → 描述」的映射；直接透传数组会被判 invalid_request，
  // 而这条通道上一个 400 就可能把渠道打成禁用，所以这里先归一。
  let question: Record<string, unknown> = item.question as unknown as Record<string, unknown>;
  if (Array.isArray((item.question as { criteria?: unknown }).criteria)) {
    const criteria: Record<string, string> = {};
    ((item.question as { criteria: unknown[] }).criteria).forEach((desc, index) => {
      criteria[String(item.labels[index] ?? index)] = String(desc);
    });
    question = { ...question, criteria };
  }
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: item.state, questions: { q: question } }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    if (!res.ok) return { answers: null, ms: Date.now() - started, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    const parsed = JSON.parse(text) as { answers?: Record<string, unknown> };
    return { answers: parsed.answers ?? null, ms: Date.now() - started, error: null };
  } catch (error) {
    return { answers: null, ms: Date.now() - started, error: String((error as Error)?.message || error).slice(0, 120) };
  }
}

/** 把一题的回答转成 (预测标签, 置信度)。 */
function decide(item: BenchItem, answers: Record<string, unknown> | null): { pred: string | null; conf: number | null } {
  const a = answers?.q as { probabilities?: unknown; noul?: unknown; choice?: unknown } | undefined;
  if (!a) return { pred: null, conf: null };
  const probs = (a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : {}) as Record<string, number>;
  const values = Object.values(probs).map(Number).filter((v) => Number.isFinite(v));
  const maxP = values.length ? Math.max(...values) : null;
  if (item.question.type === 'noul') {
    const p = Number(a.noul);
    if (!Number.isFinite(p)) return { pred: null, conf: null };
    return { pred: p >= 0.5 ? 'yes' : 'no', conf: Math.max(p, 1 - p) };
  }
  const choice = typeof a.choice === 'string' ? a.choice : null;
  if (choice) return { pred: choice, conf: maxP };
  // score / 只给概率没给 choice 的情况：取概率最大档
  if (values.length) {
    const best = Object.entries(probs).sort((x, y) => Number(y[1]) - Number(x[1]))[0];
    return { pred: String(best[0]), conf: maxP };
  }
  return { pred: null, conf: null };
}

async function main(): Promise<void> {
  const split = arg('split', 'original');
  const limit = Number(arg('limit', '0'));
  const concurrency = Number(arg('concurrency', '4'));
  const gapMs = Number(arg('delay', '120'));
  const outFile = arg('out', path.join(DIR, `${split}.${MODEL.replace(/[^a-zA-Z0-9._-]/g, '_')}.jsonl`));
  const file = path.join(DIR, `${split}.jsonl`);
  if (!fs.existsSync(file)) {
    console.error(`找不到 ${file}；先拉公开集（见文件头注释）`);
    process.exitCode = 1;
    return;
  }
  let items = fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as BenchItem)
    .filter((i) => i.expected !== null && i.expected !== undefined);
  if (limit > 0) items = items.slice(0, limit);
  console.log(`[jevbench] split=${split} 题数=${items.length} | model=${MODEL} | ${BASE_URL} | 并发 ${concurrency}`);

  const outcomes: Outcome[] = [];
  const queue = items.map((item) => item);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= queue.length) return;
        const item = queue[index];
        const { answers, ms, error } = await askOne(item);
        const { pred, conf } = decide(item, answers);
        const ok = pred !== null && String(pred) === String(item.expected);
        outcomes.push({ id: item.id, family: item.family, type: item.question.type, expected: item.expected, pred, conf, ok, ms, error });
        const mark = error ? '✗' : ok ? '✓' : '·';
        console.log(`  [${outcomes.length}/${queue.length}] ${mark} ${item.id} ${item.question.type} 期望=${String(item.expected)} 得到=${String(pred)}(${conf === null ? '-' : conf.toFixed(2)}) ${ms}ms${error ? ' ' + error : ''}`);
        if (gapMs > 0) await sleep(gapMs);
      }
    })
  );
  outcomes.sort((a, b) => a.id.localeCompare(b.id));

  const n = outcomes.length;
  const ans = outcomes.filter((o) => o.pred !== null);
  const acc = ans.length ? ans.filter((o) => o.ok).length / ans.length : 0;
  const brier = ans.filter((o) => o.conf !== null).length
    ? ans.reduce((s, o) => s + (Number(o.conf) - (o.ok ? 1 : 0)) ** 2, 0) / ans.filter((o) => o.conf !== null).length
    : NaN;
  // AUC：置信度对「答对」的排序能力
  const pos = ans.filter((o) => o.ok && o.conf !== null).map((o) => Number(o.conf));
  const neg = ans.filter((o) => !o.ok && o.conf !== null).map((o) => Number(o.conf));
  let wins = 0;
  let ties = 0;
  for (const p of pos) for (const q of neg) { if (p > q) wins += 1; else if (p === q) ties += 1; }
  const auc = pos.length && neg.length ? (wins + 0.5 * ties) / (pos.length * neg.length) : NaN;

  const group = (key: 'type' | 'family') => {
    const m = new Map<string, { n: number; ok: number }>();
    for (const o of ans) {
      const g = m.get(o[key]) ?? { n: 0, ok: 0 };
      g.n += 1;
      if (o.ok) g.ok += 1;
      m.set(o[key], g);
    }
    return [...m.entries()].map(([k, v]) => `${k} ${v.ok}/${v.n}=${((100 * v.ok) / v.n).toFixed(0)}%`).join(' | ');
  };

  fs.writeFileSync(outFile, outcomes.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf-8');
  console.log(`\n[jevbench] ${split} @ ${MODEL}`);
  console.log(`  可判题 ${ans.length}/${n}（失败 ${n - ans.length}）| 准确率 ${(100 * acc).toFixed(1)}% | Brier ${brier.toFixed(3)} | AUC(conf→对) ${auc.toFixed(3)}`);
  console.log(`  按题型：${group('type')}`);
  console.log(`  按家族：${group('family')}`);
  console.log(`  逐题记录 → ${outFile}`);
}

void main();
