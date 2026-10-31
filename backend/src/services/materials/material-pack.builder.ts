/**
 * 「用户上传的附件」→ 「path 可消费的资料包（Material Pack）」。
 *
 * 定位（2026-09-22 用户口径）：**附件是主线**——用户上传的资料必须进入路径生成，
 * 联网采集只用于**补信息**。因此这里产出的包与 material-collector 的包**同构**，
 * 由 path.coordinator 合并后交给 path-planning（uploads 在前、web 在后）。
 *
 * 与采集包一致的硬约束：
 *   ① 每条要点必须带**逐字引文**（cite）——取自 officeparser 的 chunk 正文/切片，不是生成的；
 *   ② 附带 sourceUrl（`attachment://<文件名>`），可回溯到具体附件；
 *   ③ sections[].id 稳定（s-N），供里程碑「引用资料条目」核对。
 *
 * 只依赖 `material-store`（fs），**不引解析库**，因此可被 path.coordinator 安全静态引入。
 */
import { readMaterial, type MaterialRecord } from './material-store';
import { isProseTextLine, stripLineMarkers } from './document-parser.types';
import { classifySourceTier } from '../../skills/material-collector';
import { logger } from '../../utils/logger';
import { selectMaterials } from './material-selection.service';
import {
  DEFAULT_SEMANTIC_TIMEOUT_MS,
  ensureMaterialVectorIndex,
  isMaterialSemanticEnabled,
  selectRepresentativeText,
  selectStratifiedChunks,
} from './material-semantic.service';
import type { MaterialVectorIndex } from './material-vector-store';
import type { MaterialChunk } from './material-chunker';
import type {
  MaterialKeyPoint,
  MaterialPack,
  MaterialPackResult,
  MaterialSection,
} from '../../skills/material-collector/types';

/** 单次最多带上几份附件（再多会挤占路径提示词预算）。 */
export const MAX_UPLOAD_MATERIAL_PACKS = 3;
/** 单个包最多几个章节 / 几条要点。要点上限 ≈ 每章一条（contextual retrieval 语境前缀的载体，2026-09-24）。 */
export const MAX_PACK_SECTIONS = 24;
export const MAX_PACK_KEY_POINTS = 24;
/**
 * 语义化打包的要点上限（2026-10-17 A/B，50 份真实联网长文）：
 * 24 条只能覆盖后半 55%，48 条到 82.7%——覆盖上限≈要点数/块数，24 条是欠预算而非取舍。
 */
export const MAX_SEMANTIC_PACK_KEY_POINTS = 48;
/** 单条要点正文上限（引文本身不截断语义，仅防超长行）。 */
export const MAX_POINT_CHARS = 160;
/** tldr 上限。 */
export const MAX_TLDR_CHARS = 1200;

/** 附件注入开关（默认开启；`MATERIAL_UPLOAD_INJECTION_DISABLED=1` 关闭，便于灰度回滚）。 */
export function isUploadMaterialInjectionEnabled(): boolean {
  return process.env.MATERIAL_UPLOAD_INJECTION_DISABLED !== '1';
}

/** 附件来源标识：可回溯到具体附件（前端/审计都能看出这不是联网抓来的）。 */
export function attachmentSourceUrl(name: string): string {
  return `attachment://${encodeURIComponent(String(name || '未命名附件'))}`;
}

function clamp(text: string, max: number): string {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 由章节锚点（officeparser chunks）建 sections：按标题去重，保留首次出现的顺序。 */
function buildSections(markdown: string, anchors: MaterialRecord['anchors']): MaterialSection[] {
  const seen = new Set<string>();
  const sections: MaterialSection[] = [];
  for (const anchor of anchors) {
    const title = String(anchor?.heading || '').trim();
    if (!title || title === '（无标题）' || seen.has(title)) continue;
    seen.add(title);
    sections.push({
      id: `s-${sections.length + 1}`,
      title: clamp(title, 60),
      summary: clamp(String(anchor?.preview || ''), 120),
    });
    if (sections.length >= MAX_PACK_SECTIONS) break;
  }

  // 标题结构不足（纯段落文档，或正文没有小标题）→ 用正文行补齐，保持"可引用"的语义
  for (const line of paragraphLines(markdown)) {
    if (sections.length >= MAX_PACK_SECTIONS) break;
    if (seen.has(line)) continue;
    seen.add(line);
    sections.push({ id: `s-${sections.length + 1}`, title: clamp(line, 60), summary: '' });
  }
  return sections;
}

/**
 * 正文切成「行」：只保留「像正文」的行（见 `isProseTextLine`）——过滤页码/页眉/导航/
 * 来源/日期这类样板。否则它们会挤占资料包的回退切片，让引用核对只能在样板文本上"通过"。
 */
function paragraphLines(markdown: string): string[] {
  const out: string[] = [];
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    if (!isProseTextLine(raw)) continue;
    const line = stripLineMarkers(raw);
    if (!line) continue;
    out.push(line);
  }
  return out;
}

