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

/**
 * 阶段位置窗口（2026-10-17）：任务层只带 8 个章节，此前**永远取前 8 个**——24 章节的包里
 * 后 2/3 对 stage-designer 完全不可见，路径引用因而恒落在原文前部（20 goal A/B 实证：
 * 后半引用 9%，且 s-9 之后从未出现）。
 *
 * 修法：按阶段在路径中的位次，把章节/要点切成**连续窗口**（首阶段取头、末阶段取尾），
 * 让整条路径的引用有机会覆盖全文，同时单阶段载荷不变。
 */
export interface MaterialProjectionWindow {
  /** 当前阶段序号（1-based）。 */
  stageNumber: number;
  /** 全路径阶段总数。 */
  stageCount: number;
}

/**
 * 计算 `[start, end)` 切片：`take` 为单阶段最多可见条数。
 * 阶段数 ≤1、条数不足窗口、或序号越界时退化为从头取（与改造前一致）。
 */
export function resolveMaterialWindowRange(
  total: number,
  take: number,
  stageNumber?: number | null,
  stageCount?: number | null
): [number, number] {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const size = Math.max(0, Math.min(safeTotal, Math.floor(Number(take) || 0)));
  if (size <= 0 || size >= safeTotal) return [0, safeTotal];
  const count = Math.max(1, Math.floor(Number(stageCount) || 1));
  if (count <= 1) return [0, size];
  const index = Math.min(count, Math.max(1, Math.floor(Number(stageNumber) || 1)));
  const maxStart = safeTotal - size;
  const start = Math.round(((index - 1) * maxStart) / (count - 1));
  return [start, start + size];
}

/**
 * 覆盖约束的语义重排（#119 优化项 3，2026-10-19）。
 *
 * 放开位置窗口的**成员约束**（候选不再限于连续 8 节），但保留位置窗口的**覆盖分布**：
 * 以位置窗口在各三分位（按 `index/(total-1)` 与 1/3、2/3 分界，与语义对齐探针同口径）
 * 上的条数为配额，并保证每个非空三分位 ≥1 节；配额内按语义名次取最优（rerank 填槽）。
 * 目的（issue #119 验收）：引用语义分位向窗口内上限靠拢，同时「后半覆盖」不低于窗口方案；
 * 明确不做「纯语义 top-k 替代位置窗口」。
 */
function tertileOfIndex(index: number, total: number): 0 | 1 | 2 {
  if (total <= 1) return 0;
  const position = index / (total - 1);
  if (position < 1 / 3) return 0;
  if (position < 2 / 3) return 1;
  return 2;
}

/**
 * 三分位配额：**严格等于位置窗口在各三分位上的条数**（2026-10-19 修订：首版加过
 * 「每个非空三分位 ≥1」的地板，实测反而把末阶段尾部配额从 8 削到 6、给早期阶段塞了
 * 用不上的尾部，后半覆盖 -2.8pp/-7.7pp；展示分布与窗口逐位一致才是「不低于窗口方案」的保证）。
 * 条数不足 take 时取条数上限。
 */
export function resolveTertileQuota(total: number, take: number, anchor: [number, number]): [number, number, number] {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const size = Math.max(0, Math.min(safeTotal, Math.floor(Number(take) || 0)));
  const quota: [number, number, number] = [0, 0, 0];
  if (size <= 0) return quota;
  const start = Math.max(0, Math.min(safeTotal, Math.floor(Number(anchor?.[0]) || 0)));
  const end = Math.max(start, Math.min(safeTotal, Math.floor(Number(anchor?.[1]) || 0)));
  for (let index = start; index < end; index += 1) quota[tertileOfIndex(index, safeTotal)] += 1;
  // 兜底：锚区间比 take 宽（调用方传了非窗口锚）时从配额最大者削减，保证总量 = take。
  let sum = quota[0] + quota[1] + quota[2];
  while (sum > size) {
    let pick: 0 | 1 | 2 = 0;
    for (const tertile of [1, 2] as const) {
      if (quota[tertile] >= quota[pick]) pick = tertile;
    }
    quota[pick] -= 1;
    sum -= 1;
  }
  return quota;
}

/**
 * 按「三分位配额 + 语义名次」选节：每个三分位先取配额条语义最优的，
 * 不足时按全局名次兜底补足；输出按语义名次升序（与优化项 2 同口径——模型偏爱先出现的资料），
 * 未命中名次的章节保持原位次排在后面。
 */
export function selectSectionsWithCoverageQuota<T extends { id: string | null }>(
  sections: T[],
  take: number,
  anchor: [number, number],
  rankById?: ReadonlyMap<string, number> | null
): T[] {
  const total = sections.length;
  const size = Math.max(0, Math.min(total, Math.floor(Number(take) || 0)));
  if (size <= 0) return [];
  if (size >= total) return [...sections];
  const quota = resolveTertileQuota(total, size, anchor);
  const ranked = sections.map((section, index) => {
    const rank = section.id && rankById ? rankById.get(section.id) : undefined;
    return { section, index, rank: typeof rank === 'number' ? rank : Number.POSITIVE_INFINITY };
  });
  const picked: typeof ranked = [];
  const used = new Set<number>();
  for (const tertile of [0, 1, 2] as const) {
    if (!quota[tertile]) continue;
    const pool = ranked
      .filter((entry) => !used.has(entry.index) && tertileOfIndex(entry.index, total) === tertile)
      .sort((left, right) => (left.rank - right.rank) || (left.index - right.index));
    for (const entry of pool.slice(0, quota[tertile])) {
      picked.push(entry);
      used.add(entry.index);
    }
  }
  if (picked.length < size) {
    const rest = ranked
      .filter((entry) => !used.has(entry.index))
      .sort((left, right) => (left.rank - right.rank) || (left.index - right.index));
    for (const entry of rest.slice(0, size - picked.length)) {
      picked.push(entry);
      used.add(entry.index);
    }
  }
  return picked
    .sort((left, right) => (left.rank - right.rank) || (left.index - right.index))
    .map((entry) => entry.section);
}

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
 *
 * `preferredSectionOrder`（#119 优化项 2）：章节 id → 名次。默认只在**已切好的窗口内**重排顺序，
 * 成员与数量不变（不做跨窗口检索、不做 top-k 截断）；未命中名次的章节保持原位排在后面。
 *
 * `coverageQuota`（#119 优化项 3，2026-10-19）：为 true 且有名次映射时，改走
 * 「三分位配额 + 语义 rerank 填槽」——候选放开到全文（不再限于窗口切片），
 * 但配额沿窗口的覆盖分布（保证每个非空三分位 ≥1 节），后半覆盖不回落。
 * 名次映射缺失（embedding fail-open 等）时自动退回窗口切片路径。
 */
