/**
 * 选源多样性 + 语言推断 + 兜底查询单测（2026-09-26，全 mock、无网络）。
 *
 * 背景（当晚联网优化）：
 * - rankSources 原注释承诺"同 host 只留最高优先"但实现只去重了 URL——同站多页会占满
 *   maxSources=5 的抓取名额；修复为 rankSources（纯排序）+ selectDiversifiedSources（入选时 host cap）。
 * - SearchQuery.language 从前没有任何调用方传入（tinyfish/tavily 都真消费），加 detectQueryLanguage 缺省推断。
 * - buildQueries 无显式查询时加「标题 全文」兜底变体（P0-b 教训的检索侧对齐）。
 * - rankSources 新增 preferDocuments=false（课中补充槽语义：要可读讲解页，不要 PDF 原文优先）。
 */
import type { SearchResultItem } from '../../../services/search/types';
import {
  buildQueries,
  detectQueryLanguage,
  documentSourceScore,
  rankSources,
  selectDiversifiedSources,
} from '../index';

function item(position: number, url: string, title = '资料'): SearchResultItem {
  return { position, title, url, snippet: '', provider: 'tinyfish' };
}

describe('selectDiversifiedSources（同 host cap）', () => {
  it('同站多页只放行 maxPerHost 条，不再占满 maxSources 名额', () => {
    const ranked = rankSources([
      item(0, 'https://blog.example.com/1'),
      item(1, 'https://blog.example.com/2'),
      item(2, 'https://blog.example.com/3'),
      item(3, 'https://blog.example.com/4'),
      item(4, 'https://blog.example.com/5'),
    ]);
    const selected = selectDiversifiedSources(ranked, { maxSources: 5 });
    expect(selected).toHaveLength(2); // 5 条同站候选只放 2 条
    expect(selected.map((entry) => entry.url)).toEqual([
      'https://blog.example.com/1',
      'https://blog.example.com/2',
    ]);
  });

  it('多 host 场景：tier 排序不被破坏，被 cap 挤掉的只是同站冗余页', () => {
    const ranked = rankSources([
      item(0, 'https://www.moe.gov.cn/a'),
      item(1, 'https://www.moe.gov.cn/b'),
      item(2, 'https://www.moe.gov.cn/c'),
      item(3, 'https://www.nhc.gov.cn/d'),
      item(4, 'https://example.com/e'),
      item(5, 'https://example.com/f'),
      item(6, 'https://www.unicef.org/g'),
    ]);
    const selected = selectDiversifiedSources(ranked, { maxSources: 5 });
    expect(selected.map((entry) => entry.url)).toEqual([
      'https://www.moe.gov.cn/a',
      'https://www.moe.gov.cn/b',
      'https://www.nhc.gov.cn/d',
      'https://www.unicef.org/g',
      'https://example.com/e',
    ]);
  });

  it('maxPerHost 可放开（strictWhitelist 场景：检索已限定域，cap 只会误伤）', () => {
    const ranked = rankSources([
      item(0, 'https://www.moe.gov.cn/a'),
      item(1, 'https://www.moe.gov.cn/b'),
      item(2, 'https://www.moe.gov.cn/c'),
    ]);
    expect(selectDiversifiedSources(ranked, { maxSources: 5, maxPerHost: 5 })).toHaveLength(3);
  });
});

describe('detectQueryLanguage（检索语言缺省推断）', () => {
  it('CJK ≥2 判 zh；纯 ASCII 词判 en；其余不推断', () => {
    expect(detectQueryLanguage('3-6岁儿童学习与发展指南')).toBe('zh');
    expect(detectQueryLanguage('教育部 数学课程标准')).toBe('zh');
    expect(detectQueryLanguage('Common Core State Standards Mathematics')).toBe('en');
    expect(detectQueryLanguage('12345')).toBeUndefined();
    expect(detectQueryLanguage('')).toBeUndefined();
    expect(detectQueryLanguage('   ')).toBeUndefined();
  });
});

describe('buildQueries（无显式查询时的「标题 全文」兜底变体）', () => {
  it('显式查询优先且去重截断 5 条', () => {
    expect(buildQueries({ title: 't' }, { queries: ['a', 'b', 'a', 'c'] })).toEqual(['a', 'b', 'c']);
  });

  it('无显式查询：主查询（标题+机构+类型）+ 全文变体', () => {
    const queries = buildQueries({ title: '儿童发展指南', publisher: '教育部', kind: '指南' }, {});
    expect(queries).toEqual(['儿童发展指南 教育部 指南', '儿童发展指南 全文']);
  });

  it('英文标题：变体跟随语言（full text），不拼中文「全文」', () => {
    expect(buildQueries({ title: 'Common Core Math Grade 3' }, {})).toEqual([
      'Common Core Math Grade 3',
      'Common Core Math Grade 3 full text',
    ]);
  });

  it('主查询已含 全文/原文 时不加变体（避免重复）', () => {
    const queries = buildQueries({ title: '儿童发展指南全文' }, {});
    expect(queries).toEqual(['儿童发展指南全文']);
  });
});

describe('rankSources preferDocuments=false（补充槽语义）', () => {
  const hardDoc = item(0, 'https://example.com/guide.pdf', '指南全文下载');
  const officialPage = item(1, 'https://www.moe.gov.cn/page', '指南印发通知');

  it('默认（备课采集）：硬文档优先——非官方域的 PDF 压过官方通知页（P0-b 口径不变）', () => {
    expect(documentSourceScore(hardDoc.url, hardDoc.title)).toBe(2);
    expect(rankSources([officialPage, hardDoc])[0].url).toBe('https://example.com/guide.pdf');
  });

  it('preferDocuments=false（课中补充）：tier 优先——官方讲解页压过未知域 PDF', () => {
    expect(rankSources([hardDoc, officialPage], { preferDocuments: false })[0].url).toBe(
      'https://www.moe.gov.cn/page'
    );
  });
});
