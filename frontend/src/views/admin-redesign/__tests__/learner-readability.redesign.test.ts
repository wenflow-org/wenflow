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

  it('行「详情」落在「证据」页签（列表读数列与详情证据页签同口径；2026-10-18 用户走查，不再一律落概览）', async () => {
    const w = mount(LearnerCenter);
    await settle();
    await w.find('tbody tr').trigger('click');
    expect(subPage.value).toMatchObject({ view: 'learner', tab: 'evidence' });
    expect(subPage.value?.id).toBeTruthy();
    w.unmount();
  });

  it('需关注收窄（不含疲劳=中）；「观察」pill 单列疲劳中且可筛选；pill 计数全显（2026-10-11 统一判例）', async () => {
    const w = mount(LearnerCenter);
    await settle();
    const pillCount = (label: string) => {
      const pill = w.findAll('.mk-pill').find((p) => p.text().includes(label));
      const c = pill?.find('.mk-pill__count');
      return c && c.exists() ? c.text() : undefined;
    };
    // 2026-10-11 统一判例：筛选 pill 一律显命中数（需关注与 KPI 卡同源同数）
    expect(pillCount('观察')).toBe('1'); // 甲（疲劳中）
    expect(pillCount('需关注')).toBe('3');
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

  it('KPI「学习者」显「已加载 N」；卡面不再挂口径副行（2026-10-21）', async () => {
    const w = mount(LearnerCenter);
    await settle();
    const kpi = (label: string) => {
      const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === label);
      expect(card, `缺少 KPI：${label}`).toBeTruthy();
      return card!.text();
    };
    expect(kpi('学习者账号')).toContain('已加载 4');
    // P2（2026-10-04 全站评审）：「快照单次最多加载 50 条」不再进 hint（单源=本页状态条，拆页后住学习状态页头）
    // 2026-10-21 用户「除了 kpi 面板，其他地方也有这种文案」：视角复述撤出副行（右上角开关自明），
    // 只留会改变读数含义的范围说明
    expect(kpi('学习者账号')).not.toContain('仅真实用户');
    // 2026-10-21 用户「不要了」：KPI 卡面只留 label + 读数，范围说明只在 title
    expect(kpi('学习者账号')).not.toContain('含未开始学习的账号');
    expect(kpi('学习者账号')).not.toContain('50 条');

    // 数据层接线后：liveLearnersTotal 有值且 ≠ 窗口数 → 显「N · 已载 M」
    const { liveLearnersTotal } = await import('../live');
    (liveLearnersTotal as unknown as { value: number | null }).value = 137;
    await nextTick();
    expect(kpi('学习者账号')).toContain('137 · 已加载 4');
    expect(kpi('需关注')).not.toContain('疲劳高'); // 构成说明只在 title
    w.unmount();
  });

  it('风险摘要带量级「X 等 2 个概念掌握薄弱」；平均置信度基数进 title 长释', async () => {
    // 审核 #12：风险摘要列不再默认隐藏（默认集变更同时升键 v2→v3）；本用例播种「全列显示」
    // 的列偏好，仍锁行内量级文案的渲染契约
    localStorage.setItem('wf_learner_hidden_cols_v3', JSON.stringify([]));
    const w = mount(LearnerCenter);
    await settle();
    const dingRow = w.findAll('tbody tr').find((r) => r.text().includes('丁'));
    expect(dingRow!.text()).toContain('「X」等 2 个概念掌握薄弱');
    /* 2026-10-21 用户「除了 kpi 面板，其他地方也有这种文案」：取数算法（按…取平均）不再常驻
       卡面，样本量仍在 title 长释里 */
    const avg = w.findAll('.mk-kpi').find((c) => c.text().includes('平均置信度'));
    expect(avg!.find('.mk-kpi__hint').exists()).toBe(false);
    expect(avg!.attributes('title')).toContain('本次纳入 4 位'); // 四人都有任务，全部入均值
    w.unmount();
    localStorage.removeItem('wf_learner_hidden_cols_v3');
    liveLearners.value = [];
  });

  it('低置信 KPI 与均值同口径（无任务快照不计）；基数差异由 KPI 披露（分布带已于 2026-10-17 退役）', async () => {
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
    expect(kpiCard('低置信学习者').find('.mk-kpi__num').text()).toBe('2'); // 丙/丁；无任务的戊不计（旧口径=3）
    // 2026-10-21 用户「去掉；需要下方加字说明标题起得不对」：卡名自带人群，卡面无副行，
    // 阈值与基数只在 title
    expect(kpiCard('低置信学习者').find('.mk-kpi__hint').exists()).toBe(false);
    expect(kpiCard('低置信学习者').attributes('title')).toContain('纳入计算的学习者共 4 位');

    // 分布带已退役：无任务行不计的口径由 KPI 基数承载（现住 title），不再有分档条副文
    expect(w.find('.mk-distband').exists()).toBe(false);
    expect(kpiCard('平均置信度').attributes('title')).toContain('本次纳入 4 位');

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

  it('账号页只留账户与许可：活动 feed 已迁出（2026-10-19 用户拍板去重）', async () => {
    const w = await mountPane();
    const titles = w.findAll('.mk-card__title').map((t) => t.text());
    // 许可不再独占卡片（原卡体只有一句说明 + 两个动作），按外部评审 #2 原建议收编为
    // 账户 kv 里的一行属性（.ud-kv__wide：徽章 + 说明 + 右端动作）
    expect(titles).toContain('账号与许可');
    // 「最近活动」的会话行与概览「最近会话」同源同对象；目标对话迁到概览「最近目标对话」
    expect(titles).not.toContain('最近活动');
    expect(w.find('.ud-feed').exists()).toBe(false);
    expect(titles).not.toContain('许可与接入');
    expect(w.find('.ud-kv').text()).toContain('开发视角许可');
    expect(w.find('.ud-kv__wide').exists()).toBe(true);
    w.unmount();
  });

  it('账号轴统计带整条已撤（2026-10-11 用户走查「这个不要了，页面重新设计」）', async () => {
    const w = await mountPane();
    // 路径/会话/XP/等级四格各归其主（会话→教学会话页签、XP 与等级→画像、路径→概览）
    expect(w.find('.mk-stat-strip').exists()).toBe(false);
    expect(w.findAll('.mk-stat').length).toBe(0);
    w.unmount();
  });

  it('账号域字段补全（账号类型 / 用户 ID）；最后登录无兜底显「—」不显「从未」', async () => {
    const w = await mountPane();
    const kv = w.find('.ud-kv').text();
    expect(kv).toContain('账号类型');
    expect(kv).toContain('用户 ID');
    expect(kv).not.toContain('从未');
    w.unmount();
    liveLearners.value = [];
  });

  it('账号页不再自行拉会话列表（活动 feed 已迁出）', async () => {
    // 活动 feed 已迁出账号页（2026-10-19）：概览「最近会话」保留同款「排除废弃 + 标注隐藏条数」口径，
    // 目标对话改由「最近目标对话」承载；此处只守卫账号页不再自行拉会话列表。
    const w = await mountPane();
    expect(w.find('.ud-feed').exists()).toBe(false);
    expect(listSessions).not.toHaveBeenCalled();
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

  /** 账户卡的卡头（标题 + 状态 + 账户操作所在的那一行；2026-10-11 合卡后标题为「账号与许可」（2026-10-23 与页签同词）） */
  const accountHead = (w: ReturnType<typeof mount>) =>
    w.findAll('.mk-card__head').find((h) => h.text().includes('账号与许可'))!;

  it('游离的 .ud-head 行已退役，状态与账户操作落在账户卡头内', async () => {
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

  it('删除入口仍是低频/危险收进 ⋯ 的约定：菜单项为「删除账号…」，且带软删说明', async () => {
    const w = await mountPane();
    const head = accountHead(w);
    await head.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const item = w.find('.mk-menu__pop .mk-menu__item--danger');
    expect(item.exists()).toBe(true);
    expect(item.text()).toContain('删除账号');
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
