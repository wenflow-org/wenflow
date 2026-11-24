/**
 * 短文档目录保真：有显式 anchors 时，语义化打包不得用合并后的 chunk 覆盖章节树。
 * 2026-11-24 实证：408 字/10 章的合成手册被 900 字 chunk 并成 1 节，Goal/Path 的目录导航失效。
 */
import { buildPackFromMaterialAsync, buildPackFromMaterial } from '../material-pack.builder';
import type { MaterialRecord } from '../material-store';

jest.mock('../material-semantic.service', () => ({
  DEFAULT_SEMANTIC_TIMEOUT_MS: 1000,
  isMaterialSemanticEnabled: () => true,
  ensureMaterialVectorIndex: async () => ({
    chunks: [{ id: 'c-1', title: '合并后的一整块', text: '十个章节被并成一块', charCount: 10, index: 0 }],
  }),
  selectRepresentativeText: async () => '语义摘要',
  selectStratifiedChunks: (chunks: unknown[]) => chunks,
}));

function makeRecord(): MaterialRecord {
  const headings = ['一、产品定位', '二、核心工作流', '三、数据模型', '四、权限与角色'];
  const body = '这是一段可引用的章节正文，用来验证锚点目录在语义打包后仍然完整。';
  const markdown = headings.map((heading) => `# ${heading}\n\n${body}`).join('\n\n');
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    userId: 'user-1',
    name: '手册.md',
    ext: '.md',
    format: 'markdown',
    size: markdown.length,
    charCount: markdown.length,
    structure: {
      pageCount: 0, slideCount: 0, sheetCount: 0, headingCount: headings.length,
      tableCount: 0, listCount: 0, paragraphCount: 4, chunkCount: 1,
    },
    anchors: headings.map((heading, index) => ({
      heading,
      location: String(index + 1),
      preview: body,
    })),
    warnings: [],
    origin: 'upload',
    createdAt: new Date().toISOString(),
  };
}

describe('buildPackFromMaterialAsync × anchors 目录', () => {
  it('有 3+ 锚点的短文档：sections 保留完整章节树，不被语义 chunk 覆盖', async () => {
    const record = makeRecord();
    const markdown = record.anchors.map((anchor) => `# ${anchor.heading}\n\n${anchor.preview}`).join('\n\n');
    const sync = buildPackFromMaterial(record, markdown);
    expect(sync.pack?.sections.length).toBeGreaterThanOrEqual(4);
    expect(sync.pack?.sections.slice(0, 4).map((section) => section.title)).toEqual(
      record.anchors.map((anchor) => anchor.heading),
    );

    const asyncResult = await buildPackFromMaterialAsync(record, markdown);
    expect(asyncResult.pack?.sections.map((section) => section.title)).toEqual(
      sync.pack?.sections.map((section) => section.title),
    );
    // 语义摘要仍可替换 tldr，但目录必须保真
    expect(asyncResult.pack?.tldr).toBe('语义摘要');
  });
});
