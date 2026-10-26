/**
 * 启动弹层（VirtualLearnerLaunch）与提示词试跑（VirtualLearnerPromptTest）的对抗度口径（2026-10-26）：
 * - 同一个后端枚举 frictionBudget 此前两处两套词（「无摩擦 / 压力测试」vs「配合 / 极端」），
 *   运营读成两个参数；词表收到 vlab.ts 的 FRICTION_OPTIONS，两处共用。
 * - 启动弹层收成「故事 + 启动」一行，运行模式与对抗预算折进「更多设置」并保留默认值。
 *
 * 两个组件都 Teleport 到 body，查询走 document.body（cleanup / batch 测试同判例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { storiesMock } = vi.hoisted(() => ({
  storiesMock: vi.fn(async () => ({
    data: {
      data: {
        stories: [
          { storyId: 's1', storyTitle: '函数补差', stats: { totalRuns: 0, pathCount: 0 } },
          { storyId: 's2', storyTitle: '立体几何', stats: { totalRuns: 2, pathCount: 1 } }
        ]
      }
    }
  }))
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    getVirtualLearnerStories: storiesMock,
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 'sess-1', autopilot: 'running' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 'sess-1', autopilot: 'running' } } }))
  },
  adminPromptOpsApi: { runEval: vi.fn(async () => ({ data: { data: { results: [] } } })) }
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() } }));
vi.mock('../live', () => ({ errMsg: (e: unknown) => String(e), refreshLiveVirtuals: vi.fn() }));
vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return { isLive: ref(true), openSubPage: vi.fn() };
});

import VirtualLearnerLaunch from '../VirtualLearnerLaunch.vue';
import VirtualLearnerPromptTest from '../VirtualLearnerPromptTest.vue';
import { FRICTION_OPTIONS } from '../vlab';

const EXPECTED_LABELS = FRICTION_OPTIONS.map((o) => o.label);

beforeEach(() => {
  document.body.innerHTML = '';
  storiesMock.mockClear();
});

async function openLaunch() {
  const w = mount(VirtualLearnerLaunch, { attachTo: document.body });
  await (w.vm as unknown as { open: (s: unknown) => Promise<void> }).open({ id: 'p1', name: '小陈', storyCount: 2 });
  await flushPromises();
  return w;
}

describe('启动弹层：故事 + 启动，低频调参折进更多设置', () => {
  it('主行只有故事下拉与「启动」；运行模式 / 对抗预算在「更多设置」里', async () => {
    const w = await openLaunch();
    const mainRow = document.body.querySelector('.vl-launch-row')!;
    expect(mainRow.textContent).toContain('选择故事');
    expect(mainRow.textContent).toContain('启动');
    expect(mainRow.textContent).not.toContain('运行模式');
    expect(mainRow.textContent).not.toContain('学生对抗度');

    const more = document.body.querySelector('.vl-launch-more')!;
    expect(more).toBeTruthy();
    expect(more.querySelector('summary')!.textContent).toBe('更多设置');
    expect(more.querySelectorAll('select')).toHaveLength(2);
    w.unmount();
  });

  it('对抗度用与提示词试跑同一套中文词（vlab.FRICTION_OPTIONS）', async () => {
    const w = await openLaunch();
    const selects = document.body.querySelectorAll('.vl-launch-more select');
    const labels = [...selects[1].querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(EXPECTED_LABELS);
    w.unmount();
  });
});

describe('提示词试跑：对抗度同一套中文词', () => {
  it('下拉选项 = FRICTION_OPTIONS（不再出现「无摩擦 / 压力测试」）', async () => {
    const w = mount(VirtualLearnerPromptTest, { attachTo: document.body });
    (w.vm as unknown as { open: (s: unknown) => void }).open({ id: 'p1', name: '小陈' });
    await flushPromises();
    const selects = document.body.querySelectorAll('.pt-config select');
    const labels = [...selects[1].querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(EXPECTED_LABELS);
    w.unmount();
  });
});
