/**
 * 学习台用户全生命周期状态回归：
 * 1. 刚注册新手态（0 路径、0 会话、连续 0 天、引导文案不出现虚假「10 分钟」门禁）
 * 2. 跨账号 SWR 快照隔离（前账号缓存绝不闪现到切换后的新账号学习台）
 * 3. 路径生成中态（generating 等待卡）
 * 4. 刚建路未开课（active + todo 任务 → 主 CTA「开始学习」、进度条 0%、「这节课还没开始」）
 * 5. 学了半节课退出（active + in_progress + active 会话 → 主 CTA「继续学习」、进度条 50%、当日抽屉区分「进行中」而非「已完成」）
 * 6. 学了 1 节课 / 1 天（active + 1 completed 会话 + 下一节 todo → 「连续 1 天」、最近学习卡、当日抽屉「完成了 1 次学习」）
 * 7. 整条路径学完（allPathDone → 主 CTA「查看学习记录」、隐藏「今天休息」）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const getMock = vi.hoisted(() => vi.fn());
const getStats = vi.hoisted(() => vi.fn());
const getPaths = vi.hoisted(() => vi.fn());
const getAdaptiveGuidance = vi.hoisted(() => vi.fn());
const getRetentionProbesDue = vi.hoisted(() => vi.fn());
const userState = vi.hoisted(() => ({
  user: { id: 'u-fresh', name: '新同学' } as { id?: string; name?: string } | null,
}));

vi.mock('@/utils/api', () => ({
  default: { get: getMock },
}));
vi.mock('@/api/learning', () => ({
  learningAPI: {
    getStats,
    getPaths,
    getAdaptiveGuidance,
    retryPathEnrichment: vi.fn(),
    retryPathGeneration: vi.fn(),
  },
}));
vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    getRetentionProbesDue,
    answerRetentionProbe: vi.fn(),
  },
}));
vi.mock('@/stores/user', () => ({
  useUserStore: () => userState,
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2Dashboard from '../V2Dashboard.vue';

interface MountStateOptions {
  paths?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  guidance?: Record<string, unknown> | null;
}

async function mountDashboard(options: MountStateOptions = {}) {
  getStats.mockResolvedValue({});
  getPaths.mockResolvedValue(options.paths ?? []);
  getAdaptiveGuidance.mockResolvedValue(options.guidance ?? null);
  getRetentionProbesDue.mockResolvedValue([]);
  getMock.mockImplementation((url: string) => {
    if (String(url).includes('/users/me/sessions')) {
      return Promise.resolve({ data: options.sessions ?? [] });
    }
    if (String(url).includes('/ai-teaching/review/plan')) return Promise.resolve({ data: { items: [] } });
    if (String(url).includes('/ai-teaching/review/due')) return Promise.resolve({ data: { items: [] } });
    if (String(url).includes('/achievements/all')) return Promise.resolve({ data: [] });
    if (String(url).includes('/learning/schedule/today')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
  const w = mount(V2Dashboard, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return w;
}

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lp-1',
    title: '劳动合同条款风险判断',
    status: 'active',
    generationLifecycle: { phase: 'ready', canStartLearning: true },
    milestones: [
      {
        title: '阶段一：核心条款尺子',
        subtasks: [
          { id: 'task-1', title: '第 1 节：竞业限制补偿金下限与违约边界', status: 'todo', estimatedMinutes: 25 },
          { id: 'task-2', title: '第 2 节：试用期期限与工资下限判断', status: 'todo', estimatedMinutes: 25 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('学习台全生命周期状态检查', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userState.user = { id: 'u-fresh', name: '新同学' };
    localStorage.clear();
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
    getRetentionProbesDue.mockReset();
  });

  it('1. 刚注册新手态：渲染新手引导卡、连续 0 天、无虚假 10 分钟门禁、无最近学习块', async () => {
    const w = await mountDashboard({ paths: [], sessions: [] });

    expect(w.find('.dash--empty').exists()).toBe(true);
    expect(w.find('.action--empty').exists()).toBe(true);
    expect(w.find('.streak').text()).toContain('连续 0 天');
    expect(w.find('.week__note').text()).toContain('规划好第一个目标并开始学习后');
    expect(w.text()).not.toContain('学满 10 分钟');
    expect(w.find('.recent').exists()).toBe(false);
    expect(w.find('.cal__grid').exists()).toBe(true);
  });

  it('2. 跨账号切换隔离：前账号缓存不会在刚登录的新账号上短暂闪出', async () => {
    userState.user = { id: 'u-old', name: '老用户' };
    const oldWrapper = await mountDashboard({
      paths: [makePath({ title: '老用户的私密路径' })],
      sessions: [{ id: 's-old', taskId: 'task-0', taskTitle: '旧课', startTime: new Date().toISOString(), durationMinutes: 30, status: 'completed' }],
    });
    expect(oldWrapper.text()).toContain('老用户的私密路径');
    oldWrapper.unmount();

    // 切换为全新注册账号，且 getPaths 故意挂起在首屏刷新阶段：不能露出老用户数据
    userState.user = { id: 'u-brand-new', name: '全新账号' };
    let resolvePaths!: (v: unknown[]) => void;
    getPaths.mockImplementation(() => new Promise((r) => { resolvePaths = r; }));
    getStats.mockResolvedValue({});
    getAdaptiveGuidance.mockResolvedValue(null);
    getRetentionProbesDue.mockResolvedValue([]);
    getMock.mockResolvedValue({ data: [] });

    const newWrapper = mount(V2Dashboard, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(newWrapper.find('.dash__loading').exists()).toBe(true);
    expect(newWrapper.text()).not.toContain('老用户的私密路径');

    resolvePaths([]);
    await flushPromises();
    expect(newWrapper.find('.action--empty').exists()).toBe(true);
  });

  it('3. 路径生成中态：显示生成等待卡，且无错误弹窗或重试死循环', async () => {
    const w = await mountDashboard({
      paths: [makePath({ generationLifecycle: { phase: 'core', status: 'processing', canStartLearning: false }, milestones: [] })],
    });
    expect(w.find('.action--gen').exists()).toBe(true);
    expect(w.find('.action--gen').text()).toContain('路径正在生成，稍等一下');
    expect(w.find('.action--empty').exists()).toBe(false);
  });

  it('4. 刚建路未开课：按钮为「开始学习」、今日进度 0%、「这节课还没开始」', async () => {
    const w = await mountDashboard({
      paths: [makePath()],
      sessions: [],
    });
    expect(w.find('.action__actions .btn-primary').text()).toBe('开始学习');
    expect(w.find('.action__today').text()).toContain('今日已学 0 分钟 · 这节课还没开始');
    expect(w.find('.action__today-bar i').attributes('style')).toContain('width: 0%');
    expect(w.find('.week__note').text()).toBe('今天开始学习，即可点亮第 1 天连续记录');
  });

  it('5. 学了半节课退出：任务 in_progress 且会话未结课时，按钮为「继续学习」、当日抽屉标明进行中而非已完成', async () => {
    const nowIso = new Date().toISOString();
    const w = await mountDashboard({
      paths: [
        makePath({
          milestones: [
            {
              title: '阶段一：核心条款尺子',
              subtasks: [
                { id: 'task-1', title: '第 1 节：竞业限制补偿金下限与违约边界', status: 'in_progress', estimatedMinutes: 25 },
                { id: 'task-2', title: '第 2 节：试用期期限与工资下限判断', status: 'todo', estimatedMinutes: 25 },
              ],
            },
          ],
        }),
      ],
      sessions: [
        {
          id: 'sess-half',
          taskId: 'task-1',
          taskTitle: '第 1 节：竞业限制补偿金下限与违约边界',
          taskStatus: 'in_progress',
          status: 'active',
          startTime: nowIso,
          endTime: null,
          durationMinutes: 12,
        },
      ],
    });

    expect(w.find('.action__actions .btn-primary').text()).toBe('继续学习');
    expect(w.find('.action__reason').text()).toContain('接着上次的进度继续');
    expect(w.find('.action__today').text()).toContain('今日已学 12 分钟 · 继续上次进度');
    expect(w.find('.action__today-bar i').attributes('style')).toContain('width: 50%');
    // 与今日待办是同一节，不重复渲染「最近学习」卡
    expect(w.find('.recent').exists()).toBe(false);

    // 点开今日格子查看复盘抽屉：半节课退出不应错写成「完成了 1 次学习」
    await w.find('.cal__cell--today').trigger('click');
    await flushPromises();
    const sheetText = w.find('.sheet').text();
    expect(sheetText).toContain('这一天开始了 1 次学习（进行中）');
    expect(sheetText).toContain('尚未结课');
    expect(sheetText).not.toContain('完成了 1 次学习');
  });

  it('6. 学了 1 节课 / 1 天：连续 1 天点亮、最近学习锚点出现、今日推进到第 2 节', async () => {
    const nowIso = new Date().toISOString();
    const w = await mountDashboard({
      paths: [
        makePath({
          milestones: [
            {
              title: '阶段一：核心条款尺子',
              subtasks: [
                { id: 'task-1', title: '第 1 节：竞业限制补偿金下限与违约边界', status: 'completed', estimatedMinutes: 25 },
                { id: 'task-2', title: '第 2 节：试用期期限与工资下限判断', status: 'todo', estimatedMinutes: 25 },
              ],
            },
          ],
        }),
      ],
      sessions: [
        {
          id: 'sess-done',
          taskId: 'task-1',
          taskTitle: '第 1 节：竞业限制补偿金下限与违约边界',
          taskStatus: 'completed',
          status: 'completed',
          startTime: nowIso,
          endTime: nowIso,
          durationMinutes: 22,
        },
      ],
    });

    expect(w.find('.streak').text()).toContain('连续 1 天');
    expect(w.find('.action__title').text()).toBe('第 2 节：试用期期限与工资下限判断');
    expect(w.find('.action__actions .btn-primary').text()).toBe('开始学习');
    expect(w.find('.recent').exists()).toBe(true);
    expect(w.find('.recent').text()).toContain('第 1 节：竞业限制补偿金下限与违约边界');

    await w.find('.cal__cell--today').trigger('click');
    await flushPromises();
    expect(w.find('.sheet').text()).toContain('这一天完成了 1 次学习');
  });

  it('7. 路径全部学完：显示「查看学习记录」，隐藏「今天休息」次入口', async () => {
    const w = await mountDashboard({
      paths: [
        makePath({
          status: 'completed',
          milestones: [
            {
              title: '阶段一：核心条款尺子',
              subtasks: [
                { id: 'task-1', title: '第 1 节', status: 'completed', estimatedMinutes: 25 },
              ],
            },
          ],
        }),
      ],
    });
    expect(w.find('.action__actions .btn-primary').text()).toBe('查看学习记录');
    expect(w.find('.action__rest').exists()).toBe(false);
  });
});
