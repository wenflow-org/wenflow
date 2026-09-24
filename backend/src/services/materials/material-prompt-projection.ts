/**
 * 资料包 → **提示词友好投影**（单一实现，供 path / stage / teaching 三处复用）。
 *
 * 为什么需要投影：pack 里 tldr/sections/keyPoints 是全量（单份可能上万字），
 * 直接塞进提示词会挤爆上下文。这里只保留**可核对**的最小集合：
 * 资料名 + 来源 + 章节（id/title）+ 带逐字引文的要点。
 *
 * 三处消费方（同源，避免各自实现一份导致口径漂移）：
 *   - `skills/path-planning`（路径骨架长在资料上）
 *   - `services/learning/generation/stage-enrichment`（任务长在资料章节上）
 *   - `services/ai-teaching/TeachingContextBuilder`（课堂上引用资料原文）
 */

export interface PromptMaterialLimits {
  /** 最多带几份资料。 */
  maxMaterials: number;
  /** 每份最多几个章节。 */
  maxSections: number;
  /** 每份最多几条要点。 */
  maxKeyPoints: number;
  /** tldr 截断长度。 */
  maxTldrChars: number;
}

/** 路径层（骨架）：资料是主线，给得最全（2026-09-24 对齐包上限——「全面学习」场景 path 必须看到完整目录）。 */
export const PATH_MATERIAL_LIMITS: PromptMaterialLimits = {
  maxMaterials: 3,
  maxSections: 24,
  maxKeyPoints: 12,
  maxTldrChars: 600,
};

/** 任务层（stage-designer）：任务要落到章节/条目上。 */
export const STAGE_MATERIAL_LIMITS: PromptMaterialLimits = {
  maxMaterials: 3,
  maxSections: 8,
  maxKeyPoints: 6,
  maxTldrChars: 400,
};

/** 课堂层（teaching-turn）：够引用原文即可，越小越好（每轮都进上下文）。 */
export const TEACHING_MATERIAL_LIMITS: PromptMaterialLimits = {
  maxMaterials: 2,
  maxSections: 6,
  maxKeyPoints: 4,
  maxTldrChars: 300,
};

export interface PromptMaterialSection {
  id: string | null;
  title: string | null;
}

export interface PromptMaterialKeyPoint {
  text: string | null;
  cite: string | null;
}

export interface PromptMaterial {
  title: string | null;
  sourceUrl: string | null;
  /** 本地附件 id（联网资料为 null）；学习者侧据此取回原文 */
  materialId: string | null;
  publisher: string | null;
  sourceTier: string | null;
  tldr: string | null;
  sections: PromptMaterialSection[];
  keyPoints: PromptMaterialKeyPoint[];
  /**
   * 资料理解摘要（material-brief；仅上传附件且已生成时存在，2026-09-24）。
   * path-planning 据此获得「这份资料是什么/怎么切分学习」的分段意图；
   * 联网资料不携带（其 pack 本身即采集时 LLM 抽取的摘要）。
   */
  brief?: {
    docType: string | null;
    subject: string | null;
    audience: string | null;
    overview: string | null;
    toc: Array<{ title: string; gist: string }>;
    coreConcepts: string[];
    naturalDivisions: string[];
  } | null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 投影资料包；无可用资料时返回 `null`（调用方据此**不出现该键**，冷启动行为不变）。
 */
export function buildPromptFriendlyMaterials(
  raw: unknown,
  limits: PromptMaterialLimits = PATH_MATERIAL_LIMITS
): PromptMaterial[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PromptMaterial[] = [];
  for (const item of raw.slice(0, limits.maxMaterials)) {
    const pack = (item as { pack?: Record<string, unknown> })?.pack;
    if (!pack || typeof pack !== 'object') continue;
    const sections = (Array.isArray(pack.sections) ? pack.sections : [])
      .slice(0, limits.maxSections)
      .map((section: Record<string, unknown>) => ({
        id: normalizeString(section?.id),
        title: normalizeString(section?.title),
      }))
      .filter((section) => !!section.title);
    const keyPoints = (Array.isArray(pack.keyPoints) ? pack.keyPoints : [])
      .slice(0, limits.maxKeyPoints)
      .map((point: Record<string, unknown>) => ({
        text: normalizeString(point?.text),
        cite: normalizeString(point?.cite),
      }))
      .filter((point) => !!point.text);
    if (!sections.length && !keyPoints.length) continue;
    out.push({
      title: normalizeString(pack.title),
      sourceUrl: normalizeString(pack.sourceUrl),
      materialId: normalizeString(pack.materialId),
      publisher: normalizeString(pack.publisher),
      sourceTier: normalizeString(pack.sourceTier),
      tldr: normalizeString(pack.tldr)?.slice(0, limits.maxTldrChars) || null,
      sections,
      keyPoints,
      // 资料理解摘要（仅上传附件携带；透传即可——规模已由生成侧钳制，无需再截）
      brief: (item as { brief?: PromptMaterial['brief'] }).brief ?? null,
    });
  }
  return out.length ? out : null;
}

/**
 * 从任意「携带 normalizedInput 的容器」里取资料并投影。
 * 容器形态：`{ normalizedInput }` / `{ resources: { materials } }` / 直接的 normalizedInput。
 */
export function extractPromptMaterials(
  container: unknown,
  limits: PromptMaterialLimits = PATH_MATERIAL_LIMITS
): PromptMaterial[] | null {
  if (!container || typeof container !== 'object') return null;
  const record = container as {
    resources?: { materials?: unknown };
    normalizedInput?: { resources?: { materials?: unknown }; materials?: unknown };
  };
  const materials = record.resources?.materials
    ?? record.normalizedInput?.resources?.materials
    ?? record.normalizedInput?.materials
    ?? null;
  return buildPromptFriendlyMaterials(materials, limits);
}
