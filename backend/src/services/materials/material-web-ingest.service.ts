/**
 * 联网资料入库（活的 path 批次 A，2026-09-24）。
 *
 * 把联网采集抓到的正文变成用户资料库里的**正式资料**（与上传附件同构）：
 *   - path 重建直接读库，零重采集；
 *   - extractSectionWindow 对它同样生效（「网络资料：域名」从跳链接升级为点开直达章节）；
 *   - material-brief 走 listMaterials 的既有惰性管线自动覆盖。
 *
 * 设计约束：
 *   - 走 parseDocument('.md') 复用文本闸门 + 锚点抽取（与上传同一套确定性解析）；
 *   - URL 规范化去重：同一来源同一用户只存一份（刷新 fetchedAt，不堆副本）；
 *   - 文本 100K 截断（存储帽 400K 之上再收紧，控库膨胀）；
 *   - fail-open：任何失败返回 null，由调用方记 note，绝不阻塞采集主流程。
 */
import crypto from 'crypto';
import { parseDocument } from './document-parser';
import { listMaterials, updateRecord, writeMaterial, type MaterialRecord } from './material-store';

/** 联网正文入库上限（字符）。fetch 层 8MB 上限之内再收紧——资料库不是网页存档站。 */
const MAX_WEB_TEXT_CHARS = 100_000;

export interface IngestWebMaterialInput {
  userId: string;
  /** 来源页 URL（抓取最终 URL 优先）。 */
  url: string;
  /** 资料名（展示用；优先页面标题，回退 need.title）。 */
  title: string;
  /** 抓取到的正文（markdown 或纯文本）。 */
  text: string;
}

export interface IngestWebMaterialResult {
  record: MaterialRecord;
  /** true=命中 URL 去重，返回的是库中既有记录（本次只刷新了 fetchedAt）。 */
  deduped: boolean;
}

/** URL 规范化：小写 host、去 hash、去尾斜杠——同一页面的琐碎变体归一。 */
export function normalizeSourceUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return raw;
  }
}

/** 标题归一（库优先查找用）：去书名号/括号/空白/连字符变体、小写——「《指南》」与「指南全文」可对上。 */
function normalizeTitleForMatch(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[《》〔〕\s（）()【】[\]—–\-·、，,。.：:；;"'「」]/g, '');
}

/**
 * 库优先查找（path 重建零重采）：按 need 标题在用户库里找已入库的联网资料。
 * 归一后互相包含即视为同一资料；命中返回记录（调用方据此跳过采集、直接用库打包）。
 */
export function findWebRecordByTitle(userId: string, title: string): MaterialRecord | null {
  const userIdTrimmed = String(userId || '').trim();
  const needle = normalizeTitleForMatch(title);
  if (!userIdTrimmed || !needle) return null;
  return listMaterials(userIdTrimmed).find((record) => {
    if (record.origin !== 'web') return false;
    const haystack = normalizeTitleForMatch(record.name);
    return !!haystack && (haystack.includes(needle) || needle.includes(haystack));
  }) || null;
}

/**
 * 把联网正文落成用户库里的一份资料。已存在同 URL 记录 → 刷新 fetchedAt 并返回既有记录。
 * 返回 null = 入库失败（正文过短被闸门拒收等），调用方 fail-open。
 */
export async function ingestWebMaterial(input: IngestWebMaterialInput): Promise<IngestWebMaterialResult | null> {
  const userId = String(input?.userId || '').trim();
  const url = normalizeSourceUrl(input?.url);
  const title = String(input?.title || '').trim().slice(0, 200) || '联网资料';
  const text = String(input?.text || '');
  if (!userId || !url || !text.trim()) return null;

  // --- 去重：同用户同 URL 只存一份 ---
  const existing = listMaterials(userId).find(
    (record) => record.origin === 'web' && normalizeSourceUrl(String(record.sourceUrl || '')) === url
  );
  if (existing) {
    const updated = updateRecord(userId, existing.id, { fetchedAt: new Date().toISOString() });
    return updated ? { record: updated, deduped: true } : null;
  }

  // --- 截断 + 复用上传解析（文本闸门 + 锚点），与附件同一套确定性解析 ---
  const overLong = text.length > MAX_WEB_TEXT_CHARS;
  const bounded = overLong
    ? `${text.slice(0, MAX_WEB_TEXT_CHARS)}\n\n<!-- 联网正文超长，已截断：仅保留前 ${MAX_WEB_TEXT_CHARS} 字 -->`
    : text;
  const parsed = await parseDocument(Buffer.from(bounded, 'utf-8'), 'web-source.md');
  if (parsed.status === 'rejected') return null;

  const record: MaterialRecord = {
    id: crypto.randomUUID(),
    userId,
    name: title,
    ext: '.md',
    format: 'web',
    size: Buffer.byteLength(bounded, 'utf-8'),
    charCount: parsed.charCount,
    structure: parsed.structure,
    anchors: parsed.anchors,
    warnings: overLong
      ? [...parsed.warnings, `联网正文超长，已截断：仅保留前 ${MAX_WEB_TEXT_CHARS} 字`]
      : parsed.warnings,
    createdAt: new Date().toISOString(),
    origin: 'web',
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
  };
  writeMaterial(record, parsed.markdown);
  return { record, deduped: false };
}