/** 由章节锚点建要点：**引文取自原文**（cite = 原文片段），text 前置「文档名·章节名」语境
 *  （contextual retrieval 对齐：脱离原文的引文片段必须自带出处语境，2026-09-24）。 */
function buildKeyPoints(record: MaterialRecord, anchors: MaterialRecord['anchors'], markdown: string): MaterialKeyPoint[] {
  const sourceUrl = attachmentSourceUrl(record.name);
  const docTitle = String(record.name || '').replace(/\.[^.]+$/, '') || record.name;
  const points: MaterialKeyPoint[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const quote = String(anchor?.preview || '').trim();
    if (!quote) continue;
    const heading = String(anchor?.heading || '').trim();
    const contextPrefix = heading && heading !== '（无标题）' ? `${docTitle}·${heading}｜` : `${docTitle}｜`;
    const cite = clamp(quote, MAX_POINT_CHARS);
    if (seen.has(cite)) continue;
    seen.add(cite);
    points.push({
      text: clamp(`${contextPrefix}${quote}`, MAX_POINT_CHARS),
      cite,
      sourceUrl,
    });
    if (points.length >= MAX_PACK_KEY_POINTS) break;
  }

  // 锚点不足（或纯段落文档）→ 用正文行补齐要点：引文仍是原文（用户给的附件，逐字即原文）
  for (const line of paragraphLines(markdown)) {
    if (points.length >= MAX_PACK_KEY_POINTS) break;
    const cite = clamp(line, MAX_POINT_CHARS);
    if (seen.has(cite)) continue;
    seen.add(cite);
    points.push({ text: cite, cite, sourceUrl });
  }
  return points;
}

/** 把一份已落盘的资料转成资料包。 */
export function buildPackFromMaterial(record: MaterialRecord, markdown: string): MaterialPackResult {
  const sections = buildSections(markdown, record.anchors || []);
  const keyPoints = buildKeyPoints(record, record.anchors || [], markdown);
  // 联网入库资料（origin='web'）亮真身份：真源 URL + tier 分级；attachment:// 只属于真正的上传附件
  // （2026-09-26 实测：库优先复用 web 记录时，此前的 attachment:// 伪装会让联网资料在路径详情里
  //  假冒"用户上传附件"，真源 URL 与 tier 全部丢失）
  const isWeb = record.origin === 'web';
  const sourceUrl = isWeb
    ? String(record.sourceUrl || '') || attachmentSourceUrl(record.name)
    : attachmentSourceUrl(record.name);

  const pack: MaterialPack = {
    title: String(record.name || '').replace(/\.[^.]+$/, '') || record.name,
    publisher: null,
    sourceTier: isWeb ? classifySourceTier(sourceUrl) : 'unknown',
    sourceUrl,
    // 附件正文可回溯（学习者侧「点开看原文」）
    materialId: record.id,
    version: null,
    fetchedAt: record.createdAt || new Date().toISOString(),
    license: null,
    tldr: clamp(markdown, MAX_TLDR_CHARS),
    sections,
    keyPoints,
  };

  const notes = [
    isWeb
      ? `来自库中联网资料：${record.name}（${record.charCount} 字，${sections.length} 章节，${keyPoints.length} 条原文要点）`
      : `来自用户上传的本地附件：${record.name}（${record.charCount} 字，${sections.length} 章节，${keyPoints.length} 条原文要点）`,
  ];
  for (const warning of (record.warnings || []).slice(0, 2)) notes.push(`解析提示：${warning}`);

  if (!keyPoints.length) {
    return {
      status: 'not_found',
      pack: null,
      provenance: [],
      coverage: { covered: [], missing: [] },
      notes: [...notes, '该附件没有可引用的原文片段，已按无内容处理'],
    };
  }

  return {
    status: 'ok',
    pack,
    // 资料理解摘要（惰性生成，未生成时为 null；path-planning 据此获得分段意图与全文目录感知）
    brief: record.brief ?? null,
    provenance: keyPoints.map((point, index) => ({
      pointId: `p-${index + 1}`,
      sourceUrl: point.sourceUrl,
      quote: point.cite,
    })),
    coverage: { covered: sections.map((section) => section.title), missing: [] },
    notes,
  };
}

