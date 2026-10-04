/**
 * 人员轴「人类可读性」修复回归（2026-10-02 评审 P1#14/15/16/17 + P2）：
 * - LearnerCenter isRisk 拆档：需关注=趋势降 ∨ 疲劳高 ∨ 有风险摘要；疲劳=中 单列「观察」pill
 * - LearnerCenter KPI 学习者=「已加载 N」（live.ts 未透出后端 total 前的诚实口径）
 * - LearnerCenter 风险摘要带量级 + 平均置信度 hint 带 n=
 * - UserAccountPane（人员详情合并后 LearnerDetail 的「账号与许可」pane）：统计条「学习状态」格 + 最后登录无兜底显「—」
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import LearnerCenter from '../LearnerCenter.vue';
import UserAccountPane from '../UserAccountPane.vue';
import { liveLearners } from '../live';
import { subPage } from '../store';

const { apiObject, getUserDetail, listSessions } = vi.hoisted(() => {
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  // 详情接口：带 _count（会话总数 40）与 XP/层级（等级词汇断言用）
  const getUserDetail = vi.fn(async () => ({
    data: {
      data: {
        user: {
          name: '测试用户',
          email: 't@x.com',
          createdAt: '2026-08-01T00:00:00Z',
          xp: 120,
          currentLevel: 'intermediate',
          _count: { teaching_sessions: 40, learning_paths: 3 }
        }
      }
    }
  }));
  // 会话列表：limit=5 窗口返回 5 条（角标应为「最近 5 / 共 40」而非裸 5）
  const listSessions = vi.fn(async () => ({
    data: {
      data: {
        items: Array.from({ length: 5 }, (_, i) => ({
          id: `s-${i + 1}`,
          topic: `会话 ${i + 1}`,
          subject: 'concept-teaching',
          status: 'completed',
          startTime: '2026-09-30T10:00:00Z',
          messageCount: 4,
          duration: 60
        }))
      }
    }
  }));
  return { apiObject, getUserDetail, listSessions };
});

vi.mock('@/api/adminApi', () => ({
  adminUsersApi: apiObject(),
  adminTeachingSessionsApi: { list: listSessions },
  adminGoalConversationsApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminMemoryReviewApi: apiObject(),
  adminMemoryTracesApi: apiObject(),
  getUserIncludingDeleted: getUserDetail,
  getDeletedUsers: vi.fn(async () => ({ data: { data: { users: [] } } })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

function learner(p: Partial<typeof liveLearners.value[number]>) {
  return {
    userId: 'x', name: '匿名', email: '', pathTitle: null, currentTask: null, currentMilestone: null,
    trend: 'flat' as const, fatigue: '低', confidence: 0.8, generatedAt: '2026-10-01T08:00:00Z',
    struggling: [] as string[], fragile: [] as string[], ...p
  };
}

describe('LearnerCenter 告警拆档与口径（P1#16/17 + P2）', () => {
  beforeEach(() => {
    // 甲：疲劳中（常态档）→ 只进「观察」；乙：趋势降 → 需关注；丙：疲劳高 → 需关注；
    // 丁：两个概念挣扎（有风险摘要）→ 需关注；风险摘要要带量级
    liveLearners.value = [
      learner({ userId: 'jia', name: '甲', currentTask: '任务A', fatigue: '中', confidence: 0.6 }),
      learner({ userId: 'yi', name: '乙', currentTask: '任务B', trend: 'down', confidence: 0.5 }),
      learner({ userId: 'bing', name: '丙', currentTask: '任务C', fatigue: '高', confidence: 0.4 }),
      learner({ userId: 'ding', name: '丁', currentTask: '任务D', confidence: 0.3, struggling: ['X', 'Y'] })
    ];
    subPage.value = null;
  });

  it('需关注收窄（不含疲劳=中）；「观察」pill 单列疲劳中且可筛选；pill 计数只留无 KPI 孪生的「观察」', async () => {
    const w = mount(LearnerCenter, { props: { embedded: true, tab: 'state' } });
    await settle();
    const pillCount = (label: string) => {
      const pill = w.findAll('.mk-pill').find((p) => p.text().includes(label));
      const c = pill?.find('.mk-pill__count');
      return c && c.exists() ? c.text() : undefined;
    };
    // P2（2026-10-04 全站评审）：pill 计数只留在「观察」上（无 KPI 孪生）；需关注/低置信数字由 KPI 卡单源
    expect(pillCount('观察')).toBe('1'); // 甲（疲劳中）
    expect(pillCount('需关注')).toBeUndefined();
    const riskKpi = w.findAll('.mk-kpi').find((c) => c.text().includes('需关注'));
    expect(riskKpi!.text()).toContain('3'); // 乙（趋势降）/ 丙（疲劳高）/ 丁（风险摘要）；甲（疲劳中）不再计入

    // 点「观察」pill → 只剩甲
    await w.findAll('.mk-pill').find((p) => p.text().includes('观察'))!.trigger('click');
    await nextTick();
    const rows = w.findAll('tbody tr').map((r) => r.text());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('甲');
    w.unmount();
  });

  it('KPI「学习者」显「已加载 N」+ 口径 hint（截断句单源=页状态条）；需关注 hint 收窄为疲劳高', async () => {
    const w = mount(LearnerCenter, { props: { embedded: true, tab: 'state' } });
    await settle();
    const kpi = (label: string) => {
      const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === label);
      expect(card, `缺少 KPI：${label}`).toBeTruthy();
      return card!.text();
    };
    expect(kpi('学习者')).toContain('已加载 4');
    // P2（2026-10-04 全站评审）：「快照单次最多加载 50 条」不再进 hint（单源=People 页状态条）
    expect(kpi('学习者')).toContain('口径：不含测试账号');
    expect(kpi('学习者')).not.toContain('50 条');

    // 数据层接线后：liveLearnersTotal 有值且 ≠ 窗口数 → 显「N · 已载 M」
    const { liveLearnersTotal } = await import('../live');
    (liveLearnersTotal as unknown as { value: number | null }).value = 137;
    await nextTick();
    expect(kpi('学习者')).toContain('137 · 已载 4');
    expect(kpi('需关注')).toContain('疲劳高');
    w.unmount();
  });

  it('风险摘要带量级「X 等 2 个概念挣扎」；平均置信度 hint 带 n=', async () => {
    const w = mount(LearnerCenter, { props: { embedded: true, tab: 'state' } });
    await settle();
    const dingRow = w.findAll('tbody tr').find((r) => r.text().includes('丁'));
    expect(dingRow!.text()).toContain('「X」等 2 个概念挣扎');
    const avg = w.findAll('.mk-kpi').find((c) => c.text().includes('平均置信度'));
    expect(avg!.text()).toContain(`n=${4}`); // 四人都有任务，全部入均值
    w.unmount();
    liveLearners.value = [];
  });
});

describe('UserAccountPane 账号轴口径（人员详情合并后）', () => {
  beforeEach(() => {
    liveLearners.value = [
      learner({ userId: 'u1', name: '测试用户', trend: 'down', fatigue: '中', confidence: 0.72 })
    ];
  });

  async function mountPane() {
    const w = mount(UserAccountPane, { props: { userId: 'u1' } });
    await settle();
    return w;
  }

  it('tab 收敛守卫已随合并迁移：pane 含 账户信息/最近活动/许可与接入 三块且 feed 仍在', async () => {
    const w = await mountPane();
    const titles = w.findAll('.mk-card__title').map((t) => t.text());
    expect(titles).toContain('账户信息');
    expect(titles).toContain('最近活动');
    expect(titles).toContain('许可与接入');
    expect(w.find('.ud-feed').exists()).toBe(true);
    w.unmount();
  });

  it('统计条「学习状态」格已撤（P2 2026-10-04 全站评审）：趋势/疲劳/置信与同屏 hero pills 逐项复读', async () => {
    const w = await mountPane();
    const cell = w.findAll('.statstrip__stat').find((s) => s.text().includes('学习状态'));
    expect(cell).toBeUndefined();
    w.unmount();
  });

  it('等级读数用单点词汇「L2 · 进阶」；最后登录无兜底显「—」不显「从未」', async () => {
    const w = await mountPane();
    expect(w.find('.statstrip').text()).toContain('L2 · 进阶');
    const kv = w.find('.ud-kv').text();
    expect(kv).not.toContain('从未');
    w.unmount();
    liveLearners.value = [];
  });
});
