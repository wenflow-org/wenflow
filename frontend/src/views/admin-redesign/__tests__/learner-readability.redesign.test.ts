/**
 * 人员轴「人类可读性」修复回归（2026-10-02 评审 P1#14/15/16/17 + P2）：
 * - LearnerCenter isRisk 拆档：需关注=趋势降 ∨ 疲劳高 ∨ 有风险摘要；疲劳=中 单列「观察」
 * - LearnerCenter KPI 学习者=「已加载 N」（live.ts 未透出后端 total 前的诚实口径）
 * - LearnerCenter 风险摘要带量级 + 平均置信度卡面只留读数
 * - UserAccountPane（人员详情合并后 LearnerDetail 的「账号与许可」pane）：统计条「学习状态」格 + 最后登录无兜底显「—」
 * 2026-10-26：KPI 即筛选入口（卡头 pill 行撤除）；干预弹窗出口收口（删「查看执行日志」，
 * 「查看学习详情」与行内「详情」同落证据页签）；发送成功给可核对落点。
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

  /* 2026-10-26：干预弹窗原先两个出口都到不了这个人——「查看执行日志」落全站日志首页
     （执行日志没有学习者维度），「查看学习详情」落概览（找不到弹窗里那条风险摘要）。
     现在只留一个，且与行内「详情」同落证据页签。 */
  it('干预弹窗：删「查看执行日志」；「查看学习详情」与行内「详情」同落证据页签', async () => {
    const w = mount(LearnerCenter);
    await settle();
    const riskRow = w.findAll('tbody tr').find((r) => r.text().includes('乙'))!;
    const intervene = riskRow.findAll('.mk-actions button').find((b) => b.text() === '干预')!;
    await intervene.trigger('click');
    await settle();
    const labels = Array.from(document.body.querySelectorAll('.mk-modal button')).map((b) => b.textContent?.trim());
    expect(labels).toContain('查看学习详情');
    expect(labels).not.toContain('查看执行日志');
    // 弹窗底部那句解释也撤了
    expect(document.body.querySelector('.mk-modal')!.textContent).not.toContain('站内通知中');

    const detailBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.mk-modal button'))
      .find((b) => b.textContent?.trim() === '查看学习详情')!;
    detailBtn.click();
    await settle();
    expect(subPage.value).toMatchObject({ view: 'learner', id: 'yi', tab: 'evidence' });
    w.unmount();
    document.body.innerHTML = '';
  });

  /* 发送成功不再只有一闪而过的 toast：页内留结果条，带「查看通知」按该学习者筛 */
  it('发送提醒成功 → 页内结果条 + 「查看通知」指向 ops-hub?tab=inapp&userId=', async () => {
    const w = mount(LearnerCenter);
    await settle();
    const riskRow = w.findAll('tbody tr').find((r) => r.text().includes('乙'))!;
    await riskRow.findAll('.mk-actions button').find((b) => b.text() === '干预')!.trigger('click');
    await settle();
    const modal = document.body.querySelector<HTMLElement>('.mk-modal')!;
    // 标题已预填，直接发送
    const send = Array.from(modal.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === '发送提醒')!;
    send.click();
    await settle();
    const bar = w.find('.mk-alert--row');
    expect(bar.text()).toContain('提醒已发送给「乙」');
    expect(bar.findAll('button').some((b) => b.text() === '查看通知')).toBe(true);
    w.unmount();
    document.body.innerHTML = '';
  });

  it('需关注收窄（不含疲劳=中）；「观察」是独立可点 KPI，卡头不再有同名 pill 行', async () => {
    const w = mount(LearnerCenter);
    await settle();
    /* 2026-10-26：筛选入口从卡头 pill 行移到 KPI 卡——同一个数字不再有「不能点的卡」与
       「能点的胶囊」两个版本 */
    expect(w.findAll('.mk-card__head .mk-pill')).toHaveLength(0);
    const kpi = (label: string) =>
      w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === label)!;
    expect(kpi('观察').find('.mk-kpi__num').text()).toBe('1'); // 甲（疲劳中）
    expect(kpi('需关注').find('.mk-kpi__num').text()).toBe('3'); // 乙（趋势降）/ 丙（疲劳高）/ 丁（风险摘要）；甲不再计入
    expect(kpi('需关注').classes()).toContain('mk-kpi--clickable');

    // 点「观察」卡 → 只剩甲；再点一次取消筛选
    await kpi('观察').trigger('click');
    await nextTick();
    const rows = w.findAll('tbody tr').map((r) => r.text());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('甲');
    expect(kpi('观察').classes()).toContain('lc-kpi--on');
    await kpi('观察').trigger('click');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(4);
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

  it('数据更新列读学习证据时间，不读快照重算时间（批重建曾把全表刷成同一分钟）', async () => {
    // 2026-10-23 用户「怎么都是 37 分钟呢」：generatedAt 是列表请求整批重建的快照时间，
    // 用它当列会让所有学习者同屏同值；列读 dataUpdatedAt（freshness.basedOn 最新一条）
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    const sameBatchBuild = '2026-10-23T02:12:27.000Z';
    liveLearners.value = [
      learner({ userId: 'a', name: '甲', currentTask: '任务A', generatedAt: sameBatchBuild, dataUpdatedAt: twoDaysAgo }),
      learner({ userId: 'b', name: '乙', currentTask: '任务B', generatedAt: sameBatchBuild, dataUpdatedAt: tenDaysAgo }),
      learner({ userId: 'c', name: '丙', currentTask: '', generatedAt: sameBatchBuild, dataUpdatedAt: null }),
    ];
    const w = mount(LearnerCenter);
    await settle();
    const heads = w.findAll('th').map((t) => t.text());
    expect(heads).toContain('数据更新');
    expect(heads).not.toContain('档案更新');
    // 甲 2 天、乙 10 天，各不相同；丙无学习数据 → 「—」，不拿重建时间冒充
    const cellsText = w.findAll('tbody tr').map((r) => r.findAll('td').at(-2)!.text())
    expect(cellsText[0]).toContain('2 天前')
    expect(cellsText[1]).toContain('10 天前')
    expect(cellsText[2]).toBe('—')
    const tip = w.findAll('tbody tr').at(0)!.findAll('td').at(-2)!.find('.mk-fresh').attributes('title') || ''
    expect(tip).toContain('数据截至')
    expect(tip).toContain('档案重算')
    w.unmount()
    liveLearners.value = []
  });

  it('风险摘要带量级「X 等 2 个概念掌握薄弱」；平均置信度卡面只有读数', async () => {
    // 审核 #12：风险摘要列不再默认隐藏（默认集变更同时升键 v2→v3）；本用例播种「全列显示」
    // 的列偏好，仍锁行内量级文案的渲染契约
    localStorage.setItem('wf_learner_hidden_cols_v3', JSON.stringify([]));
    const w = mount(LearnerCenter);
    await settle();
    const dingRow = w.findAll('tbody tr').find((r) => r.text().includes('丁'));
    expect(dingRow!.text()).toContain('「X」等 2 个概念掌握薄弱');
    /* 2026-10-26：KPI 卡的 title 口径自述整批撤除，卡面只留 label + 读数 */
    const avg = w.findAll('.mk-kpi').find((c) => c.text().includes('平均置信度'));
    expect(avg!.find('.mk-kpi__hint').exists()).toBe(false);
    expect(avg!.attributes('title')).toBeUndefined();
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
    // 2026-10-26：KPI 卡面只留 label + 读数，口径自述不再挂 title
    expect(kpiCard('低置信学习者').find('.mk-kpi__hint').exists()).toBe(false);
    expect(kpiCard('低置信学习者').attributes('title')).toBeUndefined();

    // 分布带已退役：无任务行不计的口径由「低置信学习者」卡与列表过滤共同承载
    expect(w.find('.mk-distband').exists()).toBe(false);

    // 点「低置信学习者」卡 → 与 KPI 同口径：戊不出现，行数=KPI 读数（否则计数/过滤再打架）
    await kpiCard('低置信学习者').trigger('click');
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

  /* 2026-10-26：详情页原先全文没有编辑或改密入口——看到「角色：管理员」想改只能退回列表。
     卡头补「编辑」，与账号列表行内「编辑」打开同一份表单。 */
  it('卡头「编辑」打开同一份表单（改昵称 / 邮箱 / 角色、重置密码）', async () => {
    const w = await mountPane();
    const head = accountHead(w);
    const edit = head.findAll('button').find((b) => b.text() === '编辑');
    expect(edit, '卡头应有「编辑」').toBeTruthy();
    await edit!.trigger('click');
    await settle();
    const modal = document.body.querySelector('.mk-modal');
    expect(modal).toBeTruthy();
    expect(modal!.textContent).toContain('编辑用户 · 测试用户');
    // 角色下拉与密码重置字段都在
    expect(modal!.textContent).toContain('重置密码');
    expect(modal!.querySelector('select')).toBeTruthy();
    w.unmount();
    document.body.innerHTML = '';
  });

  it('已删除态不给编辑（先恢复再改）', async () => {
    getUserDetail.mockResolvedValue({
      data: {
        data: {
          deletedAt: '2026-10-01T00:00:00Z',
          user: {
            name: '测试用户', email: 't@x.com', createdAt: '2026-08-01T00:00:00Z',
            xp: 0, currentLevel: 'beginner', _count: { teaching_sessions: 0, learning_paths: 0 }
          }
        }
      }
    });
    const w = await mountPane();
    const head = accountHead(w);
    expect(head.findAll('button').some((b) => b.text() === '编辑')).toBe(false);
    expect(head.findAll('button').some((b) => b.text().includes('恢复用户'))).toBe(true);
    w.unmount();
  });
});
