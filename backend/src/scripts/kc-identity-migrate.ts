/* eslint-disable no-console -- 一次性迁移 CLI：KC 身份迁移 */
/**
 * KC 身份迁移：让**有痕迹的路径**也能安全重跑 kc-mapper（新契约），而不打断「痕迹→图节点」的 join。
 *
 * ## 问题（实测 2026-09-23，commit a76cbfac）
 *
 * 重跑 kc-mapper 会产出全新的 KC 名（旧契约产物与 v10 产物实测同名交集≈0），物化时经
 * 概念注册表解析 → 生成**新的 conceptId**；而该路径既有的 `memory_traces.conceptId`
 * 仍指向旧概念 → 重跑后旧概念变成图上孤立的"幽灵节点"（带掌握度但无边），
 * 新 KC 则是零掌握度的新节点。13 条路径 / 118 条痕迹被卡住不能重跑。
 *
 * ## 解法：先登记别名，再重跑
 *
 * `resolveConcept` 走 `concept_aliases` 的 `@@unique([userId, aliasNorm])`。所以只要在重跑**之前**
 * 把**新 KC 名**登记为**旧概念**的别名，重跑物化时 `resolveConcept(新名)` 就会命中旧 conceptId →
 * 痕迹的 conceptId 与新节点重合，掌握度自然接上。
 *
 * ## 为什么匹配必须过 LLM（先证伪了代码匹配）
 *
 * 实测字符二元组 Jaccard：28 个新 KC 里 ≥0.5 的只有 5 个（18%），且**分数与对错不相关**
 * （0.263 是对的、0.188 与 0.583 指向同一个旧 KC，存在碰撞）。代码匹配无法定阈值。
 * 故照本仓既有分工：**LLM 只出可证伪建议，代码执行**（同 ConceptConsolidatorService）。
 *
 * ## 三道护栏（都是"宁可漏配，不可错并"）
 *
 * 1. **一对一**：同一旧 KC 只接受置信度最高的一条新 KC（碰撞按 confidence→分数 裁决）
 * 2. **名字冲突即放弃**：若新名已被解析到**另一个** conceptId，说明这个名字在别处已有主，
 *    登记别名会把两条路径的两个概念永久并成一个 —— 直接跳过并记账
 * 3. **只登记 `confidence=high`**（`--min-confidence=medium` 可放宽，但默认不放）
 *
 * 别名是**用户级**身份变更，但**可回滚**：审计文件记下本次登记的每一条 `aliasRaw`，
 * 回滚 = `conceptRegistryService.removeAliases(userId, aliasRaws)`（只删别名行，不动业务表）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/kc-identity-migrate.ts --scope=traces            # 预演（只调模型，不写）
 *   npx ts-node --transpile-only src/scripts/kc-identity-migrate.ts --path=lp_xxx --apply
 *   npx ts-node --transpile-only src/scripts/kc-identity-migrate.ts --scope=traces --apply --min-confidence=medium
 */
import 'dotenv/config';
import fs from 'node:fs';
import prisma from '../config/database';
import { callPrompt } from '../composers/prompt-composer';
import type { PromptCallSpec } from '../composers/types';
import { conceptRegistryService } from '../services/learner/concept-registry.service';
import { conceptGraphService } from '../services/learner/concept-graph.service';
import { mapAndPersistKcAnnotation, persistKcAnnotationToPath, type KcAnnotation } from '../services/learning/generation/kc-annotation';

// ── 参数 ────────────────────────────────────────────────────────────────
interface Args {
  path: string | null;
  scope: 'traces' | 'all';
  apply: boolean;
  minConfidence: 'high' | 'medium';
  limit: number | null;
  auditFile: string;
  dryAliasOnly: boolean;
}
function parseArgs(): Args {
  const out: Args = {
    path: null, scope: 'traces', apply: false, minConfidence: 'high', limit: null,
    auditFile: 'C:/tmp/kc-identity-migration.json', dryAliasOnly: false,
  };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'path' && v) out.path = v.trim();
    if (k === 'scope' && (v === 'traces' || v === 'all')) out.scope = v;
    if (k === 'apply') out.apply = true;
    if (k === 'min-confidence' && (v === 'high' || v === 'medium')) out.minConfidence = v;
    if (k === 'limit' && v && Number.isFinite(Number(v))) out.limit = Number(v);
    if (k === 'audit-file' && v) out.auditFile = v.trim();
  }
  return out;
}

