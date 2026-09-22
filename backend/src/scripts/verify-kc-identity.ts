/* eslint-disable no-console -- 只读断言 CLI：KC 概念身份改造的效果度量（设计 §6.3） */
/**
 * KC 概念身份改造 · 只读度量脚本（设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §6.3）
 *
 * 用途：改造前采基线、改造后采对照，**同一脚本同一口径**，断言不新造。
 * 纪律：只读，不写任何业务表；表/列缺失时降级报告（改造前本就没有 concepts 表）。
 *
 * 断言（编号与设计文档一致）：
 *   1  重复键收敛：distinct conceptKey / distinct conceptId（改造前 ≈1.00）
 *   2  跨表可 join：misconception_ledger 与 memory_traces 的概念键/身份交集覆盖率
 *   3  子任务可解析：subtasks 有 canonical conceptId 的比例（改造前 0）
 *   9  边物化一致：concept_edges(prerequisite,path) 行数 vs 各路径 kcGraph.edges 总数
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/verify-kc-identity.ts
 *   npx ts-node --transpile-only src/scripts/verify-kc-identity.ts --scope=virtual
 *   npx ts-node --transpile-only src/scripts/verify-kc-identity.ts --json=C:/tmp/kc-baseline.json
 */
import 'dotenv/config';
import * as fs from 'fs';
import prisma from '../config/database';
import { parsePathPromptTemplate } from '../services/learning/learning.helpers';

type Scope = 'all' | 'virtual';

interface Report {
  scope: Scope;
  at: string;
  schema: { conceptsTable: boolean; aliasesTable: boolean; edgesTable: boolean; memoryTraceConceptId: boolean };
  a1: { distinctConceptKey: number; distinctConceptId: number | null; traceRows: number; ratio: number | null };
  a2: { misconceptionKeys: number; traceKeys: number; keyIntersection: number; keyCoverage: number;
        misconceptionConceptIds: number | null; traceConceptIds: number | null;
        idIntersection: number | null; idCoverage: number | null };
  a3: { subtaskRows: number; withCanonicalConceptId: number | null; withLocalRef: number; canonicalCoverage: number | null };
  a4: { subtaskConcepts: number | null; traceConcepts: number | null; shared: number | null; bridgeRate: number | null };
  a5: { misconceptionConcepts: number | null; shared: number | null; bridgeRate: number | null };
  a9: { kcGraphEdgesTotal: number; conceptEdgesPrerequisitePath: number | null; consistent: boolean | null };
  extra: { virtualLearners: number; memoryTracesVirtual: number; memoryTracesReal: number };
}

function parseArgs() {
  const out: { scope: Scope; json: string | null } = { scope: 'all', json: null };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'scope' && (v === 'all' || v === 'virtual')) out.scope = v;
    if (k === 'json' && v) out.json = v;
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

/** 用户范围 SQL 片段（与虚拟学习者隔离口径一致） */
function userFilter(scope: Scope, column = 'userId'): string {
  return scope === 'virtual'
    ? ` and ${column} in (select id from users where isVirtualLearner = 1)`
    : '';
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `select name from sqlite_master where type='table' and name=?`, name);
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`pragma table_info("${table}")`);
    return rows.some((r) => r.name === column);
  } catch { return false; }
}

async function one<T = Record<string, unknown>>(sql: string): Promise<T> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql);
  return rows[0] ?? ({} as T);
}

