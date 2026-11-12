/**
 * 学习台状态一致性回归（2026-11-11 用户侧走查 #1 / #2 / #3 + 实机 headline 证据）
 *
 * ① 已完成路径上「今天没有待办任务」与「继续」并存：CTA 实际落到路径详情，
 *    读作「还有事可继续」。现在标题/标签/CTA 同说「学完了」，CTA 去学习记录。
 * ② 卡头「阶段 1 / 2 · 任务」缺数量：改报本阶段任务数；整条完成后报「已完成 · 共 N 个任务」。
 * ③ 「今日已学 64 / 25 分钟」= 256% 却无说明：超目标时改自然语言并标出超出量。
 * ④ 服务端 headline 把「欢迎回来，X」与路径说明拼成 28 字长句：按姓名边界拆成主/副两层。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const getMock = vi.hoisted(() => vi.fn());
const getStats = vi.hoisted(() => vi.fn());
const getPaths = vi.hoisted(() => vi.fn());
const getAdaptiveGuidance = vi.hoisted(() => vi.fn());
const userState = vi.hoisted(() => ({ user: { name: '奶茶店店长' } as { name?: string } | null }));

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
vi.mock('@/stores/user', () => ({
  useUserStore: () => userState,
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2Dashboard from '../V2Dashboard.vue';

const COMPLETED_PATH = {
  id: 'lp1',
  title: '奶茶店店长用客流排下周班',
  status: 'completed',
  generationLifecycle: { phase: 'ready' },
  milestones: [
    {
      title: '阶段一',
      subtasks: [
        { id: 't1', title: '第一步', status: 'completed', estimatedMinutes: 25, completedAt: '2026-11-09T02:00:00.000Z' },
        { id: 't2', title: '第二步', status: 'completed', estimatedMinutes: 25, completedAt: '2026-11-10T02:00:00.000Z' },
      ],
    },
    {
      title: '阶段二',
      subtasks: [
        { id: 't3', title: '第三步', status: 'completed', estimatedMinutes: 25, completedAt: '2026-11-10T03:00:00.000Z' },
      ],
    },
  ],
};

const LONG_HEADLINE =
  '欢迎回来，奶茶店店长用客流排下周班这条路径正等着你开头';

function guidanceCopy(overrides: Record<string, unknown> = {}) {
  return {
    headline: LONG_HEADLINE,
    subtitle: '',
    todayActions: [{ title: '继续上次学习', desc: '', action: '继续', to: 'continue-learning' }],
    ...overrides,
  };
}

interface MountOptions {
  copy?: Record<string, unknown> | null;
  sessions?: Array<Record<string, unknown>>;
  paths?: Array<Record<string, unknown>>;
  stats?: Record<string, unknown>;
}

async function mountDashboard(options: MountOptions = {}) {
  getStats.mockResolvedValue(options.stats ?? {});
  getPaths.mockResolvedValue(options.paths ?? [COMPLETED_PATH]);
  getAdaptiveGuidance.mockResolvedValue(options.copy ? { copy: options.copy } : null);
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

const todaySession = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  taskId: 't3',
  taskTitle: '上一节课',
  startTime: new Date().toISOString(),
  durationMinutes: 64,
  ...overrides,
});

describe('学习台已完成态：标题 / 标签 / CTA 不再自相矛盾（走查 #1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userState.user = { name: '奶茶店店长' };
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('已完成路径：说明「都已完成」，CTA 改去学习记录', async () => {
    const w = await mountDashboard({ copy: guidanceCopy() });
    expect(w.find('.action__title').text()).toBe('这条路径的 3 个任务都已完成');
    const cta = w.find('.action__actions .btn-primary');
    expect(cta.text()).toContain('查看学习记录');
    expect(cta.text()).not.toContain('继续');
  });

  it('卡头标签报出任务数（不再是「阶段 1 / 2 · 任务」半句）', async () => {
    const w = await mountDashboard({ copy: guidanceCopy() });
    expect(w.find('.action__tag').text()).toBe('已完成 · 共 3 个任务');
  });

  it('有进行中任务时：标签报本阶段任务数', async () => {
    const active = {
      ...COMPLETED_PATH,
      status: 'active',
      milestones: [
        {
          title: '阶段一',
          subtasks: [
            { id: 't1', title: '第一步', status: 'completed', estimatedMinutes: 25 },
            { id: 't2', title: '第二步', status: 'todo', estimatedMinutes: 25 },
          ],
        },
      ],
    };
    const w = await mountDashboard({ copy: guidanceCopy(), paths: [active] });
    expect(w.find('.action__tag').text()).toBe('阶段 1 / 1 · 本阶段 2 个任务');
  });
});

describe('学习台今日进度：超过目标要说明（走查 #1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userState.user = { name: '奶茶店店长' };
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('64 / 25 分钟 → 自然语言写明目标与超出量，进度条仍封顶 100%', async () => {
    const w = await mountDashboard({ copy: guidanceCopy(), sessions: [todaySession()] });
    const today = w.find('.action__today');
    expect(today.text()).toContain('今日已学 64 分钟');
    expect(today.text()).toContain('今日目标 25 分钟');
    expect(today.text()).toContain('已超出 39 分钟');
    expect(today.classes()).toContain('action__today--over');
    expect(w.find('.action__today-bar i').attributes('style')).toContain('width: 100%');
  });

  it('未超目标时保留 x / y 口径', async () => {
    const w = await mountDashboard({
      copy: guidanceCopy(),
      sessions: [todaySession({ durationMinutes: 10 })],
    });
    expect(w.find('.action__today').text()).toContain('今日已学 10 / 25 分钟');
    expect(w.find('.action__today').classes()).not.toContain('action__today--over');
  });
});

describe('学习台问候标题分层（实机 headline 证据）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userState.user = { name: '奶茶店店长' };
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('按姓名边界拆成「欢迎回来，X」+ 后段说明，不改后端文案', async () => {
    const w = await mountDashboard({ copy: guidanceCopy() });
    expect(w.find('.greet__headline-lead').text()).toBe('欢迎回来，奶茶店店长');
    expect(w.find('.greet__headline-tail').text()).toBe('用客流排下周班这条路径正等着你开头');
  });

  it('headline 只有问候语时回退到本地「问候，姓名」，不留半句', async () => {
    const w = await mountDashboard({ copy: guidanceCopy({ headline: '欢迎回来，' }) });
    const lead = w.find('.greet__headline-lead').text();
    expect(lead).toContain('奶茶店店长');
    expect(lead.endsWith('，')).toBe(false);
  });

  it('姓名缺失 / 纯空白时回退为「学习者」', async () => {
    userState.user = { name: '   ' };
    const w = await mountDashboard({ copy: guidanceCopy({ headline: '欢迎回来，' }) });
    expect(w.find('.greet__headline-lead').text()).toContain('学习者');
  });
});

describe('学习台「最近学习」区块（走查 #3：只在有数据时渲染）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userState.user = { name: '奶茶店店长' };
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('有最近学习记录时补一条时间锚点，不造假区块', async () => {
    const w = await mountDashboard({ copy: guidanceCopy(), sessions: [todaySession()] });
    const recent = w.find('.recent');
    expect(recent.exists()).toBe(true);
    expect(recent.text()).toContain('最近学习');
    expect(recent.text()).toContain('上一节课');
    expect(recent.text()).toContain('64 分钟');
    expect(recent.find('.recent__when').attributes('title')).toContain('最近学习');
  });

  it('无学习记录时不渲染', async () => {
    const w = await mountDashboard({ copy: guidanceCopy() });
    expect(w.find('.recent').exists()).toBe(false);
  });
});
