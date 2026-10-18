/**
 * material-chunker 单测：确定性分块。
 * 覆盖：预算内合并相邻小节 / 超预算拆分 / 超长段落硬切 / 样板行过滤 / 块数上限 /
 * 真实语料回归（大量短标题行不得炸成碎块）。纯函数，无 mock、无 IO。
 */
import { chunkMaterialMarkdown, chunkEmbedText, MAX_MATERIAL_CHUNKS } from '../material-chunker';

/** 造一段约 n 字的正文（用于精确控制块预算边界）。 */
function body(n: number, seed = '内容'): string {
  return `${seed}`.repeat(Math.ceil(n / 2)).slice(0, n);
}

describe('chunkMaterialMarkdown', () => {
  it('空/纯空白正文 → []', () => {
    expect(chunkMaterialMarkdown('')).toEqual([]);
    expect(chunkMaterialMarkdown('   \n\n  ')).toEqual([]);
  });

  it('预算内合并相邻小节：块标题取首节标题，后续标题留在正文里', () => {
    const md = ['# 一、总则', '本规范适用于所有教学场景。', '## 二、术语', '学习者指接受教学的人。'].join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 400 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe('# 一、总则');
    expect(chunks[0].text).toContain('## 二、术语');
    expect(chunks[0].text).toContain('学习者指接受教学的人');
  });

  it('超出预算则拆分，各块保留自己的小节标题', () => {
    const md = ['# 一、总则', body(200), '# 二、术语', body(200, '术语')].join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].title).toBe('# 一、总则');
    expect(chunks.map((c) => c.text).join('\n')).toContain('术语');
  });

  it('块 id 与 index 按正文顺序稳定', () => {
    const md = ['# 甲', body(250)].concat(['# 乙', body(250, '乙')]).join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 300 });
    chunks.forEach((chunk, i) => {
      expect(chunk.id).toBe(`c-${i + 1}`);
      expect(chunk.index).toBe(i);
    });
  });

  it('识别中文标题形态（第X部分 / 一、 / （一） / 1、）——标题都留在正文里', () => {
    const md = ['第一部分 概述', body(150, '概'), '一、背景', body(150, '背'), '（一）细节', body(150, '细'), '1、要点', body(150, '要')].join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 200 });
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('第一部分 概述');
    expect(all).toContain('一、背景');
    expect(all).toContain('（一）细节');
    expect(all).toContain('1、要点');
  });

  it('超长单节按段落聚合为多块，且相邻块有重叠', () => {
    const para = '这是一个用于填充的段落，包含足够的文字内容以撑开分块预算。'.repeat(3);
    const md = ['# 长章节'].concat(Array.from({ length: 6 }, (_, i) => `${para}段落${i}。`)).join('\n\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 300, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.charCount).toBeLessThanOrEqual(300 + 60);
    }
    const tail = chunks[0].text.slice(-30);
    expect(chunks[1].text.startsWith(tail) || chunks[1].text.includes(tail)).toBe(true);
  });

  it('过滤页码/页眉类样板行', () => {
    const md = ['# 正文标题', '作者：某某', '第 3 页', '这是真正的正文内容，描述学习理论。'].join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 400 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('这是真正的正文内容');
    expect(chunks[0].text).not.toContain('第 3 页');
  });

  it('单段超长（无空行）→ 硬切成 ≤ maxChars 的多块，内容不丢', () => {
    const md = '# 单段长文\n' + '这是一段没有空行分隔的超长正文内容。'.repeat(300);
    const chunks = chunkMaterialMarkdown(md, { maxChars: 900, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(900);
    }
    expect(chunks.map((c) => c.text).join('').length).toBeGreaterThanOrEqual(4800);
  });

  it('长行（>40 字）即使以「一、」开头也不算标题', () => {
    const longLine = `一、${'为深入贯彻相关要求我们现将有关事项说明如下内容'.repeat(3)}`;
    const md = ['# 真标题', '这是前置正文内容描述。', longLine].join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 600 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe('# 真标题');
    expect(chunks[0].text).toContain('为深入贯彻');
  });

  it('超 maxChunks 时截断（保头部）', () => {
    const md = Array.from({ length: 30 }, (_, i) => `# 章节${i}\n${body(150, `章${i}`)}`).join('\n');
    const chunks = chunkMaterialMarkdown(md, { maxChars: 200, maxChunks: 5 });
    expect(chunks).toHaveLength(5);
  });

  // —— 真实语料回归（2026-10-16）：考试大纲/规范类文档满是短标题行 ——
  it('大量短标题行不得炸成碎块（真机：初版中位块长仅 37 字）', () => {
    const md = Array.from({ length: 100 }, (_, i) => `一、要点${i}\n该要点的说明内容${i}。`).join('\n');
    const chunks = chunkMaterialMarkdown(md);
    expect(chunks.length).toBeLessThan(MAX_MATERIAL_CHUNKS);
    expect(chunks.length).toBeLessThan(20);
    // 合并后的块都应接近预算（不是几十字的碎块）
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.charCount).toBeGreaterThan(400);
    }
    // 内容不丢：所有要点都还在
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('要点0');
    expect(all).toContain('要点99');
  });

  it('短标题行不触发块数上限（真机：42 份资料因碎块丢掉三成正文）', () => {
    const md = Array.from({ length: 900 }, (_, i) => `第${i + 1}条 ${body(30, `规${i}`)}`).join('\n');
    const chunks = chunkMaterialMarkdown(md);
    expect(chunks.length).toBeLessThan(MAX_MATERIAL_CHUNKS);
    expect(chunks.map((c) => c.text).join('\n')).toContain('第900条');
  });
});

describe('chunkEmbedText', () => {
  it('标题不是正文前缀时，前置标题作为语境', () => {
    expect(chunkEmbedText({ id: 'c-1', title: '一、健康', text: '身体与动作发展。', charCount: 7, index: 0 }))
      .toBe('一、健康\n身体与动作发展。');
  });

  it('正文已以标题开头时不重复', () => {
    expect(chunkEmbedText({ id: 'c-1', title: '一、健康', text: '一、健康\n身体与动作发展。', charCount: 14, index: 0 }))
      .toBe('一、健康\n身体与动作发展。');
  });
});
