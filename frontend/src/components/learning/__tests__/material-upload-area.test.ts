/**
 * MaterialUploadArea：资料挂载器（2026-11-21 语义重构）的关键约束回归。
 *
 * 约束来源（资料跟路径生成走）：
 *   1. chips 展示的是**本次目标显式挂载**的资料（v-model），不再等于用户资料库；
 *   2. chip × = 从本次目标摘掉（emit 全量列表），**不调 DELETE /materials**——删文件只在 /library；
 *   3. 挂载选择弹层：只列上传来源（联网资料不冒充），勾选回填，上限 3 份；
 *   4. 上传成功 → 自动挂载；被拒收（扫描件等）→ 展示后端中文原因，且**不进挂载列表**；
 *   5. accept 只放开文本型扩展名；同一文件可重复选择（input.value 必须清空）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MaterialUploadArea from '../MaterialUploadArea.vue';
import type { UploadedMaterial } from '@/api/materials';

const mockLibrary = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();

vi.mock('@/api/materials', () => ({
  getMaterialLibrary: (...args: unknown[]) => mockLibrary(...args),
  uploadMaterial: (...args: unknown[]) => mockUpload(...args),
  removeMaterial: (...args: unknown[]) => mockRemove(...args),
}));

function libraryOf(items: Array<Record<string, unknown>>) {
  const uploads = items.filter((item) => item.origin !== 'web');
  return {
    items,
    library: {
      total: items.length,
      uploadCount: uploads.length,
      webCount: items.length - uploads.length,
      uploadBytes: uploads.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      totalBytes: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      quotaBytes: 200 * 1024 * 1024,
    },
  };
}

const mountGlobal = {
  stubs: {
    RouterLink: { template: '<a><slot /></a>' },
  },
};

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
  mockLibrary.mockResolvedValue(libraryOf([]));
});

/** v-model 双向绑定挂载：把组件 emit 的列表回写进 props，模拟父页面的真实接法 */
function mountVModel(initial: UploadedMaterial[] = []) {
  const state = { value: initial as UploadedMaterial[] };
  const wrapper = mount(MaterialUploadArea, {
    props: { modelValue: state.value },
    attrs: {
      'onUpdate:modelValue': (value: UploadedMaterial[]) => {
        state.value = value;
        void wrapper.setProps({ modelValue: value });
      },
    },
    global: mountGlobal,
  });
  return wrapper;
}

