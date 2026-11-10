/**
 * 按创建时间清理向导（VirtualLearnerCleanup）回归。
 *
 * 2026-11-09 契约变更：候选判定从「客户端对当前载入页的行做」改成「服务端按实例全集算」
 * （GET /cleanup/candidates）——旧口径下列表一次最多 1000 行，超出的同龄实例被静默漏删
 * （向导报「将删除 3 人」，库里还有几百个）。本文件钉住三件事：
 *  ① 名单/豁免口径来自服务端返回（前端只做保留名单过滤），摘要里的豁免分项逐项对上；
 *  ② 保留期变化会带新参数重拉；读取失败时**禁止删除**（不基于半份数据动手）；
 *  ③ 落地仍是分批（≤100/批）调 batch-delete，任一批报错即停。
 * 注意：模态 Teleport 到 body，查询走 document.body（batch 测试同判例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearnerCleanup from '../VirtualLearnerCleanup.vue';
import Confirm from '../Confirm.vue';
import { settleConfirm, confirmState } from '../useConfirm';
import { chooseMkSelect } from '@/components/mk/__tests__/mkSelect';

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

const { batchDeleteMock, candidatesMock } = vi.hoisted(() => ({
  batchDeleteMock: vi.fn(async (ids: string[]): Promise<{ data: { data: Record<string, unknown> } }> => ({ data: { data: { deleted: ids, skipped: [], errors: [] } } })),
  candidatesMock: vi.fn()
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    batchDeleteVirtualLearners: batchDeleteMock,
    getVirtualLearnerCleanupCandidates: candidatesMock
  }
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { toast } from '@/utils/toast';

const NOW = Date.parse('2026-10-10T12:00:00+08:00');

/** 服务端候选行（已排除在跑/保留期内；保留名单命中仍在列表里，由前端按输入过滤） */
const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  name: 'n',
  createdAt: '2026-09-01T00:00:00+08:00',
  sessions: 1,
  tags: [] as string[],
  ...over
});

/** 默认服务端响应：3 个候选（其中 1 个命中保留名单）+ 全库 6 人；保留期 ≥30 天时无候选 */
const serverPayload = (keepDays: number) => (keepDays >= 30
  ? {
      data: {
        data: {
          keepDays,
          total: 6,
          candidates: [],
          exempt: { running: 1, withinKeepWindow: 5 }
        }
      }
    }
  : {
      data: {
        data: {
          keepDays,
          total: 6,
          candidates: [
            candidate({ id: 'old-1', name: '旧账号一', sessions: 3 }),
            candidate({ id: 'old-2', name: '旧账号二' }),
            candidate({ id: 'keep-tag', name: '保留名单', tags: ['cohort-keep'] })
          ],
          exempt: { running: 1, withinKeepWindow: 1 }
        }
      }
    });

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  candidatesMock.mockImplementation(async (params: { keepDays: number }) => serverPayload(params.keepDays));
  batchDeleteMock.mockImplementation(async (ids: string[]) => ({ data: { data: { deleted: ids, skipped: [], errors: [] } } }));
  document.body.innerHTML = '';
});

const mountWizard = () => mount(VirtualLearnerCleanup, {
  attachTo: document.body,
  // Teleport 打平到组件内：既能在 body 里断言，也能用 MkSelect 助手按 aria-label 定位
  global: { stubs: { teleport: true } }
});
const bodyText = () => document.body.textContent || '';
const bodyButton = (match: (b: HTMLButtonElement) => boolean) =>
  Array.from(document.body.querySelectorAll('button')).find(match);
const deleteButton = () => bodyButton((b) => b.classList.contains('mk-btn--danger')) as HTMLButtonElement;
const candidateNames = () =>
  Array.from(document.body.querySelectorAll('.vl-cleanup-name')).map((el) => el.textContent);

async function openWizard(w: VueWrapper) {
  (w.vm as unknown as { open: () => void }).open();
  await nextTick();
  await flushPromises();
}

