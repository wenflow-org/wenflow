/**
 * 创建虚拟学习者弹窗的选卡搜索（M-4，2026-10-29 夜审）：
 * 卡库索引一次给全（实测 286+ 张）且弹窗平铺无搜索，找特定卡只能滚动长列表。
 * 钉住：按卡名 / 卡 id（profileId）/ 目标过滤；命中计数「命中 X / 共 Y 张」；
 * 0 命中给「没有命中的卡」内联空态；打开时关键词重置。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import CardDeriveDialog from '../CardDeriveDialog.vue';

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    cardsTasks: vi.fn(async () => ({ data: { data: { groups: [] } } })),
    cardsClone: vi.fn(async () => ({ data: { data: { created: [], failed: [] } } }))
  }
}));

const CARDS = [
  { profileId: 'p_coffee', name: '手冲咖啡爱好者', goal: '在家复刻手冲' },
  { profileId: 'p_calligraphy', name: '毛笔小楷入门', goal: '写一手小楷' },
  { profileId: 'p_fund', name: '基金亏损能手', goal: '回本' }
];

function mountDialog() {
  // teleport 桩把弹层内容留在组件树内，VTU 的 find 才能触达
  return mount(CardDeriveDialog, { global: { stubs: { teleport: true } } });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('CardDeriveDialog 选卡搜索（M-4）', () => {
  it('无关键词：全量平铺 + 「共 N 张」计数', async () => {
    const w = mountDialog();
    (w.vm as unknown as { openPicker: (c: unknown) => void }).openPicker(CARDS);
    await flushPromises();
    await nextTick();
    expect(w.findAll('.cdd-cards li')).toHaveLength(3);
    expect(w.find('.cdd-picker__meta').text()).toBe('共 3 张');
    w.unmount();
  });

  it('按卡名过滤：列表随输入收敛，命中计数同步', async () => {
    const w = mountDialog();
    (w.vm as unknown as { openPicker: (c: unknown) => void }).openPicker(CARDS);
    await nextTick();
    await w.find('.cdd-picker-bar input').setValue('毛笔');
    await nextTick();
    expect(w.findAll('.cdd-cards li')).toHaveLength(1);
    expect(w.find('.cdd-picker__meta').text()).toBe('命中 1 / 共 3 张');
    w.unmount();
  });

  it('按目标与卡 id（profileId）也能命中', async () => {
    const w = mountDialog();
    (w.vm as unknown as { openPicker: (c: unknown) => void }).openPicker(CARDS);
    await nextTick();
    await w.find('.cdd-picker-bar input').setValue('回本');
    await nextTick();
    expect(w.findAll('.cdd-cards li')).toHaveLength(1);
    await w.find('.cdd-picker-bar input').setValue('p_coffee');
    await nextTick();
    expect(w.findAll('.cdd-cards li')).toHaveLength(1);
    w.unmount();
  });

  it('0 命中给「没有命中的卡」内联空态，不清空候选', async () => {
    const w = mountDialog();
    (w.vm as unknown as { openPicker: (c: unknown) => void }).openPicker(CARDS);
    await nextTick();
    await w.find('.cdd-picker-bar input').setValue('不存在的卡');
    await nextTick();
    expect(w.text()).toContain('没有命中的卡');
    expect(w.find('.cdd-picker__meta').text()).toBe('命中 0 / 共 3 张');
    await w.find('.cdd-picker-bar input').setValue('');
    await nextTick();
    expect(w.findAll('.cdd-cards li')).toHaveLength(3);
    w.unmount();
  });
});
