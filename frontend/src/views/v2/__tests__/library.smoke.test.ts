import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import V2Library from '../V2Library.vue';

const mockLibrary = vi.fn();
const mockRead = vi.fn();
const mockRemove = vi.fn();
const mockUpload = vi.fn();

vi.mock('@/api/materials', () => ({
  getMaterialLibrary: (...args: unknown[]) => mockLibrary(...args),
  readMaterial: (...args: unknown[]) => mockRead(...args),
  removeMaterial: (...args: unknown[]) => mockRemove(...args),
  uploadMaterial: (...args: unknown[]) => mockUpload(...args),
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: '公司合规手册.md',
    ext: '.md',
    format: 'md',
    size: 2048,
    charCount: 12000,
    structure: {
      pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 3,
      tableCount: 0, listCount: 0, paragraphCount: 0, chunkCount: 0,
    },
    anchors: [{ heading: '合规风险管理', location: '1', preview: '' }],
    warnings: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    origin: 'upload',
    brief: {
      docType: '手册',
      subject: '公司合规',
      audience: '员工',
      overview: '公司合规与风险管理的基础要求。',
      naturalDivisions: ['按主题'],
      toc: [{ title: '合规风险管理', gist: '风险识别与处理' }],
    },
    ...overrides,
  };
}

function libraryOf(items: Array<Record<string, unknown>>) {
  const uploads = items.filter((item) => item.origin !== 'web');
  return {
    items,
    library: {
      total: items.length,
      uploadCount: uploads.length,
      webCount: items.length - uploads.length,
      totalBytes: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      quotaBytes: 200 * 1024 * 1024,
    },
  };
}

const mountGlobal = {
  stubs: {
    V2Nav: true,
    RouterLink: { template: '<a><slot /></a>' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('V2Library', () => {
  it('空库渲染上传空态', async () => {
    mockLibrary.mockResolvedValue(libraryOf([]));
    const w = mount(V2Library, { global: mountGlobal });
    await flushPromises();

    expect(w.text()).toContain('资料库还是空的');
    expect(w.text()).toContain('上传资料');
  });

  it('渲染资料、统计与来源，并支持搜索过滤', async () => {
    mockLibrary.mockResolvedValue(
      libraryOf([
        baseItem({
          usage: {
            pathCount: 1,
            adoptedPathCount: 1,
            refCount: 2,
            paths: [
              { pathId: 'p1', pathTitle: '健康管理师备考路径', adopted: true, refCount: 2, updatedAt: null },
            ],
          },
        }),
        baseItem({
          id: 'w1',
          name: '联网指南.md',
          origin: 'web',
          brief: null,
          anchors: [],
        }),
      ])
    );
    const w = mount(V2Library, { global: mountGlobal });
    await flushPromises();

    expect(w.text()).toContain('公司合规手册.md');
    expect(w.text()).toContain('联网指南.md');
    expect(w.text()).toContain('我上传 1');
    expect(w.text()).toContain('联网采集 1');
    expect(w.text()).toContain('健康管理师备考路径');
    expect(w.text()).toContain('引用 2 处');

    await w.find('input[type="search"]').setValue('合规');
    expect(w.text()).toContain('公司合规手册.md');
    expect(w.text()).not.toContain('联网指南.md');
  });

  it('预览读取正文并展示摘要/原文', async () => {
    mockLibrary.mockResolvedValue(libraryOf([baseItem()]));
    mockRead.mockResolvedValue({ ...baseItem(), markdown: '合规风险管理的原文。' });
    const w = mount(V2Library, { global: mountGlobal });
    await flushPromises();

    await w.findAll('button').find((button) => button.text().includes('预览'))!.trigger('click');
    await flushPromises();

    expect(mockRead).toHaveBeenCalledWith('m1');
    expect(w.text()).toContain('合规风险管理的原文。');
  });

  it('删除弹层显示使用警示', async () => {
    mockLibrary.mockResolvedValue(
      libraryOf([
        baseItem({
          usage: {
            pathCount: 5,
            adoptedPathCount: 5,
            refCount: 9,
            paths: [
              { pathId: 'p1', pathTitle: '健康管理师备考路径', adopted: true, refCount: 4, updatedAt: null },
              { pathId: 'p2', pathTitle: '营养师基础路径', adopted: true, refCount: 3, updatedAt: null },
              { pathId: 'p3', pathTitle: '心理咨询入门路径', adopted: true, refCount: 2, updatedAt: null },
              { pathId: 'p4', pathTitle: '第四条路径', adopted: true, refCount: 0, updatedAt: null },
              { pathId: 'p5', pathTitle: '第五条路径', adopted: true, refCount: 0, updatedAt: null },
            ],
          },
        }),
        baseItem({ id: 'm2', name: '未引用资料.md' }),
      ])
    );
    const w = mount(V2Library, { global: mountGlobal });
    await flushPromises();

    await w.findAll('button').find((button) => button.text().includes('删除'))!.trigger('click');
    expect(w.text()).toContain('这份资料已被 5 条路径引用');
    expect(w.text()).toContain('健康管理师备考路径、营养师基础路径、心理咨询入门路径 等 5 条');
    expect(w.text()).toContain('删除后相关路径不会重建');
    expect(w.text()).not.toContain('第四条路径');

    await w.findAll('button').find((button) => button.text() === '取消')!.trigger('click');
    const deleteButtons = w.findAll('button').filter((button) => button.text().includes('删除'));
    await deleteButtons[deleteButtons.length - 1].trigger('click');
    expect(w.text()).not.toContain('这份资料已被');
  });

  it('使用状态筛选与搜索叠加，空结果走无匹配出口', async () => {
    mockLibrary.mockResolvedValue(
      libraryOf([
        baseItem({
          usage: {
            pathCount: 1,
            adoptedPathCount: 1,
            refCount: 2,
            paths: [
              { pathId: 'p1', pathTitle: '健康管理师备考路径', adopted: true, refCount: 2, updatedAt: null },
            ],
          },
        }),
        baseItem({ id: 'm2', name: '未引用资料.md' }),
      ])
    );
    const w = mount(V2Library, { global: mountGlobal });
    await flushPromises();

    const usageSelect = () => w.find('select[aria-label="使用状态筛选"]');
    await usageSelect().setValue('used');
    expect(w.text()).toContain('公司合规手册.md');
    expect(w.text()).not.toContain('未引用资料.md');

    await usageSelect().setValue('unused');
    expect(w.text()).toContain('未引用资料.md');
    expect(w.text()).not.toContain('公司合规手册.md');

    await usageSelect().setValue('used');
    await w.find('input[type="search"]').setValue('不存在的关键词');
    expect(w.text()).toContain('没有匹配的资料');

    await w.findAll('button').find((button) => button.text().includes('清空筛选'))!.trigger('click');
    expect(w.text()).toContain('公司合规手册.md');
    expect(w.text()).toContain('未引用资料.md');
    expect((usageSelect().element as HTMLSelectElement).value).toBe('all');
  });
});