export function buildPromptFriendlyMaterials(
  raw: unknown,
  limits: PromptMaterialLimits = PATH_MATERIAL_LIMITS,
  window?: MaterialProjectionWindow | null,
  preferredSectionOrder?: ReadonlyMap<string, number> | null,
  coverageQuota?: boolean
): PromptMaterial[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PromptMaterial[] = [];
  for (const item of raw.slice(0, limits.maxMaterials)) {
    const pack = (item as { pack?: Record<string, unknown> })?.pack;
    if (!pack || typeof pack !== 'object') continue;
    const rawSections = Array.isArray(pack.sections) ? pack.sections : [];
    const [sectionStart, sectionEnd] = resolveMaterialWindowRange(
      rawSections.length,
      limits.maxSections,
      window?.stageNumber,
      window?.stageCount
    );
    const mapSection = (section: Record<string, unknown>): PromptMaterialSection => ({
      id: normalizeString(section?.id),
      title: normalizeString(section?.title),
    });
    let sections: PromptMaterialSection[];
    if (coverageQuota && preferredSectionOrder && preferredSectionOrder.size) {
      // 覆盖约束的语义重排（#119-3）：候选为全文（仅按 id 空间取配额锚），按名次选节。
      const pool = rawSections
        .map((section) => mapSection(section as Record<string, unknown>))
        .filter((section) => !!section.title);
      sections = selectSectionsWithCoverageQuota(pool, limits.maxSections, [sectionStart, sectionEnd], preferredSectionOrder);
    } else {
      sections = rawSections
        .slice(sectionStart, sectionEnd)
        .map((section: Record<string, unknown>) => mapSection(section))
        .filter((section) => !!section.title);
      // 窗口内语义重排（#119-2）：稳定排序，未命中名次的章节（未知 id）保持原位排后。
      if (preferredSectionOrder && preferredSectionOrder.size && sections.length > 1) {
        const rankOf = (section: { id: string | null }): number => {
          const rank = section.id ? preferredSectionOrder.get(section.id) : undefined;
          return typeof rank === 'number' ? rank : Number.POSITIVE_INFINITY;
        };
        sections.sort((left, right) => rankOf(left) - rankOf(right));
      }
    }
    const rawKeyPoints = Array.isArray(pack.keyPoints) ? pack.keyPoints : [];
    const [pointStart, pointEnd] = resolveMaterialWindowRange(
      rawKeyPoints.length,
      limits.maxKeyPoints,
      window?.stageNumber,
      window?.stageCount
    );
    const keyPoints = rawKeyPoints
      .slice(pointStart, pointEnd)
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

/** 从容器里解析资料包数组（与 extractPromptMaterials 同一套容器形态）。 */
export function resolvePromptMaterialPacks(container: unknown): unknown[] {
  if (!container || typeof container !== 'object') return [];
  const record = container as {
    resources?: { materials?: unknown };
    normalizedInput?: { resources?: { materials?: unknown }; materials?: unknown };
  };
  const materials = record.resources?.materials
    ?? record.normalizedInput?.resources?.materials
    ?? record.normalizedInput?.materials
    ?? null;
  return Array.isArray(materials) ? materials : [];
}

/**
 * 收集资料包里全部章节的 `{id,title,summary}`（语义排序用；不含窗口裁剪）。
 * 与投影侧同一个 normalize 口径，避免 id 对不上导致排序整段失效。
 */
export function collectMaterialSectionRefs(container: unknown): Array<{ id: string; title: string; summary: string }> {
  const refs: Array<{ id: string; title: string; summary: string }> = [];
  for (const item of resolvePromptMaterialPacks(container)) {
    const pack = (item as { pack?: Record<string, unknown> })?.pack;
    const sections = pack && Array.isArray(pack.sections) ? pack.sections : [];
    for (const section of sections as Array<Record<string, unknown>>) {
      const id = normalizeString(section?.id);
      const title = normalizeString(section?.title);
      if (!id || !title) continue;
      refs.push({ id, title, summary: normalizeString(section?.summary) || '' });
    }
  }
  return refs;
}

/**
 * 从任意「携带 normalizedInput 的容器」里取资料并投影。
 * 容器形态：`{ normalizedInput }` / `{ resources: { materials } }` / 直接的 normalizedInput。
 */
export function extractPromptMaterials(
  container: unknown,
  limits: PromptMaterialLimits = PATH_MATERIAL_LIMITS,
  window?: MaterialProjectionWindow | null,
  preferredSectionOrder?: ReadonlyMap<string, number> | null,
  coverageQuota?: boolean
): PromptMaterial[] | null {
  return buildPromptFriendlyMaterials(
    resolvePromptMaterialPacks(container),
    limits,
    window,
    preferredSectionOrder,
    coverageQuota
  );
}
