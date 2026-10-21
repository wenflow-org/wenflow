/**
 * 资料引用覆盖度：判断“有相关资料却没给出可核对引用”是否值得纠错重试。
 *
 * 背景（2026-10-20 真实路径实测）：资料包已进入路径/阶段输入，但模型偶尔一条
 * `materialRefs` 都不写；课堂只能退回语义召回，学习者侧没有“依据资料”标签。
 * 这里提供软校验（不阻断生成）+ 观测量：
 *   - **相关性闸门**：只有资料与目标/阶段文本有 ≥2 个词面 token 交集时才要求引用，
 *     避免把“用户传了但明显无关”的附件硬塞进路径（提示词本身也要求无关资料应忽略）；
 *   - **逐字核对**：引用仍走 normalizeMaterialRefs，编造/改写引文不算覆盖；
 *   - **只判缺失，不代写**：校验失败只触发一次带反馈的重试，绝不由代码补 materialRefs。
 */
import { normalizeMaterialRefs } from './material-refs';
import type { PromptMaterial } from './material-prompt-projection';

export interface MaterialRefCoverageNode {
  /** 用于日志/纠错提示的人类可读标签（如「里程碑 2『风险识别』」）。 */
  label: string;
  /** 模型原始 materialRefs（未核对）。 */
  refs: unknown;
}

export interface MaterialRefCoverageResult {
  /** 资料与目标文本是否有足够词面交集（无关资料不要求引用）。 */
  relevant: boolean;
  /** 有至少 1 条逐字核对通过的引用的节点数。 */
  covered: number;
  total: number;
  missing: string[];
  valid: boolean;
  failureReason?: string;
  violations?: string[];
}

/** 资料侧可检索文本：标题 / tldr / brief / 章节标题 / 要点原文。 */
export function materialCoverageText(materials: PromptMaterial[] | null | undefined): string {
  if (!Array.isArray(materials) || materials.length === 0) return '';
  const parts: string[] = [];
  for (const material of materials) {
    if (!material) continue;
    parts.push(material.title || '', material.tldr || '');
    const brief = material.brief;
    if (brief) {
      parts.push(brief.subject || '', brief.overview || '', brief.docType || '');
      for (const item of brief.toc || []) parts.push(item?.title || '', item?.gist || '');
      for (const item of brief.naturalDivisions || []) parts.push(item || '');
      for (const item of brief.coreConcepts || []) parts.push(item || '');
    }
    for (const section of material.sections || []) parts.push(section?.title || '');
    for (const point of material.keyPoints || []) parts.push(point?.text || '', point?.cite || '');
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * 词面相关性闸门：目标文本里至少有一个 **4 字以上连续片段** 原样出现在资料里。
 *
 * 为什么不用 bigram 重合数：真实误配案例里，儿童发展指南的 4000 字 tldr 与
 * “健康管理师”路径共享 47 个通用 bigram（健康/管理/学习/发展…），任何阈值都挡不住。
 * 连续 4 字片段是更强的信号：相关资料的标题/章节/要点通常能原样命中
 * （“合规风险”“员工行为”“儿童学习”），而通用词组合不会。
 * 代价是改写过近义的资料可能不触发重试——优先保证“不硬塞无关附件”。
 *
 * `minTokenHits` 保留为兼容参数，含义变为最小连续片段长度（默认 4）。
 */
export function materialsHaveLexicalOverlap(
  materials: PromptMaterial[] | null | undefined,
  text: string,
  minTokenHits = 4
): boolean {
  const source = String(materialCoverageText(materials) || '').toLowerCase().replace(/\s+/g, '');
  if (!source.trim() || !String(text || '').trim()) return false;
  const minLen = Math.max(2, Math.floor(minTokenHits) || 4);
  const runs = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  for (const run of runs) {
    const chars = [...run];
    if (/^[a-z0-9]+$/.test(run)) {
      if (chars.length >= minLen && source.includes(run)) return true;
      continue;
    }
    const maxLen = Math.min(chars.length, Math.max(minLen, 8));
    for (let len = minLen; len <= maxLen; len += 1) {
      for (let i = 0; i + len <= chars.length; i += 1) {
        if (source.includes(chars.slice(i, i + len).join(''))) return true;
      }
    }
  }
  return false;
}

/**
 * 覆盖率阈值（当前未启用）：2026-10-21 离线对比实测（doc/local/RESOURCE-LIBRARY-OPT-2026-10-20/
 * INJECTION-GATE-COMPARISON.md §四），按 0.5 触发重试在 60 条真实路径上是 61 次 vs 零引用口径的
 * 13 次（≈4.7 倍 stage-designer 调用），且相关性闸门的词面口径尚不可靠——故软校验退回
 * 「零引用才重试」，覆盖率只进日志观测；本常量保留给将来接 embedding 相关性后复评。
 */
export const MIN_STAGE_REF_COVERAGE_RATIO = 0.5;

/**
 * 评估一组节点（里程碑/任务）的引用覆盖。
 * 无资料、无节点、资料与目标无明显交集 → 直接 valid（不触发重试）；
 * 相关但**零覆盖** → invalid（触发一次纠错重试）。部分覆盖只记录，不重试。
 */
export function assessMaterialRefCoverage(params: {
  materials: PromptMaterial[] | null | undefined;
  nodes: MaterialRefCoverageNode[];
  /** 目标/阶段文本（用于相关性闸门）。 */
  text: string;
  scope: 'PATH' | 'STAGE';
}): MaterialRefCoverageResult {
  const materials = Array.isArray(params.materials) ? params.materials : [];
  const nodes = Array.isArray(params.nodes) ? params.nodes : [];
  const base = { relevant: false, covered: 0, total: nodes.length, missing: [] as string[], valid: true };
  if (materials.length === 0 || nodes.length === 0) return base;

  const relevant = materialsHaveLexicalOverlap(materials, params.text);
  const coveredNodes = nodes.filter(
    (node) => normalizeMaterialRefs(node.refs, materials).length > 0
  );
  const missing = nodes
    .filter((node) => normalizeMaterialRefs(node.refs, materials).length === 0)
    .map((node) => node.label);
  const valid = !relevant || coveredNodes.length > 0;
  if (valid) return { ...base, relevant, covered: coveredNodes.length, missing };

  return {
    relevant,
    covered: 0,
    total: nodes.length,
    missing,
    valid: false,
    failureReason: `MATERIAL_REFS_MISSING_${params.scope}: 资料与目标相关，但${params.scope === 'PATH' ? '所有里程碑' : '本阶段所有任务'}都没有可核对的 materialRefs`,
    violations: missing.map((label) => `${label} 未给出逐字可核对的资料引用`),
  };
}
