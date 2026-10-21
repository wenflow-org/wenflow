/**
 * 资料注入 rerank 闸门：用交叉编码器（bge-reranker-v2-m3）给「(学习目标, 资料)」打分，
 * 把分数低于阈值的资料挡在路径注入之外。
 *
 * 为什么是 rerank 而不是别的（2026-10-21 离线评测，262 对真实注入样本：
 * doc/local/RESOURCE-LIBRARY-OPT-2026-10-20/EMBEDDING-DECISION-EVAL.md）：
 *   - 词面 4 字片段闸门误杀 16.3%，被否决（只留日志）；
 *   - bge-m3 余弦误杀=0 时拦截为 0，不能做门；
 *   - bge-reranker-v2-m3 误杀≤2% 时拦截 57.1%、误杀=0 时拦截 20%，且按目标一次调用
 *     可批量判整组资料、零解析失败、无提示词敏感性（网关 Qwen3-Reranker 排序更高但
 *     分数双极不可标定，故不用）；
 *   - DS 提示词门拦截更高（71.4%）但本阶段不引入 LLM 调用，留待后续。
 *
 * 阈值缺省 0.29 = 评测「误杀≤2%」工作点（true cited 误杀 4/227=1.8%，拦 20/35）。
 * 硬性原则：fail-open——没配/超时/报错一律放行，闸门永远不能挡住路径生成。
 */
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import type { MaterialRecord } from './material-store';
import { materialSelectionText } from './material-selection.service';

const RERANK_TEXT_MAX_CHARS = 1200;
const SCORE_CACHE_TTL_MS = 10 * 60 * 1000;
const SCORE_CACHE_MAX_ENTRIES = 500;

export type MaterialRerankGateReason =
  | 'applied'
  | 'disabled'
  | 'not-configured'
  | 'insufficient'
  | 'error';

export interface MaterialRerankGateOptions {
  /** 学习目标 / 查询文本。 */
  query: string;
  /** 待判定的资料（selectMaterials 的 selected）。 */
  records: MaterialRecord[];
  /** 阈值覆写；缺省 MATERIAL_RERANK_GATE_MIN_SCORE（0.29）。 */
  threshold?: number;
  /** 单次 rerank 请求超时；缺省 MATERIAL_RERANK_GATE_TIMEOUT_MS（6s）。 */
  timeoutMs?: number;
  /** 测试注入；缺省 global fetch。 */
  fetchImpl?: typeof fetch;
}

export interface MaterialRerankGateResult {
  kept: MaterialRecord[];
  dropped: MaterialRecord[];
  applied: boolean;
  reason: MaterialRerankGateReason;
  /** materialId → 分数（applied 或成功打分时才有值）。 */
  scores: Record<string, number>;
  threshold: number;
}

