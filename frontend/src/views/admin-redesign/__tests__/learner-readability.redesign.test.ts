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
  // 详情接口：带 _count（会话总数 40）与 XP/层级（等级词汇断言用）；
  // deletedAt 是「账号已软删」的唯一信号，默认 null。显式标注 string|null——
  // 写成字面量 null 会把 mock 的载荷类型锁死，已删除态用例就覆写不进时间戳
  const getUserDetail = vi.fn<() => Promise<{
    data: { data: { deletedAt: string | null; user: Record<string, unknown> } }
  }>>(async () => {
    const deletedAt: string | null = null
    return {
      data: {
        data: {
          deletedAt,
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
    }
  })
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
    const w = mount(LearnerCenter);
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
    const w = mount(LearnerCenter);
    await settle();
    const kpi = (label: string) => {
      const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === label);
      expect(card, `缺少 KPI：${label}`).toBeTruthy();
      return card!.text();
    };
    expect(kpi('学习者账号')).toContain('已加载 4');
    // P2（2026-10-04 全站评审）：「快照单次最多加载 50 条」不再进 hint（单源=本页状态条，拆页后住学习状态页头）
    expect(kpi('学习者账号')).toContain('口径：不含测试账号');
    // 审核 #13：hint 补「与用户页『共 N 人』同集合 + 含未开始学习的账号」
    expect(kpi('学习者账号')).toContain('含未开始学习的账号');
    expect(kpi('学习者账号')).not.toContain('50 条');

    // 数据层接线后：liveLearnersTotal 有值且 ≠ 窗口数 → 显「N · 已载 M」
    const { liveLearnersTotal } = await import('../live');
    (liveLearnersTotal as unknown as { value: number | null }).value = 137;
    await nextTick();
    expect(kpi('学习者账号')).toContain('137 · 已载 4');
    expect(kpi('需关注')).toContain('疲劳高');
    w.unmount();
  });

  it('风险摘要带量级「X 等 2 个概念挣扎」；平均置信度 hint 带 n=', async () => {
    // 审核 #12：风险摘要列不再默认隐藏（默认集变更同时升键 v2→v3）；本用例播种「全列显示」
    // 的列偏好，仍锁行内量级文案的渲染契约
    localStorage.setItem('wf_learner_hidden_cols_v3', JSON.stringify([]));
    const w = mount(LearnerCenter);
    await settle();
    const dingRow = w.findAll('tbody tr').find((r) => r.text().includes('丁'));
    expect(dingRow!.text()).toContain('「X」等 2 个概念挣扎');
    const avg = w.findAll('.mk-kpi').find((c) => c.text().includes('平均置信度'));
    expect(avg!.text()).toContain(`n=${4}`); // 四人都有任务，全部入均值
    w.unmount();
    localStorage.removeItem('wf_learner_hidden_cols_v3');
    liveLearners.value = [];
  });

  it('低置信 KPI 与分档条/均值同口径（无任务快照不计）；基数差异就地显式（281/241 型接缝）', async () => {
    // 四人都有任务 + 戊无任务且低置信（0.2）：旧口径会把戊算进低置信 → 与紧邻的分布对不上
    liveLearners.value = [
      learner({ userId: 'jia', name: '甲', currentTask: '任务A', confidence: 0.6 }),
      learner({ userId: 'yi', name: '乙', currentTask: '任务B', confidence: 0.5 }),
      learner({ userId: 'bing', name: '丙', currentTask: '任务C', confidence: 0.4 }),
      learner({ userId: 'ding', name: '丁', currentTask: '任务D', confidence: 0.3 }),
      learner({ userId: 'wu', name: '戊', currentTask: null, confidence: 0.2 })
    ];
    const w = mount(LearnerCenter);
    await settle();
    const kpiCard = (label: string) => {
      const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === label);
      expect(card, `缺少 KPI：${label}`).toBeTruthy();
      return card!;
    };
    expect(kpiCard('低置信').find('.mk-kpi__num').text()).toBe('2'); // 丙/丁；无任务的戊不计（旧口径=3）
    expect(kpiCard('低置信').find('.mk-kpi__hint').text()).toContain('n=4'); // 基数=有任务的快照

    const sub = w.find('.mk-distband__sub').text();
    expect(sub).toContain('共 4 个有任务的快照');
    expect(sub).toContain('另 1 位无任务/无快照不计');

    // 「低置信」pill 过滤与 KPI 同口径：戊不出现，行数=KPI 读数（否则计数/过滤再打架）
    await w.findAll('.mk-pill').find((p) => p.text().includes('低置信'))!.trigger('click');
    await nextTick();
    const rowsText = w.findAll('tbody tr').map((r) => r.text());
    expect(rowsText).toHaveLength(2);
    expect(rowsText.some((t) => t.includes('戊'))).toBe(false);
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
    const cell = w.findAll('.mk-stat').find((s) => s.text().includes('学习状态'));
    expect(cell).toBeUndefined();
    w.unmount();
  });

  it('等级读数用单点词汇「L2 · 进阶」；最后登录无兜底显「—」不显「从未」', async () => {
    const w = await mountPane();
    expect(w.find('.mk-stat-strip').text()).toContain('L2 · 进阶');
    const kv = w.find('.ud-kv').text();
    expect(kv).not.toContain('从未');
    w.unmount();
    liveLearners.value = [];
  });
});

