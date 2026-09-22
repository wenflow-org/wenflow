/* eslint-disable no-console -- 一次性回填 CLI：KC 概念身份注册表（设计 §3.5） */
/**
 * 概念身份回填（KC 概念身份与图关系改造 · P1）
 *
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.5
 *
 * 把历史自由文本键解析成 canonical `conceptId`（只增列，不动任何既有列）：
 *   1. memory_traces.conceptKey       → conceptId
 *   2. misconception_ledger.conceptKey → conceptId   ← 这一步把跨表交集覆盖率顶上去
 *   3. subtasks.linkedConceptName / coreConcept → conceptId（canonical；linkedConceptId 局部序号保留）
 *   4. milestones.coreConceptName     → conceptId
 *
 * 纪律：
 * - **只做文本精确解析**（normalizeConceptKey 后相等），语义近义一律留给 concept-consolidator 建议，
 *   不做自动语义合并（设计 §7 风险 2）。
 * - 幂等：已解析出 conceptId 的行跳过；重复执行不产生新概念（alias 唯一索引兜底）。
 * - 可分批：`--scope=virtual` 隔离真实用户（默认），`--limit=` 控单次规模，`--dry-run` 只看计划。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-concept-registry.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/backfill-concept-registry.ts --scope=virtual
 */
import 'dotenv/config';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { conceptRegistryService } from '../services/learner/concept-registry.service';
import { normalizeConceptKey } from '../services/memory/concept-key';

interface Args { scope: 'virtual' | 'all'; dryRun: boolean; limit: number | null; }

function parseArgs(): Args {
  const out: Args = { scope: 'virtual', dryRun: false, limit: null };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'scope' && (v === 'all' || v === 'virtual')) out.scope = v;
    if (k === 'dry-run') out.dryRun = true;
    if (k === 'limit' && v && Number.isFinite(Number(v))) out.limit = Number(v);
  }
  return out;
}

const CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 目标用户集合（scope=virtual 时先取虚拟学习者 id，隔离真实用户） */
async function targetUserIds(scope: Args['scope']): Promise<string[] | null> {
  if (scope === 'all') return null;
  const rows = await prisma.users.findMany({ where: { isVirtualLearner: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

interface Stats { traces: number; misconceptions: number; subtasks: number; milestones: number; concepts: number; skipped: number; }

/** 1) memory_traces：按用户解析后按 (userId, conceptKey) 批量回填 */
async function backfillTraces(userIds: string[] | null, args: Args, stats: Stats): Promise<void> {
  const rows = await prisma.memory_traces.findMany({
    where: { conceptId: null, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { id: true, userId: true, conceptKey: true },
    ...(args.limit ? { take: args.limit } : {}),
  });
  const byUser = new Map<string, Array<{ id: string; conceptKey: string }>>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push({ id: r.id, conceptKey: r.conceptKey });
  }
  for (const [userId, items] of byUser) {
    const map = await conceptRegistryService.resolveMany(userId, items.map((i) => i.conceptKey), { source: 'backfill' });
    stats.concepts += map.size;
    // 同 conceptKey 可能对应多行？(userId,conceptKey) 唯一 → 一 key 一行；按 key 批量更新
    for (const group of chunk(items, CHUNK)) {
      for (const item of group) {
        const conceptId = map.get(normalizeConceptKey(item.conceptKey));
        if (!conceptId) { stats.skipped += 1; continue; }
        if (!args.dryRun) {
          await prisma.memory_traces.update({ where: { id: item.id }, data: { conceptId } });
        }
        stats.traces += 1;
      }
    }
  }
}

/** 2) misconception_ledger：同上 */
async function backfillMisconceptions(userIds: string[] | null, args: Args, stats: Stats): Promise<void> {
  const rows = await prisma.misconception_ledger.findMany({
    where: { conceptId: null, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { id: true, userId: true, conceptKey: true },
    ...(args.limit ? { take: args.limit } : {}),
  });
  const byUser = new Map<string, Array<{ id: string; conceptKey: string }>>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push({ id: r.id, conceptKey: r.conceptKey });
  }
  for (const [userId, items] of byUser) {
    const map = await conceptRegistryService.resolveMany(userId, items.map((i) => i.conceptKey), { source: 'backfill' });
    stats.concepts += map.size;
    for (const group of chunk(items, CHUNK)) {
      for (const item of group) {
        const conceptId = map.get(normalizeConceptKey(item.conceptKey));
        if (!conceptId) { stats.skipped += 1; continue; }
        if (!args.dryRun) {
          await prisma.misconception_ledger.update({ where: { id: item.id }, data: { conceptId } });
        }
        stats.misconceptions += 1;
      }
    }
  }
}

/** 3) subtasks：按 linkedConceptName（回落 coreConcept）解析 */
async function backfillSubtasks(userIds: string[] | null, args: Args, stats: Stats): Promise<void> {
  const rows = await prisma.subtasks.findMany({
    where: { conceptId: null, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { id: true, userId: true, linkedConceptName: true, coreConcept: true },
    ...(args.limit ? { take: args.limit } : {}),
  });
  const byUser = new Map<string, Array<{ id: string; text: string }>>();
  for (const r of rows) {
    const text = (r.linkedConceptName || r.coreConcept || '').trim();
    if (!text) { stats.skipped += 1; continue; }
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push({ id: r.id, text });
  }
  for (const [userId, items] of byUser) {
    const map = await conceptRegistryService.resolveMany(userId, items.map((i) => i.text), { source: 'backfill', level: 'concept' });
    stats.concepts += map.size;
    for (const group of chunk(items, CHUNK)) {
      for (const item of group) {
        const conceptId = map.get(normalizeConceptKey(item.text));
        if (!conceptId) { stats.skipped += 1; continue; }
        if (!args.dryRun) {
          await prisma.subtasks.update({ where: { id: item.id }, data: { conceptId } });
        }
        stats.subtasks += 1;
      }
    }
  }
}

/** 4) milestones：无 userId 列，经 learning_paths 取归属用户 */
async function backfillMilestones(userIds: string[] | null, args: Args, stats: Stats): Promise<void> {
  const rows = await prisma.milestones.findMany({
    where: { conceptId: null, ...(userIds ? { learning_paths: { userId: { in: userIds } } } : {}) },
    select: { id: true, coreConceptName: true, learning_paths: { select: { userId: true } } },
    ...(args.limit ? { take: args.limit } : {}),
  });
  const byUser = new Map<string, Array<{ id: string; text: string }>>();
  for (const r of rows) {
    const text = (r.coreConceptName || '').trim();
    const userId = r.learning_paths?.userId;
    if (!text || !userId) { stats.skipped += 1; continue; }
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId)!.push({ id: r.id, text });
  }
  for (const [userId, items] of byUser) {
    const map = await conceptRegistryService.resolveMany(userId, items.map((i) => i.text), { source: 'backfill', level: 'concept' });
    stats.concepts += map.size;
    for (const group of chunk(items, CHUNK)) {
      for (const item of group) {
        const conceptId = map.get(normalizeConceptKey(item.text));
        if (!conceptId) { stats.skipped += 1; continue; }
        if (!args.dryRun) {
          await prisma.milestones.update({ where: { id: item.id }, data: { conceptId } });
        }
        stats.milestones += 1;
      }
    }
  }
}

/**
 * dry-run 计划报告：**纯只读**——只统计"待处理行数 + 归一化后不同键数"，
 * 不调用 resolveMany（否则会顺带创建概念/别名，dry-run 就不再是只读）。
 */
async function reportPlan(userIds: string[] | null, args: Args): Promise<void> {
  const scopeWhere = userIds ? { userId: { in: userIds } } : {};
  const [traces, misconceptions, subtasks, milestones] = await Promise.all([
    prisma.memory_traces.findMany({ where: { conceptId: null, ...scopeWhere }, select: { userId: true, conceptKey: true }, ...(args.limit ? { take: args.limit } : {}) }),
    prisma.misconception_ledger.findMany({ where: { conceptId: null, ...scopeWhere }, select: { userId: true, conceptKey: true }, ...(args.limit ? { take: args.limit } : {}) }),
    prisma.subtasks.findMany({ where: { conceptId: null, ...scopeWhere }, select: { userId: true, linkedConceptName: true, coreConcept: true }, ...(args.limit ? { take: args.limit } : {}) }),
    prisma.milestones.findMany({ where: { conceptId: null, ...(userIds ? { learning_paths: { userId: { in: userIds } } } : {}) }, select: { coreConceptName: true, learning_paths: { select: { userId: true } } }, ...(args.limit ? { take: args.limit } : {}) }),
  ]);
  const distinct = (pairs: Array<[string, string]>): number => new Set(pairs.map(([u, k]) => `${u}\u0000${k}`)).size;
  const traceKeys = distinct(traces.map((r) => [r.userId, normalizeConceptKey(r.conceptKey)]).filter(([, k]) => !!k));
  const misKeys = distinct(misconceptions.map((r) => [r.userId, normalizeConceptKey(r.conceptKey)]).filter(([, k]) => !!k));
  const stKeys = distinct(subtasks.map((r) => [r.userId, normalizeConceptKey(r.linkedConceptName || r.coreConcept || '')]).filter(([, k]) => !!k));
  const msKeys = distinct(milestones.map((r) => [r.learning_paths?.userId || '', normalizeConceptKey(r.coreConceptName || '')]).filter(([, k]) => !!k));
  const allKeys = new Set([traceKeys, misKeys, stKeys, msKeys].flatMap((n) => [n])); // 仅用于提示规模
  void allKeys;
  const existing = await prisma.concepts.count();
  const existingAliases = await prisma.concept_aliases.count();
  console.log(`[backfill:plan] 待处理行：traces=${traces.length} misconceptions=${misconceptions.length} subtasks=${subtasks.length} milestones=${milestones.length}`);
  console.log(`[backfill:plan] 各源 (userId,键) 去重数：traces=${traceKeys} misconceptions=${misKeys} subtasks=${stKeys} milestones=${msKeys}`);
  console.log(`[backfill:plan] 库内现有 concepts=${existing} aliases=${existingAliases}（已存在的别名不会重复创建）`);
  console.log('[backfill:plan] dry-run 结束：未写任何行');
}

async function main() {
  const args = parseArgs();
  const userIds = await targetUserIds(args.scope);
  console.log(`[backfill] scope=${args.scope}${userIds ? ` 用户数=${userIds.length}` : ' (全部用户)'} dryRun=${args.dryRun} limit=${args.limit ?? '∞'}`);

  if (args.dryRun) {
    await reportPlan(userIds, args);
    return;
  }

  const stats: Stats = { traces: 0, misconceptions: 0, subtasks: 0, milestones: 0, concepts: 0, skipped: 0 };
  const started = Date.now();

  await backfillTraces(userIds, args, stats);
  console.log(`[backfill] memory_traces     已解析=${stats.traces}`);
  await backfillMisconceptions(userIds, args, stats);
  console.log(`[backfill] misconception     已解析=${stats.misconceptions}`);
  await backfillSubtasks(userIds, args, stats);
  console.log(`[backfill] subtasks          已解析=${stats.subtasks}`);
  await backfillMilestones(userIds, args, stats);
  console.log(`[backfill] milestones        已解析=${stats.milestones}`);

  const concepts = await prisma.concepts.count();
  const aliases = await prisma.concept_aliases.count();
  console.log(`[backfill] 完成 耗时=${((Date.now() - started) / 1000).toFixed(1)}s 跳过=${stats.skipped}` +
    ` ｜库内 concepts=${concepts} aliases=${aliases}${args.dryRun ? ' （dry-run：未写库）' : ''}`);
}

main().then(() => process.exit(0)).catch((e) => { logger.error('[backfill] 失败', e); console.error(e); process.exit(1); });
