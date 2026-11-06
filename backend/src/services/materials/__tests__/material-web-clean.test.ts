/**
 * 联网正文抓取痕迹清洗的单测（2026-11-06 真机样本：《党政机关公文处理工作条例》）。
 *
 * 样本取自实测落盘的 `web-source.md`：英文抓取头 13 行 + `Title/Body (Chinese)` 标记，
 * 正文 `## 第一章` 之后第一至第八章全挤在一个 5752 字长行里，`*第一条*` 斜体标志裸露。
 */
import { sanitizeWebMaterialText } from '../material-web-clean';

const SAMPLE = [
  '# Regulations Regarding Official Document Management Work by Party and Government Institutions (Chinese Text)',
  '',
  'Institutions of Democratic Governance',
  '',
  'Major Law',
  '',
  'Additional Laws and Regulations',
  '',
  'Issued',
  '',
  'Sun, 07/01/2012 - 12:00',
  '',
  'Issuer:',
  '',
  'State Council',
  '',
  "The following text was retrieved from the Central People's Government of the PRC Web site on April 2, 2013.",
  '',
  'Title (Chinese)',
  '',
  '党政机关公文处理工作条例',
  '',
  'Body (Chinese)',
  '',
  '## 第一章　总　　则 *第一条*　为了适应中国共产党机关和国家行政机关工作需要，制定本条例。　　*第二条*　本条例适用于党政机关公文处理工作。',
].join('\n');

describe('sanitizeWebMaterialText：抓取头不进库', () => {
  it('按 Body (Chinese) 切：英文头与 Title 标记全部丢弃，中文标题保留', () => {
    const result = sanitizeWebMaterialText(SAMPLE);
    expect(result.text.startsWith('## 第一章')).toBe(true);
    expect(result.text).not.toContain('Institutions of Democratic Governance');
    expect(result.text).not.toContain('Issued');
    expect(result.text).not.toContain('retrieved from');
    expect(result.text).not.toContain('Title (Chinese)');
    expect(result.strippedHeaderLines).toBeGreaterThan(10);
  });

  it('长行里的每条法条断成独立行（切片与锚点都靠这一步）', () => {
    const result = sanitizeWebMaterialText(SAMPLE);
    expect(result.clauseBreaks).toBe(1);
    expect(result.text).toContain('制定本条例。\n\n**第二条**');
    /* 巨行断行后不再有「整章挤在一行」的形态 */
    const longest = Math.max(...result.text.split('\n').map((line) => line.length));
    expect(longest).toBeLessThan(200);
  });

  it('`*第X条*` 斜体统一成加粗（渲染层不再出斜体条文）', () => {
    const result = sanitizeWebMaterialText(SAMPLE);
    expect(result.text).toContain('**第一条**');
    expect(/^\*第一条\*/m.test(result.text)).toBe(false);
  });

  it('句中引用不断行（「依照本条例第十条规定」属于同一句）', () => {
    const result = sanitizeWebMaterialText('第一条　各级机关依照本条例第十条规定办理。');
    expect(result.clauseBreaks).toBe(0);
    expect(result.text).toBe('第一条　各级机关依照本条例第十条规定办理。');
  });
});

describe('sanitizeWebMaterialText：不误伤正常正文', () => {
  it('中文正文原样返回（没有抓取头可切时一个字都不动）', () => {
    const zh = '## 第一章 总则\n\n第一条 为了统一……';
    const result = sanitizeWebMaterialText(zh);
    expect(result.text).toBe(zh);
    expect(result.strippedHeaderLines).toBe(0);
  });

  it('纯英文正文不被当成抓取头切掉（没有元数据键名）', () => {
    const en = 'Chapter One\n\nThis is a plain English document body about learning methods.';
    const result = sanitizeWebMaterialText(en);
    expect(result.text).toBe(en);
    expect(result.strippedHeaderLines).toBe(0);
  });

  it('无 Body 标记但有元数据键名时，丢开头无中文块', () => {
    const result = sanitizeWebMaterialText(['Issued:', 'State Council', '', '公文处理工作条例', '第一条 内容'].join('\n'));
    expect(result.text.startsWith('公文处理工作条例')).toBe(true);
    expect(result.text).toContain('第一条 内容');
  });

  it('空文本不炸', () => {
    expect(sanitizeWebMaterialText('')).toEqual({ text: '', strippedHeaderLines: 0, clauseBreaks: 0 });
    expect(sanitizeWebMaterialText('   \n  ').text).toBe('');
  });
});
