/**
 * 启动弹层（VirtualLearnerLaunch）与用人设模拟试跑（skill-design/persona-trial）的对抗度口径（2026-10-26；
 * - 同一个后端枚举 frictionBudget 此前两处两套词（「无摩擦 / 压力测试」vs「配合 / 极端」），
 *   运营读成两个参数；词表收到 vlab.ts 的 FRICTION_OPTIONS，两处共用。
 * - 启动弹层收成「故事 + 启动」一行，运行模式与对抗预算折进「更多设置」并保留默认值。
 *
 * 2026-11-10 试跑入口从虚拟学习者行菜单迁到 Skill 详情 → 试跑，组件换成 persona-trial）：
 * 启动弹层 Teleport 到 body，查询走 document.body（cleanup / batch 测试同判例）。
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
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 'sess-1', autopilot: 'started' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 'sess-1', autopilot: 'started' } } }))
  },
  adminPromptOpsApi: { runEval: vi.fn(async () => ({ data: { data: { results: [] } } })) },
  /* 试跑弹窗会读所选能力的生效提示词（R7：面板里要能看见跑的是哪条） */
  adminSkillsApi: {
    getEffectiveSkillPrompt: vi.fn(async () => ({
      data: { data: { prompt: { version: 3, systemPrompt: '你是目标对话助手' } } }
    }))
  }
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() } }));
vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    errMsg: (e: unknown) => String(e),
    refreshLiveVirtuals: vi.fn(),
    // 人设试跑的面板从这份全量清单取「虚拟学习者」选项
    liveVirtuals: ref([{ id: 'p1', name: '小陈' }]),
  };
});
vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return { isLive: ref(true), openSubPage: vi.fn() };
});

