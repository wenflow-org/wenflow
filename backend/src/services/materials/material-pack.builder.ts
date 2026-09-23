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
import { listMaterials, readMaterial, type MaterialRecord } from './material-store';
import { isProseTextLine, stripLineMarkers } from './document-parser.types';
import type {
  MaterialKeyPoint,
  MaterialPack,
  MaterialPackResult,
  MaterialSection,
} from '../../skills/material-collector/types';

/** 单次最多带上几份附件（再多会挤占路径提示词预算）。 */
export const MAX_UPLOAD_MATERIAL_PACKS = 3;
/** 单个包最多几个章节 / 几条要点。 */
export const MAX_PACK_SECTIONS = 24;
export const MAX_PACK_KEY_POINTS = 12;
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

/** 由章节锚点建要点：**引文取自原文**（cite = 原文片段），text 前置章节名便于路径引用。 */
function buildKeyPoints(record: MaterialRecord, anchors: MaterialRecord['anchors'], markdown: string): MaterialKeyPoint[] {
  const sourceUrl = attachmentSourceUrl(record.name);
  const points: MaterialKeyPoint[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const quote = String(anchor?.preview || '').trim();
    if (!quote) continue;
    const heading = String(anchor?.heading || '').trim();
    const prefix = heading && heading !== '（无标题）' ? `${heading}｜` : '';
    const cite = clamp(quote, MAX_POINT_CHARS);
    if (seen.has(cite)) continue;
    seen.add(cite);
    points.push({
      text: clamp(`${prefix}${quote}`, MAX_POINT_CHARS),
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
  const sourceUrl = attachmentSourceUrl(record.name);

  const pack: MaterialPack = {
    title: String(record.name || '').replace(/\.[^.]+$/, '') || record.name,
    publisher: null,
    sourceTier: 'unknown',
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

  const notes = [`来自用户上传的本地附件：${record.name}（${record.charCount} 字，${sections.length} 章节，${keyPoints.length} 条原文要点）`];
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
    provenance: keyPoints.map((point, index) => ({
      pointId: `p-${index + 1}`,
      sourceUrl: point.sourceUrl,
      quote: point.cite,
    })),
    coverage: { covered: sections.map((section) => section.title), missing: [] },
    notes,
  };
}

/**
 * 读取该用户上传的资料并转成资料包（新→旧，最多 MAX_UPLOAD_MATERIAL_PACKS 份）。
 * 任何异常都吞掉返回已成功的部分（fail-open：附件读不到不能挡路径生成）。
 */
export function buildUploadedMaterialPacks(userId: string): MaterialPackResult[] {
  if (!userId) return [];
  if (!isUploadMaterialInjectionEnabled()) return [];

  let records: MaterialRecord[] = [];
  try {
    records = listMaterials(userId).slice(0, MAX_UPLOAD_MATERIAL_PACKS);
  } catch {
    return [];
  }

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
