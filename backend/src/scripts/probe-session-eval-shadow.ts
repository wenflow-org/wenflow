/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * 会话评估影子探针（**真实数据**，不调 LLM、不写库）。
 *
 * 用法：cd backend && npx ts-node --transpile-only src/scripts/probe-session-eval-shadow.ts
 *
 * 做三件事（都基于库里真实 teaching_sessions）：
 *   1) 用「确定性聚合」重算每节课的 lss/ktl/lf，与库里 LLM 的评估值对比（这就是影子双写将来要比的分布）；
 *   2) 给出逐轮输入的质量（轮数 / coverage），确认聚合不是退化成均值；
 *   3) 量化「阈值语义修正」的影响面：把真实数值按锚点回投成档位后，
 *      旧规则（>=6）与新规则（仅 high）分别会把这节课判成什么信号。
 */

import 'dotenv/config';
import path from 'node:path';
// node:sqlite 属 Node 22 实验 API，本仓库 @types/node 尚未声明；运行时可 require 到。
// 这里用最小局部类型替代 import，避免为一个只读探针脚本放宽全仓 tsc。
// eslint-disable-next-line @typescript-eslint/no-require-imports -- 实验 API 无类型声明，import type 无法表达运行时存在性
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (dbPath: string, options?: { readOnly?: boolean }) => {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
};
import {
  aggregateSessionEvaluationFromMessages,
  type SessionEvaluationTurnMessage,
} from '../services/learning/session-evaluation-aggregate';

interface SessionRow {
  id: string;
  subject: string | null;
  topic: string | null;
  messages: string | null;
  wrapup: string | null;
  endTime: string | null;
}

type Signal = 'fatigue' | 'mastery' | 'struggle' | 'incomplete';

/** 锚点分档（与 session-evaluation-scale 一致：1-4 low / 5-7 mid / 8-10 high） */
const bandOf = (value: unknown): 'low' | 'mid' | 'high' | undefined => {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n >= 8 ? 'high' : n >= 5 ? 'mid' : 'low';
};

/** 旧规则：LLM 给的是连续 0-10，用 >=6 判定 */
const oldSignal = (lf: number | null, ktl: number | null, lss: number | null): Signal =>
  lf !== null && lf >= 6 ? 'fatigue' : ktl !== null && ktl >= 6 ? 'mastery' : lss !== null && lss >= 6 ? 'struggle' : 'incomplete';

