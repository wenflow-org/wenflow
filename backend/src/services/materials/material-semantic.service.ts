/**
 * 资料**语义层**（外挂能力 embedding/rerank 在业务里的落地点）。
 *
 * 分工：
 *   - 本模块只做「**召回与排序**」——绝不做合并/裁决（裁决仍走 material-refs 的逐字核对）。
 *   - 结构化取回（material-sections.extractSectionWindow）仍是主路径；本模块是它的
 *     **语义补充**：标题/引文都没命中时（anchor='none'）用它兜底，以及给超长资料做代表采样。
 *
 * 三条不变量：
 *   ① **fail-open**：未配置 / 超时 / 上游故障一律返回空或 null，绝不阻塞资料读路径与教学回合；
 *   ② **不编造**：召回的永远是资料里的**原文块**（chunker 切出来的正文），不是生成的；
 *   ③ **可回退**：`MATERIAL_SEMANTIC_DISABLED=1` 一键退回纯结构化取回（灰度回滚）。
 *
 * 成本：向量索引**惰性建、落侧车、按正文哈希失效**（同一份资料只嵌入一次）；
 * 召回只在有查询词时发生（无查询=零调用）。
 */

import { logger } from '../../utils/logger';
import {
  embedTexts,
  rerankDocuments,
  cosineSimilarity,
  resolveEmbeddingModelId,
} from '../embedding';
import { chunkEmbedText, chunkMaterialMarkdown } from './material-chunker';
import { listMaterials, readMaterial, type MaterialRecord } from './material-store';
import {
  hashMaterialMarkdown,
  isVectorIndexFresh,
  readVectorIndex,
  writeVectorIndex,
  type MaterialVectorIndex,
} from './material-vector-store';

/** 召回默认最多考察几份资料（防一次查询把整个库都嵌入）。 */
export const MAX_RECALL_MATERIALS = 8;
/** 召回默认返回条数。 */
export const DEFAULT_RECALL_TOP_K = 6;
/**
 * 代表采样里**头部片段**占预算的比例（默认 40%）。
 * 依据（2026-10-17 真机 A/B）：纯语义采样会把目录型开头当同质块丢掉，而 brief 要产出 toc/结构；
 * 留一段原文开头既保结构，又给「文档类型/主题/适用对象」提供最直接的证据。
 */
export const DEFAULT_SAMPLING_HEAD_RATIO = 0.4;
/** 单次语义调用的超时（毫秒）——到点按无结果处理。 */
export const DEFAULT_SEMANTIC_TIMEOUT_MS = 12_000;

/** 语义层总开关（默认开；`MATERIAL_SEMANTIC_DISABLED=1` 关闭 → 全站退回纯结构化取回）。 */
export function isMaterialSemanticEnabled(): boolean {
  return process.env.MATERIAL_SEMANTIC_DISABLED !== '1';
}

export interface RecallHit {
  materialId: string;
  materialName: string;
  chunkId: string;
  title: string;
  text: string;
  /** 余弦相似度（0-1 区间，越高越相关）——rerank 后仍保留原始余弦便于观测。 */
  score: number;
  /** rerank 命中时附带的排序分（尺度由模型定，仅可比较）。 */
  rerankScore?: number;
}