// ── kcAnnotation 读取 ───────────────────────────────────────────────────
interface OldKc { kcId: string; name: string }

/** kcAnnotation 的最小可读视图（容忍契约演进：字段缺失即视为无） */
interface KcAnnotationLike {
  kcGraph?: { nodes?: Array<{ kcId?: unknown; name?: unknown }> } | null;
  conceptKcs?: Array<{ conceptId?: unknown; kcs?: Array<{ kcId?: unknown; name?: unknown }> }> | null;
}

/** 旧标注里的 KC 明细（kcId → name，优先 kcGraph.nodes，回落 conceptKcs 内嵌） */
function oldKcsOf(ann: KcAnnotationLike | null | undefined): OldKc[] {
  const nameByKcId = new Map<string, string>();
  for (const n of ann?.kcGraph?.nodes || []) nameByKcId.set(String(n.kcId), String(n.name ?? ''));
  const out: OldKc[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(ann?.conceptKcs) ? ann.conceptKcs : []) {
    for (const k of g?.kcs || []) {
      const kcId = String(k?.kcId ?? '');
      const name = String(k?.name ?? nameByKcId.get(kcId) ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ kcId, name });
    }
  }
  return out;
}
function newKcNames(ann: KcAnnotationLike | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kc of oldKcsOf(ann)) {
    if (seen.has(kc.name)) continue;
    seen.add(kc.name);
    out.push(kc.name);
  }
  return out;
}

// ── 匹配（LLM 出建议） ──────────────────────────────────────────────────
const MATCH_SYSTEM = `你是知识组件（KC）身份对齐助手。给你同一批核心概念在**两版契约**下拆出的 KC 名单，
判断"新名单里的每个 KC，是否就是旧名单里的某一个"。

判据：**两者指的是同一个可独立习得的能力单元**（学生学会其中一个，另一个就也会了），
而不是"任务里位置相近"或"字面有共同词"。同一个核心概念下的多个 KC 常常彼此相关但**不是同一个能力**
（如「识别题型特征」与「按特征选方法」是两步不同的能力，不可并成一个）。

严格输出 JSON：
{ "matches": [ { "newKc": "新名单里的名字（逐字复制）", "oldKc": "旧名单里的名字（逐字复制）或 null", "confidence": "high|medium|low", "reason": "一句话依据" } ] }

纪律：
- 新名单里**每个** KC 都要出现一条记录；没有对应旧 KC 的，oldKc 填 null（这是正常结果，不要硬凑）
- 一个旧 KC 最多被匹配一次；若两条新 KC 都像它，只给更像的那条 high，另一条给 null 或 low
- confidence=high 仅当你确信是同一个能力单元；只是"相关/相近/上下位"一律给 low
- 不编造名单里没有的名字`;

interface MatchRow { newKc: string; oldKc: string | null; confidence: string; reason?: string }

/**
 * 匹配建议的调用规格。
 *
 * 用独立 agentId（不是 `skill:kc-mapper`）：这是**另一个提示词**，挂在 kc-mapper 名下会把
 * 该 skill 的 prompt-call 遥测口径搞脏（`systemPromptVersion` 为 null 的调用混进去）。
 * 本仓纪律是业务 LLM 调用一律走 `callPrompt`（`scripts/check-llm-call-boundary.ts` 会拦
 * 直接 `gateway.execute`），故这里用 `defaultSystemPrompt` 走正规入口、不注册 core 文件。
 */
