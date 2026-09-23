/**
 * MaterialUploadArea：上传资料区的关键约束回归。
 *
 * 约束来源（2026-09-22 定稿，2026-09-23 附件层移入输入框后更新）：
 *   1. 入口与格式说明在父级回形针按钮的 title 里，accept 只放开文本型扩展名；
 *   2. 上传失败（扫描件 / legacy .doc 等被后端拒收）时展示后端的中文原因，且**不进列表**；
 *   3. 同一文件可重复选择（input.value 必须清空，否则第二次选同名文件不触发 change）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MaterialUploadArea from '../MaterialUploadArea.vue';

const mockList = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();

vi.mock('@/api/materials', () => ({
  listMaterials: (...args: unknown[]) => mockList(...args),
  uploadMaterial: (...args: unknown[]) => mockUpload(...args),
  removeMaterial: (...args: unknown[]) => mockRemove(...args),
}));

function baseMaterial(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: '指南.txt',
    ext: '.txt',
    format: 'text',
    size: 100,
    charCount: 1200,
    structure: {
      pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 3,
      tableCount: 0, listCount: 0, paragraphCount: 0, chunkCount: 0,
    },
    anchors: [],
    warnings: [],
    createdAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe('MaterialUploadArea', () => {
  it('无资料时整体退场（display:none，不占输入框上方的行）', async () => {
    const w = mount(MaterialUploadArea);
    await flushPromises();
    expect(w.classes()).toContain('mat-upload--empty');
    expect(w.classes()).toContain('mat-upload--empty');
  });

  it('chips 超过 4 份折叠为 +N，点击展开', async () => {
    mockList.mockResolvedValue([1, 2, 3, 4, 5, 6].map((i) => baseMaterial({ id: `m${i}`, name: `资料${i}.txt` })));
    const w = mount(MaterialUploadArea);
    await flushPromises();
    const chips = () => w.findAll('.mat-upload__chip:not(.mat-upload__chip--more)');
    expect(chips().length).toBe(4); // 默认只显 4 份
    const more = w.find('.mat-upload__chip--more');
    expect(more.text()).toBe('+2');
    await more.trigger('click');
    expect(chips().length).toBe(6);
  });

  it('accept 只放开文本型扩展名，不含图片与 legacy .doc', async () => {
    const w = mount(MaterialUploadArea);
    await flushPromises();
    const accept = w.find('input[type="file"]').attributes('accept') || '';
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.pptx');
    expect(accept).toContain('.txt');
    expect(accept).not.toContain('.png');
    expect(accept).not.toContain('.doc,');
  });

  it('上传成功 → 出现在列表并展示结构与字数', async () => {
    mockUpload.mockResolvedValue(baseMaterial());
    const w = mount(MaterialUploadArea);
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '指南.txt', { type: 'text/plain' })]);
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const chip = w.find('.mat-upload__chip');
    expect(chip.text()).toContain('指南.txt');
    // 完整元信息在 title 里（chip 本体只放名字，避免输入框上方过吵）
    expect(chip.attributes('title')).toContain('1200 字');
    expect(chip.attributes('title')).toContain('3 个小标题');
  });

  it('被拒收（扫描件）→ 展示后端中文原因，且不进列表', async () => {
    mockUpload.mockRejectedValue({ message: '这份文件没有可提取的文本（多为扫描件或图片型 PDF），暂时读不了' });
    const w = mount(MaterialUploadArea);
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '扫描件.pdf')]);
    await flushPromises();

    expect(w.find('.mat-upload__error').text()).toContain('没有可提取的文本');
    expect(w.find('.mat-upload__chips').exists()).toBe(false);
  });

  it('多选时逐份处理：一份失败不影响其余', async () => {
    mockUpload
      .mockRejectedValueOnce({ message: '暂不支持 .doc' })
      .mockResolvedValueOnce(baseMaterial({ id: 'm2', name: '笔记.md', charCount: 800 }));
    const w = mount(MaterialUploadArea);
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '旧.doc'), new File(['y'], '笔记.md')]);
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(w.find('.mat-upload__error').text()).toContain('暂不支持 .doc');
    expect(w.text()).toContain('笔记.md');
  });

  it('选择文件后清空 input.value，保证同名文件可再次选择', async () => {
    mockUpload.mockResolvedValue(baseMaterial());
    const w = mount(MaterialUploadArea);
    await flushPromises();

    const input = w.find('input[type="file"]').element as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.txt', { type: 'text/plain' })],
      configurable: true,
    });
    await w.find('input[type="file"]').trigger('change');
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('删除资料 → 从列表移除', async () => {
    mockList.mockResolvedValue([baseMaterial()]);
    mockRemove.mockResolvedValue(undefined);
    const w = mount(MaterialUploadArea);
    await flushPromises();
    expect(w.text()).toContain('指南.txt');

    await w.find('.mat-upload__chip-x').trigger('click');
    await flushPromises();

    expect(mockRemove).toHaveBeenCalledWith('m1');
    expect(w.text()).not.toContain('指南.txt');
  });
});
