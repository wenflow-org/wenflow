/**
 * 章节取回单测（parent-child 检索的「取大」半边）：
 * 引文锚定（含空白容忍）/ 标题定位 / 双双未命中回退全文开头 / 空正文。
 */
import { extractSectionWindow } from '../material-sections';

const doc = [
  '# 3-6岁儿童学习与发展指南',
  '说 明',
  '本指南旨在帮助幼儿园教师和家长……',
  '一、健康',
  '（一）身心状况',
  '目标1 具有健康的体态。',
  '教育建议：为幼儿提供营养丰富、健康的饮食。',
  '（二）动作发展',
  '目标2 具有一定的力量和耐力。',
  '二、语言',
  '（一）倾听与表达',
  '目标1 认真听并能听懂常用语言。',
].join('\n');

describe('extractSectionWindow 章节取回', () => {
  it('引文锚定：命中并带出前后文，空白容忍（引文含换行/多空白）', () => {
    const result = extractSectionWindow(doc, { quote: '为幼儿提供\n  营养丰富、健康的饮食。' });
    expect(result.anchor).toBe('quote');
    expect(result.excerpt).toContain('为幼儿提供营养丰富、健康的饮食');
    expect(result.excerpt).toContain('（一）身心状况');
  });

  it('标题定位：从标题行取到窗口', () => {
    const result = extractSectionWindow(doc, { sectionTitle: '二、语言' });
    expect(result.anchor).toBe('title');
    expect(result.excerpt).toContain('（一）倾听与表达');
    expect(result.excerpt).not.toContain('一、健康');
  });

  it('标题优先于引文（消费者要的都是「那一章」）；标题未命中时引文兜底', () => {
    const both = extractSectionWindow(doc, { sectionTitle: '二、语言', quote: '具有一定的力量和耐力' });
    expect(both.anchor).toBe('title');
    expect(both.excerpt).toContain('（一）倾听与表达');

    const quoteOnly = extractSectionWindow(doc, { quote: '具有一定的力量和耐力' });
    expect(quoteOnly.anchor).toBe('quote');
    expect(quoteOnly.excerpt).toContain('力量和耐力');
  });

  it('双未命中 → 回退全文开头（anchor=none，excerpt 非空）', () => {
    const result = extractSectionWindow(doc, { sectionTitle: '不存在的章节', quote: '不存在的引文' });
    expect(result.anchor).toBe('none');
    expect(result.excerpt).toContain('3-6岁儿童学习与发展指南');
  });

  it('空正文 → 空 excerpt', () => {
    expect(extractSectionWindow('', { quote: 'x' }).excerpt).toBe('');
  });

  it('maxChars 上限生效', () => {
    const long = 'A'.repeat(10_000);
    const result = extractSectionWindow(long, { quote: 'A' }, 4000);
    expect(result.excerpt.length).toBeLessThanOrEqual(4002);
  });

  it('目录行不劫持标题定位：取正文候选的最长窗口（docx 装饰形态）', () => {
    // 真实《指南》docx 转 md 形态：目录行 <u>一、健康</u>3，正文标题 <a id>**一、健康**
    const tocDoc = [
      '<u>一、健康</u>3',
      '',
      '<u>二、语言</u>14',
      '',
      '<a id="toc1"></a><a id="ref1"></a>**一、健康**',
      '（一）身心状况',
      '目标1 具有健康的体态。',
      '教育建议：保证幼儿每天睡 11～12 小时。',
      '（二）动作发展',
      '目标2 具有一定的力量和耐力。',
      '<a id="toc2"></a>**二、语言**',
      '（一）倾听与表达',
      '目标1 认真听并能听懂常用语言。',
    ].join('\n');
    const result = extractSectionWindow(tocDoc, { sectionTitle: '一、健康' });
    expect(result.anchor).toBe('title');
    // 落在正文窗口：带出目标/教育建议，且不包含后一章
    expect(result.excerpt).toContain('具有健康的体态');
    expect(result.excerpt).toContain('力量和耐力');
    expect(result.excerpt).not.toContain('倾听与表达');
    // 不是目录那一小段
    expect(result.excerpt.length).toBeGreaterThan(60);
  });
});