describe('MaterialUploadArea（挂载器语义）', () => {
  it('库和挂载都为空时整体退场（不占输入框上方的行）', async () => {
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();
    expect(w.classes()).toContain('mat-upload--empty');
  });

  it('库里有文件但未挂载 → 不渲染任何说明行（不占输入框上方空间），库文件也不冒充 chips', async () => {
    mockLibrary.mockResolvedValue(libraryOf([baseMaterial()]));
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();
    expect(w.classes()).not.toContain('mat-upload--empty');
    // 说明性文案彻底撤出 composer（2026-11-21 走查）：挂载语义只在挂载弹层里交代
    expect(w.find('.mat-upload__meta').exists()).toBe(false);
    expect(w.find('.mat-upload__note').exists()).toBe(false);
    // 库文件不再冒充已挂载 chips
    expect(w.find('.mat-upload__chips').exists()).toBe(false);
  });

  it('挂载弹层底栏交代挂载语义并保留库管理入口', async () => {
    mockLibrary.mockResolvedValue(libraryOf([baseMaterial()]));
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();
    await (w.vm as unknown as { openPicker: () => Promise<void> }).openPicker();
    await flushPromises();
    expect(w.find('.mat-upload__picker-hint').text()).toContain('进入路径生成');
    const lib = w.find('.mat-upload__picker-lib');
    expect(lib.exists()).toBe(true);
    expect(lib.text()).toBe('管理资料库');
  });

  it('v-model 挂载列表 → chips 展示；× 只摘挂载并 emit 全量列表，不删库文件', async () => {
    const m1 = baseMaterial();
    const m2 = baseMaterial({ id: 'm2', name: '笔记.md', charCount: 800 });
    const w = mount(MaterialUploadArea, {
      props: { modelValue: [m1, m2] },
      global: mountGlobal,
    });
    await flushPromises();

    const chips = w.findAll('.mat-upload__chip:not(.mat-upload__chip--more)');
    expect(chips.length).toBe(2);
    expect(chips[0].text()).toContain('指南.txt');

    await w.find('.mat-upload__chip-x').trigger('click');
    await flushPromises();

    const updates = w.emitted('update:modelValue');
    expect(updates).toBeTruthy();
    const latest = (updates as unknown[][][]).at(-1)![0] as Array<{ id: string }>;
    expect(latest.map((item) => item.id)).toEqual(['m2']);
    // 关键：摘掉 ≠ 删除资料库文件
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('挂载选择弹层：默认空态不列资料库，展开后只列上传来源、勾选回填、第 4 份被禁用', async () => {
    const uploads = [1, 2, 3, 4].map((i) => baseMaterial({ id: `m${i}`, name: `资料${i}.txt` }));
    const web = baseMaterial({ id: 'w1', name: '联网资料.md', origin: 'web' });
    mockLibrary.mockResolvedValue(libraryOf([...uploads, web]));
    const w = mount(MaterialUploadArea, {
      props: { modelValue: [uploads[0], uploads[1], uploads[2]] },
      global: mountGlobal,
    });
    await flushPromises();

    await (w.vm as unknown as { openPicker: () => Promise<void> }).openPicker();
    await flushPromises();

    // 默认收起：列表只显示本次已挂载的 3 份，资料库不冒出来
    expect(w.findAll('.mat-upload__picker-row').length).toBe(3);

    // 点「从资料库选择」展开 → 未挂载的第 4 份出现，联网资料仍不进弹层
    await w.find('.mat-upload__picker-browse').trigger('click');
    await flushPromises();
    const rows = w.findAll('.mat-upload__picker-row');
    expect(rows.length).toBe(4); // 已挂载 3 + 库里未挂载 1；联网资料被过滤
    expect(w.text()).not.toContain('联网资料.md');
    // 前 3 份已挂载（勾选），第 4 份 disabled
    const boxes = w.findAll('.mat-upload__picker-row input[type="checkbox"]');
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true);
    expect((boxes[3].element as HTMLInputElement).disabled).toBe(true);
  });

  it('新对话（什么都没挂）打开弹层 → 空态一句话，不列任何资料', async () => {
    mockLibrary.mockResolvedValue(libraryOf([baseMaterial()]));
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();
    await (w.vm as unknown as { openPicker: () => Promise<void> }).openPicker();
    await flushPromises();

    expect(w.findAll('.mat-upload__picker-row').length).toBe(0);
    expect(w.find('.mat-upload__picker-empty').text()).toContain('还没挂载资料');
    // 点「从资料库选择」→ 资料库才展开
    await w.find('.mat-upload__picker-browse').trigger('click');
    await flushPromises();
    expect(w.findAll('.mat-upload__picker-row').length).toBe(1);
  });

  it('弹层取消勾选 → emit 列表摘掉该项', async () => {
    const m1 = baseMaterial();
    const m2 = baseMaterial({ id: 'm2', name: '笔记.md', charCount: 800 });
    mockLibrary.mockResolvedValue(libraryOf([m1, m2]));
    const w = mount(MaterialUploadArea, {
      props: { modelValue: [m1] },
      global: mountGlobal,
    });
    await flushPromises();
    await (w.vm as unknown as { openPicker: () => Promise<void> }).openPicker();
    await flushPromises();

    // m1 已挂载（勾选）→ 再点取消勾选
    const firstBox = w.find('.mat-upload__picker-row input[type="checkbox"]');
    expect((firstBox.element as HTMLInputElement).checked).toBe(true);
    await firstBox.setValue(false);
    await flushPromises();

    const updates = w.emitted('update:modelValue');
    const latest = (updates as unknown[][][]).at(-1)![0] as Array<{ id: string }>;
    expect(latest).toEqual([]);
  });

  it('上传成功 → 自动挂载（emit 含新项），完整元信息在 title', async () => {
    mockUpload.mockResolvedValue(baseMaterial());
    mockLibrary
      .mockResolvedValueOnce(libraryOf([]))
      .mockResolvedValueOnce(libraryOf([baseMaterial()]));
    const w = mountVModel();
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '指南.txt', { type: 'text/plain' })]);
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const updates = w.emitted('update:modelValue');
    const latest = (updates as unknown[][][]).at(-1)![0] as Array<{ id: string; name: string }>;
    expect(latest.map((item) => item.id)).toEqual(['m1']);
    const chip = w.find('.mat-upload__chip');
    expect(chip.text()).toContain('指南.txt');
    expect(chip.attributes('title')).toContain('1200 字');
    expect(chip.attributes('title')).toContain('3 个小标题');
  });

  it('被拒收（扫描件）→ 展示后端中文原因，且不进挂载列表', async () => {
    mockUpload.mockRejectedValue({ message: '这份文件没有可提取的文本（多为扫描件或图片型 PDF），暂时读不了' });
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '扫描件.pdf')]);
    await flushPromises();

    expect(w.find('.mat-upload__error').text()).toContain('没有可提取的文本');
    expect(w.find('.mat-upload__chips').exists()).toBe(false);
    expect(w.emitted('update:modelValue')).toBeFalsy();
  });

  it('多选上传时逐份处理并自动挂载：一份失败不影响其余', async () => {
    mockUpload
      .mockRejectedValueOnce({ message: '暂不支持 .doc' })
      .mockResolvedValueOnce(baseMaterial({ id: 'm2', name: '笔记.md', charCount: 800 }));
    mockLibrary
      .mockResolvedValueOnce(libraryOf([]))
      .mockResolvedValueOnce(libraryOf([baseMaterial({ id: 'm2', name: '笔记.md', charCount: 800 })]));
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '旧.doc'), new File(['y'], '笔记.md')]);
    await flushPromises();

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(w.find('.mat-upload__error').text()).toContain('暂不支持 .doc');
    const updates = w.emitted('update:modelValue');
    const latest = (updates as unknown[][][]).at(-1)![0] as Array<{ id: string }>;
    expect(latest.map((item) => item.id)).toEqual(['m2']);
  });

  it('挂载满 3 份后再拖入上传：不自动追加并提示上限', async () => {
    const attached = [1, 2, 3].map((i) => baseMaterial({ id: `m${i}`, name: `资料${i}.txt` }));
    mockUpload.mockResolvedValue(baseMaterial({ id: 'm9', name: '新文件.txt' }));
    const w = mount(MaterialUploadArea, {
      props: { modelValue: attached },
      global: mountGlobal,
    });
    await flushPromises();

    await (w.vm as unknown as { addFiles: (files: File[]) => Promise<void> })
      .addFiles([new File(['x'], '新文件.txt', { type: 'text/plain' })]);
    await flushPromises();

    expect(w.find('.mat-upload__error').text()).toContain('最多挂载 3 份');
    const updates = w.emitted('update:modelValue');
    // 满载时不上报新列表（挂载集不变）
    expect(updates).toBeFalsy();
  });

  it('accept 只放开文本型扩展名，不含图片与 legacy .doc', async () => {
    const w = mount(MaterialUploadArea, { global: mountGlobal });
    await flushPromises();
    const accept = w.find('input[type="file"]').attributes('accept') || '';
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.pptx');
    expect(accept).toContain('.txt');
    expect(accept).not.toContain('.png');
    expect(accept).not.toContain('.doc,');
  });

  it('选择文件后清空 input.value，保证同名文件可再次选择', async () => {
    mockUpload.mockResolvedValue(baseMaterial());
    const w = mount(MaterialUploadArea, { global: mountGlobal });
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
});