async function main() {
  const args = parseArgs();
  const scope = args.scope;

  const conceptsTable = await tableExists('concepts');
  const aliasesTable = await tableExists('concept_aliases');
  const edgesTable = await tableExists('concept_edges');
  const memoryTraceConceptId = await columnExists('memory_traces', 'conceptId');
  const misconceptionConceptId = await columnExists('misconception_ledger', 'conceptId');
  const subtaskConceptId = await columnExists('subtasks', 'conceptId');

  // ── 断言 1：重复键收敛 ────────────────────────────────────────────────
  const t1 = await one<{ rows: number; keys: number }>(
    `select count(*) rows, count(distinct conceptKey) keys from memory_traces where 1=1${userFilter(scope)}`);
  const distinctConceptId = memoryTraceConceptId
    ? num((await one<{ c: number }>(
        `select count(distinct conceptId) c from memory_traces where conceptId is not null${userFilter(scope)}`)).c)
    : null;
  const traceRows = num(t1.rows);
  const distinctConceptKey = num(t1.keys);

  // ── 断言 2：跨表可 join ───────────────────────────────────────────────
  const misKeys = num((await one<{ c: number }>(
    `select count(distinct conceptKey) c from misconception_ledger where 1=1${userFilter(scope)}`)).c);
  const keyInter = num((await one<{ c: number }>(
    `select count(*) c from (select distinct conceptKey k from memory_traces where 1=1${userFilter(scope)}
       intersect select distinct conceptKey k from misconception_ledger where 1=1${userFilter(scope)})`)).c);
  let misIds: number | null = null;
  let traceIds: number | null = null;
  let idInter: number | null = null;
  if (memoryTraceConceptId && misconceptionConceptId) {
    misIds = num((await one<{ c: number }>(
      `select count(distinct conceptId) c from misconception_ledger where conceptId is not null${userFilter(scope)}`)).c);
    traceIds = num((await one<{ c: number }>(
      `select count(distinct conceptId) c from memory_traces where conceptId is not null${userFilter(scope)}`)).c);
    idInter = num((await one<{ c: number }>(
      `select count(*) c from (select distinct conceptId k from memory_traces where conceptId is not null${userFilter(scope)}
         intersect select distinct conceptId k from misconception_ledger where conceptId is not null${userFilter(scope)})`)).c);
  }

  // ── 断言 3：子任务可解析 ──────────────────────────────────────────────
  const st = await one<{ total: number; local: number }>(
    `select count(*) total,
            sum(case when linkedConceptId is not null and linkedConceptId <> '' then 1 else 0 end) local
       from subtasks where 1=1${userFilter(scope)}`);
  const stCanonical = subtaskConceptId
    ? num((await one<{ c: number }>(
        `select count(*) c from subtasks where conceptId is not null${userFilter(scope)}`)).c)
    : null;

  // ── 断言 4/5：canonical 身份跨表贯通（改造前不可计算——两套 id 系统）────────
  const stConcepts = subtaskConceptId
    ? num((await one<{ c: number }>(
        `select count(distinct conceptId) c from subtasks where conceptId is not null${userFilter(scope)}`)).c) : null;
  const trConcepts = memoryTraceConceptId
    ? num((await one<{ c: number }>(
        `select count(distinct conceptId) c from memory_traces where conceptId is not null${userFilter(scope)}`)).c) : null;
  const stShared = subtaskConceptId && memoryTraceConceptId
    ? num((await one<{ c: number }>(
        `select count(*) c from (select distinct conceptId from subtasks where conceptId is not null${userFilter(scope)}
           intersect select distinct conceptId from memory_traces where conceptId is not null${userFilter(scope)})`)).c) : null;
  const misShared = misconceptionConceptId && memoryTraceConceptId
    ? num((await one<{ c: number }>(
        `select count(*) c from (select distinct conceptId from misconception_ledger where conceptId is not null${userFilter(scope)}
           intersect select distinct conceptId from memory_traces where conceptId is not null${userFilter(scope)})`)).c) : null;

  // ── 断言 9：边物化一致 ───────────────────────────────────────────────
  const paths = await prisma.learning_paths.findMany({
    where: scope === 'virtual' ? { users: { isVirtualLearner: true } } : {},
    select: { aiPromptTemplate: true },
  });
  let kcGraphEdgesTotal = 0;
  for (const p of paths) {
    const ann = parsePathPromptTemplate(p.aiPromptTemplate)?.kcAnnotation as
      { kcGraph?: { edges?: unknown[] } } | undefined;
    kcGraphEdgesTotal += Array.isArray(ann?.kcGraph?.edges) ? ann!.kcGraph!.edges!.length : 0;
  }
  const conceptEdges = edgesTable
    ? num((await one<{ c: number }>(
        `select count(*) c from concept_edges where relation='prerequisite' and scope='path'${userFilter(scope)}`)).c)
    : null;

  // ── 附：规模 ─────────────────────────────────────────────────────────
  const vl = num((await one<{ c: number }>(`select count(*) c from users where isVirtualLearner = 1`)).c);
  const mtVirtual = num((await one<{ c: number }>(
    `select count(*) c from memory_traces where userId in (select id from users where isVirtualLearner = 1)`)).c);
  const mtReal = traceRows - mtVirtual;

  const report: Report = {
    scope,
    at: new Date().toISOString(),
    schema: { conceptsTable, aliasesTable, edgesTable, memoryTraceConceptId },
    a1: {
      distinctConceptKey, distinctConceptId, traceRows,
      ratio: distinctConceptId && distinctConceptId > 0 ? Number((distinctConceptKey / distinctConceptId).toFixed(3)) : null,
    },
    a2: {
      misconceptionKeys: misKeys, traceKeys: distinctConceptKey, keyIntersection: keyInter,
      keyCoverage: misKeys > 0 ? Number((keyInter / misKeys).toFixed(3)) : 0,
      misconceptionConceptIds: misIds, traceConceptIds: traceIds, idIntersection: idInter,
      idCoverage: misIds && misIds > 0 && idInter !== null ? Number((idInter / misIds).toFixed(3)) : null,
    },
    a3: {
      subtaskRows: num(st.total), withCanonicalConceptId: stCanonical, withLocalRef: num(st.local),
      canonicalCoverage: stCanonical !== null && num(st.total) > 0 ? Number((stCanonical / num(st.total)).toFixed(3)) : null,
    },
    a4: {
      subtaskConcepts: stConcepts, traceConcepts: trConcepts, shared: stShared,
      bridgeRate: stConcepts && stConcepts > 0 && stShared !== null ? Number((stShared / stConcepts).toFixed(3)) : null,
    },
    a5: {
      misconceptionConcepts: misIds, shared: misShared,
      bridgeRate: misIds && misIds > 0 && misShared !== null ? Number((misShared / misIds).toFixed(3)) : null,
    },
    a9: {
      kcGraphEdgesTotal, conceptEdgesPrerequisitePath: conceptEdges,
      consistent: conceptEdges === null ? null : conceptEdges === kcGraphEdgesTotal,
    },
    extra: { virtualLearners: vl, memoryTracesVirtual: mtVirtual, memoryTracesReal: mtReal },
  };

  console.log(`\n===== KC 概念身份度量（scope=${scope}）@ ${report.at} =====`);
  console.log(`schema: concepts=${conceptsTable} aliases=${aliasesTable} edges=${edgesTable} memory_traces.conceptId=${memoryTraceConceptId}`);
  console.log(`[A1 重复键收敛] 行=${traceRows} distinctKey=${distinctConceptKey} distinctId=${distinctConceptId ?? 'n/a'} 比值=${report.a1.ratio ?? 'n/a'}`);
  console.log(`[A2 跨表可 join] 误解键=${misKeys} 痕迹键=${distinctConceptKey} 键交集=${keyInter} 覆盖率=${report.a2.keyCoverage}` +
    ` ｜ id覆盖率=${report.a2.idCoverage ?? 'n/a'}`);
  console.log(`[A3 子任务可解析] 子任务=${num(st.total)} 有canonicalId=${stCanonical ?? 'n/a'} 有局部ref=${num(st.local)} 覆盖率=${report.a3.canonicalCoverage ?? 'n/a'}`);
  console.log(`[A4 计划↔痕迹贯通] subtask概念=${stConcepts ?? 'n/a'} trace概念=${trConcepts ?? 'n/a'} 共享=${stShared ?? 'n/a'} 贯通率=${report.a4.bridgeRate ?? 'n/a'}`);
  console.log(`[A5 误解↔痕迹贯通] 误解概念=${misIds ?? 'n/a'} 共享=${misShared ?? 'n/a'} 贯通率=${report.a5.bridgeRate ?? 'n/a'}`);
  console.log(`[A9 边物化一致] kcGraph.edges=${kcGraphEdgesTotal} concept_edges=${conceptEdges ?? 'n/a'} 一致=${report.a9.consistent ?? 'n/a'}`);
  console.log(`[规模] 虚拟学习者=${vl} 痕迹(虚拟)=${mtVirtual} 痕迹(真实)=${mtReal}`);

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n[report] 已写 ${args.json}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('[verify-kc-identity] 失败:', e); process.exit(1); });
