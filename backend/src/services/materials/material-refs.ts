/**
 * `materialRefs` —— 里程碑/任务 → **资料条目**的结构化引用（可自动验收）。
 *
 * 为什么需要它：此前只在提示词里"要求模型提到资料章节名"，代码不校验、也不落库，
 * 于是无法自动验收（英文资料 + 中文讲解时字符串比对命中 0），也无法让学习者回看原文。
 *
 * 本模块只做**确定性的核对**（不含语义判断）：
 *   - `quote` 必须能在该资料包的文本里**逐字找到**（空白归一后比对）；
 *   - `sectionId` 必须是该资料包里真实存在的章节 id（给了就核对，没给就按 quote 定位）；
 *   - 核对不通过的引用**一律丢弃**（宁缺勿编）。
 *
 * 形状：`{ packIndex, sectionId, sectionTitle, quote }`。
 */
import type { PromptMaterial } from './material-prompt-projection';

export interface MaterialRef {
  /** 资料包下标（0 = 附件最先、联网在后，与提示词里的顺序一致）。 */
  packIndex: number;
  /** 本地附件 id（联网资料为 null）：前端「点开看原文」用 */
  materialId: string | null;
  /** 资料章节 id（如 s-3）；无法定位时为 null。 */
  sectionId: string | null;
  /** 资料章节标题（便于前端直接展示"对应资料哪一节"）。 */
  sectionTitle: string | null;
  /** 逐字引文（已核对存在于资料正文/章节/要点中）。 */
  quote: string;
}

/** 单个里程碑/任务最多保留几条资料引用（防提示词与前端被刷屏）。 */
export const MAX_MATERIAL_REFS = 3;
/** 引文最短长度（太短无鉴别力，如"图"）。 */
const MIN_QUOTE_CHARS = 4;
/** 引文最长长度（前端展示用）。 */
const MAX_QUOTE_CHARS = 120;

/** 空白归一：全角/半角空格、换行、制表符统一成单空格，便于逐字比对。 */
function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** 资料包的"可核对文本"：章节标题 + 要点引文 + 要点正文 + tldr。 */
function packText(material: PromptMaterial): string {
  const parts: string[] = [];
  for (const section of material.sections || []) {
    if (section.title) parts.push(section.title);
  }
  for (const point of material.keyPoints || []) {
    if (point.cite) parts.push(point.cite);
    if (point.text) parts.push(point.text);
  }
  if (material.tldr) parts.push(material.tldr);
  return normalizeWhitespace(parts.join(' '));
}

/** 逐字核对：归一化后的引文必须出现在该包的可核对文本里。 */
export function isQuoteVerbatim(quote: string, material: PromptMaterial): boolean {
  const normalized = normalizeWhitespace(quote);
  if (normalized.length < MIN_QUOTE_CHARS) return false;
  return packText(material).includes(normalized);
}

/** 按 sectionId 或标题反查章节标题（用于补全展示信息）。 */
function resolveSection(material: PromptMaterial, sectionId: string | null, quote: string) {
  const sections = material.sections || [];
  if (sectionId) {
    const byId = sections.find((section) => section.id === sectionId);
    if (byId) return byId;
  }
  // 未给 id（或给了不存在的 id）：用引文去命中章节标题，命不中就留空
  const normalizedQuote = normalizeWhitespace(quote);
  const byQuote = sections.find((section) => section.title && normalizedQuote.includes(normalizeWhitespace(section.title)));
  return byQuote || null;
}

/**
 * 把模型给的引用归一成**可核对**的引用列表：核对不过的丢弃、去重、截断。
 * 拿不到资料或引用全不可核对 → 返回空数组（调用方据此不落该键）。
 */
export function normalizeMaterialRefs(raw: unknown, materials: PromptMaterial[] | null | undefined): MaterialRef[] {
  if (!Array.isArray(raw) || !Array.isArray(materials) || materials.length === 0) return [];
  const out: MaterialRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const quote = normalizeWhitespace(record.quote ?? record.cite ?? record.text).slice(0, MAX_QUOTE_CHARS);
    if (!quote) continue;
    const packIndex = Number(record.packIndex);
    // packIndex 缺省/越界时，按引文在所有资料里找（模型经常忘记填 packIndex）
    const candidates = Number.isInteger(packIndex) && packIndex >= 0 && packIndex < materials.length
      ? [materials[packIndex]]
      : materials;
    const hit = candidates.find((material) => isQuoteVerbatim(quote, material));
    if (!hit) continue;
    const section = resolveSection(
      hit,
      typeof record.sectionId === 'string' && record.sectionId ? record.sectionId : null,
      quote
    );
    const key = `${section?.id || ''}|${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      packIndex: materials.indexOf(hit),
      materialId: hit.materialId || null,
      sectionId: section?.id || null,
      sectionTitle: section?.title || null,
      quote,
    });
    if (out.length >= MAX_MATERIAL_REFS) break;
  }
  return out;
}

/** 面向学习者的短标签：优先章节标题，其次引文片段。 */
export function describeMaterialRef(ref: MaterialRef): string {
  if (ref.sectionTitle) return ref.sectionTitle;
  return ref.quote.length > 24 ? `${ref.quote.slice(0, 24)}…` : ref.quote;
}
