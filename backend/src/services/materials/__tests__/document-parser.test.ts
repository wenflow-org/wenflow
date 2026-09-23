import fs from 'fs';
import path from 'path';
import {
  classifyDocumentExtension,
  evaluateTextLayer,
  getDocumentExt,
  parseDocument,
} from '../document-parser';

const FIXTURE_DOCX = path.join(__dirname, 'fixtures', 'sample.docx');

describe('getDocumentExt', () => {
  it('取小写扩展名，兼容大写与路径', () => {
    expect(getDocumentExt('报告.PDF')).toBe('.pdf');
    expect(getDocumentExt('C:\\a\\b\\课件.docx')).toBe('.docx');
    expect(getDocumentExt('/tmp/x/y.Markdown')).toBe('.markdown');
  });

  it('无扩展名返回空串（不是 undefined）', () => {
    expect(getDocumentExt('无扩展名')).toBe('');
    expect(getDocumentExt('')).toBe('');
  });
});

describe('classifyDocumentExtension', () => {
  it('文本型 → supported', () => {
    for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.markdown']) {
      expect(classifyDocumentExtension(ext)).toBe('supported');
    }
  });

  it('legacy 二进制 → legacy（提示另存）', () => {
    for (const ext of ['.doc', '.ppt', '.xls']) {
      expect(classifyDocumentExtension(ext)).toBe('legacy');
    }
  });

  it('其它（含图片、压缩包）→ unsupported', () => {
    for (const ext of ['.png', '.jpg', '.zip', '.exe', '']) {
      expect(classifyDocumentExtension(ext)).toBe('unsupported');
    }
  });
});

describe('evaluateTextLayer · 文本层闸门', () => {
  it('真实坏例（MIT 讲义 PDF：489 字 / 8 页）判无文本层', () => {
    const result = evaluateTextLayer({ charCount: 489, pageCount: 8 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_text_layer');
  });

  it('真实好例（课件 7741 字 / 27 页）通过', () => {
    expect(evaluateTextLayer({ charCount: 7741, pageCount: 27 }).ok).toBe(true);
  });

  it('短但真实的单页文档（130 字 / 1 页）通过', () => {
    expect(evaluateTextLayer({ charCount: 130, pageCount: 1 }).ok).toBe(true);
  });

  it('整篇过短 → empty_document', () => {
    const result = evaluateTextLayer({ charCount: 40, pageCount: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty_document');
  });

  it('页数未知（docx 等）不额外收紧：未知 ≠ 最小', () => {
    expect(evaluateTextLayer({ charCount: 300, pageCount: null }).ok).toBe(true);
    expect(evaluateTextLayer({ charCount: 300, pageCount: 0 }).ok).toBe(true);
  });
});

describe('parseDocument', () => {
  it('legacy .doc 直接拒收，并给出可展示的中文原因', async () => {
    const result = await parseDocument(Buffer.from('dummy'), '旧文档.doc');
    expect(result.status).toBe('rejected');
    expect(result.rejectReason).toBe('legacy_format');
    expect(result.message).toContain('另存为');
    expect(result.markdown).toBe('');
  });

  it('图片等不支持类型拒收', async () => {
    const result = await parseDocument(Buffer.from([1, 2, 3]), '截图.png');
    expect(result.status).toBe('rejected');
    expect(result.rejectReason).toBe('unsupported_format');
  });

  it('纯文本直读（虽然 .txt 不在 officeparser 支持列表）', async () => {
    const text = '把发展要求翻译成可观察的行为证据，是判断实际情况的关键一步。'.repeat(5);
    const result = await parseDocument(Buffer.from(text, 'utf-8'), '笔记.txt');
    expect(result.status).toBe('ok');
    expect(result.format).toBe('text');
    expect(result.markdown).toBe(text);
    expect(result.charCount).toBe(text.length);
  });

  it('空文本拒收为 empty_document', async () => {
    const result = await parseDocument(Buffer.from('   ', 'utf-8'), '空.md');
    expect(result.status).toBe('rejected');
    expect(result.rejectReason).toBe('empty_document');
  });

  it('Markdown：从 ATX 标题建章节锚点，正文预览跳过网页样板', async () => {
    const md = [
      '# 定积分换元法 - 博客园',
      '',
      '来源: https://example.com/a',
      '',
      '* [首页](/)',
      '* [登录](/login)',
      '',
      '## 换元法',
      '',
      '在我们写出换元法的公式之前，我们**先写清楚它的作用区间**。',
      '',
      '## 分部积分法',
      '',
      '不定积分的分部积分法是根据求导公式推导得出的，在定积分当中同样适用。',
    ].join('\n');

    const result = await parseDocument(Buffer.from(md, 'utf-8'), '讲义.md');
    expect(result.status).toBe('ok');
    expect(result.format).toBe('text');
    expect(result.structure.headingCount).toBe(3);
    expect(result.anchors.map((anchor) => anchor.heading)).toEqual([
      '定积分换元法 - 博客园',
      '换元法',
      '分部积分法',
    ]);
    // 标题下只有「来源/导航」→ 预览为空（下游不会据此产出样板引用）
    expect(result.anchors[0].preview).toBe('');
    expect(result.anchors[1].preview).toContain('先写清楚它的作用区间');
  });

  it('Markdown：标题本身是链接时取链接文字；.txt 不建锚点（保持原行为）', async () => {
    const linked = await parseDocument(
      Buffer.from(
        '# [敲黑板，定积分也有换元法](https://example.com/a "标题")\n\n' +
          '正文内容足够长，可以成为可引用要点。'.repeat(6),
        'utf-8'
      ),
      '链接标题.md'
    );
    expect(linked.status).toBe('ok');
    expect(linked.anchors[0].heading).toBe('敲黑板，定积分也有换元法');

    const plain = await parseDocument(
      Buffer.from('# 这不是标题\n正文段落内容足够长，可以作为可引用要点。'.repeat(3), 'utf-8'),
      '笔记.txt'
    );
    expect(plain.anchors).toEqual([]);
    expect(plain.structure.headingCount).toBe(0);
  });

  it('真 docx：抽出正文、结构与章节锚点', async () => {
    const buffer = fs.readFileSync(FIXTURE_DOCX);
    const result = await parseDocument(buffer, '样本文档.docx');

    expect(result.status).toBe('ok');
    expect(result.format).toBe('docx');
    expect(result.charCount).toBeGreaterThan(100);
    expect(result.markdown).toContain('第一章 目标定位');
    expect(result.structure.headingCount).toBeGreaterThanOrEqual(2);
    expect(result.structure.tableCount).toBeGreaterThanOrEqual(1);
    expect(result.anchors.length).toBeGreaterThan(0);
    expect(result.anchors[0].heading).toContain('第一章');
    expect(result.anchors[0].preview.length).toBeGreaterThan(0);
  });

  it('损坏的 docx 不抛异常，落到 parse_failed', async () => {
    const result = await parseDocument(Buffer.from('not a zip at all'), '坏的.docx');
    expect(result.status).toBe('rejected');
    expect(['parse_failed', 'empty_document']).toContain(result.rejectReason as string);
    expect(result.message).toBeTruthy();
  });
});
