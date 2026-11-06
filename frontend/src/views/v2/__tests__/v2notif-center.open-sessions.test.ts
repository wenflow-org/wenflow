/**
 * 通知面板的状态口径（2026-11-03 真人走查修正）。
 *
 * 走查实锤：面板写「课堂进行中」，而同一条会话在路径列表里是「待开始」。
 * 根因两条：① `sessions/active` 只回 startTime/messageCount，**不给最近活跃时间**，
 * 所以「进行中」是面板验证不了的宣称；② 那些会话原先被塞进「运行中 / AI 任务进行中」，
 * 还挂着进度条动画——可课堂不是后台任务，没有任何东西在跑。
 *
 * 口径：不再宣称进行中，改说知道的事（有可继续的课堂 + 起始时刻 + 已几轮），
 * 并且不进 busy 计数（角标只数真正的后台任务）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
const learning = vi.hoisted(() => ({ getPaths: vi.fn() }));
const aiTeaching = vi.hoisted(() => ({ getActiveSessions: vi.fn() }));
const logs = vi.hoisted(() => ({ getAgentLogs: vi.fn() }));
const push = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({ default: api, API_BASE_URL: '/api' }));
vi.mock('@/api/learning', () => ({ learningAPI: learning }));
vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: aiTeaching }));
vi.mock('@/api/userCustom', () => ({ getAgentLogs: logs.getAgentLogs }));
vi.mock('@/views/admin-redesign/live', () => ({ timeAgo: () => '刚刚' }));
vi.mock('./../agent-labels', () => ({ agentLabelOf: () => '智能体' }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

import V2NotifCenter from '../V2NotifCenter.vue';

async function mountCenter() {
  const w = mount(V2NotifCenter, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  return w;
}

describe('V2NotifCenter 课堂两档（进行中 / 空闲中）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { items: [], total: 0, unread: 0 } });
    api.post.mockResolvedValue({ data: {} });
    learning.getPaths.mockResolvedValue([]);
    logs.getAgentLogs.mockResolvedValue({ data: [] });
    aiTeaching.getActiveSessions.mockResolvedValue([
      {
        sessionId: 's_1',
        subject: '英语',
        topic: '时态与语态',
        startTime: '2026-11-03T09:05:00.000Z',
        messageCount: 7,
        lastActiveAt: '2026-11-03T09:40:00.000Z',
        activity: 'active',
      },
    ]);
  });

  it('进行中的课列在「课堂进行中」，副文给起始时刻与轮次', async () => {
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    const text = w.text();
    expect(text).toContain('课堂进行中');
    expect(text).toContain('时态与语态');
    expect(text).toContain('始于');
    expect(text).toContain('已 7 轮');
    expect(text, '进行中的课不该出现在空闲档').not.toContain('课堂空闲中');
  });

  it('超过断线恢复窗口的课落到「课堂空闲中」，并说明多久没动', async () => {
    aiTeaching.getActiveSessions.mockResolvedValue([
      {
        sessionId: 's_old',
        subject: '心理学',
        topic: '五大流派',
        startTime: '2026-10-20T02:00:00.000Z',
        messageCount: 12,
        lastActiveAt: '2026-10-20T03:00:00.000Z',
        activity: 'idle',
      },
    ]);
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    const text = w.text();
    expect(text).toContain('课堂空闲中');
    expect(text).toContain('最近活跃');
    expect(text).toContain('已 12 轮');
    expect(text, '空闲的课不该出现在进行档').not.toContain('课堂进行中');
  });

  it('两档可同时出现：活跃的在上、空闲的在下，都不进「运行中」', async () => {
    aiTeaching.getActiveSessions.mockResolvedValue([
      { sessionId: 's_a', subject: 'A', topic: '活跃课', startTime: '2026-11-03T09:00:00.000Z', messageCount: 3, lastActiveAt: '2026-11-03T09:30:00.000Z', activity: 'active' },
      { sessionId: 's_b', subject: 'B', topic: '空闲课', startTime: '2026-10-01T09:00:00.000Z', messageCount: 9, lastActiveAt: '2026-10-01T10:00:00.000Z', activity: 'idle' },
    ]);
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    const labels = w.findAll('.nc__section-label').map((e) => e.text());
    expect(labels).toContain('课堂进行中');
    expect(labels).toContain('课堂空闲中');
    expect(labels).not.toContain('运行中');
    expect(w.find('.nc__busy-dot').exists(), '课堂不算后台任务').toBe(false);
  });

  it('旧接口无 activity 字段时按「进行中」处理（行为不变）', async () => {
    aiTeaching.getActiveSessions.mockResolvedValue([
      { sessionId: 's_legacy', subject: 'C', topic: '旧数据课', startTime: '2026-11-03T09:00:00.000Z', messageCount: 4 },
    ]);
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    expect(w.text()).toContain('课堂进行中');
    expect(w.text()).toContain('旧数据课');
  });

  it('课堂不计入 busy：铃铛不亮忙态、角标文案不说「AI 任务进行中」', async () => {
    const w = await mountCenter();
    expect(w.find('.nc__bell--busy').exists(), '只有会话时铃铛不该是忙态').toBe(false);
    expect(w.find('.nc__busy-dot').exists()).toBe(false);
    expect(w.find('.nc__bell').attributes('aria-label') || '').not.toContain('AI 任务进行中');
  });

  it('真的后台任务（路径生成）仍然亮忙态，且一条任务只说两层', async () => {
    /* 2026-11-06 走查 图5：段标题「运行中」与卡片「正在生成学习路径 / 路径生成中」是同一句的
       第三、四遍。卡片标题改说「哪条路径」，副文只说「正在做什么」。 */
    learning.getPaths.mockResolvedValue([
      { id: 'lp_1', title: '新路径', generationLifecycle: { phase: 'stage_design', status: 'running', completedStages: 1, totalStages: 4 } },
    ]);
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    expect(w.text(), '标题要是路径方向名').toContain('新路径');
    expect(w.text(), '副文只描述正在做什么').toContain('正在规划阶段与课时…（1/4）');
    expect(w.text(), '「正在生成学习路径」不得复活').not.toContain('正在生成学习路径');
    expect(w.text(), '「路径生成中」与副文重复，不得复活').not.toContain('路径生成中');
    expect(w.findAll('.nc__section-label').map((e) => e.text())).not.toContain('运行中');
    expect(w.find('.nc__busy-dot').exists()).toBe(true);
  });

  it('既无会话也无任务时落空态', async () => {
    aiTeaching.getActiveSessions.mockResolvedValue([]);
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();
    expect(w.text()).not.toContain('课堂进行中');
    expect(w.find('.nc__empty').exists()).toBe(true);
  });
});
