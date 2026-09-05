/**
 * OpsContent「学习路径」重设计回归（2026-09-05）：
 * 与教学会话/目标对话 tab 同族——状态条为路径自身统计、头部 pill 组+搜索+口径+列显隐、
 * 无独立场景 KPI 大卡、无学科列（subject 实为长目标文本，改目标摘要单行省略）。
 * 断言 = 视觉骨架（结构类），浏览器人工复核负责像素级细节。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OpsContent from '../OpsContent.vue';
import { intent } from '../store';

const mkPath = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `路径${id}`,
  subject: '这是一段很长的学习目标描述，用来验证单行省略的显示效果是否正常 work',
  status: 'active',
  difficulty: 'beginner',
  estimatedHours: 6,
  totalMilestones: 4,
  completedMilestones: 1,
  aiGenerated: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-04T00:00:00Z',
  deadline: null,
  user: { id: 'u1', name: '张三', email: 'zs@wenflow.local', isVirtualLearner: false },
  milestoneStatuses: ['completed', 'in_progress', 'todo', 'todo'],
  milestoneCount: 4,
  ...over,
});

const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    listPaths: listMock,
    getStats: statsMock,
    getPathDetail: vi.fn(async () => ({ data: { data: { title: 'x', subject: 'x', milestones: [] } } })),
    archivePath: vi.fn(async () => ({ data: {} })),
    restorePath: vi.fn(async () => ({ data: {} })),
    deletePath: vi.fn(async () => ({ data: {} })),
  },
  adminTeachingSessionsApi: { list: vi.fn(async () => ({ data: {} })) },
  adminGoalConversationsApi: { list: vi.fn(async () => ({ data: {} })), getStats: vi.fn(async () => ({ data: {} })) },
  adminAnnouncementsApi: { list: vi.fn(async () => ({ data: {} })) },
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
}));

vi.mock('../live', () => ({
  isLive: { value: true },
  timeAgo: (v: string) => v,
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id),
}));

const rows = [
  mkPath('lp_a', { user: { id: 'u2', name: '虚拟生', email: 'v@wenflow.local', isVirtualLearner: true } }),
  mkPath('lp_b', { status: 'completed', subject: '完成的目标摘要' }),
  mkPath('lp_c', { status: 'failed', subject: '失败路径摘要' }),
];

function mockOk() {
  listMock.mockResolvedValue({ data: { data: { paths: rows, pagination: { total: rows.length, page: 1, limit: 100 } } } });
  statsMock.mockResolvedValue({ data: { data: { total: rows.length, byStatus: { active: 1, completed: 1, failed: 1 }, bySubject: [], totalMilestones: 9, totalTasks: 24 } } });
}

beforeEach(() => {
  intent.scene = 'overview';
  intent.statusFilter = '';
  intent.tab = '';
  mockOk();
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('OpsContent 学习路径 tab 重设计骨架', () => {
  it('embedded：无状态条（宿主承载）；count 事件上报总数；卡头含 pill+搜索+口径+列显隐；表头无学科列', async () => {
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    // embedded 不渲染自己的状态条（合并宿主「学习会话」状态条承载域计数）
    expect(w.find('.mk-status').exists()).toBe(false);
    // 加载完成上报「路径 N」徽章计数（stats.total）
    expect(w.emitted('count')?.at(-1)).toEqual([3]);

    // 无 KPI 卡（MkKpi 已被移除）
    expect(w.find('.mk-kpi').exists()).toBe(false);

    // 头部 pill（状态）
    const pills = w.findAll('.mk-card__head .mk-pill').map((b) => b.text());
    expect(pills).toEqual(['学习中', '已完成', '生成失败', '已下线']);

    // 右侧组件
    expect(w.find('.mk-card__head input.mk-filter__input').exists()).toBe(true);
    expect(w.find('.ds-toggle').exists()).toBe(true);
    expect(w.find('.mk-cols').exists()).toBe(true);
    expect(w.text()).toContain('条（仅真实）');

    // 表头：路径/主题/用户/状态/进度/更新/操作（subject 或为学科或为目标长文本，均单行省略）
    const ths = w.findAll('thead th').map((t) => t.text());
    expect(ths).toContain('路径');
    expect(ths).toContain('主题');
    expect(ths).toContain('用户');
    expect(ths).toContain('状态');
    expect(ths).toContain('进度');
    expect(ths).toContain('操作');
    expect(ths).not.toContain('学科');

    // 虚拟行标记
    expect(w.find('.oc-tags .mk-badge--virtual').exists()).toBe(true);

    w.unmount();
  });

  it('embedded：状态 pill 点击本地过滤；目标摘要列单行省略类存在', async () => {
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(3);

    // 点击「已完成」pill → 1 行
    await w.findAll('.mk-card__head .mk-pill').find((b) => b.text() === '已完成')!.trigger('click');
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(1);
    expect(w.find('tbody').text()).toContain('完成的目标摘要');

    // 摘要列带省略样式
    expect(w.find('.oc-subject').exists()).toBe(true);

    w.unmount();
  });

  it('初始预筛：failed（工作台深链）状态下 failed 行可见', async () => {
    const w = mount(OpsContent, { props: { embedded: true, initialStatus: 'failed' } });
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(1);
    expect(w.find('tbody').text()).toContain('失败路径摘要');
    w.unmount();
  });
});