/**
 * 账号状态与账户操作归位（2026-10-08 用户判例「这个设计的不好，重新设计」）：
 * 原来 pane 顶部是一条 28px 游离行（`.ud-head`：只有状态徽章 + 贴错位的 ⋯），
 * 与它作用的账户字段不在同一块里。现在归「账户信息」卡头，走全站 `.mk-card__head` /
 * `.mk-card__head-right` 语法（标题吃剩余宽度、尾部元素贴右）。
 */
describe('UserAccountPane 账户信息卡头（状态与账户操作归位）', () => {
  /** 详情载荷：deletedAt 显式给 null —— 它是「未删除」的唯一信号，
      也让下面的已删除态用例能共用同一个 mock 载荷类型 */
  const aliveDetail = () => ({
    data: {
      data: {
        deletedAt: null,
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
  });

  beforeEach(() => {
    liveLearners.value = [learner({ userId: 'u1', name: '测试用户' })];
    getUserDetail.mockResolvedValue(aliveDetail());
    localStorage.removeItem('admin_user');
  });

  async function mountPane() {
    const w = mount(UserAccountPane, { props: { userId: 'u1' } });
    await settle();
    return w;
  }

  /** 账户信息卡的卡头（标题 + 状态 + 账户操作所在的那一行） */
  const accountHead = (w: ReturnType<typeof mount>) =>
    w.findAll('.mk-card__head').find((h) => h.text().includes('账户信息'))!;

  it('游离的 .ud-head 行已退役，状态与账户操作落在「账户信息」卡头内', async () => {
    const w = await mountPane();
    expect(w.find('.ud-head').exists()).toBe(false);
    expect(w.find('.ud-head__sp').exists()).toBe(false);
    const head = accountHead(w);
    expect(head.exists()).toBe(true);
    // 状态徽章与动作同排：都在卡头右侧组里，而不是散在卡外
    expect(head.find('.mk-badge').text()).toBe('正常');
    expect(head.find('.mk-card__head-right').exists()).toBe(true);
    expect(head.find('.mk-menu__btn').exists()).toBe(true);
    // 动作与它作用的账户字段同卡
    expect(head.element.closest('.mk-card')).toBe(w.find('.ud-kv').element.closest('.mk-card'));
    w.unmount();
  });

  it('删除入口仍是低频/危险收进 ⋯ 的约定：菜单项为「删除账户…」，且带软删说明', async () => {
    const w = await mountPane();
    const head = accountHead(w);
    await head.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const item = w.find('.mk-menu__pop .mk-menu__item--danger');
    expect(item.exists()).toBe(true);
    expect(item.text()).toContain('删除账户');
    expect(item.attributes('title')).toContain('软删除');
    w.unmount();
  });

  it('已删除态：徽章翻「已删除」、恢复入口顶替 ⋯（不出现删除项）', async () => {
    getUserDetail.mockResolvedValue({
      data: {
        data: {
          deletedAt: '2026-10-01T00:00:00Z',
          user: {
            name: '测试用户',
            email: 't@x.com',
            createdAt: '2026-08-01T00:00:00Z',
            xp: 0,
            currentLevel: 'beginner',
            _count: { teaching_sessions: 0, learning_paths: 0 }
          }
        }
      }
    });
    const w = await mountPane();
    const head = accountHead(w);
    expect(head.find('.mk-badge').text()).toBe('已删除');
    expect(head.findAll('button').some((b) => b.text().includes('恢复用户'))).toBe(true);
    expect(head.find('.mk-menu__btn').exists()).toBe(false);
    w.unmount();
  });

  it('自保护口径不变：查看自己的账号时不出现 ⋯ 删除入口', async () => {
    localStorage.setItem('admin_user', JSON.stringify({ id: 'u1' }));
    const w = await mountPane();
    expect(accountHead(w).find('.mk-menu__btn').exists()).toBe(false);
    // 状态徽章与该看的事实仍在（自保护只收动作，不收读数）
    expect(accountHead(w).find('.mk-badge').text()).toBe('正常');
    w.unmount();
    localStorage.removeItem('admin_user');
  });
});