async function setSelect(w: VueWrapper, value: string) {
  await chooseMkSelect(w as never, '保留最近', value);
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

describe('按创建时间清理向导 · 服务端候选与豁免口径', () => {
  it('候选来自服务端；保留名单在前端过滤，摘要逐项报出豁免原因', async () => {
    const w = mountWizard();
    await openWizard(w);
    await setTextarea('cohort-keep');

    const summary = bodyText();
    expect(summary).toContain('将删除 2 人'); // 3 个候选 − 1 个命中保留名单
    expect(summary).toContain('会话 4'); // old-1(3) + old-2(1)
    expect(summary).toContain('豁免 4 人'); // 服务端 total 6 − 最终 2
    expect(summary).toContain('进行中 1');
    expect(summary).toContain('保留名单 1');
    expect(summary).toContain('保留期内 1');
    expect(candidateNames()).toEqual(['旧账号一', '旧账号二']);
    w.unmount();
  });

  it('打开向导即按当前保留期拉候选（不再吃列表页的行）', async () => {
    const w = mountWizard();
    await openWizard(w);
    expect(candidatesMock).toHaveBeenCalledWith({ keepDays: 3 });
    w.unmount();
  });

  it('保留期变化 → 带新参数重拉；窗口内无候选时空态 + 删除钮禁用', async () => {
    const w = mountWizard();
    await openWizard(w);
    await setSelect(w, '30');
    expect(candidatesMock).toHaveBeenLastCalledWith({ keepDays: 30 });
    expect(bodyText()).toContain('没有符合条件的账号');
    expect(deleteButton().disabled).toBe(true);
    w.unmount();
  });

  it('候选读取失败：给出原因并禁用删除（不基于半份数据动手）', async () => {
    candidatesMock.mockRejectedValue(new Error('network down'));
    const w = mountWizard();
    await openWizard(w);

    expect(bodyText()).toContain('候选读取失败');
    expect(bodyText()).toContain('network down');
    expect(deleteButton().disabled).toBe(true);
    w.unmount();
  });
});

describe('按创建时间清理向导 · 确认与分批执行', () => {
  const manyCandidates = (n: number) => ({
    data: {
      data: {
        keepDays: 3,
        total: n,
        candidates: Array.from({ length: n }, (_, i) => candidate({ id: `old-${i}`, name: `旧${i}` })),
        exempt: { running: 0, withinKeepWindow: 0 }
      }
    }
  });

  it('确认后分批（≤100/批）调 batch-delete，成功后 toast + done 事件', async () => {
    candidatesMock.mockResolvedValue(manyCandidates(250));
    const w = mountWizard();
    await openWizard(w);
    expect(bodyText()).toContain('将删除 250 人');

    const confirmHost = mount(Confirm, { attachTo: document.body });
    deleteButton().click();
    await flushPromises();
    expect(confirmState.open).toBe(true);
    // 家法：.mk-confirm button [0]=取消 [1]=确认
    [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')][1].click();
    await flushPromises();
    await settleConfirm(true);

    expect(batchDeleteMock).toHaveBeenCalledTimes(3); // 250 → 100+100+50
    const sizes = batchDeleteMock.mock.calls.map((c) => (c[0] as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(toast.success).toHaveBeenCalledWith('已删除 250 个账号');
    expect(w.emitted('done')).toBeTruthy();
    confirmHost.unmount();
    w.unmount();
  });

  it('任一批报错即停：不再发后续批次，toast 报失败数', async () => {
    candidatesMock.mockResolvedValue(manyCandidates(150));
    batchDeleteMock.mockImplementationOnce(async (ids: string[]) => ({
      data: { data: { deleted: [], skipped: [], errors: ids.map((id) => ({ id, error: 'boom' })) } }
    }));
    const w = mountWizard();
    await openWizard(w);

    const confirmHost = mount(Confirm, { attachTo: document.body });
    deleteButton().click();
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
