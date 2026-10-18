/**
 * 清理旧账号向导（VirtualLearnerCleanup，2026-10-10）回归：
 * 口径 = 建号早于保留期 且 非进行中 且 不命中保留名单 tag；
 * 交互 = 预览（删 N / 豁免分项）→ askConfirm(danger) → 分批（≤100/批）调 batch-delete → toast + 刷新。
 * 断言 = 判定谓词与分批契约（视觉骨架），像素细节归浏览器人工复核。
 * 注意：模态 Teleport 到 body，查询走 document.body（batch 测试同判例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearnerCleanup from '../VirtualLearnerCleanup.vue';
import Confirm from '../Confirm.vue';
import { settleConfirm, confirmState } from '../useConfirm';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveLoading: ref(false),
    liveFailures: ref({}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e)
  };
});

const { batchDeleteMock } = vi.hoisted(() => ({
  batchDeleteMock: vi.fn(async (ids: string[]): Promise<{ data: { data: Record<string, unknown> } }> => ({ data: { data: { deleted: ids, skipped: [], errors: [] } } }))
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    batchDeleteVirtualLearners: batchDeleteMock
  }
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { toast } from '@/utils/toast';

const NOW = Date.parse('2026-10-10T12:00:00+08:00');
beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  document.body.innerHTML = '';
});

const mk = (over: Record<string, unknown>) => ({
  id: 'x', name: 'n', goal: '', storyCount: 0, pathCount: 0, sessions: 1,
  runningCount: 0, pausedCount: 0, failedCount: 0, stalledCount: 0,
  runningSessionIds: [], currentStage: null,
  createdAt: '2026-09-01T00:00:00+08:00', created: 'x', tags: [] as string[],
  ...over
});

const samples = [
  mk({ id: 'old-1', name: '旧账号一', createdAt: '2026-09-01T00:00:00+08:00', sessions: 3 }),
  mk({ id: 'old-2', name: '旧账号二', createdAt: '2026-09-20T00:00:00+08:00' }),
  mk({ id: 'fresh', name: '新账号', createdAt: '2026-10-09T00:00:00+08:00' }),
  mk({ id: 'running', name: '进行中', createdAt: '2026-09-01T00:00:00+08:00', runningCount: 1 }),
  mk({ id: 'keep-tag', name: '保留名单', createdAt: '2026-09-01T00:00:00+08:00', tags: ['cohort-keep'] }),
  mk({ id: 'no-date', name: '无建号', createdAt: '' })
];

const mountWizard = (rows: typeof samples = samples) => mount(VirtualLearnerCleanup, { props: { samples: rows } });
const bodyText = () => document.body.textContent || '';
const bodyButton = (match: (b: HTMLButtonElement) => boolean) =>
  Array.from(document.body.querySelectorAll('button')).find(match);

async function setSelect(value: string) {
  const el = document.body.querySelector('select') as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event('change'));
  await nextTick();
  await flushPromises();
}

async function setTextarea(value: string) {
  const el = document.body.querySelector('textarea') as HTMLTextAreaElement;
  el.value = value;
  el.dispatchEvent(new Event('input'));
  await nextTick();
  await flushPromises();
}

describe('清理旧账号向导 · 判定口径', () => {
  it('保留期 3 天 + 保留名单：旧账号入选，新账号/进行中/保留名单/无建号全部豁免', async () => {
    const w = mountWizard();
    (w.vm as unknown as { open: () => void }).open();
    await nextTick();
    await setTextarea('cohort-keep');
    const summary = bodyText();
    expect(summary).toContain('将删除 2 人');
    expect(summary).toContain('会话 4'); // old-1(3) + old-2(1)
    expect(summary).toContain('豁免 4 人');
    expect(summary).toContain('进行中 1');
    expect(summary).toContain('保留名单 1');
    expect(summary).toContain('建号缺失 1');
    const names = Array.from(document.body.querySelectorAll('.vl-cleanup-name')).map((el) => el.textContent);
    expect(names).toEqual(['旧账号一', '旧账号二']);
    w.unmount();
  });

  it('保留期调到 30 天：全库都在窗口内时空态出现且删除钮禁用', async () => {
    const fresh = [
      mk({ id: 'f1', createdAt: '2026-10-05T00:00:00+08:00' }),
      mk({ id: 'f2', createdAt: '2026-10-09T00:00:00+08:00' })
    ];
    const w = mountWizard(fresh);
    (w.vm as unknown as { open: () => void }).open();
    await nextTick();
    await setSelect('30');
    expect(bodyText()).toContain('没有符合口径的旧账号');
    const del = bodyButton((b) => b.classList.contains('mk-btn--danger')) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    w.unmount();
  });

  it('保留名单：命中 tag 的账号豁免', async () => {
    const w = mountWizard();
    (w.vm as unknown as { open: () => void }).open();
    await nextTick();
    await setTextarea('cohort-keep');
    const names = Array.from(document.body.querySelectorAll('.vl-cleanup-name')).map((el) => el.textContent);
    expect(names).not.toContain('保留名单');
    w.unmount();
  });
});

describe('清理旧账号向导 · 确认与分批执行', () => {
  it('确认后分批（≤100/批）调 batch-delete，成功后 toast + done 事件', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      mk({ id: `old-${i}`, name: `旧${i}`, createdAt: '2026-09-01T00:00:00+08:00' })
    );
    const w = mountWizard(many);
    (w.vm as unknown as { open: () => void }).open();
    await nextTick();
    await flushPromises();
    expect(bodyText()).toContain('将删除 250 人');

    const confirmHost = mount(Confirm, { attachTo: document.body });
    const del = bodyButton((b) => b.classList.contains('mk-btn--danger')) as HTMLButtonElement;
    del.click();
    await flushPromises();
    expect(confirmState.open).toBe(true);
    // 家法：.mk-confirm button [0]=取消 [1]=确认
    [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')][1].click();
    await flushPromises();
    await settleConfirm(true);

    expect(batchDeleteMock).toHaveBeenCalledTimes(3); // 250 → 100+100+50
    const sizes = batchDeleteMock.mock.calls.map((c) => (c[0] as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(toast.success).toHaveBeenCalledWith('已删除 250 个旧账号');
    expect(w.emitted('done')).toBeTruthy();
    confirmHost.unmount();
    w.unmount();
  });

  it('任一批报错即停：不再发后续批次，toast 报失败数', async () => {
    batchDeleteMock.mockImplementationOnce(async (ids: string[]) => ({
      data: { data: { deleted: [], skipped: [], errors: ids.map((id) => ({ id, error: 'boom' })) } }
    }));
    const many = Array.from({ length: 150 }, (_, i) =>
      mk({ id: `old-${i}`, name: `旧${i}`, createdAt: '2026-09-01T00:00:00+08:00' })
    );
    const w = mountWizard(many);
    (w.vm as unknown as { open: () => void }).open();
    await nextTick();
    await flushPromises();

    const confirmHost = mount(Confirm, { attachTo: document.body });
    const del = bodyButton((b) => b.classList.contains('mk-btn--danger')) as HTMLButtonElement;
    del.click();
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')][1].click();
    await flushPromises();
    await settleConfirm(true);

    expect(batchDeleteMock).toHaveBeenCalledTimes(1); // 首批错 → 停
    expect(toast.error).toHaveBeenCalledWith('第 1 批有 100 人删除失败，已停止后续批次');
    expect(toast.success).not.toHaveBeenCalled();
    confirmHost.unmount();
    w.unmount();
  });
});