const MATCH_SPEC: PromptCallSpec<MatchInput, MatchRow[]> = {
  agentId: 'skill:kc-identity-matcher',
  defaultSystemPrompt: MATCH_SYSTEM,
  caller: { skillId: 'kc-identity-matcher', action: 'propose-matches' },
  buildUserPayload: (input) => JSON.stringify(input),
  normalizeOutput: (parsed: unknown) => {
    const matches = (parsed as { matches?: unknown } | null)?.matches;
    return Array.isArray(matches) ? (matches as MatchRow[]) : [];
  },
};

interface MatchInput {
  coreConcepts: string[];
  oldKcs: Array<{ name: string; traceCount: number }>;
  newKcs: string[];
}

async function proposeMatches(params: {
  userId: string;
  coreConcepts: Array<{ id?: unknown; name?: unknown }>;
  oldKcs: Array<OldKc & { traceCount: number }>;
  newNames: string[];
}): Promise<MatchRow[]> {
  const payload: MatchInput = {
    coreConcepts: params.coreConcepts.map((c) => String(c?.name ?? '')).filter(Boolean),
    oldKcs: params.oldKcs.map((k) => ({ name: k.name, traceCount: k.traceCount })),
    newKcs: params.newNames,
  };
  const result = await callPrompt(MATCH_SPEC, payload, {
    systemPromptOverride: MATCH_SYSTEM,
    generationOverride: { temperature: 0.1, maxTokens: 4000 },
  });
  if (!result.success || !result.output) {
    throw new Error(`匹配调用失败：${result.error?.message ?? '无输出'}`);
  }
  const rows: MatchRow[] = result.output;
  return rows.filter((r) => r && typeof r.newKc === 'string');
}

