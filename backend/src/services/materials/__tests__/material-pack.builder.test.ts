/**
 * 附件 → 资料包 转换单测（纯本地，无网络/LLM）。
 *
 * 验收点：
 *   1) 有章节锚点的文档 → sections[].id 稳定（s-N）、keyPoints 带**逐字引文**与 attachment:// 来源；
 *   2) 无锚点（txt/md）→ 回退用原文行当要点，同样满足"有引文"硬约束；
 *   3) 空内容 → not_found（不得用记忆冒充）；
 *   4) 上限（包数/章节/要点）生效；
 *   5) 开关 MATERIAL_UPLOAD_INJECTION_DISABLED=1 → 不产出；
 *   6) 用户隔离：读不到别人的附件。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MAX_PACK_KEY_POINTS,
  MAX_UPLOAD_MATERIAL_PACKS,
  attachmentSourceUrl,
  buildPackFromMaterial,
  buildUploadedMaterialPacks,
  isUploadMaterialInjectionEnabled,
} from '../material-pack.builder';
import { writeMaterial, type MaterialRecord } from '../material-store';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-pack-'));
  process.env.MATERIAL_UPLOAD_DIR = root;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  delete process.env.MATERIAL_UPLOAD_INJECTION_DISABLED;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

function makeRecord(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    userId: 'user-1',
    name: '指南.pdf',
    ext: '.pdf',
    format: 'pdf',
    size: 1000,
    charCount: 500,
    structure: {
      pageCount: 4, slideCount: 0, sheetCount: 0, headingCount: 2,
      tableCount: 1, listCount: 0, paragraphCount: 10, chunkCount: 3,
    },
    anchors: [
      { heading: '一、健康领域', location: '2', preview: '健康包括身心状况、动作发展和生活习惯三个方面' },
      { heading: '一、健康领域', location: '3', preview: '动作发展目标包括具有一定的平衡能力' },
      { heading: '二、语言领域', location: '4', preview: '语言领域包括倾听与表达、阅读与书写准备' },
    ],
    warnings: [],
    createdAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPackFromMaterial', () => {
  it('章节按标题去重并编号 s-N；要点带逐字引文与 attachment 来源', () => {
    const record = makeRecord();
    const result = buildPackFromMaterial(record, '正文……');

    expect(result.status).toBe('ok');
    expect(result.pack!.sections.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(result.pack!.sections.map((s) => s.title)).toEqual(['一、健康领域', '二、语言领域']);
    expect(result.pack!.sourceUrl).toBe(attachmentSourceUrl('指南.pdf'));

    expect(result.pack!.keyPoints).toHaveLength(3);
    for (const point of result.pack!.keyPoints) {
      expect(point.cite.length).toBeGreaterThan(0);
      expect(point.sourceUrl).toBe(attachmentSourceUrl('指南.pdf'));
    }
    // 要点 text 前置章节名，便于路径里程碑"引用资料条目"
    expect(result.pack!.keyPoints[0].text).toContain('一、健康领域');
    // 引文是原文，不是转述
    expect(result.pack!.keyPoints[0].cite).toBe('健康包括身心状况、动作发展和生活习惯三个方面');
    expect(result.provenance).toHaveLength(3);
  });

  it('无锚点（纯文本）→ 用原文行当要点，仍满足"引文非空"', () => {
    const record = makeRecord({ name: '笔记.txt', ext: '.txt', format: 'text', anchors: [] });
    const markdown = [
      '# 第一节 目标定位',
      '把发展要求翻译成可观察的行为证据，是判断实际情况的关键一步。',
      '短',
      '无标题的纯文本段落也能作为可引用要点，供路径里程碑核对。',
    ].join('\n');

    const result = buildPackFromMaterial(record, markdown);
    expect(result.status).toBe('ok');
    expect(result.pack!.keyPoints.length).toBeGreaterThanOrEqual(2);
    expect(result.pack!.keyPoints[0].cite).toContain('目标定位');
    expect(result.pack!.sections.length).toBeGreaterThan(0);
  });

  it('无锚点纯文本：网页样板（来源/导航/日期）不进章节与要点', () => {
    const record = makeRecord({ name: '网页.md', ext: '.md', format: 'text', anchors: [] });
    const markdown = [
      '# 小学数学行程知识点',
      '来源: https://www.example.com/a',
      '* [首页](/)',
      '* [教育资源](/resource.html)',
      ':   2018-12-18 11:52:00',
      '',
      '行程问题是小学数学考试的四大题型之一(计算、数论、几何、行程)。',
      '建议熟练应用标准解法，即 s=v×t 结合标准线段画图解答。',
    ].join('\n');

    const result = buildPackFromMaterial(record, markdown);
    const cites = result.pack!.keyPoints.map((point) => point.cite);
    expect(cites).toContain('行程问题是小学数学考试的四大题型之一(计算、数论、几何、行程)。');
    expect(cites.some((cite) => cite.includes('建议熟练应用标准解法'))).toBe(true);
    expect(cites.some((cite) => /来源|首页|教育资源|2018-12-18/.test(cite))).toBe(false);
  });

  it('有锚点时也用正文行补齐要点（锚点稀疏不会让要点变空）', () => {
    const record = makeRecord({
      anchors: [{ heading: '换元法', location: '', preview: '在我们写出换元法的公式之前，先写清楚作用区间。' }],
    });
    const markdown = [
      '正文第一段内容足够长，可以作为可引用要点。',
      '正文第二段内容也足够长，可以作为可引用要点。',
    ].join('\n');

    const result = buildPackFromMaterial(record, markdown);
    expect(result.pack!.keyPoints).toHaveLength(3);
    expect(result.pack!.keyPoints[0].text).toContain('换元法');
  });

  it('没有任何可用原文 → not_found（不用记忆冒充）', () => {
    const record = makeRecord({ anchors: [] });
    const result = buildPackFromMaterial(record, '短\n');
    expect(result.status).toBe('not_found');
    expect(result.pack).toBeNull();
    expect(result.notes.join(' ')).toContain('没有可引用的原文片段');
  });

  it('要点数量受上限约束', () => {
    const anchors = Array.from({ length: MAX_PACK_KEY_POINTS + 8 }, (_, index) => ({
      heading: `章节${index}`,
      location: String(index),
      preview: `第 ${index} 条原文片段，长度足够成为可引用要点。`,
    }));
    const result = buildPackFromMaterial(makeRecord({ anchors }), '正文');
    expect(result.pack!.keyPoints).toHaveLength(MAX_PACK_KEY_POINTS);
  });

  it('解析 warning 进入 notes（让下游看见"内容被截断"之类）', () => {
    const result = buildPackFromMaterial(makeRecord({ warnings: ['内容过长，已截断存储'] }), '正文');
    expect(result.notes.join(' ')).toContain('内容过长');
  });
});

describe('buildUploadedMaterialPacks', () => {
  it('读取该用户已落盘的附件，新→旧，最多 MAX_UPLOAD_MATERIAL_PACKS 份', () => {
    for (let index = 0; index < MAX_UPLOAD_MATERIAL_PACKS + 2; index += 1) {
      const record = makeRecord({
        id: `1111111${index}-2222-3333-4444-555555555555`.slice(0, 36),
        name: `资料${index}.pdf`,
        createdAt: `2026-09-2${index}T00:00:00.000Z`,
      });
      writeMaterial(record, '正文');
    }

    const packs = buildUploadedMaterialPacks('user-1');
    expect(packs).toHaveLength(MAX_UPLOAD_MATERIAL_PACKS);
    // 最新的一份排在最前
    expect(packs[0].pack!.title).toContain('资料');
  });

  it('没有附件 → 空数组（对路径零影响）', () => {
    expect(buildUploadedMaterialPacks('user-1')).toEqual([]);
    expect(buildUploadedMaterialPacks('')).toEqual([]);
  });

  it('不会读到别人的附件', () => {
    const record = makeRecord({ userId: 'user-2', name: '别人的.pdf' });
    writeMaterial(record, '正文');
    expect(buildUploadedMaterialPacks('user-1')).toEqual([]);
    expect(buildUploadedMaterialPacks('user-2')).toHaveLength(1);
  });

  it('开关关闭 → 不产出（灰度回滚能力）', () => {
    const record = makeRecord();
    writeMaterial(record, '正文');
    expect(buildUploadedMaterialPacks('user-1')).toHaveLength(1);

    process.env.MATERIAL_UPLOAD_INJECTION_DISABLED = '1';
    expect(isUploadMaterialInjectionEnabled()).toBe(false);
    expect(buildUploadedMaterialPacks('user-1')).toEqual([]);
  });
});