function readGateThreshold(): number {
  const raw = Number(process.env.MATERIAL_RERANK_GATE_MIN_SCORE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.29;
}

function isDisabled(): boolean {
  return process.env.MATERIAL_RERANK_GATE_DISABLED === '1';
}

function rerankEndpoint(): { url: string; key: string; model: string } | null {
  const url = (process.env.RERANK_API_URL || '').trim();
  const key = (process.env.RERANK_API_KEY || process.env.EMBEDDING_API_KEY || '').trim();
  const model = (process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3').trim();
  if (!url || !key) return null;
  return { url, key, model };
}

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/** (query, 资料内容) → 分数缓存：goal 来回重打同一目标时省调用。 */
const scoreCache = new Map<string, { score: number; expiresAt: number }>();

function cacheKey(query: string, record: MaterialRecord): string {
  return `${sha1(String(query || ''))}:${record.contentHash || record.id}`;
}

function readScoreCache(query: string, record: MaterialRecord): number | null {
  const hit = scoreCache.get(cacheKey(query, record));
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    scoreCache.delete(cacheKey(query, record));
    return null;
  }
  return hit.score;
}

function writeScoreCache(query: string, record: MaterialRecord, score: number): void {
  if (scoreCache.size >= SCORE_CACHE_MAX_ENTRIES) {
    const oldest = scoreCache.keys().next().value;
    if (oldest) scoreCache.delete(oldest);
  }
  scoreCache.set(cacheKey(query, record), { score, expiresAt: Date.now() + SCORE_CACHE_TTL_MS });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 给一组资料打分；返回 materialId → score。任何失败抛错（由闸门转 fail-open）。 */
async function rerankScores(
  query: string,
  records: MaterialRecord[],
  options: MaterialRerankGateOptions
): Promise<Record<string, number>> {
  const endpoint = rerankEndpoint();
  if (!endpoint) throw new Error('RERANK_API_URL/KEY 未配置');
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? (Number(process.env.MATERIAL_RERANK_GATE_TIMEOUT_MS) || 6_000);

  const pending = records.filter((record) => readScoreCache(query, record) === null);
  let batch: Record<string, number> = {};
  if (pending.length > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${endpoint.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.model,
          query: truncate(String(query || ''), 500),
          documents: pending.map((record) => truncate(materialSelectionText(record), RERANK_TEXT_MAX_CHARS)),
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`rerank HTTP ${response.status}: ${text.slice(0, 160)}`);
      const parsed = JSON.parse(text) as { results?: Array<{ index?: number; relevance_score?: number }> };
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      batch = {};
      results.forEach((item) => {
        const record = pending[item.index as number];
        if (!record || typeof item.relevance_score !== 'number' || !Number.isFinite(item.relevance_score)) return;
        batch[record.id] = item.relevance_score;
      });
      if (Object.keys(batch).length === 0) throw new Error('rerank 响应无有效 results');
      for (const record of pending) {
        if (typeof batch[record.id] === 'number') writeScoreCache(query, record, batch[record.id]);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const scores: Record<string, number> = {};
  for (const record of records) {
    const cached = readScoreCache(query, record);
    if (cached !== null) scores[record.id] = cached;
  }
  return scores;
}

/**
 * 注入闸门。返回 kept/dropped；applied=false 时 kept===传入 records（fail-open）。
 * 打分部分成功也照常应用（有分数的按阈值，没分数的放行——宁漏勿杀）。
 */
export async function applyMaterialRerankGate(
  options: MaterialRerankGateOptions
): Promise<MaterialRerankGateResult> {
  const records = options.records || [];
  const empty = (reason: MaterialRerankGateReason): MaterialRerankGateResult => ({
    kept: records,
    dropped: [],
    applied: false,
    reason,
    scores: {},
    threshold: readGateThreshold(),
  });
  if (isDisabled()) return empty('disabled');
  if (!rerankEndpoint()) return empty('not-configured');
  if (records.length <= 1 || !String(options.query || '').trim()) return empty('insufficient');

  const threshold = options.threshold ?? readGateThreshold();
  let scores: Record<string, number>;
  try {
    scores = await rerankScores(options.query, records, options);
  } catch (error) {
    logger.warn('[material-rerank] 注入闸门打分失败，放行（fail-open）', {
      error: error instanceof Error ? error.message : String(error),
      count: records.length,
    });
    return { ...empty('error'), threshold };
  }

  const kept: MaterialRecord[] = [];
  const dropped: MaterialRecord[] = [];
  for (const record of records) {
    const score = scores[record.id];
    if (typeof score !== 'number') {
      kept.push(record);
      continue;
    }
    if (score >= threshold) kept.push(record);
    else dropped.push(record);
  }
  logger.info('[material-rerank] 注入闸门', {
    threshold,
    total: records.length,
    kept: kept.map((record) => record.name),
    dropped: dropped.map((record) => ({ name: record.name, score: Number(scores[record.id]?.toFixed(4)) })),
    scoredCount: Object.keys(scores).length,
  });
  return { kept, dropped, applied: true, reason: 'applied', scores, threshold };
}

/** 测试用：清空进程内分数缓存。 */
export function __clearMaterialRerankCacheForTests(): void {
  scoreCache.clear();
}
