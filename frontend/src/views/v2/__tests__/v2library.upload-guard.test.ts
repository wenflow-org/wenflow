/**
 * 资料库：容量单位、长文件名、上传前校验与拖拽入口（2026-11-11 走查）
 *
 * ① 页头容量「0 B / 200MB」单位空格不一致；卡片 meta 同样出现「2048KB」这类挤在一起的写法。
 * ② 长文件名单行不限高，一份 60 字导出名会把卡片撑到三行；列表高度不齐，也读不出全名。
 * ③ 拖拽不受 input accept 约束，格式/空文件/超配额只在服务端被打回，页面只留最后一条错误。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mockLibrary = vi.fn();
const mockUpload = vi.fn();
vi.mock('@/api/materials', () => ({
  getMaterialLibrary: (...args: unknown[]) => mockLibrary(...args),
  readMaterial: vi.fn(async () => ({ markdown: '' })),
  removeMaterial: vi.fn(async () => ({})),
  uploadMaterial: (...args: unknown[]) => mockUpload(...args)
}));
const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: { success, error: vi.fn() } }));

import V2Library from '../V2Library.vue';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Library.vue'), 'utf8');
const css = source.slice(source.indexOf('<style'));

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
      tableCount: 0, listCount: 0, paragraphCount: 0, chunkCount: 0
    },
    anchors: [],
    warnings: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    origin: 'upload',
    brief: null,
    ...overrides
  };
}

function libraryOf(items: Array<Record<string, unknown>>, quotaBytes = 200 * 1024 * 1024) {
  return {
    items,
    library: {
      total: items.length,
      uploadCount: items.length,
      webCount: 0,
      totalBytes: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      quotaBytes
    }
  };
}

const mountGlobal = {
  stubs: {
    V2Nav: true,
    RouterLink: { template: '<a><slot /></a>' }
  }
};

async function mountLibrary() {
  const w = mount(V2Library, { global: mountGlobal });
  await flushPromises();
  return w;
}

async function pickFiles(w: Awaited<ReturnType<typeof mountLibrary>>, files: File[]) {
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: files, configurable: true });
  await input.trigger('change');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLibrary.mockResolvedValue(libraryOf([]));
});

describe('资料库：容量与长文件名', () => {
  it('单位与数值之间统一一个空格（0 B / 200 MB）', async () => {
    const w = await mountLibrary();
    expect(w.text()).toContain('0 份 · 已用 0 B / 200 MB');
    expect(w.text()).not.toContain('200MB');
    w.unmount();
  });

  it('卡片 meta 同样用带空格的 KB/MB', async () => {
    mockLibrary.mockResolvedValue(libraryOf([baseItem({ size: 2048 })]));
    const w = await mountLibrary();
    expect(w.text()).toContain('2 KB');
    w.unmount();
  });

  it('长文件名最多两行、悬停可读全名', () => {
    expect(css).toMatch(/\.lib-card__title \{[^}]*-webkit-line-clamp:\s*2/);
    expect(source).toContain(':title="item.name"');
  });
});

describe('资料库：上传前校验', () => {
  it('不支持的格式就地说明支持哪些格式，不请求上传', async () => {
    const w = await mountLibrary();
    await pickFiles(w, [new File(['exe'], 'setup.exe', { type: 'application/octet-stream' })]);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(w.text()).toContain('格式不支持');
    expect(w.text()).toContain('PDF / Word / PPT / Excel / TXT / Markdown / CSV');
    expect(w.find('[role="alert"]').exists()).toBe(true);
    w.unmount();
  });

  it('超过剩余配额时说明剩余容量', async () => {
    mockLibrary.mockResolvedValue(libraryOf([], 100));
    const w = await mountLibrary();
    await pickFiles(w, [new File(['x'.repeat(200)], '大文件.pdf', { type: 'application/pdf' })]);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(w.text()).toContain('超出剩余容量');
    expect(w.text()).toContain('剩余 100 B');
    w.unmount();
  });

  it('合法文件照常上传，成功后刷新资料库', async () => {
    mockUpload.mockResolvedValue(baseItem());
    const w = await mountLibrary();
    mockLibrary.mockClear();
    await pickFiles(w, [new File(['hello'], '笔记.md', { type: 'text/markdown' })]);

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('已上传 笔记.md');
    expect(mockLibrary).toHaveBeenCalled();
    w.unmount();
  });

  it('多份文件里失败的原因逐条保留，不只显示最后一条', async () => {
    const w = await mountLibrary();
    await pickFiles(w, [
      new File(['a'], 'a.exe'),
      new File(['b'], 'b.zip')
    ]);
    expect(w.findAll('.library__error p').length).toBe(2);
    w.unmount();
  });
});

describe('资料库：拖拽入口', () => {
  it('拖入文件高亮投放区并提示松开', async () => {
    const w = await mountLibrary();
    const main = w.find('main.library__main');
    expect(main.attributes('class')).not.toContain('library__main--drop');

    await main.trigger('dragenter', { dataTransfer: { types: ['Files'] } });
    expect(main.attributes('class')).toContain('library__main--drop');
    expect(w.text()).toContain('松开即可上传');

    await main.trigger('dragleave', { relatedTarget: null });
    expect(main.attributes('class')).not.toContain('library__main--drop');
    w.unmount();
  });

  it('拖放合法文件走同一套上传', async () => {
    mockUpload.mockResolvedValue(baseItem());
    const w = await mountLibrary();
    const main = w.find('main.library__main');
    await main.trigger('drop', { dataTransfer: { files: [new File(['hi'], '拖入.md')] } });
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
