/**
 * 真人误区语料库（2026-10-21）：匹配逻辑单测。
 *
 * 关键约束：语料里的概念别名是「短名」，运行时传进来的是画像里的「长句卡点」，
 * 所以匹配必须容忍长短句差异，同时不能把无关概念误命中（否则受控错误会演错方向）。
 */
import {
  conceptSimilarity,
  corpusMeta,
  findMisconceptionFor,
  listMisconceptions,
  MISCONCEPTION_MATCH_THRESHOLD,
  normalizeConceptKey,
} from '../misconception-corpus';

describe('misconception-corpus', () => {
  it('语料可加载且带来源', () => {
    const meta = corpusMeta();
    expect(meta.count).toBeGreaterThan(5);
    expect(meta.version).toBeGreaterThanOrEqual(1);
    for (const entry of listMisconceptions()) {
      expect(entry.statement.length).toBeGreaterThan(6);
      expect(entry.concepts.length).toBeGreaterThan(0);
      expect(String(entry.source || '')).toMatch(/^https?:\/\//);
    }
  });

  it('归一化去掉标点与空白', () => {
    expect(normalizeConceptKey(' 把材料里这句条件，翻译成 能写的区位得分点 ')).toBe('把材料里这句条件翻译成能写的区位得分点');
  });

  it('相似度：同一句 = 1，无关句接近 0', () => {
    expect(conceptSimilarity('信度与效度', '信度与效度')).toBe(1);
    expect(conceptSimilarity('信度与效度', '几何证明')).toBeLessThan(0.3);
  });

  it('长句卡点能命中短名别名（长短句变体）', () => {
    const hit = findMisconceptionFor('把材料里这句条件，翻译成能写的区位得分点');
    expect(hit).not.toBeNull();
    expect(['geo-template-blindness', 'geo-short-chain']).toContain(hit?.id);
  });

  it('同分时取 confidence 高的条目', () => {
    const hit = findMisconceptionFor('信度与效度');
    expect(hit?.id).toBe('psy-reliability-is-not-validity');
  });

  it('无关概念不误命中', () => {
    expect(findMisconceptionFor('量子力学的算符对易关系')).toBeNull();
    expect(findMisconceptionFor('')).toBeNull();
  });

  it('过短的概念不参与匹配', () => {
    expect(findMisconceptionFor('信度')).toBeNull();
  });

  it('阈值常量在合理区间', () => {
    expect(MISCONCEPTION_MATCH_THRESHOLD).toBeGreaterThan(0.5);
    expect(MISCONCEPTION_MATCH_THRESHOLD).toBeLessThan(0.8);
  });
});
