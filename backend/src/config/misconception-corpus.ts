/**
 * 真人误区语料库（v1，2026-10-21）。
 *
 * 用途：虚拟学习者的「受控错误」不再由模型即兴编一个卡点，而是按概念命中一条**有公开来源**的
 * 真实误区来演（并写进判决器/叙事器的 errorPattern）。检查点干扰项同样可以引用这里的条目。
 *
 * 存储：backend/config/misconception-corpus.json（可评审、可 diff，不改库结构）。
 * 匹配：概念名做中文 bigram Dice 相似度（去掉标点/空白），≥ MISCONCEPTION_MATCH_THRESHOLD 视为命中。
 *   语料里的 concepts 是别名列表，允许写「短名」去匹配画像里的长句卡点。
 * 边界：只影响「错成什么样」，不影响判分与参数；没有命中就回退原来的即兴卡点（fail-open）。
 */
import corpusJson from '../../config/misconception-corpus.json';

export interface MisconceptionEntry {
  id: string;
  concepts: string[];
  statement: string;
  why?: string;
  source?: string;
  sourceTitle?: string;
  confidence?: number;
  locale?: string;
}

interface MisconceptionCorpusFile {
  version: number;
  generatedAt: string;
  note?: string;
  entries: MisconceptionEntry[];
}

const CORPUS = corpusJson as MisconceptionCorpusFile;

/** 命中阈值：0.6 在实测样例上把「条件翻译成能写的区位得分点」这类长短句变体收进来，同时避开无关概念。 */
export const MISCONCEPTION_MATCH_THRESHOLD = 0.6;
/** 别名太短（<4 个字符）不做匹配，避免「信度」这类短词误命中整段概念。 */
const MIN_ALIAS_CHARS = 4;

export function listMisconceptions(): MisconceptionEntry[] {
  return CORPUS.entries.slice();
}

export function corpusMeta(): { version: number; generatedAt: string; count: number } {
  return { version: CORPUS.version, generatedAt: CORPUS.generatedAt, count: CORPUS.entries.length };
}

export function normalizeConceptKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！“”‘’（）《》【】[\]{}<>·,.;:!?()"'`~@#$%^&*+=|\\/_—-]+/g, '');
}

function bigrams(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length < 2) return chars.length === 1 ? [chars[0]] : [];
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** 中文 bigram Dice 相似度（0-1）。 */
export function conceptSimilarity(a: string, b: string): number {
  const left = normalizeConceptKey(a);
  const right = normalizeConceptKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const la = bigrams(left);
  const lb = bigrams(right);
  if (la.length === 0 || lb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of la) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of lb) {
    const hit = counts.get(gram) || 0;
    if (hit > 0) {
      overlap += 1;
      counts.set(gram, hit - 1);
    }
  }
  return (2 * overlap) / (la.length + lb.length);
}

/**
 * 为一条概念找最匹配的误区条目。相似度相同取 confidence 高的（人工复核过的更可信）。
 * 没命中返回 null —— 调用方据此回退到原来的即兴卡点。
 */
export function findMisconceptionFor(concept: unknown, entries: MisconceptionEntry[] = CORPUS.entries): MisconceptionEntry | null {
  const normalized = normalizeConceptKey(concept);
  if (normalized.length < MIN_ALIAS_CHARS) return null;
  let best: { entry: MisconceptionEntry; score: number } | null = null;
  for (const entry of entries) {
    for (const alias of entry.concepts || []) {
      const aliasKey = normalizeConceptKey(alias);
      if (aliasKey.length < MIN_ALIAS_CHARS) continue;
      // 先走廉价判断：互相包含直接算强命中，避免长短句被 bigram 稀释
      if (normalized.includes(aliasKey) || aliasKey.includes(normalized)) {
        const score = 1;
        if (!best || score > best.score || (score === best.score && (entry.confidence || 0) > (best.entry.confidence || 0))) {
          best = { entry, score };
        }
        continue;
      }
      const score = conceptSimilarity(normalized, aliasKey);
      if (score < MISCONCEPTION_MATCH_THRESHOLD) continue;
      if (!best || score > best.score || (score === best.score && (entry.confidence || 0) > (best.entry.confidence || 0))) {
        best = { entry, score };
      }
    }
  }
  return best ? best.entry : null;
}
