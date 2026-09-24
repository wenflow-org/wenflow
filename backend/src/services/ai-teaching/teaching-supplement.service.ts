/**
 * 教师补充槽（活的 path 批次 E，2026-09-25）：课中发现主线资料没覆盖、学生明确需要
 * 外部信息时，教师输出 `control.supplement` 请求；编排层：
 *   ① 本轮 commit 把槽位写进 sessionArtifacts（status='requested'，与回合同事务，零竞争）；
 *   ② 后台任务 search→fetch→ingestWebMaterial（资料入库是跨进程的持久产物）；
 *   ③ 下一回合开始时查库晋升：命中 → 取章节窗口（≤1200 字）注入本轮 scenario 与消息
 *      结果（前端卡片），槽位置 'delivered'；连续数轮未命中 → 'expired'（fail-open）。
 *
 * 纪律（prompt 侧约束）：每 session 至多 1 次请求；仅主线资料未覆盖时用。
 */
import { logger } from '../../utils/logger';
import { searchWeb } from '../search';
import { fetchWeb } from '../fetch';
import { findWebRecordByTitle, ingestWebMaterial } from '../materials/material-web-ingest.service';
import { extractSectionWindow } from '../materials/material-sections';
import { readMaterial } from '../materials/material-store';

/** 补充窗口上限（课堂上下文预算紧，正文截 1200 字）。 */
export const SUPPLEMENT_EXCERPT_CHARS = 1200;
/** requested 后最多等几个回合（超时置 expired）。 */
export const SUPPLEMENT_MAX_WAIT_TURNS = 3;

/** sessionArtifacts.supplement 槽位形状（跨回合持久）。 */
export interface SupplementSlot {
  status: 'requested' | 'delivered' | 'expired';
  topic: string;
  query: string;
  requestedAt: string;
  requestedTurn?: number;
  deliveredTurn?: number;
  /** delivered 时附带：库记录与窗口 */
  materialId?: string;
  materialTitle?: string;
  sourceUrl?: string | null;
}

/** 采集结果（后台任务内部用）。 */
export interface SupplementFetchOutcome {
  ok: boolean;
  materialId?: string;
  sourceUrl?: string | null;
  error?: string;
}

export interface SupplementDeps {
  searchWeb: typeof searchWeb;
  fetchWeb: typeof fetchWeb;
  ingestWebMaterial: typeof ingestWebMaterial;
  findWebRecordByTitle: typeof findWebRecordByTitle;
}

/**
 * 后台腿：search → 选首条可用源 → fetch → 入库（全文，走批次 A 管线）。
 * 永不抛错；返回 ok=false 时调用方只记日志——槽位靠回合开始时的查库兜底晋升。
 */
export async function fetchSupplementMaterial(
  userId: string,
  topic: string,
  query: string,
  deps: SupplementDeps = { searchWeb, fetchWeb, ingestWebMaterial, findWebRecordByTitle }
): Promise<SupplementFetchOutcome> {
  const trimmedQuery = String(query || topic || '').trim();
  if (!userId || !trimmedQuery) return { ok: false, error: 'empty-input' };
  try {
    // ① 库里已有同题资料（重复请求/备课补采过）→ 直接复用
    const existing = deps.findWebRecordByTitle(userId, trimmedQuery);
    if (existing) {
      return { ok: true, materialId: existing.id, sourceUrl: existing.sourceUrl ?? null };
    }

    // ② 搜索（取前几条候选，官方域优先的排序已由 services/search 保证）
    const search = await deps.searchWeb({ query: trimmedQuery, maxResults: 5 });
    const candidates = (search?.results || []).filter((item) => {
      const url = String(item?.url || '');
      try {
        const host = new URL(url).hostname;
        return !/wenku\.baidu\.com|docin\.com|doc88\.com|360doc\.com/.test(host);
      } catch {
        return false;
      }
    });
    if (candidates.length === 0) return { ok: false, error: 'no-search-results' };

    // ③ 逐条抓取，取第一条有正文的（不带 query 定向——补充要的是整页原文）
    for (const candidate of candidates.slice(0, 3)) {
      try {
        const response = await deps.fetchWeb({
          urls: [candidate.url],
          format: 'markdown',
          extractDepth: 'advanced',
          perUrlTimeoutMs: 20_000,
          purpose: `教师补充槽：${topic}`,
        });
        const item = (response?.results || []).find(
          (entry) => !entry.suspicious && typeof entry.text === 'string' && entry.text.trim().length > 0
        );
        if (!item) continue;
        const ingested = await deps.ingestWebMaterial({
          userId,
          url: item.finalUrl || candidate.url,
          title: item.title || topic,
          text: String(item.text),
        });
        if (ingested?.record?.id) {
          return { ok: true, materialId: ingested.record.id, sourceUrl: normalizeUrl(item.finalUrl || candidate.url) };
        }
      } catch (error) {
        logger.warn('[teaching-supplement] 单源抓取失败，试下一条（fail-open）', {
          url: candidate.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ok: false, error: 'fetch-exhausted' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 已入库记录 → 补充材料载荷（章节窗口优先，回退正文开头；≤1200 字）。 */
export function buildSupplementPayload(
  userId: string,
  materialId: string,
  topic: string
): { materialId: string; title: string; topic: string; sourceUrl: string | null; excerpt: string } | null {
  const found = readMaterial(userId, materialId);
  if (!found) return null;
  const window = extractSectionWindow(found.markdown, {}, SUPPLEMENT_EXCERPT_CHARS);
  return {
    materialId,
    title: found.record.name,
    topic,
    sourceUrl: found.record.sourceUrl ?? null,
    excerpt: window.excerpt || '',
  };
}

/** 回合开始的槽位晋升：查库命中 → 就绪载荷；未命中且超轮次 → 过期。返回 [新槽位, 载荷]。 */
export function promoteSupplementSlot(
  slot: SupplementSlot | undefined,
  userId: string,
  currentTurn: number
): { slot: SupplementSlot | null; payload: ReturnType<typeof buildSupplementPayload> } {
  if (!slot || slot.status !== 'requested') return { slot: slot ?? null, payload: null };
  const materialId = findWebRecordByTitle(userId, slot.query || slot.topic)?.id;
  if (materialId) {
    const payload = buildSupplementPayload(userId, materialId, slot.topic);
    if (payload) {
      return {
        slot: {
          ...slot,
          status: 'delivered',
          deliveredTurn: currentTurn,
          materialId,
          materialTitle: payload.title,
          sourceUrl: payload.sourceUrl,
        },
        payload,
      };
    }
  }
  if (typeof slot.requestedTurn === 'number' && currentTurn - slot.requestedTurn > SUPPLEMENT_MAX_WAIT_TURNS) {
    return { slot: { ...slot, status: 'expired' }, payload: null };
  }
  return { slot, payload: null };
}

function normalizeUrl(url: string): string | null {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

export const teachingSupplementService = { fetchSupplementMaterial, promoteSupplementSlot, buildSupplementPayload };
