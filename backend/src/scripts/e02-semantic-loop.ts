/* eslint-disable no-console -- 只读读数 CLI（#103 语义卡环）：按 createdAt 降序、分 VL/真人两列。
 *
 * 背景（#103）：本读数脚本此前只以 `.tmp-e02-split.ts` 的形式存在于仓库根，`*.tmp-*` 被
 * `.gitignore:342` 排除，干净检出拿不到，外部复核无法复算。现提升为受跟踪脚本。
 *
 * 口径与 `.tmp-night-watch/e02.ts` 一致：相邻 assistant 余弦 vs 本会话非相邻基线+0.05
 * （下限 0.70），卡环段 = 连续 ≥3 个相邻对越阈，零假设 = 同会话 200 次置换（固定种子）。
 * 只读 dev.db，不写盘。
 *
 * 退出码：
 *   0 正常出数
 *   2 EMBEDDING_PROVIDER_NOT_CONFIGURED（缺 backend/.env 的 EMBEDDING_API_URL / EMBEDDING_API_KEY）
 *   3 INSUFFICIENT_SAMPLES（VL 可入样会话 < --limit，读数不可作为 n=limit 判据）
 *
 * 用法（backend 目录）：
 *   npx ts-node -T src/scripts/e02-semantic-loop.ts --limit=20
 *   npx ts-node -T src/scripts/e02-semantic-loop.ts --limit=20 --db=prisma/dev.db
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { embedTexts, cosineSimilarity, resolveEmbeddingProviderOrder, createEmbeddingProviders } from '../services/embedding';
import { readBgeConfig } from '../services/embedding/providers/bge';

const BACKEND_DIR = path.resolve(__dirname, '..', '..');

/** 依次尝试 backend/.env 与 cwd 下的 .env；找不到就交给下面的显式配置检查报错（不再静默返回）。 */
export function loadEnv(): string | null {
  const candidates = [
    path.join(BACKEND_DIR, '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend', '.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }
  return null;
}

export interface EmbeddingConfigCheck {
  ok: boolean;
  reason?: string;
  envFile: string | null;
}

/**
 * 显式前置检查：脚本只做向量化，所以不仅要 provider.isConfigured()（apiKey + 任一 endpoint），
 * 还必须确认 EMBEDDING_API_URL 在位——只配 RERANK_API_URL 时 isConfigured() 为 true 但 embed 必失败。
 */
export function checkEmbeddingConfig(envFile: string | null): EmbeddingConfigCheck {
  const cfg = readBgeConfig();
  const providers = createEmbeddingProviders();
  const order = resolveEmbeddingProviderOrder();
  const configuredIds = order.filter((id) => providers[id]?.isConfigured());
  const missing: string[] = [];
  if (!cfg.apiKey) missing.push('EMBEDDING_API_KEY');
  if (!cfg.embeddingEndpoint) missing.push('EMBEDDING_API_URL');
  if (missing.length > 0) {
    return {
      ok: false,
      envFile,
      reason:
        `EMBEDDING_PROVIDER_NOT_CONFIGURED: 在 backend/.env 配置 ${missing.join(' 与 ')}` +
        `（env 文件：${envFile ?? '未找到 backend/.env'}）`,
    };
  }
  if (configuredIds.length === 0) {
    return {
      ok: false,
      envFile,
      reason: `EMBEDDING_PROVIDER_NOT_CONFIGURED: 没有 isConfigured() 为真的向量化 provider（顺序 ${order.join(' -> ') || '-'}）`,
    };
  }
  return { ok: true, envFile };
}

export const THRESHOLD = 0.7;
export const MIN_RUN = 3;
/** 可入样门槛：至少 MIN_RUN+2 条 assistant（3 个相邻对的卡环 + 2 个非相邻对做基线）。 */
export const MIN_TURNS = MIN_RUN + 2;

export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let v = state;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

/** 连续 true 的段长列表（卡环段 = 段长 ≥ MIN_RUN-1，即 ≥3 个相邻对 / 4 轮连续）。 */
export function runLengths(flags: boolean[]): number[] {
  const runs: number[] = [];
  let cur = 0;
  for (const f of flags) {
    if (f) cur += 1;
    else {
      if (cur) runs.push(cur);
      cur = 0;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** 卡环对占比：仅统计段长 ≥ MIN_RUN-1 的连续对。 */
export function loopPairCount(flags: boolean[]): number {
  return runLengths(flags)
    .filter((r) => r >= MIN_RUN - 1)
    .reduce((s, r) => s + r, 0);
}

/** 零假设：同会话内随机打乱顺序后的卡环占比（固定种子，可复现）。 */
export function shuffledLoopRate(vectors: number[][], threshold: number, seed: number, iterations = 200): number {
  const rng = makeRng(seed);
  let total = 0;
  for (let it = 0; it < iterations; it += 1) {
    const order = Array.from({ length: vectors.length }, (_, i) => i);
    for (let i = vectors.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const flags: boolean[] = [];
    for (let i = 0; i + 1 < vectors.length; i += 1) {
      flags.push(cosineSimilarity(vectors[order[i]], vectors[order[i + 1]]) >= threshold);
    }
    total += loopPairCount(flags) / Math.max(1, flags.length);
  }
  return total / iterations;
}

export interface SessionReading {
  sessionId: string;
  turns: number;
  adjacentPairs: number;
  adjacentMean: number;
  nonAdjacentMean: number;
  threshold: number;
  loopRate: number;
  nullLoopRate: number;
  loopExcess: number;
  firstHalfLoopRate: number;
  secondHalfLoopRate: number;
}

/** 单会话读数：相邻余弦 vs 非相邻基线+0.05（下限 0.70），与旧临时脚本逐行同口径。 */
export function readSession(sessionId: string, vectors: number[][]): SessionReading {
  const adj: number[] = [];
  for (let i = 0; i + 1 < vectors.length; i += 1) adj.push(cosineSimilarity(vectors[i], vectors[i + 1]));
  const non: number[] = [];
  for (let i = 0; i + 2 < vectors.length; i += 2) non.push(cosineSimilarity(vectors[i], vectors[i + 2]));
  const base = non.length ? non.reduce((a, b) => a + b, 0) / non.length : 0;
  const threshold = Math.max(THRESHOLD, base + 0.05);
  const flags = adj.map((v) => v >= threshold);
  const loopPairs = loopPairCount(flags);
  const half = Math.floor(adj.length / 2);
  const firstHalf = loopPairCount(flags.slice(0, half));
  const secondHalf = loopPairCount(flags.slice(half));
  // 种子沿用旧临时脚本口径（turns + 相邻对数），保证同一库上读数可复现
  const nullRate = shuffledLoopRate(vectors, threshold, vectors.length + adj.length);
  return {
    sessionId,
    turns: vectors.length,
    adjacentPairs: adj.length,
    adjacentMean: +(adj.reduce((a, b) => a + b, 0) / Math.max(1, adj.length)).toFixed(4),
    nonAdjacentMean: +base.toFixed(4),
    threshold: +threshold.toFixed(4),
    loopRate: +(loopPairs / Math.max(1, adj.length)).toFixed(4),
    nullLoopRate: +nullRate.toFixed(4),
    loopExcess: +(loopPairs / Math.max(1, adj.length) - nullRate).toFixed(4),
    firstHalfLoopRate: +(firstHalf / Math.max(1, half)).toFixed(4),
    secondHalfLoopRate: +(secondHalf / Math.max(1, adj.length - half)).toFixed(4),
  };
}

export function summarize(column: string, report: SessionReading[]) {
  const mean = (k: keyof SessionReading) =>
    report.reduce((s, r) => s + Number(r[k] || 0), 0) / Math.max(1, report.length);
  return {
    column,
    sessions: report.length,
    meanLoopRate: +mean('loopRate').toFixed(4),
    meanNullLoopRate: +mean('nullLoopRate').toFixed(4),
    meanLoopExcess: +mean('loopExcess').toFixed(4),
    meanFirstHalf: +mean('firstHalfLoopRate').toFixed(4),
    meanSecondHalf: +mean('secondHalfLoopRate').toFixed(4),
    perSession: report,
  };
}

/**
 * 样本门：VL 可入样数必须 ≥ limit，否则读数只是「现有会话的均值」，不能当 n=limit 的判据。
 * 真人列在现库天然不足（实测 n=6），保留输出但标 adjudicable:false。
 */
export function evaluateSampleGate(vlEligible: number, humanEligible: number, limit: number) {
  return {
    vl: { eligible: vlEligible, limit, adjudicable: vlEligible >= limit },
    human: { eligible: humanEligible, limit, adjudicable: humanEligible >= limit },
  };
}

function argText(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<number> {
  const envFile = loadEnv();
  const config = checkEmbeddingConfig(envFile);
  if (!config.ok) {
    console.error(config.reason);
    return 2;
  }

  const limit = Number(argText('limit', '10'));
  const dbPath = path.isAbsolute(argText('db', '')) ? argText('db', '') : path.resolve(BACKEND_DIR, argText('db', 'prisma/dev.db'));

  // node:sqlite 属 Node 22 实验 API（本仓 @types/node 20.x 未声明），且 CI 用 Node 20 没有该内建模块。
  // 必须**懒加载**：模块级 require 会让任何 import 本文件的测试在 CI 直接套件失败（2026-10-20 CI 红）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const vlUsers = new Set(
    db.prepare('SELECT userId FROM virtual_learner_profiles').all().map((r: any) => String(r.userId))
  );
  const rows = db
    .prepare(
      `SELECT m.sessionId AS sid, m.payload AS payload, s.userId AS uid, s.createdAt AS createdAt
         FROM teaching_session_messages m JOIN teaching_sessions s ON s.id = m.sessionId
        WHERE s.status = 'completed'
        ORDER BY s.createdAt DESC, m.createdAt, m.id`
    )
    .all() as Array<{ sid: string; payload: unknown; uid: string; createdAt: unknown }>;
  db.close();

  const bySession = new Map<string, { uid: string; turns: string[] }>();
  for (const r of rows) {
    let p: any = r.payload;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        continue;
      }
    }
    if (p?.role !== 'assistant') continue;
    const text = String(p.content || '').trim();
    if (!text) continue;
    const cur = bySession.get(r.sid) || { uid: r.uid, turns: [] };
    cur.turns.push(text);
    bySession.set(r.sid, cur);
  }

  const eligible = [...bySession.entries()].filter(([, v]) => v.turns.length >= MIN_TURNS);
  const vlSessions = eligible.filter(([, v]) => vlUsers.has(v.uid));
  const humanSessions = eligible.filter(([, v]) => !vlUsers.has(v.uid));
  const gate = evaluateSampleGate(vlSessions.length, humanSessions.length, limit);

  if (!gate.vl.adjudicable) {
    console.error(
      `INSUFFICIENT_SAMPLES: VL eligible=${vlSessions.length} < limit=${limit}` +
        `（completed 会话中 assistant>=${MIN_TURNS} 的 VL 样本不足；读数不可作为 n=${limit} 判据）`
    );
    return 3;
  }

  const groups: Array<[string, Array<[string, { uid: string; turns: string[] }]>, { adjudicable: boolean; eligible: number; limit: number }]> = [
    ['VL', vlSessions.slice(0, limit), gate.vl],
    ['真人', humanSessions.slice(0, limit), gate.human],
  ];

  for (const [label, sessions, gateInfo] of groups) {
    const report: SessionReading[] = [];
    for (const [sid, { turns }] of sessions) {
      const { vectors } = await embedTexts({ input: turns }, { timeoutMs: 120_000 });
      report.push(readSession(sid, vectors.map((v) => v.embedding)));
    }
    const summary = summarize(label, report);
    console.log(
      JSON.stringify(
        {
          ...summary,
          adjudicable: gateInfo.adjudicable,
          eligible: gateInfo.eligible,
          limit: gateInfo.limit,
          note: gateInfo.adjudicable
            ? undefined
            : `样本不足：eligible=${gateInfo.eligible} < limit=${gateInfo.limit}，仅作登记，不得当判据`,
        },
        null,
        1
      )
    );
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    });
}