/** 块的正文（去掉块首标题行）——引文要落在正文上，不能只引标题。 */
function chunkBodyText(chunk: MaterialChunk): string {
  const titleFlat = String(chunk.title || '').replace(/\s+/g, '').slice(0, 12);
  const kept: string[] = [];
  for (const raw of String(chunk.text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (titleFlat && line.replace(/\s+/g, '').startsWith(titleFlat)) continue;
    kept.push(line);
    if (kept.join('\n').length >= MAX_POINT_CHARS) break;
  }
  return kept.join('\n');
}

/** 语义要点：每条引一段原文正文，前置「文档·章节｜」语境（与锚点要点同形）。 */
function buildSemanticKeyPoints(
  chunks: MaterialChunk[],
  docTitle: string,
  sourceUrl: string
): MaterialKeyPoint[] {
  const points: MaterialKeyPoint[] = [];
  for (const chunk of chunks) {
    const quote = clamp(chunkBodyText(chunk), MAX_POINT_CHARS);
    if (!quote) continue;
    const heading = String(chunk.title || '').trim();
    const prefix = heading && heading !== '（无标题）' ? `${docTitle}·${heading}｜` : `${docTitle}｜`;
    points.push({ text: clamp(`${prefix}${quote}`, MAX_POINT_CHARS), cite: quote, sourceUrl });
  }
  return points;
}

/**
 * 语义章节：让 `sections` 也覆盖全文（2026-10-17 端到端发现）。
 *
 * 路径的 `materialRefs` 是按 **sectionId（s-N）** 落库的，只改 keyPoints 不动 sections，
 * 引用就仍然集中在文档头部（20 个 goal 实测：keyPoints 后半覆盖 4.5%→49.8%，路径引用 8.3%→6.7%）。
 * 这里用同一套分层选择产出 sections，章节数不变（24），但位置铺满全文。
 */
function buildSemanticSections(chunks: MaterialChunk[]): MaterialSection[] {
  return chunks.map((chunk, index) => {
    const body = chunkBodyText(chunk).replace(/\s+/g, ' ').trim();
    const heading = String(chunk.title || '').trim();
    return {
      id: `s-${index + 1}`,
      title: clamp(heading && heading !== '（无标题）' ? heading : body.slice(0, 40), 60),
      summary: clamp(body, 120),
    };
  });
}

export interface BuildPackOptions {
  timeoutMs?: number;
  /** 调用方已建好索引时复用，避免重复嵌入（A/B 探针、预热路径）。 */
  index?: MaterialVectorIndex;
}

/**
 * **语义化打包**：tldr 用跨全文代表采样、要点按文档位置分层（48 条）。
 *
 * 为什么（2026-10-17，50 份真实联网长文 A/B）：联网资料多为扁平文本，`anchors` 常为空，
 * 旧包退化成「正文前 1200 字 + 前 24 行正文」——49/50 份的后半段在路径阶段完全不可见；
 * 换成语义口径后后半覆盖 0.3% → 82.7%，前 1/4 覆盖 21.5% → 82.0%。
 *
 * 任何失败（索引/嵌入/超时）都回落到同步旧口径，绝不阻塞路径生成。
 */
export async function buildPackFromMaterialAsync(
  record: MaterialRecord,
  markdown: string,
  options: BuildPackOptions = {}
): Promise<MaterialPackResult> {
  const base = buildPackFromMaterial(record, markdown);
  if (base.status !== 'ok' || !base.pack) return base;
  if (!isMaterialSemanticEnabled()) return base;

  const timeoutMs = options.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS;
  try {
    const index = options.index ?? (await ensureMaterialVectorIndex(record, markdown, { timeoutMs }));
    if (!index || index.chunks.length === 0) return base;
    const sampled = await selectRepresentativeText(record, markdown, MAX_TLDR_CHARS, {
      timeoutMs,
      index,
    });
    const picked = selectStratifiedChunks(index.chunks, MAX_SEMANTIC_PACK_KEY_POINTS);
    const points = buildSemanticKeyPoints(picked, base.pack.title, base.pack.sourceUrl);
    if (points.length === 0) return base;
    const sectionChunks = selectStratifiedChunks(index.chunks, MAX_PACK_SECTIONS);
    const sections = sectionChunks.length > 0 ? buildSemanticSections(sectionChunks) : base.pack.sections;

    return {
      ...base,
      pack: { ...base.pack, tldr: sampled || base.pack.tldr, sections, keyPoints: points },
      provenance: points.map((point, pointIndex) => ({
        pointId: `p-${pointIndex + 1}`,
        sourceUrl: point.sourceUrl,
        quote: point.cite,
      })),
      coverage: { covered: sections.map((section) => section.title), missing: [] },
      notes: [
        ...base.notes,
        `语义采样：tldr 跨全文 + 章节/要点按位置分层 ${sections.length}/${points.length} 条`,
      ],
    };
  } catch (error) {
    logger.warn('[material-pack] 语义化打包失败，回退头部/锚点口径（fail-open）', {
      materialId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return base;
  }
}

export interface UploadedMaterialPackOptions {
  /** 目标文本；有值时按相关性选资料，空值退回最近上传。 */
  query?: string | null;
  /** 本次最多打包几份；缺省 MAX_UPLOAD_MATERIAL_PACKS。 */
  limit?: number;
  /** 调用方已选好的记录；传入后不再重复排序/读取列表。 */
  records?: MaterialRecord[];
}

function resolveUploadedRecords(userId: string, options: UploadedMaterialPackOptions): MaterialRecord[] {
  const limit = Math.max(1, Math.floor(Number(options.limit) || MAX_UPLOAD_MATERIAL_PACKS));
  if (options.records) {
    return options.records.filter((record) => record.origin !== 'web').slice(0, limit);
  }
  return selectMaterials({
    userId,
    query: options.query,
    limit,
    includeWeb: false,
  }).selected;
}

/**
 * 读取该用户上传的资料并转成资料包（按目标相关性选，最多 MAX_UPLOAD_MATERIAL_PACKS 份）。
 * 任何异常都吞掉返回已成功的部分（fail-open：附件读不到不能挡路径生成）。
 *
 * 必须排除 origin='web'（2026-09-26 实测）：联网入库资料有自己的复用通道
 * （path.coordinator 库优先 → findWebRecordByTitle → 真 sourceUrl/sourceTier 的联网包）。
 * 若混进附件列表会被双重伤害：① attachment:// 伪源 + "用户上传附件" 假身份 + tier=unknown；
 * ② 它的 materialId 进入 uploadedMaterialIds 后，真联网包在合并处被当作"与附件重复"丢弃——
 * 净效果是第二次生成时联网资料"消失"，只剩一份假冒附件。
 */
export function buildUploadedMaterialPacks(
  userId: string,
  options: UploadedMaterialPackOptions = {}
): MaterialPackResult[] {
  if (!userId) return [];
  if (!isUploadMaterialInjectionEnabled()) return [];

  const records = resolveUploadedRecords(userId, options);
  const packs: MaterialPackResult[] = [];
  for (const record of records) {
    try {
      const found = readMaterial(userId, record.id);
      if (!found) continue;
      packs.push(buildPackFromMaterial(found.record, found.markdown));
    } catch {
      // 单份失败不影响其余
    }
  }
  return packs;
}

/** 同 `buildUploadedMaterialPacks`，但走语义化口径（path 生成用这个）。 */
export async function buildUploadedMaterialPacksAsync(
  userId: string,
  options: UploadedMaterialPackOptions = {}
): Promise<MaterialPackResult[]> {
  if (!userId) return [];
  if (!isUploadMaterialInjectionEnabled()) return [];

  const records = resolveUploadedRecords(userId, options);
  const packs: MaterialPackResult[] = [];
  for (const record of records) {
    try {
      const found = readMaterial(userId, record.id);
      if (!found) continue;
      packs.push(await buildPackFromMaterialAsync(found.record, found.markdown));
    } catch {
      // 单份失败不影响其余
    }
  }
  return packs;
}
