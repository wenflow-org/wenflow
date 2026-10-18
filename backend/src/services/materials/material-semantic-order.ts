/**
 * 阶段资料窗口的**窗口内语义排序**（#119 优化项 2，P1 低成本）。
 *
 * 现状（2026-10-17 实测，20 goal 对照）：阶段按位次切 8 节窗口后，引用语义分位 0.54–0.69，
 * 不是窗口内最强——模型对「先出现的资料」有引用偏好。本模块只重排**已切好的同一窗口**里的
 * 顺序（成员与数量完全不变，覆盖范围不受影响），不改窗口边界、不做跨窗口检索。
 *
 * 纪律：
 * - **fail-open**：query 为空、窗口不足 2 节、embedding 不可用/报错/条数不齐 → 返回 null，
 *   调用方按原顺序喂模型（生成链不因这个优化失败）；
 * - 相似度只作「排序」不作「过滤/裁决」——不做 top-k 截断（那会丢覆盖，见 issue 里的否决项）；
 * - 平局按原始位次稳定排序（同分不制造随机）。
 */
import { cosineSimilarity, embedTexts } from '../embedding';

export interface SectionRef {
  id: string;
  title: string;
  summary: string;
}

export interface SectionSemanticOrderInput {
  /** 阶段查询文本（milestone.title + goal + description，空白项由调用方过滤） */
  query: string;
  /** 窗口内（或资料包全部）章节；只有带 id 且文本非空的参与 */
  sections: SectionRef[];
  /** 测试注入：直接给向量，跳过真实 embedding */
  embed?: (texts: string[]) => Promise<number[][]>;
}

const MAX_TEXT_CHARS = 400;

function sectionText(section: SectionRef): string {
  return `${section.title || ''}\n${section.summary || ''}`.trim().slice(0, MAX_TEXT_CHARS);
}

/**
 * 按「与 query 的余弦相似度降序」给出**原始索引序列**；平局保持原始顺序。
 * 纯函数：便于单测排序与平局规则，不触碰网络。
 */
export function rankSectionIndexes(queryVector: number[], sectionVectors: number[][]): number[] {
  const identity = sectionVectors.map((_, index) => index);
  if (!Array.isArray(queryVector) || !queryVector.length) return identity;
  return sectionVectors
    .map((vector, index) => {
      const score = cosineSimilarity(queryVector, vector);
      return { index, score: Number.isFinite(score) ? score : 0 };
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((entry) => entry.index);
}

/**
 * 计算「章节 id → 名次」映射；任何前置条件不满足或 embedding 失败都返回 null（fail-open）。
 */
export async function buildSectionSemanticOrder(
  input: SectionSemanticOrderInput
): Promise<Map<string, number> | null> {
  const query = String(input.query || '').trim();
  if (!query) return null;
  const usable = (Array.isArray(input.sections) ? input.sections : []).filter(
    (section) => section && typeof section.id === 'string' && !!section.id && !!sectionText(section)
  );
  if (usable.length < 2) return null;

  const texts = [query.slice(0, MAX_TEXT_CHARS), ...usable.map(sectionText)];
  let vectors: number[][];
  try {
    if (input.embed) {
      vectors = await input.embed(texts);
    } else {
      const response = await embedTexts({ input: texts });
      const ordered = [...(response.vectors || [])].sort((a, b) => a.index - b.index);
      vectors = ordered.map((item) => item.embedding);
    }
  } catch {
    return null;
  }
  if (!Array.isArray(vectors) || vectors.length !== texts.length) return null;
  const queryVector = vectors[0];
  if (!Array.isArray(queryVector) || !queryVector.length) return null;

  const order = rankSectionIndexes(queryVector, vectors.slice(1));
  const rankById = new Map<string, number>();
  order.forEach((sectionIndex, rank) => rankById.set(usable[sectionIndex].id, rank));
  return rankById;
}