/** 给 promise 加超时；超时/异常都收敛成 fallback（默认 null）。 */
async function withTimeout<T>(task: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const gate = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([task, gate]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 为一份资料构建向量索引（纯函数式建索引，不落盘）。
 * 空正文 / 无可切块 → null。嵌入返回条数与块数不符 → 抛（上游异常，由调用方 fail-open）。
 */
export async function buildMaterialVectorIndex(
  markdown: string,
  options: { maxChunks?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<MaterialVectorIndex | null> {
  const chunks = chunkMaterialMarkdown(markdown, { maxChunks: options.maxChunks });
  if (chunks.length === 0) return null;

  const embedded = await embedTexts(
    { input: chunks.map(chunkEmbedText) },
    { timeoutMs: options.timeoutMs, signal: options.signal }
  );
  if (embedded.vectors.length !== chunks.length) {
    throw new Error(`向量条数与块数不符（${embedded.vectors.length} vs ${chunks.length}）`);
  }

  const byIndex = new Map(embedded.vectors.map((v) => [v.index, v.embedding]));
  return {
    version: 1,
    model: embedded.model || resolveEmbeddingModelId(),
    dimensions: embedded.dimensions,
    builtAt: new Date().toISOString(),
    sourceHash: hashMaterialMarkdown(markdown),
    chunks: chunks.map((chunk, i) => ({ ...chunk, vector: byIndex.get(i) ?? [] })),
  };
}

/**
 * 取（必要时建）某资料的向量索引：命中且新鲜直接返回，否则嵌入 + 落侧车。
 * 未启用 / 空正文 / 任何异常 → null（fail-open）。
 */
export async function ensureMaterialVectorIndex(
  record: MaterialRecord,
  markdown: string,
  options: { force?: boolean; timeoutMs?: number; signal?: AbortSignal; persist?: boolean } = {}
): Promise<MaterialVectorIndex | null> {
  if (!isMaterialSemanticEnabled()) return null;
  if (!String(markdown || '').trim()) return null;
  const model = resolveEmbeddingModelId();

  if (!options.force) {
    const cached = readVectorIndex(record.userId, record.id);
    if (isVectorIndexFresh(cached, markdown, model)) return cached;
  }

  try {
    const index = await buildMaterialVectorIndex(markdown, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (!index) return null;
    if (options.persist !== false) writeVectorIndex(record.userId, record.id, index);
    return index;
  } catch (error) {
    logger.warn('[material-semantic] 建索引失败（fail-open）', {
      userId: record.userId,
      materialId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 后台预热：不 await，失败静默。写路径（上传/入库）调用，让首次检索无需等嵌入。 */
export function warmMaterialVectorIndex(record: MaterialRecord, markdown: string): void {
  if (!isMaterialSemanticEnabled()) return;
  void ensureMaterialVectorIndex(record, markdown).catch(() => undefined);
}

/**
 * 语义召回：在指定（或该用户最近的若干）资料里，按查询词召回最相关的原文块。
 * 可选 rerank 精排（用相关性跨块可比的重排分替换纯余弦序）。
 * 未启用 / 无查询 / 无候选 / 任何异常 → []（fail-open）。
 */
export async function recallMaterialChunks(params: {
  userId: string;
  query: string;
  materialIds?: string[] | null;
  topK?: number;
  rerank?: boolean;
  timeoutMs?: number;
  /** 覆盖候选资料集（测试注入 / 调用方已持有记录时省一次 listMaterials） */
  records?: MaterialRecord[];
}): Promise<RecallHit[]> {
  if (!isMaterialSemanticEnabled()) return [];
  const query = String(params.query || '').trim();
  if (!query) return [];
  const topK = Math.max(1, params.topK ?? DEFAULT_RECALL_TOP_K);
  const timeoutMs = params.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS;

  try {
    return await withTimeout(
      (async (): Promise<RecallHit[]> => {
        const records = params.records
          ? params.records
          : selectRecords(params.userId, params.materialIds);

        // 没有候选资料就直接返回 —— 必须在嵌入查询词**之前**（2026-10-17 真机发现）：
        // 零资料账号（如无附件的目标型学员）每回合都会走到这里，先嵌入再空转等于白烧一次往返；
        // 实测一个零资料人设的一节课里出现了 19 次 hits:0 的空转召回。
        if (records.length === 0) return [];

        // 嵌入查询词（一次）；块向量走各自侧车索引
        const queryEmbedded = await embedTexts({ input: query }, { timeoutMs });
        const queryVec = queryEmbedded.vectors[0]?.embedding;
        if (!queryVec || queryVec.length === 0) return [];

        const scored: RecallHit[] = [];
        for (const record of records) {
          const found = readMaterial(record.userId, record.id);
          if (!found) continue;
          const index = await ensureMaterialVectorIndex(found.record, found.markdown, { timeoutMs });
          if (!index) continue;
          for (const chunk of index.chunks) {
            if (!chunk.vector || chunk.vector.length !== queryVec.length) continue;
            const score = cosineSimilarity(queryVec, chunk.vector);
            scored.push({
              materialId: record.id,
              materialName: found.record.name,
              chunkId: chunk.id,
              title: chunk.title,
              text: chunk.text,
              score,
            });
          }
        }

        scored.sort((a, b) => b.score - a.score);
        let hits = scored.slice(0, Math.max(topK, params.rerank ? Math.min(topK * 3, 30) : topK));

        if (params.rerank && hits.length > 1) {
          hits = await applyRerank(query, hits, topK);
        } else {
          hits = hits.slice(0, topK);
        }
        return hits;
      })(),
      timeoutMs,
      []
    );
  } catch (error) {
    logger.warn('[material-semantic] 召回失败（fail-open）', {
      userId: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** rerank 精排：命中失败退回原余弦序（不因精排故障丢掉召回结果）。 */
async function applyRerank(query: string, hits: RecallHit[], topK: number): Promise<RecallHit[]> {
  try {
    const reranked = await rerankDocuments({ query, documents: hits.map((h) => h.text) });
    const out: RecallHit[] = [];
    for (const item of reranked.results) {
      const hit = hits[item.index];
      if (!hit) continue;
      out.push({ ...hit, rerankScore: item.relevanceScore });
    }
    return out.slice(0, topK);
  } catch (error) {
    logger.warn('[material-semantic] 重排失败，退回余弦序（fail-open）', {
      error: error instanceof Error ? error.message : String(error),
    });
    return hits.slice(0, topK);
  }
}

function selectRecords(userId: string, materialIds?: string[] | null): MaterialRecord[] {
  let records: MaterialRecord[] = [];
  try {
    records = listMaterials(userId);
  } catch {
    return [];
  }
  if (materialIds && materialIds.length) {
    const wanted = new Set(materialIds);
    return records.filter((r) => wanted.has(r.id));
  }
  return records.slice(0, MAX_RECALL_MATERIALS);
}

/**
 * 超长资料的**代表采样**：头部保结构 + 语义补正文。
 *
 * 两段拼成（2026-10-17 真机 A/B 后的修正）：
 *   ① **头部片段**（默认占预算 40%）——原文开头，保留文档自己的目录/前言/体例。
 *      A/B 实测：纯语义采样会把目录型开头判为"同质块"而丢掉，而 brief 恰恰要产出 toc/结构；
 *      头部截断臂正是靠这部分拿到大量小节名。
 *   ② **语义代表片段**（余下预算）——从头部之后的内容里做 MMR 多样性选择，
 *      保证够到文档后半的正文（头部截断在结构上不可能够到）。
 * 两臂各取所长：结构来自头部、正文覆盖来自语义。
 *
 * 未启用 / 嵌入失败 / 预算够用 → null 让调用方回退原来的纯截断策略。
 * `headRatio: 0` 退化为纯语义采样（A/B 的对照臂）。
 */
export async function selectRepresentativeText(
  record: MaterialRecord,
  markdown: string,
  budgetChars: number,
  options: {
    maxChunks?: number;
    timeoutMs?: number;
    lambda?: number;
    headRatio?: number;
    /** 调用方已建好索引时复用（A/B 探针/预热路径），避免重复嵌入。 */
    index?: MaterialVectorIndex;
  } = {}
): Promise<string | null> {
  if (!isMaterialSemanticEnabled()) return null;
  const text = String(markdown || '');
  if (!text.trim()) return null;
  if (text.length <= budgetChars) return text;

  const chunks = chunkMaterialMarkdown(text, { maxChunks: options.maxChunks ?? 400 });
  if (chunks.length <= 1) return null;

  let index: MaterialVectorIndex | null;
  try {
    index = options.index ?? (await ensureMaterialVectorIndex(record, text, { timeoutMs: options.timeoutMs }));
  } catch {
    index = null;
  }
  if (!index || index.chunks.length <= 1) return null;

  const headRatio = Math.max(0, Math.min(options.headRatio ?? DEFAULT_SAMPLING_HEAD_RATIO, 0.9));
  const headChars = Math.floor(budgetChars * headRatio);
  const head = headChars > 0 ? text.slice(0, headChars) : '';
  const headFlat = head.replace(/\s+/g, '');

  // 头部已覆盖的块不重复占预算（只比开头 60 字，避免"头部被切一半的块"重复计入）
  const candidates = headChars > 0
    ? index.chunks.filter((chunk) => !headFlat.includes(chunk.text.replace(/\s+/g, '').slice(0, 60)))
    : index.chunks;
  const picked = selectDiverseChunks(candidates, Math.max(200, budgetChars - head.length), options.lambda ?? 0.7);
  if (!picked.length && !head) return null;
  // 按原文顺序输出（拼回来读得通）
  picked.sort((a, b) => a.index - b.index);

  const parts: string[] = [];
  if (head) parts.push(`【文档开头 ${head.length} 字】\n${head}`);
  if (picked.length) {
    parts.push(
      `【代表节选：全文 ${text.length} 字，取与原文档多个主题最相关的 ${picked.length} 段】\n` +
        picked.map((chunk) => chunk.text).join('\n\n…\n\n')
    );
  }
  return parts.join('\n\n');
}

/**
 * MMR 式多样性选择：先取离质心最近的块，再迭代取「与质心相关 − 与已选相似」最大的块，
 * 直到塞满预算。返回按选择顺序的块（调用方通常再按 index 排回原文顺序）。
 */
export function selectDiverseChunks(
  chunks: MaterialVectorIndex['chunks'],
  budgetChars: number,
  lambda: number
): MaterialVectorIndex['chunks'] {
  const usable = chunks.filter((c) => Array.isArray(c.vector) && c.vector.length > 0);
  if (usable.length === 0) return [];

  // 质心（逐维均值）
  const dims = usable[0].vector.length;
  const centroid = new Array(dims).fill(0);
  for (const chunk of usable) {
    for (let i = 0; i < dims; i += 1) centroid[i] += chunk.vector[i] ?? 0;
  }
  for (let i = 0; i < dims; i += 1) centroid[i] /= usable.length;

  const relToCentroid = new Map<string, number>();
  for (const chunk of usable) {
    relToCentroid.set(chunk.id, safeCosine(centroid, chunk.vector));
  }

  const picked: MaterialVectorIndex['chunks'] = [];
  const remaining = new Set(usable.map((c) => c.id));
  let used = 0;

  while (remaining.size > 0 && used < budgetChars) {
    let best: MaterialVectorIndex['chunks'][number] | null = null;
    let bestScore = -Infinity;
    for (const chunk of usable) {
      if (!remaining.has(chunk.id)) continue;
      const relevance = relToCentroid.get(chunk.id) ?? 0;
      let maxSim = 0;
      for (const chosen of picked) {
        const sim = safeCosine(chosen.vector, chunk.vector);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        best = chunk;
      }
    }
    if (!best) break;
    // 预算够不够放这块：放不下就跳过它继续找更短的（避免直接收尾留下空洞）
    if (used + best.charCount > budgetChars && picked.length > 0) {
      remaining.delete(best.id);
      continue;
    }
    picked.push(best);
    remaining.delete(best.id);
    used += best.charCount;
  }
  return picked;
}

function safeCosine(a: readonly number[], b: readonly number[]): number {
  try {
    return cosineSimilarity(a, b);
  } catch {
    return 0;
  }
}

/**
 * **按文档位置分层**选择块（2026-10-17，path 资料包 A/B 结论）。
 *
 * 与 MMR 的区别：MMR 优化「全局去冗余」，对线性文档会系统性欠采样某些区段；
 * path 资料包要的是「每一章都看见」。这里把全文按块序号等分成 `count` 段，
 * 每段取最接近全文质心的一块——覆盖与代表性兼得。返回按原文顺序。
 */
export function selectStratifiedChunks(
  chunks: MaterialVectorIndex['chunks'],
  count: number
): MaterialVectorIndex['chunks'] {
  const usable = chunks.filter((c) => Array.isArray(c.vector) && c.vector.length > 0);
  if (usable.length === 0) return [];
  const ordered = [...usable].sort((a, b) => a.index - b.index);

  const dims = ordered[0].vector.length;
  const centroid = new Array(dims).fill(0);
  for (const chunk of ordered) for (let i = 0; i < dims; i += 1) centroid[i] += chunk.vector[i] ?? 0;
  for (let i = 0; i < dims; i += 1) centroid[i] /= ordered.length;

  const buckets = Math.min(Math.max(1, Math.floor(count) || 1), ordered.length);
  const picked: MaterialVectorIndex['chunks'] = [];
  for (let b = 0; b < buckets; b += 1) {
    const from = Math.floor((b * ordered.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * ordered.length) / buckets));
    let best = ordered[from];
    let bestScore = -Infinity;
    for (let i = from; i < to && i < ordered.length; i += 1) {
      const score = safeCosine(centroid, ordered[i].vector);
      if (score > bestScore) {
        bestScore = score;
        best = ordered[i];
      }
    }
    if (best) picked.push(best);
  }
  return picked;
}