import VirtualLearnerLaunch from '../VirtualLearnerLaunch.vue';
import PersonaTrial from '../skill-design/persona-trial.vue';
import { FRICTION_OPTIONS } from '../vlab';
import { adminVirtualLearnersApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';
import { refreshLiveVirtuals } from '../live';
import { chooseMkSelect, mkSelectLabels } from '@/components/mk/__tests__/mkSelect';

const EXPECTED_LABELS = FRICTION_OPTIONS.map((o) => o.label);
/* Teleport 打平到组件内（attachTo body）：MkSelect 助手按 aria-label 在 wrapper 里定位 */
const mountOpts = { attachTo: document.body, global: { stubs: { teleport: true } } };

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function openLaunch() {
  const w = mount(VirtualLearnerLaunch, mountOpts);
  await (w.vm as unknown as { open: (s: unknown) => Promise<void> }).open({ id: 'p1', name: '小陈', storyCount: 2 });
  await flushPromises();
  return w;
}

describe('启动弹层：故事 + 启动，低频调参折进更多设置', () => {
  it('表单只留故事下拉；「启动」与「取消」同在页脚', async () => {
    const w = await openLaunch();
    const storyField = document.body.querySelector('.vl-launch-story')!;
    expect(storyField.textContent).toContain('选择故事');
    expect(storyField.textContent).not.toContain('运行模式');
    expect(storyField.textContent).not.toContain('学习者对抗度');
    expect(document.body.querySelector('.vl-launch-story')!.querySelectorAll('button.mk-btn').length).toBe(0);

    /* 2026-11-02 评审 R1/R3：主操作在表单行里会被下拉挤成竖排，两个操作拆在两端 */
    const foot = document.body.querySelector('.mk-modal__foot')!;
    expect(foot.textContent).toContain('取消');
    expect(foot.textContent).toContain('启动');
    expect(storyField.textContent).not.toContain('启动');

    const more = document.body.querySelector('.vl-launch-more')!;
    expect(more).toBeTruthy();
    expect(more.querySelector('summary')!.textContent).toBe('更多设置');
    expect(more.querySelectorAll('.mk-select')).toHaveLength(2);
    w.unmount();
  });

  it('对抗度用与提示词试跑同一套中文词（vlab.FRICTION_OPTIONS）', async () => {
    const w = await openLaunch();
    expect(mkSelectLabels(w as never, '学习者对抗度')).toEqual(EXPECTED_LABELS);
    w.unmount();
  });
});

describe('启动弹层：自动驾驶回执与模式说明', () => {
  it.each(['assisted', 'blackbox'] as const)('%s 显式请求 final；仅 started 回执报告已开始', async (mode) => {
    const w = await openLaunch();
    await chooseMkSelect(w, '选择故事', 's1');
    await chooseMkSelect(w, '运行模式', mode);
    await w.get('.mk-modal__foot .mk-btn--primary').trigger('click');
    await flushPromises();
    const api = mode === 'blackbox' ? adminVirtualLearnersApi.startBlackboxVirtualSession : adminVirtualLearnersApi.startVirtualSession;
    expect(api).toHaveBeenCalledWith('p1', { storyId: 's1', frictionBudget: 'normal', autopilot: 'final' });
    expect(toast.success).toHaveBeenCalledWith('已开始运行「函数补差」');
    expect(w.emitted('started')?.[0]?.[0]).toMatchObject({ id: 'sess-1', autopilot: 'started' });
    expect(refreshLiveVirtuals).toHaveBeenCalledTimes(1);
    expect(w.find('.mk-modal').exists()).toBe(false);
    w.unmount();
  });

  it.each([
    { autopilot: 'queued', channel: 'success', message: '并发已满，「函数补差」已排队，轮到即自动开跑' },
    { autopilot: 'failed', channel: 'warning', message: '已创建「函数补差」的会话，但自动驾驶启动失败，可在画像页打开座舱重试' },
    { autopilot: 'off', channel: 'info', message: '已创建「函数补差」的会话，尚未启动，可在画像页打开座舱开始' },
    { autopilot: undefined, channel: 'info', message: '已创建「函数补差」的会话，未确认自动驾驶启动，请在画像页打开座舱查看' },
    { autopilot: 'unexpected', channel: 'info', message: '已创建「函数补差」的会话，未确认自动驾驶启动，请在画像页打开座舱查看' },
  ] as const)('$autopilot 不假报已开始，保留已创建会话供继续/查看', async ({ autopilot, channel, message }) => {
    vi.mocked(adminVirtualLearnersApi.startBlackboxVirtualSession).mockResolvedValueOnce({
      data: { data: { id: 'sess-1', status: 'created', ...(autopilot ? { autopilot } : {}) } },
    } as never);
    const w = await openLaunch();
    await chooseMkSelect(w, '选择故事', 's1');
    await chooseMkSelect(w, '运行模式', 'blackbox');
    await w.get('.mk-modal__foot .mk-btn--primary').trigger('click');
    await flushPromises();
    expect(toast[channel]).toHaveBeenCalledWith(message);
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining('已开始运行'));
    expect(w.emitted('started')?.[0]?.[0]).toMatchObject({ id: 'sess-1', status: 'created' });
    expect(refreshLiveVirtuals).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('创建请求失败保留启动入口，不发出已创建事件', async () => {
    vi.mocked(adminVirtualLearnersApi.startVirtualSession).mockRejectedValueOnce(new Error('请求失败'));
    const w = await openLaunch();
    await chooseMkSelect(w, '选择故事', 's1');
    await w.get('.mk-modal__foot .mk-btn--primary').trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('启动失败'));
    expect(w.emitted('started')).toBeUndefined();
    expect(refreshLiveVirtuals).not.toHaveBeenCalled();
    expect(w.get('.mk-modal__foot .mk-btn--primary').attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('模式选择解释日期差异和独立评审入口，不暗示启动即评审', async () => {
    const w = await openLaunch();
    expect(w.get('.mk-field__hint').text()).toContain('辅助模拟支持按模拟日期推进');
    expect(w.get('.mk-field__hint').text()).toContain('独立评审不在启动时自动执行');
    await chooseMkSelect(w, '运行模式', 'blackbox');
    expect(w.get('.mk-field__hint').text()).toContain('真实日期，不支持日期模拟');
    expect(w.get('.mk-field__hint').text()).toContain('完成后可到会话审计发起独立评审');
    w.unmount();
  });
});

describe('用人设模拟试跑：对抗度同一套中文词', () => {
  it('下拉选项 = FRICTION_OPTIONS（不再出现「无摩擦 / 压力测试」）', async () => {
    const w = mount(PersonaTrial, { props: { skillId: 'goal-conversation' } });
    await flushPromises();
    expect(mkSelectLabels(w as never, '学习者对抗度')).toEqual(EXPECTED_LABELS);
    w.unmount();
  });
});