/** 新规则：只有 high 档（8-10）才算异常信号 */
const newSignal = (lf: number | null, ktl: number | null, lss: number | null): Signal => {
  const high = (v: number | null) => bandOf(v) === 'high';
  return high(lf) ? 'fatigue' : high(ktl) ? 'mastery' : high(lss) ? 'struggle' : 'incomplete';
};

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function main(): void {
  const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, subject, topic, messages, wrapup, endTime
       FROM teaching_sessions
       WHERE messages IS NOT NULL AND wrapup LIKE '%"evaluation"%'
       ORDER BY updatedAt DESC LIMIT 120`
    )
    .all() as unknown as SessionRow[];
  db.close();

  interface Sample {
    id: string;
    label: string;
    turns: number;
    llm: { lss: number | null; ktl: number | null; lf: number | null; confidence: number | null };
    det: { lss: number; ktl: number; lf: number; confidence: number; basis: string; coverage: number };
    delta: { lss: number; ktl: number; lf: number };
  }

  const samples: Sample[] = [];
  for (const row of rows) {
    const messages = parseJson<SessionEvaluationTurnMessage[]>(row.messages) || [];
    const wrapup = parseJson<{ evaluation?: Record<string, unknown> }>(row.wrapup);
    const evaluation = wrapup?.evaluation;
    if (!evaluation) continue;
    const llm = {
      lss: num(evaluation.sessionLss),
      ktl: num(evaluation.sessionKtl),
      lf: num(evaluation.sessionLf),
      confidence: num(evaluation.confidence),
    };
    if (llm.lss === null && llm.ktl === null && llm.lf === null) continue;

    const det = aggregateSessionEvaluationFromMessages(messages);
    samples.push({
      id: row.id.slice(0, 8),
      label: `${String(row.subject ?? '').slice(0, 10)}·${String(row.topic ?? '').slice(0, 14)}`,
      turns: det.turnCount,
      llm,
      det: { lss: det.lss, ktl: det.ktl, lf: det.lf, confidence: det.confidence, basis: det.basis, coverage: det.coverage.overall },
      delta: {
        lss: Math.round((det.lss - (llm.lss ?? det.lss)) * 100) / 100,
        ktl: Math.round((det.ktl - (llm.ktl ?? det.ktl)) * 100) / 100,
        lf: Math.round((det.lf - (llm.lf ?? det.lf)) * 100) / 100,
      },
    });
  }

  console.log(`\n=== 1) 真实会话对比（确定性聚合 vs 库里 LLM 评估）共 ${samples.length} 节 ===`);
  console.log('  id      轮数   LLM(lss/ktl/lf)      确定性(lss/ktl/lf)    Δ(lss/ktl/lf)        cov  节');
  for (const s of samples.slice(0, 18)) {
    console.log(
      `  ${s.id}  ${String(s.turns).padStart(3)}   ` +
        `${s.llm.lss ?? '-'}/${s.llm.ktl ?? '-'}/${s.llm.lf ?? '-'}`.padEnd(20) +
        `  ${s.det.lss}/${s.det.ktl}/${s.det.lf}`.padEnd(20) +
        `  ${s.delta.lss}/${s.delta.ktl}/${s.delta.lf}`.padEnd(19) +
        `  ${s.det.coverage}   ${s.label}`
    );
  }

  const withTurns = samples.filter((s) => s.turns > 0);
  const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0);
  const absMean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + Math.abs(b), 0) / values.length) * 100) / 100 : 0);

  console.log(`\n=== 2) 输入质量与偏差分布 ===`);
  console.log(`  有逐轮观测的会话：${withTurns.length}/${samples.length}`);
  console.log(`  轮数：均值 ${mean(samples.map((s) => s.turns))}，中位 ${[...samples.map((s) => s.turns)].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? 0}，最大 ${Math.max(0, ...samples.map((s) => s.turns))}`);
  console.log(`  coverage.overall：均值 ${mean(samples.map((s) => s.det.coverage))}`);
  console.log(`  |Δ| 均值：lss=${absMean(samples.map((s) => s.delta.lss))} ktl=${absMean(samples.map((s) => s.delta.ktl))} lf=${absMean(samples.map((s) => s.delta.lf))}`);
  console.log(`  Δ 均值 ：lss=${mean(samples.map((s) => s.delta.lss))} ktl=${mean(samples.map((s) => s.delta.ktl))} lf=${mean(samples.map((s) => s.delta.lf))}（正=确定性聚合更"重"）`);
  const zeroEvidence = samples.filter((s) => s.det.basis === 'zero-evidence').length;
  console.log(`  零证据（无任何逐轮观测）：${zeroEvidence} 节`);

  console.log(`\n=== 3) 阈值语义修正的影响面（真实数值按锚点回投档位）===`);
  const buckets: Signal[] = ['fatigue', 'mastery', 'struggle', 'incomplete'];
  const oldCounts = new Map<Signal, number>(buckets.map((b) => [b, 0]));
  const newCounts = new Map<Signal, number>(buckets.map((b) => [b, 0]));
  let changed = 0;
  for (const s of samples) {
    const before = oldSignal(s.llm.lf, s.llm.ktl, s.llm.lss);
    const after = newSignal(s.llm.lf, s.llm.ktl, s.llm.lss);
    oldCounts.set(before, (oldCounts.get(before) || 0) + 1);
    newCounts.set(after, (newCounts.get(after) || 0) + 1);
    if (before !== after) changed += 1;
  }
  console.log('  信号       旧规则(>=6)   新规则(仅 high)');
  for (const b of buckets) {
    console.log(`  ${b.padEnd(10)} ${String(oldCounts.get(b)).padStart(6)}   ${String(newCounts.get(b)).padStart(10)}`);
  }
  console.log(`  判定发生变化的会话：${changed}/${samples.length}（${samples.length ? Math.round((changed / samples.length) * 100) : 0}%）`);
}

main();