/** 决策（纯函数，可测）：LLM 建议 → 实际要登记的别名，带三道护栏 */
export interface AliasDecision {
  /** 允许登记：(新名 → 旧名/旧 conceptId) */
  approved: Array<{ newKc: string; oldKc: string; oldConceptId: string; confidence: string; reason: string }>;
  /** 被护栏拦下的（记账用，不写库） */
  skipped: Array<{ newKc: string; oldKc: string | null; reason: string; confidence?: string }>;
}
export function decideAliases(params: {
  matches: MatchRow[];
  oldConceptIdByName: Map<string, string>;
  /** 新名当前解析到的 conceptId（createIfMissing=false 的探测结果） */
  existingConceptIdByNewName: Map<string, string>;
  minConfidence: 'high' | 'medium';
}): AliasDecision {
  const { matches, oldConceptIdByName, existingConceptIdByNewName, minConfidence } = params;
  const rank: Record<string, number> = { high: 2, medium: 1, low: 0 };
  const minRank = rank[minConfidence];
  const approved: AliasDecision['approved'] = [];
  const skipped: AliasDecision['skipped'] = [];
  const claimedOld = new Set<string>();

  // 先按置信度降序，保证"同一旧 KC 被多条新 KC 争抢"时赢的是置信度更高的那条
  const ordered = matches
    .slice()
    .sort((a, b) => (rank[String(b.confidence)] ?? 0) - (rank[String(a.confidence)] ?? 0));

  for (const row of ordered) {
    const newKc = String(row.newKc || '').trim();
    const oldKc = row.oldKc == null ? null : String(row.oldKc).trim();
    const confidence = String(row.confidence || 'low');
    if (!newKc) continue;
    if ((rank[confidence] ?? 0) < minRank) {
      skipped.push({ newKc, oldKc, confidence, reason: `置信度 ${confidence} 低于门槛 ${minConfidence}` });
      continue;
    }
    if (!oldKc) {
      skipped.push({ newKc, oldKc: null, confidence, reason: '模型判定无对应旧 KC（正常，新 KC 会拿新身份）' });
      continue;
    }
    const oldConceptId = oldConceptIdByName.get(oldKc);
    if (!oldConceptId) {
      skipped.push({ newKc, oldKc, confidence, reason: '旧 KC 名未解析到既有概念（无可继承的身份）' });
      continue;
    }
    if (claimedOld.has(oldConceptId)) {
      skipped.push({ newKc, oldKc, confidence, reason: '该旧概念已被更高置信度的新 KC 认领（一对一护栏）' });
      continue;
    }
    const existing = existingConceptIdByNewName.get(newKc);
    if (existing && existing !== oldConceptId) {
      skipped.push({ newKc, oldKc, confidence, reason: '新名在别处已有概念身份（并会永久合并两个概念）' });
      continue;
    }
    claimedOld.add(oldConceptId);
    approved.push({ newKc, oldKc, oldConceptId, confidence, reason: String(row.reason || '') });
  }
  return { approved, skipped };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
interface AuditEntry {
  pathId: string;
  userId: string;
  title: string | null;
  tracesBefore: number;
  tracesJoinedBefore: number;
  /** 本次登记的别名所继承的旧概念上挂着的痕迹数（迁移的直接收益） */
  tracesCovered: number;
  tracesJoinedAfter: number | null;
  aliases: Array<{ aliasRaw: string; conceptId: string; oldKc: string; confidence: string }>;
  skipped: AliasDecision['skipped'];
  newKcCount: number;
  oldKcCount: number;
}

async function migrateOne(
  path: { id: string; userId: string; title: string | null; aiPromptTemplate: string | null },
  args: Args,
  audit: AuditEntry[],
): Promise<void> {
  const template = JSON.parse(path.aiPromptTemplate || '{}');
  const oldKcs = oldKcsOf(template?.kcAnnotation);

  // ① 旧 KC 的既有身份 + 痕迹分布
  const traceRows = await prisma.memory_traces.findMany({
    where: { userId: path.userId, pathId: path.id },
    select: { conceptId: true, conceptKey: true },
  });
  const traceCountByConceptId = new Map<string, number>();
  for (const t of traceRows) {
    if (!t.conceptId) continue;
    traceCountByConceptId.set(t.conceptId, (traceCountByConceptId.get(t.conceptId) ?? 0) + 1);
  }

  const oldConceptIdByName = new Map<string, string>();
  for (const kc of oldKcs) {
    const resolved = await conceptRegistryService.resolveConcept(path.userId, kc.name, { createIfMissing: false });
    if (resolved) oldConceptIdByName.set(kc.name, resolved.conceptId);
  }

  // ② 新标注（dry：只取模型输出）
  const milestones = await prisma.milestones.findMany({
    where: { learningPathId: path.id }, orderBy: { order: 'asc' },
    select: { stageNumber: true, title: true, coreConceptName: true, description: true, goal: true },
  });
  const subtasks = await prisma.subtasks.findMany({
    where: { milestones: { learningPathId: path.id } }, orderBy: { order: 'asc' },
    select: { title: true, taskType: true, linkedConceptName: true, knowledgeType: true, cognitiveLevel: true },
  });

  let captured: KcAnnotation | null = null;
  // 只跑一次模型：拿到输出后**同一份**标注既用于登记别名、又用于落库。
  // （kc-mapper 是 temperature 0.3，重跑名字会变；别名必须与落库标注同源。）
  await mapAndPersistKcAnnotation({
    pathId: path.id,
    userId: path.userId,
    template,
    milestones: milestones.map((m) => ({
      stageNumber: m.stageNumber ?? 0, title: m.title,
      coreConcept: m.coreConceptName, description: m.description, goal: m.goal,
    })),
    subtasks: subtasks.map((t) => ({
      title: t.title, type: t.taskType ?? undefined,
      linkedConcept: t.linkedConceptName, knowledgeType: t.knowledgeType, cognitiveLevel: t.cognitiveLevel,
    })),
    // dry：拦住落库与物化，只取模型输出
    persist: async (_id: string, ann: KcAnnotation) => { captured = ann; },
    materialize: async () => ({ prerequisite: 0, partOf: 0, prerequisiteConcept: 0, nodes: 0, skipped: true } as never),
  });

  const newAnnotation = captured as KcAnnotation | null;
  const newNames = newKcNames(newAnnotation);
  if (!newAnnotation || newNames.length === 0) {
    console.log(`\n${path.id}  ${String(path.title ?? '').slice(0, 24)}`);
    console.log('  ⏭ 新标注为空（模型未产出），跳过');
    return;
  }

  // ③ 匹配建议
  const matches = await proposeMatches({
    userId: path.userId,
    coreConcepts: template?.cognitiveCore?.coreConcepts ?? [],
    oldKcs: oldKcs.map((k) => ({ ...k, traceCount: traceCountByConceptId.get(oldConceptIdByName.get(k.name) ?? '') ?? 0 })),
    newNames,
  });

  // ④ 护栏决策
  const existingConceptIdByNewName = new Map<string, string>();
  for (const name of newNames) {
    const resolved = await conceptRegistryService.resolveConcept(path.userId, name, { createIfMissing: false });
    if (resolved) existingConceptIdByNewName.set(name, resolved.conceptId);
  }
  const decision = decideAliases({
    matches, oldConceptIdByName, existingConceptIdByNewName, minConfidence: args.minConfidence,
  });

  const tracesJoinedBefore = traceRows.filter((t) => t.conceptId && oldConceptIdByName.size > 0
    && [...oldConceptIdByName.values()].includes(t.conceptId)).length;
  // 本次真正能接上的痕迹：痕迹指向的 conceptId 正好是被登记别名所继承的那个旧概念。
  // 这是迁移**唯一的收益指标**——匹配全落在零痕迹的 KC 上时，收益为 0（实测常见）。
  const approvedTargets = new Set(decision.approved.map((a) => a.oldConceptId));
  const tracesCovered = traceRows.filter((t) => t.conceptId && approvedTargets.has(t.conceptId)).length;

  console.log(`\n${path.id}  ${String(path.title ?? '').slice(0, 24)}`);
  console.log(`  旧 KC ${oldKcs.length}（已解析身份 ${oldConceptIdByName.size}）｜新 KC ${newNames.length}｜本路径痕迹 ${traceRows.length}`);
  console.log(`  建议登记别名 ${decision.approved.length} 条：`);
  for (const a of decision.approved) {
    const hits = traceCountByConceptId.get(a.oldConceptId) ?? 0;
    console.log(`    [${a.confidence}] 「${a.newKc}」 → 旧「${a.oldKc}」(痕迹 ${hits})  ${a.reason.slice(0, 50)}`);
  }
  if (decision.skipped.length) {
    console.log(`  未登记 ${decision.skipped.length} 条（前 6）：`);
    for (const s of decision.skipped.slice(0, 6)) {
      console.log(`    · 「${s.newKc}」 ← 旧「${s.oldKc ?? '—'}」：${s.reason}`);
    }
  }
  console.log(`  收益：本次别名覆盖痕迹 ${tracesCovered}/${traceRows.length}（基线已落图 ${tracesJoinedBefore}/${traceRows.length}）`);

  const entry: AuditEntry = {
    pathId: path.id, userId: path.userId, title: path.title,
    tracesBefore: traceRows.length, tracesJoinedBefore, tracesCovered, tracesJoinedAfter: null,
    aliases: decision.approved.map((a) => ({
      aliasRaw: a.newKc, conceptId: a.oldConceptId, oldKc: a.oldKc, confidence: a.confidence,
    })),
    skipped: decision.skipped, newKcCount: newNames.length, oldKcCount: oldKcs.length,
  };

  if (!args.apply) {
    console.log('  DRY-RUN：未登记别名、未落库、未物化');
    audit.push(entry);
    return;
  }

  // ⑤ 登记别名（先于物化）
  let registered = 0;
  for (const a of decision.approved) {
    const r = await conceptRegistryService.registerAlias({
      userId: path.userId, conceptId: a.oldConceptId, aliasRaw: a.newKc,
      source: 'backfill', confidence: a.confidence === 'high' ? 0.9 : 0.7,
    });
    if (r.registered) registered += 1;
  }

  // ⑥ 路径内清边 → 落库**已捕获的同一份标注** → 重物化
  // （不重跑模型：kc-mapper 是 temperature 0.3，重跑名字会变，别名就指向一批不存在的名字）
  const staleEdges = await prisma.concept_edges.count({ where: { userId: path.userId, pathId: path.id } });
  if (staleEdges > 0) {
    await prisma.concept_edges.deleteMany({ where: { userId: path.userId, pathId: path.id } });
  }
  await persistKcAnnotationToPath(path.id, newAnnotation);
  await conceptGraphService.materializePathGraph({
    userId: path.userId, pathId: path.id, kcAnnotation: newAnnotation,
    cognitiveCore: template?.cognitiveCore ?? template?.cognitiveDesign ?? null,
  });

  // ⑦ 复验：痕迹的 conceptId 是否仍落在该路径图节点集里
  const view = await conceptGraphService.buildGraphView(path.userId, { pathId: path.id });
  const nodeIds = new Set(view.nodes.map((n) => n.id));
  entry.tracesJoinedAfter = traceRows.filter((t) => t.conceptId && nodeIds.has(t.conceptId)).length;

  console.log(`  已登记别名 ${registered} 条｜清旧边 ${staleEdges} 条｜图节点 ${view.meta.nodeCount} 边 ${view.meta.edgeCount}`);
  console.log(`  痕迹落图：${entry.tracesJoinedBefore}/${traceRows.length} → ${entry.tracesJoinedAfter}/${traceRows.length}`);
  audit.push(entry);
}

async function main() {
  const args = parseArgs();
  console.log(`模式=${args.apply ? 'APPLY（登记别名+落库+物化）' : 'DRY-RUN（只调模型）'}  置信度门槛=${args.minConfidence}`);

  let paths = await prisma.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' }, ...(args.path ? { id: args.path } : {}) },
    select: { id: true, userId: true, title: true, aiPromptTemplate: true },
    orderBy: { updatedAt: 'desc' },
  });
  paths = paths.filter((p) => {
    try { return !!JSON.parse(p.aiPromptTemplate || '{}')?.kcAnnotation; } catch { return false; }
  });

  const withTraces: typeof paths = [];
  const without: typeof paths = [];
  for (const p of paths) {
    const n = await prisma.memory_traces.count({ where: { userId: p.userId, pathId: p.id } });
    (n > 0 ? withTraces : without).push(p);
  }
  console.log(`候选 ${paths.length} 条：有痕迹 ${withTraces.length}，无痕迹 ${without.length}`);
  let runList = args.scope === 'all' ? [...withTraces, ...without] : withTraces;
  if (args.limit) runList = runList.slice(0, args.limit);
  if (runList.length === 0) { console.log('没有可跑的路径。'); return; }

  const audit: AuditEntry[] = [];
  for (const p of runList) {
    try {
      await migrateOne(p, args, audit);
    } catch (error) {
      console.error(`\n${p.id}  ❌ 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (args.apply) {
    fs.writeFileSync(args.auditFile, JSON.stringify({
      schemaVersion: 'kc-identity-migration-audit-v1',
      generatedAt: new Date().toISOString(),
      minConfidence: args.minConfidence,
      note: '回滚 = conceptRegistryService.removeAliases(userId, aliases[].aliasRaw)（只删别名行，不动业务表）',
      entries: audit,
    }, null, 2));
    console.log(`\n审计已写：${args.auditFile}`);
  }

  const totalAliases = audit.reduce((s, e) => s + e.aliases.length, 0);
  const totalCovered = audit.reduce((s, e) => s + e.tracesCovered, 0);
  const before = audit.reduce((s, e) => s + e.tracesJoinedBefore, 0);
  const after = audit.reduce((s, e) => s + (e.tracesJoinedAfter ?? 0), 0);
  const traces = audit.reduce((s, e) => s + e.tracesBefore, 0);
  console.log(`\n合计 ${audit.length} 条路径｜登记别名 ${totalAliases} 条｜别名覆盖痕迹 ${totalCovered}/${traces}｜痕迹落图 ${before}/${traces}${args.apply ? ` → ${after}/${traces}` : ''}`);
  console.log(args.apply ? '' : ' 加 --apply 才写库。');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
