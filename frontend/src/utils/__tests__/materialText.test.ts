/**
 * 联网采集资料展示层清洗的护栏（2026-11-06 走查，图4/5/6/8）
 *
 * 实测样本就是用户截图里那份《党政机关公文处理工作条例》：开头十几行英文爬虫元数据，
 * 正文 `## 第一章 总则` + `*第一条*` 裸露，几千字不换行。这里锁三件事：
 *  1) `Body (Chinese)` 标记之后才是正文，标记前的英文头一律丢弃；
 *  2) 没有标记时，开头的无中文元数据块也丢，但**第一行中文之后的内容一个字都不许动**；
 *  3) 法条只在句末标点后断段——「依照本条例第十条规定」这种句中引用不许被劈开。
 */
import { describe, expect, it } from 'vitest';
import { dedupeMaterialRefs, looksLikeEnglishTitle, normalizeMaterialMarkdown, stripCrawlMetadata } from '../materialText';

const CRAWLED = `Institutions of Democratic Governance
Major Law
Regulations Regarding the Handling of Official Documents
Issued: Sun, 07/01/2012 - 12:00
Issuer: State Council
The following text was retrieved from the official database.
Title (Chinese)
党政机关公文处理工作条例
Body (Chinese)
## 第一章 总则
*第一条* 为了统一党政机关公文处理工作，制定本条例。
*第二条* 本条例适用于各级党政机关公文处理工作。`;

describe('stripCrawlMetadata：英文爬虫头不进用户视野', () => {
  it('按 Body (Chinese) 标记切，标记前整段丢弃', () => {
    const out = stripCrawlMetadata(CRAWLED);
    expect(out.startsWith('## 第一章 总则'), `首行不是正文：${out.slice(0, 40)}`).toBe(true);
    expect(out).not.toContain('Institutions of Democratic Governance');
    expect(out).not.toContain('Issued:');
    expect(out).not.toContain('retrieved from');
    expect(out, '中文正文必须一字不少').toContain('*第一条* 为了统一党政机关公文处理工作');
  });

  it('标记行自带正文时保留后半段，不把内容一起切掉', () => {
    const out = stripCrawlMetadata('Major Law\nBody (Chinese): 第一条 为了……\n第二条 本条例……');
    expect(out).toBe('第一条 为了……\n第二条 本条例……');
  });

  it('没有标记时按「开头无中文块」跳，遇到第一行中文即停', () => {
    const out = stripCrawlMetadata('Institutions of Democratic Governance\nState Council\n\n公文处理工作条例\n第一条 内容');
    expect(out.startsWith('公文处理工作条例')).toBe(true);
    expect(out).toContain('第一条 内容');
  });

  it('本来就只有中文时原样返回（不许误伤）', () => {
    const zh = '第一章 总则\n第一条 为了统一……';
    expect(stripCrawlMetadata(zh)).toBe(zh);
  });
});

describe('normalizeMaterialMarkdown：法条独立成段、条文加粗', () => {
  it('`*第X条*` 变加粗小标题（斜体读起来像错字）', () => {
    const out = normalizeMaterialMarkdown(CRAWLED);
    expect(out).toContain('**第一条**');
    /* 单星斜体不许残留（`**第一条**` 里天然含有 `*第一条*` 子串，所以按行首模式判） */
    expect(/^\*第一条\*/m.test(out), '单星斜体还在').toBe(false);
  });

  it('句末标点后的「第X条」另起一段', () => {
    const out = normalizeMaterialMarkdown('第一条 甲。第二条 乙。第三条 丙。');
    expect(out.split('\n\n')).toEqual(['第一条 甲。', '第二条 乙。', '第三条 丙。']);
  });

  it('句中引用不断行（「依照本条例第十条规定」是同一句的一部分）', () => {
    const out = normalizeMaterialMarkdown('各级机关依照本条例第十条规定办理。');
    expect(out, '句中引用被劈开了').not.toContain('。\n\n第十条');
    expect(out).toContain('依照本条例第十条规定办理。');
  });

  it('标题行（## 第一章）不被拆散，空行被压到最多一空行', () => {
    const out = normalizeMaterialMarkdown('## 第一章 总则\n\n\n\n第一条 甲。');
    expect(out).toContain('## 第一章 总则');
    expect(out.includes('\n\n\n')).toBe(false);
  });
});

describe('looksLikeEnglishTitle：资料库章节名过滤', () => {
  it('英文标题返回 true，中文标题返回 false', () => {
    expect(looksLikeEnglishTitle('Regulations Regarding the Handling of Official Documents')).toBe(true);
    expect(looksLikeEnglishTitle('第一章 总则')).toBe(false);
    expect(looksLikeEnglishTitle('')).toBe(false);
    expect(looksLikeEnglishTitle('2024')).toBe(false);
  });
});

describe('dedupeMaterialRefs：同一章节只留一条引用', () => {
  it('同章不同引文（后端 sectionId|quote 去重键的产物）收成一条', () => {
    /* 实测：任务 st_…_1_1 下 3 条引用全是 sectionId=ch2 / sectionTitle=公文种类，
       quote 分别是「（九）通报…」「（十一）请示…」「（十四）函…」 */
    const refs = [
      { materialId: 'm1', sectionId: 'ch2', sectionTitle: '公文种类', quote: '（九）通报……' },
      { materialId: 'm1', sectionId: 'ch2', sectionTitle: '公文种类', quote: '（十一）请示……' },
      { materialId: 'm1', sectionId: 'ch2', sectionTitle: '公文种类', quote: '（十四）函……' },
    ];
    expect(dedupeMaterialRefs(refs)).toHaveLength(1);
    expect(dedupeMaterialRefs(refs)[0].quote).toBe('（九）通报……');
  });

  it('不同章节 / 不同资料各自保留', () => {
    const refs = [
      { materialId: 'm1', sectionId: 'ch1', sectionTitle: '总则', quote: 'a' },
      { materialId: 'm1', sectionId: 'ch2', sectionTitle: '公文种类', quote: 'b' },
      { materialId: 'm2', sectionId: 'ch2', sectionTitle: '公文种类', quote: 'c' },
    ];
    expect(dedupeMaterialRefs(refs)).toHaveLength(3);
  });

  it('没有章节标识时按引文/来源区分，不把不同出处合并成一条', () => {
    const refs = [
      { materialId: 'm1', quote: '第一句' },
      { materialId: 'm1', quote: '第二句' },
      { materialId: null, sourceUrl: 'https://a.example/x' },
    ];
    expect(dedupeMaterialRefs(refs)).toHaveLength(3);
  });

  it('空数组 / 脏数据不炸', () => {
    expect(dedupeMaterialRefs([])).toEqual([]);
    expect(dedupeMaterialRefs(null)).toEqual([]);
    expect(dedupeMaterialRefs(undefined)).toEqual([]);
  });
});
