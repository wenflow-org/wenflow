/**
 * LearnerDetail 学习者阶段切换 + FSRS 到期三态回归：
 * - 教学会话 pane 的阶段切换器：档位/计数从会话窗口的 milestoneIndex 派生（零新后端契约），
 *   单阶段不渲染，多阶段可筛选，meta 显示「N / M 条」；
 * - 到期列三态：timeAgo 对未来时间返回「刚刚」的失真修复（逾期 N 天 / 今天到期 / N 天后）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { chooseMkSelect, mkSelectLabels } from '@/components/mk/__tests__/mkSelect';

const listSessions = vi.hoisted(() => vi.fn());
const listGoals = vi.hoisted(() => vi.fn());
const listPaths = vi.hoisted(() => vi.fn());
const getMemoryTraces = vi.hoisted(() => vi.fn());
const getLearnerEvidence = vi.hoisted(() => vi.fn().mockResolvedValue({ items: [], domain: [], loadCurve: [] }));

const routeQuery = vi.hoisted(() => ({ tab: 'sessions' } as Record<string, string>));
const routerReplace = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));
vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    subPage: ref({ view: 'learner', id: 'u1', label: '' }),
    openSubPage: vi.fn(),
    setSubPageLabel: vi.fn(),
  };
});
vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveLearners: ref([{ userId: 'u1', name: '测试学习者', pathId: 'lp1' }]),
    // 用户域：概览「账号信息」卡复用（与 UserAccountPane 同源），不新增接口
    liveUsers: ref([]),
    // 虚拟档案列表：boot 全量载入，学习者详情用它反查「虚拟档案 →」互跳入口（默认空 = 真人账号）
    liveVirtuals: ref([]),
  liveGetLearnerDetail: vi.fn().mockResolvedValue({
    model: {
      name: '测试学习者',
      knowledgeMemory: {
        currentPath: {
          learningPathId: 'lp1',
          pathTitle: '测试路径',
          progress: { totalTasks: 10, completedTasks: 3, totalMilestones: 3, completedMilestones: 1 },
          conceptStates: [],
        },
        globalSignals: {},
      },
    },
  }),
  liveGetLearnerEvidence: getLearnerEvidence,
  liveGetLearnerPredictions: vi.fn().mockResolvedValue(null),
  liveRecomputeLearner: vi.fn(),
  liveGetMemoryTraces: getMemoryTraces,
  timeAgo: (iso: string) => String(iso).slice(0, 10),
  errMsg: (e: unknown) => String(e),
  };
});
vi.mock('../evidence', () => ({
  evidenceDotTone: () => 'muted',
  evidenceLowConfidence: () => false,
  evidenceSignalZh: () => '',
  evidenceTypeZh: (t: string) => t,
  evidenceFullTooltip: () => '',
  evidenceConfidenceTone: () => 'muted',
  evidenceDensityTooltip: () => '',
}));
vi.mock('../learner-profile', () => ({
  conceptBarTone: () => 'muted',
  conceptBarWidth: () => 0,
  memoryReviewUrl: (id: string) => `/admin/memory-review?userId=${id}`,
  transferReadinessZh: () => '—',
  misconceptionRiskZh: () => '—',
  // 叙述洞察渲染前会过一遍句读清洗；mock 里保持恒等，避免 undefined 把 computed 炸掉
  tidyNarrativeText: (s: string) => s,
  normalizeLearnerTab: (t: string) => t,
  levelFromXp: () => 1,
  // 等级词汇单点（LearnerDetail EN_ZH/画像卡引用，2026-10-02 起）
  levelWordZh: (v?: string | null) =>
    (({ beginner: '入门', intermediate: '进阶', advanced: '高级' } as Record<string, string>)[String(v || '').toLowerCase()] || String(v || '')),
  levelBadgeZh: (xp: number, level?: string | null) => {
    const l = `L${Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1}`
    const word = (({ beginner: '入门', intermediate: '进阶', advanced: '高级' } as Record<string, string>)[String(level || '').toLowerCase()] || String(level || ''))
    return !word || word === l ? l : `${l} · ${word}`
  },
}));
vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: { list: listSessions },
  adminGoalConversationsApi: { list: listGoals },
  // 路径视角开关的选项来源（GET /paths?userId=）
  adminLearningContentApi: { listPaths },
  // 记忆页签嵌入的 MemoryReview 面板会在挂载时拉明细：给 resolved 值防空 catch 炸响
  adminMemoryReviewApi: { detail: vi.fn().mockResolvedValue({ data: { data: null } }), recompute: vi.fn(), apply: vi.fn(), reject: vi.fn(), rollback: vi.fn() },
  // 必须给 resolved 值：loadDetail 对它 .then，undefined 会在 try 内同步抛 TypeError 炸掉后续 loadLdSessions
  getUserIncludingDeleted: vi.fn().mockResolvedValue({ data: { data: {} } }),
  // 证据页新增的建议归因命中率读侧（2026-10-21）：同样必须有函数，否则同步 TypeError 落进详情 catch
  adminOpsApi: { insightReliability: vi.fn().mockResolvedValue({ data: { data: null } }) },
  // 课堂只读预览抽屉（2026-11-11）：打开行时才请求 session-console
  adminVirtualLearnersApi: {
    getRealSessionConsole: vi.fn().mockResolvedValue({
      data: {
        data: {
          kind: 'teaching',
          sessionId: 's1',
          teaching: { topic: '会话 s1', status: 'completed', messages: [], wrapup: null },
        },
      },
    }),
  },
}));
vi.mock('../statusText', async () => {
  // 建议徽章读运营口径（2026-10-22）：用真实实现，别在 mock 里另写一份文案
  const actual = await vi.importActual<typeof import('../statusText')>('../statusText')
  return {
    ...actual,
    statusText: (s: string) => s,
    // C10 上收后教学 pane 徽章走 sessionStatusBadgeCls；本 mock 只需可调用返回空串（断言不涉及配色）
    sessionStatusBadgeCls: () => '',
    // 2026-10-11 深设计：进度列复用共享 statusText.sessionProgress* 四件套
    sessionProgressPct: (p: { taskIndex: number; totalTasks: number } | null) =>
      p && p.totalTasks > 0 ? Math.round((p.taskIndex / p.totalTasks) * 100) : null,
    sessionProgressText: (p: { taskIndex: number; totalTasks: number } | null) =>
      p && p.totalTasks > 0 ? `任务 ${p.taskIndex}/${p.totalTasks}` : '—',
    sessionProgressTone: () => null,
    sessionProgressDone: (s: string) => s === 'completed' || s === 'succeeded',
  }
});
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const copyText = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/utils/clipboard', () => ({ copyText }));

import LearnerDetail from '../LearnerDetail.vue';
import { liveUsers, liveVirtuals, liveGetLearnerDetail, liveLearners, type LiveVirtual } from '../live';
import { openSubPage, subPage } from '../store';

function sessionRow(id: string, milestoneIndex: number | null, status = 'completed') {
  return {
    id,
    topic: `会话 ${id}`,
    subject: 'concept-teaching',
    status,
    startTime: new Date().toISOString(),
    messageCount: 4,
    duration: 300,
    progress: milestoneIndex == null ? null : { milestoneIndex, totalMilestones: 3 },
  };
}

async function mountLd(sessions: ReturnType<typeof sessionRow>[]) {
  listSessions.mockResolvedValue({ data: { data: { items: sessions } } });
  const w = mount(LearnerDetail, {
    global: {
      stubs: {
        // 命名 + 接 props：压力曲线用例要读 option.xAxis.data 断言轴域
        MkChart: { name: 'MkChart', props: ['option'], template: '<div class="stub-chart" />' },
        // 命名 + 接 props：路径视角用例要断言页级作用域已接管（show-path-rail=false）
        MkGraphExplorer: { name: 'MkGraphExplorer', props: ['nodes', 'edges', 'paths', 'pathId', 'showPathRail'], template: '<div class="stub-graph" />' },
        RouterLink: { template: '<a><slot /></a>' },
        Teleport: { template: '<teleport to="body"><slot /></teleport>' },
      },
    },
  });
  await flushPromises();
  return w;
}

describe('LearnerDetail 教学会话 pane：视角 + 阶段筛选', () => {
  /** 工具栏两组 chips 的选择器（2026-10-11 深设计：视角组与阶段组同排分域） */
  const stageChips = (w: ReturnType<typeof mount>) =>
    w.findAll('.ld-filtbar__grp[aria-label="按阶段筛选课堂"] .mk-pill');
  const viewChips = (w: ReturnType<typeof mount>) =>
    w.findAll('.ld-filtbar__grp[aria-label="课堂视角"] .mk-pill');

  beforeEach(() => {
    setActivePinia(createPinia());
    listSessions.mockReset();
    getMemoryTraces.mockReset().mockResolvedValue([]);
  });

  it('多阶段：阶段 chips 按里程碑升序带计数，点击筛选', async () => {
    const w = await mountLd([
      sessionRow('s1', 1),
      sessionRow('s2', 1),
      sessionRow('s3', 2),
      sessionRow('s4', null), // 无归因行不进档位，但留在「全部阶段」
    ]);
    // 列方言回归（2026-10-11 用户走查：阶段从身份副行拆成独立列；列序按叙事重排）
    // 2026-10-21：状态后补「课堂」列（正课/复习课/延伸课）
    expect(w.findAll('#ld-panel-sessions thead th').map((t) => t.text())).toEqual([
      '课堂', '阶段', '进度', '状态', '课堂类型', '互动', '课后总结', '时间', '课堂 ID',
    ]);
    const chips = stageChips(w);
    expect(chips.length).toBe(3); // 全部阶段 + 里程碑1 + 里程碑2
    expect(chips[0].text()).toContain('全部阶段 · 4');
    expect(chips[1].text()).toContain('里程碑 1 · 2');
    expect(chips[2].text()).toContain('里程碑 2 · 1');

    await chips[2].trigger('click');
    await flushPromises();
    const rows = w.findAll('tbody .ld-pane-row');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('s3');
    // 阶段独立成列，身份副行只留路径
    expect(rows[0].findAll('td')[1].text()).toContain('里程碑 2/3');
    expect(rows[0].findAll('td')[0].text()).not.toContain('里程碑');
  });

  it('回到「全部阶段」恢复全量；切人/重载后失效档位自动复位', async () => {
    const w = await mountLd([sessionRow('s1', 1), sessionRow('s2', 2)]);
    await stageChips(w)[2].trigger('click');
    await flushPromises();
    expect(w.findAll('tbody .ld-pane-row').length).toBe(1);

    await stageChips(w)[0].trigger('click');
    await flushPromises();
    expect(w.findAll('tbody .ld-pane-row').length).toBe(2);
  });

  it('单阶段：不渲染阶段切换器（单档即全部）', async () => {
    const w = await mountLd([sessionRow('s1', 1), sessionRow('s2', 1)]);
    expect(w.find('.ld-filtbar__grp[aria-label="按阶段筛选课堂"]').exists()).toBe(false);
  });

  it('视角默认「有效」：隐藏废弃重试；头部读数给 有效/废弃 分档', async () => {
    const w = await mountLd([
      sessionRow('s1', 1),
      sessionRow('s2', 1, 'discarded'),
      sessionRow('s3', 1, 'discarded'),
    ]);
    expect(viewChips(w).map((c) => c.text())).toEqual(['有效 · 1', '已废弃 · 2', '窗口全部 · 3']);
    // 2026-10-23 走查：分档计数只在 pills 上，卡头只留作用域（不再复读 有效/废弃）
    const meta = w.find('#ld-panel-sessions .mk-card__meta').text();
    expect(meta).toContain('当前路径');
    expect(meta).not.toContain('有效');
    const rows = w.findAll('tbody .ld-pane-row');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('s1');
  });

  it('切「已废弃」只看废弃；「窗口全部」恢复全量', async () => {
    const w = await mountLd([
      sessionRow('s1', 1),
      sessionRow('s2', 1, 'discarded'),
      sessionRow('s3', 1, 'timeout'),
    ]);
    await viewChips(w)[1].trigger('click');
    await flushPromises();
    let rows = w.findAll('tbody .ld-pane-row');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('s2');

    // 超时/失败属有效信号会话（有教学过程），只有 discarded 算废弃
    await viewChips(w)[0].trigger('click');
    await flushPromises();
    rows = w.findAll('tbody .ld-pane-row');
    expect(rows.map((r) => r.text().match(/s\d/)?.[0])).toEqual(['s1', 's3']);

    await viewChips(w)[2].trigger('click');
    await flushPromises();
    expect(w.findAll('tbody .ld-pane-row').length).toBe(3);
  });

  it('有效视角为空时给切视角提示（不显示"暂无会话"）', async () => {
    const w = await mountLd([sessionRow('s1', 1, 'discarded'), sessionRow('s2', 1, 'discarded')]);
    expect(w.findAll('tbody .ld-pane-row').length).toBe(0);
    expect(w.text()).toContain('均已被重置');
    expect(w.text()).toContain('切「已废弃」或「窗口全部」查看');
  });

  it('互动/产物列消费接口现成字段：知识点数、总结档、建议徽章', async () => {
    listSessions.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              ...sessionRow('s1', 1),
              knowledgePointCount: 3,
              wrapup: { status: 'complete', summary: {} },
              advisory: { shouldSuggest: true, priority: 'high', ui: { title: '建议重排', body: '理由' } },
            },
            {
              ...sessionRow('s2', 1, 'timeout'),
              knowledgePointCount: 1,
              wrapup: { status: 'summary-only', summary: {} },
            },
          ],
        },
      },
    });
    const w = mount(LearnerDetail, {
      global: {
        stubs: {
          MkChart: { template: '<div class="stub-chart" />' },
          MkGraphExplorer: { template: '<div class="stub-graph" />' },
          RouterLink: { template: '<a><slot /></a>' },
          Teleport: { template: '<teleport to="body"><slot /></teleport>' },
        },
      },
    });
    await flushPromises();
    const rows = w.findAll('tbody .ld-pane-row');
    expect(rows[0].text()).toContain('知识 3 点');
    expect(rows[0].text()).toContain('有总结');
    // 建议徽章走运营口径（2026-10-22）：不搬学员端标题「建议重排」，只报处置状态
    expect(rows[0].text()).toContain('待确认调整');
    expect(rows[0].text()).not.toContain('建议重排');
    expect(rows[1].text()).toContain('降级总结');
  });

  it('课堂 ID 列：长 ID 收成前 8 / 后 6，完整 ID 进 title，列禁止折行', async () => {
    const longId = 'teaching_user_9c353e6e-0c8e-46e5-b764-a4d4bc50dbcb';
    const w = await mountLd([sessionRow(longId, 1)]);
    const cell = w.find('#ld-panel-sessions tbody .ld-col-id');
    expect(cell.text()).toBe('teaching…50dbcb');
    expect(cell.attributes('title')).toBe(longId);
    expect(cell.classes()).toContain('ld-col-id');
  });
});

describe('LearnerDetail 记忆与复习 pane（2026-10-11 深设计）', () => {
  const day = 86400000;
  const trace = (over: Record<string, unknown>) => ({
    conceptKey: 'kc-x', label: '知识点', masteryScore: 0.5, stability: 'developing',
    extractionCount: 1, lastSeenAt: new Date(Date.now() - 2 * day).toISOString(),
    fsrsStability: 0.5, fsrsDifficulty: 6.4, ktMasteryEma: 0.8,
    dueAt: new Date(Date.now() + day).toISOString(), retrievability: 0.9,
    updatedAt: new Date().toISOString(), ...over
  });
  const mountMemory = async (rows: ReturnType<typeof trace>[]) => {
    getMemoryTraces.mockResolvedValue(rows);
    const w = await mountLd([]);
    return w;
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'memory';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset();
  });

  it('记忆与调度页签：FSRS 普查表列方言含掌握度；调度面板随页签合并挂载（2026-11-09 页签裁并）', async () => {
    const w = await mountMemory([trace({})]);
    // 合并后单一页签：普查表列 = 知识点 / 掌握度 / 记忆强度 / 复习到期 / 回忆记录 / 状态
    expect(w.findAll('#ld-panel-memory thead th').map((t) => t.text())).toEqual([
      '知识点', '掌握度', '记忆强度', '复习到期', '回忆记录', '状态',
    ]);
    // 操作列已撤（无单点复习接口）；调度面板（温故计划/归并审计/回滚）随 MemoryReview 一并进入本页签
    expect(w.findAll('#ld-panel-memory tbody button').length).toBe(0);
    expect(w.find('#ld-panel-memory .mk-card__head .mk-link').exists()).toBe(false);
    expect(w.find('#ld-panel-memory .mr-panels').exists(), '合并后页签应渲染调度面板').toBe(true);
    // 本夹具的 review-detail mock 返回 null → 面板显示暂无兜底（栏与卡片按明细有无渲染）
    expect(w.find('#ld-panel-memory .mr-panels').text()).toContain('暂无可复盘的记忆数据');
  });

  it('旧深链 ?tab=memory-ops 回落到合并后的「记忆」页签（normalizeLdTab 别名）', async () => {
    routeQuery.tab = 'memory-ops';
    const ops = await mountMemory([trace({})]);
    // 合并后不再有独立 memory-ops 面板；旧深链落 memory，调度面板就在 memory 页签里
    expect(ops.find('#ld-panel-memory-ops').exists()).toBe(false);
    expect(ops.find('#ld-panel-memory .mr-panels').exists(), '旧深链应回落 memory 并渲染调度面板').toBe(true);
  });

  it('排序：待复习（逾期最久在前）→ 有痕迹未到期 → 未初始化压尾', async () => {
    const w = await mountMemory([
      trace({ conceptKey: 'k-ok', label: '稳固点', retrievability: 1, dueAt: new Date(Date.now() + day).toISOString() }),
      trace({ conceptKey: 'k-uninit', label: '未初始化点', retrievability: null, dueAt: null, extractionCount: 0, lastSeenAt: null }),
      trace({ conceptKey: 'k-due2', label: '逾期两点', retrievability: 0.3, dueAt: new Date(Date.now() - 2 * day).toISOString() }),
      trace({ conceptKey: 'k-due7', label: '逾期七点', retrievability: 0.31, dueAt: new Date(Date.now() - 7 * day).toISOString() }),
    ]);
    const labels = w.findAll('#ld-panel-memory tbody tr').map((tr) => tr.find('td').text());
    expect(labels).toEqual(['逾期七点', '逾期两点', '稳固点', '未初始化点']);
  });

  it('列头排序（2026-10-18）：记忆强度首击升序（弱在前）、回忆记录首击降序（多在前）', async () => {
    const rows = [
      trace({ conceptKey: 'k-a', label: '甲', retrievability: 0.9, dueAt: new Date(Date.now() + day).toISOString(), extractionCount: 2 }),
      trace({ conceptKey: 'k-b', label: '乙', retrievability: 0.3, dueAt: new Date(Date.now() + day).toISOString(), extractionCount: 9 }),
      trace({ conceptKey: 'k-c', label: '丙', retrievability: 0.6, dueAt: new Date(Date.now() + day).toISOString(), extractionCount: 5 }),
    ];
    const w = await mountMemory(rows);
    const labelsOf = () => w.findAll('#ld-panel-memory tbody tr').map((tr) => tr.find('td').text());

    // 记忆强度：首击升序 → 30% → 60% → 90%
    const strengthTh = w.findAll('#ld-panel-memory thead th').find((t) => t.text() === '记忆强度')!;
    await strengthTh.find('.mk-th__btn').trigger('click');
    await nextTick();
    expect(labelsOf()).toEqual(['乙', '丙', '甲']);
    expect(strengthTh.attributes('aria-sort')).toBe('ascending');

    // 再击 → 降序
    await strengthTh.find('.mk-th__btn').trigger('click');
    await nextTick();
    expect(labelsOf()).toEqual(['甲', '丙', '乙']);

    // 回忆记录：首击降序（9 次 → 5 次 → 2 次）
    const extractTh = w.findAll('#ld-panel-memory thead th').find((t) => t.text() === '回忆记录')!;
    await extractTh.find('.mk-th__btn').trigger('click');
    await nextTick();
    expect(labelsOf()).toEqual(['乙', '丙', '甲']);
    expect(extractTh.attributes('aria-sort')).toBe('descending');
  });

  it('压暗只标「未初始化」：待复习行即使没有强度读数也不压暗', async () => {
    const w = await mountMemory([
      trace({ conceptKey: 'k-due-null', label: '逾期无读数', retrievability: null, dueAt: new Date(Date.now() - day).toISOString(), extractionCount: 1 }),
      trace({ conceptKey: 'k-uninit', label: '未初始化点', retrievability: null, dueAt: null, extractionCount: 0, lastSeenAt: null }),
    ]);
    const rows = w.findAll('#ld-panel-memory tbody tr');
    expect(rows[0].classes()).not.toContain('ld-memrow--uninit');
    expect(rows[1].classes()).toContain('ld-memrow--uninit');
  });

  it('状态徽章带判据 title；「未初始化」用中性灰而不是 info 蓝（2026-11-11）', async () => {
    const w = await mountMemory([
      trace({ conceptKey: 'k-uninit', label: '未初始化点', retrievability: null, dueAt: null, extractionCount: 0, lastSeenAt: null }),
      trace({ conceptKey: 'k-ok', label: '稳固点', retrievability: 0.95, dueAt: new Date(Date.now() + day).toISOString() }),
    ]);
    const badges = w.findAll('#ld-panel-memory tbody .mk-badge');
    const uninit = badges.find((b) => b.text() === '未初始化')!;
    expect(uninit.classes()).toContain('mk-badge--muted');
    expect(uninit.attributes('title')).toContain('尚无记忆记录');
    const ok = badges.find((b) => b.text() === '稳固')!;
    expect(ok.attributes('title')).toContain('可提取率 ≥ 80%');
  });

  it('卡头读数给出状态分档；回忆记录输出「N 次 · 最近 时间」', async () => {
    const w = await mountMemory([
      trace({ conceptKey: 'k-a', label: '甲', retrievability: 0.3, dueAt: new Date(Date.now() - day).toISOString(), extractionCount: 15 }),
      trace({ conceptKey: 'k-b', label: '乙', retrievability: 1, dueAt: new Date(Date.now() + day).toISOString(), extractionCount: 4 }),
      trace({ conceptKey: 'k-c', label: '丙', retrievability: null, dueAt: null, extractionCount: 0, lastSeenAt: null }),
    ]);
    // 2026-10-23：状态分档由 pills 承载，卡头只留作用域标注
    const meta = w.find('#ld-panel-memory .mk-card__meta');
    expect(meta.text()).toContain('跨全部路径');
    const chips = w.findAll('.ld-filtbar[aria-label="按复习状态筛选"] .mk-pill').map((c) => c.text());
    expect(chips).toEqual(['全部 · 3', '待复习 · 1', '稳固 · 1', '未初始化 · 1']);
    expect(w.find('#ld-panel-memory tbody tr').text()).toContain('15 次 · 最近');
  });

  it('视角 chips：分档计数从行派生，点击只看该档', async () => {
    const w = await mountMemory([
      trace({ conceptKey: 'k-a', label: '甲', retrievability: 0.3, dueAt: new Date(Date.now() - day).toISOString() }),
      trace({ conceptKey: 'k-b', label: '乙', retrievability: 1, dueAt: new Date(Date.now() + day).toISOString() }),
      trace({ conceptKey: 'k-c', label: '丙', retrievability: null, dueAt: null, extractionCount: 0, lastSeenAt: null }),
    ]);
    const chips = w.findAll('.ld-filtbar[aria-label="按复习状态筛选"] .mk-pill');
    expect(chips.map((c) => c.text())).toEqual(['全部 · 3', '待复习 · 1', '稳固 · 1', '未初始化 · 1']);
    await chips[1].trigger('click');
    await flushPromises();
    const rows = w.findAll('#ld-panel-memory tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('甲');
  });
});

describe('LearnerDetail FSRS 到期三态（timeAgo 未来时间失真修复）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'memory';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
  });

  it('未到期显示「N 天后」而非「刚刚」；已逾期显示「已逾期 N 天」；绝对时刻进 title', async () => {
    const day = 86400000;
    // 半天偏移：floor 前留余量，避免夹具创建到断言之间的毫秒流逝把 3 天砍成 2 天
    getMemoryTraces.mockResolvedValue([
      { conceptKey: 'k1', label: '未来概念', retrievability: 0.9, dueAt: new Date(Date.now() + 3.5 * day).toISOString(), extractionCount: 1 },
      { conceptKey: 'k2', label: '逾期概念', retrievability: 0.3, dueAt: new Date(Date.now() - 2.5 * day).toISOString(), extractionCount: 1 },
    ]);
    const w = await mountLd([]);
    // tab=memory：到期列在记忆与复习 pane 表格
    const html = w.html();
    expect(html).toContain('3 天后');
    expect(html).toContain('已逾期 2 天');
    expect(html).not.toContain('>刚刚<');
  });
});

describe('LearnerDetail 证据时间线分段切换（2026-11-09 纵向压缩）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    getLearnerEvidence.mockReset();
  });

  it('默认展示事件时间线；切到「校准记录」后展示校准行、隐藏事件列表', async () => {
    getLearnerEvidence.mockResolvedValue({
      items: [
        { type: 'task-completed', detail: '完成练习', signal: 'mastery', score: 0.8, happenedAt: '2026-10-01T08:00:00Z', conceptKeys: ['概念甲'] },
      ],
      domain: [],
      loadCurve: [],
      calibrationDetails: [
        { type: 'prediction', detail: '判分前预测：卡壳风险 40%', happenedAt: '2026-10-01T09:00:00Z' },
      ],
    });
    const w = await mountLd([]);

    // 卡顶分段切换：事件时间线 (N) / 校准记录 (N)
    const seg = w.findAll('#ld-panel-evidence .mk-seg__item');
    const labels = seg.map((b) => b.text());
    expect(labels.some((t) => t.startsWith('事件时间线'))).toBe(true);
    expect(labels.some((t) => t.startsWith('校准记录'))).toBe(true);

    // 默认 = 事件时间线：事件行在，校准块不在
    expect(w.find('#ld-panel-evidence .ld-evidence').exists()).toBe(true);
    expect(w.find('#ld-panel-evidence .ld-calib').exists()).toBe(false);

    // 切到校准记录：校准行出现，事件列表让位
    const calibBtn = w.findAll('#ld-panel-evidence .mk-seg__item').find((b) => b.text().startsWith('校准记录'))!;
    await calibBtn.trigger('click');
    await nextTick();
    expect(w.find('#ld-panel-evidence .ld-calib').exists()).toBe(true);
    expect(w.find('#ld-panel-evidence .ld-calib').text()).toContain('判分前预测');
    expect(w.find('#ld-panel-evidence .ld-evidence').exists()).toBe(false);

    // 列表容器限高内滚（源码级已锁 440px，这里锁容器存在）
    expect(w.find('#ld-panel-evidence .ld-ev-scroll').exists()).toBe(true);
  });

  it('带 sessionId 的证据行给出可见「查看课堂」入口，点击即开只读预览（2026-11-11 第二轮）', async () => {
    getLearnerEvidence.mockResolvedValue({
      items: [
        {
          type: 'task-completed',
          detail: '完成练习',
          signal: 'mastery',
          score: 0.8,
          happenedAt: '2026-10-01T08:00:00Z',
          sessionId: 'teaching_user_x',
          taskId: 'st_1',
        },
      ],
      domain: [],
      loadCurve: [],
      calibrationDetails: [],
    });
    const w = await mountLd([]);
    const row = w.find('#ld-panel-evidence .ld-ev--link');
    expect(row.exists(), '带 sessionId 的行应渲染为可点行').toBe(true);
    expect(row.find('.ld-ev__go').text()).toBe('查看课堂 →');

    await row.trigger('click');
    await flushPromises();
    expect(w.find('.ld-sess-drawer').exists(), '点击后应打开课堂只读预览抽屉').toBe(true);
    w.unmount();
  });
});

describe('LearnerDetail 压力曲线 x 轴（B 案固定跨度：42/90 档真正控制轴宽，2026-10-13 用户拍板）', () => {
  const dayKey = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const labelOf = (key: string) => {
    const [, m, d] = key.split('-');
    return `${Number(m)}月${Number(d)}日`;
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    getLearnerEvidence.mockReset();
  });

  it('B 案固定跨度：轴宽恒等于所选档位（点 42 天档），右端锚到今天、左侧留空', async () => {
    getLearnerEvidence.mockResolvedValue({
      items: [],
      domain: [],
      loadCurve: [
        { date: dayKey(28), lss: null, lf: null, lsb: null },
        ...[4, 3, 2, 1, 0].map((o) => ({ date: dayKey(o), lss: 40 + o, lf: 41 + o, lsb: 20 + o })),
      ],
    });
    const w = await mountLd([]);
    // 默认档 2026-10-31 起为「近 7 天」；本用例验证 42 档的固定跨度，先点 42 档
    await w.findAll('.mk-seg__item').find((b) => b.text() === '42 天')!.trigger('click');
    await nextTick();
    const chart = w.findComponent({ name: 'MkChart' });
    expect(chart.exists(), 'evidence 页签应渲染压力曲线').toBe(true);
    const labels = (chart.props('option') as { xAxis: { data: string[] } }).xAxis.data;
    // 轴宽=42（所选档），右端=today；数据落在右侧 5 天，左侧按档位留空
    expect(labels).toHaveLength(42);
    expect(labels[labels.length - 1]).toBe(labelOf(dayKey(0)));
    expect(labels[0]).toBe(labelOf(dayKey(41)));
  });

  it('有值时轴宽=档位；全空值回落空态', async () => {
    getLearnerEvidence.mockResolvedValue({
      items: [],
      domain: [],
      loadCurve: [41, 40, 39].map((o) => ({ date: dayKey(o), lss: 30 + (41 - o), lf: 30, lsb: 20 })),
    });
    let w = await mountLd([]);
    await w.findAll('.mk-seg__item').find((b) => b.text() === '42 天')!.trigger('click');
    await nextTick();
    const labels = (w.findComponent({ name: 'MkChart' }).props('option') as { xAxis: { data: string[] } }).xAxis.data;
    // B 案：轴宽=42（所选档），起点恒为窗口起点
    expect(labels[0]).toBe(labelOf(dayKey(41)));
    expect(labels).toHaveLength(42);

    getLearnerEvidence.mockResolvedValue({ items: [], domain: [], loadCurve: [{ date: dayKey(9), lss: null, lf: null, lsb: null }] });
    w = await mountLd([]);
    expect(w.findComponent({ name: 'MkChart' }).exists()).toBe(false);
    expect(w.text()).toContain('暂无压力记录');
  });

  it('跨日模拟：曲线含真实今天之后的有值日时，轴末锚到最新模拟日而非截断在真实今天', async () => {
    getLearnerEvidence.mockResolvedValue({
      items: [],
      domain: [],
      // 真实今天有值 + 两个未来模拟日有值（calculatedAt 落在未来）
      loadCurve: [
        { date: dayKey(0), lss: 50, lf: 20, lsb: 30 },
        { date: dayKey(-3), lss: 52, lf: 22, lsb: 30 },
        { date: dayKey(-7), lss: 55, lf: 25, lsb: 30 },
      ],
    });
    const w = await mountLd([]);
    await w.findAll('.mk-seg__item').find((b) => b.text() === '42 天')!.trigger('click');
    await nextTick();
    const labels = (w.findComponent({ name: 'MkChart' }).props('option') as { xAxis: { data: string[] } }).xAxis.data;
    // 轴宽=42（所选档），轴末 = 最新模拟日（今天 +7）；未来点不被丢弃
    expect(labels).toHaveLength(42);
    expect(labels[labels.length - 1]).toBe(labelOf(dayKey(-7)));
    expect(labels).toContain(labelOf(dayKey(-3)));
    expect(labels).toContain(labelOf(dayKey(0)));
  });
});

describe('四读数出处标注 + 虚拟档案互跳', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listSessions.mockReset();
    getMemoryTraces.mockReset().mockResolvedValue([]);
    liveVirtuals.value = [];
  });

  /* 2026-10-19 文案优化：短标改说「全部路径汇总 · 取样 X」，长释改说「取自单次会话」 */
  it('卡头标出「全部路径汇总」出处（与虚拟档案页的单次会话快照区分开）', async () => {
    // 共享 mock 的详情没有 dynamicState（学习状态追踪卡随之不渲染），本用例整体替换详情响应
    const detailMock = vi.mocked(liveGetLearnerDetail as unknown as ReturnType<typeof vi.fn>);
    const original = detailMock.getMockImplementation();
    detailMock.mockResolvedValue({
      model: {
        name: '测试学习者',
        knowledgeMemory: { currentPath: null, globalSignals: {} },
      },
      dynamicState: { metrics: { lss: 2.7, ktl: 7.8, lf: 1.9, lsb: 5.9 } },
      freshness: { generatedAt: new Date().toISOString(), confidence: 0.2 },
    });
    // 学习状态追踪卡在「概览」页签（本文件其余用例默认落在 sessions 页签）
    const prevTab = routeQuery.tab;
    routeQuery.tab = 'overview';
    try {
      const w = await mountLd([]);
      const metas = w.findAll('.mk-card__meta').map((m) => m.text());
      expect(metas.some((t) => t.includes('全部路径汇总')), `实际 meta: ${JSON.stringify(metas)}`).toBe(true);
      // 长释必须点明另一页的来源，否则「数字打架」的观感照旧
      const note = w.find('.mk-card__meta[title*="取自单次会话"]');
      expect(note.exists()).toBe(true);
    } finally {
      routeQuery.tab = prevTab;
      if (original) detailMock.mockImplementation(original);
    }
  });

  it('真人账号（无绑定虚拟档案）不出「虚拟档案」入口', async () => {
    const w = await mountLd([]);
    expect(w.text()).not.toContain('虚拟档案');
  });

  it('虚拟账号：出现「虚拟档案 →」，点击 openSubPage(virtual, profileId, from=学习者)', async () => {
    liveVirtuals.value = [{ id: 'p1', raw: { userId: 'u1' } } as unknown as LiveVirtual];
    const w = await mountLd([]);
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('虚拟档案'));
    expect(btn, '虚拟账号应出现互跳入口').toBeTruthy();
    // 2026-10-20 用户「大小不一致」：hero 动作位统一默认档，不再和「重算档案」一高一矮
    expect(btn!.classes()).toContain('mk-btn');
    expect(btn!.classes()).not.toContain('mk-btn--sm');
    await btn!.trigger('click');
    expect(openSubPage).toHaveBeenCalledWith(
      'virtual',
      'p1',
      expect.objectContaining({ from: expect.objectContaining({ view: 'learner', id: 'u1' }) })
    );
  });
});

/**
 * 路径视角（页级作用域开关，2026-10-14 第二步）：
 * 一个学习者可并存多条路径，此前页面焊死在「当前路径」上（只有图谱自带路径轨）。
 * 现由开关驱动 概念掌握/证据/图谱/教学会话；记忆与行为基线不随它走。
 */
describe('LearnerDetail 路径视角（页级作用域开关）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'sessions';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({
      data: {
        data: {
          paths: [
            { id: 'lp1', title: '测试路径', status: 'active', updatedAt: '2026-10-14T00:00:00Z' },
            { id: 'lp2', title: '另一条路径', status: 'archived', updatedAt: '2026-10-01T00:00:00Z' },
          ],
        },
      },
    });
  });

  it('选择器列出名下每条路径，当前路径被标出', async () => {
    const w = await mountLd([]);
    expect(w.find('#ld-scope-path').exists()).toBe(true);
    const opts = mkSelectLabels(w as never, '路径范围');
    expect(opts[0]).toContain('测试路径');
    expect(opts[0]).toContain('学习中'); // 路径域文案，不是全局字典的「进行中」
    expect(opts[0]).toContain('当前');
    expect(opts[1]).toContain('另一条路径');
    expect(opts[1]).toContain('已下线');
    expect(opts[1]).not.toContain('当前');
    // 选项按学习者收窄取得（不是拉全库再前端过滤）
    expect(listPaths).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
  });

  it('不给「全部路径」档：学习者模型快照没有跨路径聚合口径（不传 pathId 是回落到当前路径）', async () => {
    const w = await mountLd([]);
    const texts = mkSelectLabels(w as never, '路径范围');
    expect(texts.some((t) => t.includes('全部路径'))).toBe(false);
  });

  it('默认作用域 = 该学习者的当前路径（与改动前行为一致）', async () => {
    await mountLd([]);
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ pathId: 'lp1' }));
  });

  it('作用域未定（名单里查不到该学习者）时：详情请求不带 pathId，读数在响应回来后写实为「当前路径」', async () => {
    // liveLearners 里没有这个人（虚拟/测试账号不在默认视角）→ base 为空 → 无 pathId 可传
    const learners = (await import('../live')).liveLearners as unknown as { value: unknown[] };
    const detailMock = vi.mocked(liveGetLearnerDetail as unknown as ReturnType<typeof vi.fn>);
    const backup = learners.value;
    learners.value = [];
    detailMock.mockClear();
    try {
      const w = await mountLd([]);
      // 首次详情请求确实没带 pathId（后端按当前 active 路径回落）
      expect(detailMock.mock.calls[0][1]).toBeUndefined();
      // 响应里的 currentPath 把作用域写实 → 后续（会话）请求带上该路径，且不产生第二次详情重读
      expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: 'lp1' }));
      expect(detailMock.mock.calls.length).toBe(1);
      expect(w.find('#ld-panel-sessions .mk-card__meta').text()).toContain('当前路径');
    } finally {
      learners.value = backup;
    }
  });

  it('切到非当前路径：标注用所选路径名（不说「当前路径」），请求带该 pathId', async () => {
    const w = await mountLd([]);
    await chooseMkSelect(w as never, '路径范围', 'lp2');
    await flushPromises();
    expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: 'lp2' }));
    const meta = w.find('#ld-panel-sessions .mk-card__meta');
    expect(meta.text()).toContain('路径 另一条路径');
    expect(meta.attributes('title')).toContain('节课堂（窗口上限）');
    expect(meta.attributes('title')).not.toContain('不是该学习者的「当前路径」');
    // 单条路径下串档告警不再出现（档位天然同源）
    expect(meta.attributes('title')).not.toContain('同序号里程碑会合到同一档');
  });

  it('切到非当前路径后，「· 当前」标记仍留在该学习者自己的当前路径上', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail as unknown as ReturnType<typeof vi.fn>);
    const original = detailMock.getMockImplementation();
    // 按路径取值时快照的 currentPath 就是所选路径（后端语义）——用它暴露「拿 currentPath 判当前」这种错法
    detailMock.mockImplementation(async (_id: string, pathId?: string) => ({
      model: {
        name: '测试学习者',
        knowledgeMemory: {
          currentPath: {
            learningPathId: pathId || 'lp1',
            pathTitle: pathId === 'lp2' ? '另一条路径' : '测试路径',
            progress: { totalTasks: 4, completedTasks: 1, totalMilestones: 2, completedMilestones: 1 },
            conceptStates: [],
          },
          globalSignals: {},
        },
      },
    }));
    try {
      const w = await mountLd([]);
      await chooseMkSelect(w as never, '路径范围', 'lp2');
      await flushPromises();
      const opts = mkSelectLabels(w as never, '路径范围');
      expect(opts[0]).toContain('· 当前');
      expect(opts[1]).not.toContain('· 当前');
      // 读数也必须说这是「所选路径」而不是「当前路径」
      expect(w.find('#ld-panel-sessions .mk-card__meta').text()).toContain('路径 另一条路径');
    } finally {
      if (original) detailMock.mockImplementation(original);
    }
  });

  it('记忆块不随开关走：标注恒为跨全部路径，不再挂解释句', async () => {
    routeQuery.tab = 'memory';
    // 卡体 v-if="memoryPaneRows.length"：无痕迹时整卡不渲染
    getMemoryTraces.mockResolvedValue([
      {
        conceptKey: 'kc-x', label: '知识点', masteryScore: 0.5, stability: 'developing',
        extractionCount: 1, lastSeenAt: new Date().toISOString(), fsrsStability: 0.5,
        fsrsDifficulty: 6, ktMasteryEma: null, dueAt: new Date(Date.now() + 86400000).toISOString(),
        retrievability: 0.9, updatedAt: new Date().toISOString(),
      },
    ]);
    const w = await mountLd([]);
    await flushPromises();
    // 记忆页签不渲染路径作用域控件（2026-11-09 走查：数据本来就不随它走，
    // 控件摆在这里只会和卡上「不随『路径范围』收窄」的说明自相矛盾）
    expect(w.find('#ld-scope-path').exists()).toBe(false);
    const meta = w.find('#ld-panel-memory .mk-card__meta');
    expect(meta.text()).toContain('跨全部路径');
    // 2026-10-22 用户裁定：作用域由短标表达，卡头不再挂长释
    expect(meta.attributes('title')).toBeUndefined();
  });

  it('图谱不吃自带的路径轨（作用域已由页级接管，避免一屏两个同义控件）', async () => {
    routeQuery.tab = 'graph';
    const w = await mountLd([]);
    const graph = w.findComponent({ name: 'MkGraphExplorer' });
    expect(graph.exists()).toBe(true);
    expect(graph.props('showPathRail')).toBe(false);
    expect(graph.props('pathId')).toBe('lp1'); // 取值仍由页级作用域决定
  });
});

/**
 * 概览对象轴（2026-10-19 用户拍板）：
 * 账号页的「最近活动」把「最近会话」的对象行又列了一遍，已撤；目标对话迁到概览
 * 成为「最近目标对话」，与会话同轴并列；事件轴卡改名「学习动态」与它们区分。
 */
describe('LearnerDetail 概览：最近目标对话 + 学习动态命名', () => {
  beforeEach(() => {
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listGoals.mockReset().mockResolvedValue({
      data: {
        data: {
          conversations: [
            { id: 'gc-same-path', description: '地理大题怎么练', status: 'completed', learningPathId: 'lp1', createdAt: '2026-10-18T10:00:00Z' },
            { id: 'gc-other-path', description: '另一个路径的目标', status: 'active', learningPathId: 'lp-other', createdAt: '2026-10-17T10:00:00Z' }
          ]
        }
      }
    });
    routeQuery.tab = 'overview';
  });
  afterEach(() => {
    routeQuery.tab = 'sessions';
  });

  it('两张卡分工：事件轴叫「学习动态」，对象轴新增「最近目标对话」', async () => {
    const w = await mountLd([]);
    const titles = w.findAll('.mk-card__title').map((t) => t.text());
    expect(titles).toContain('学习动态');
    expect(titles).toContain('最近目标对话');
    expect(titles).not.toContain('最近动态');
    // 会话预览仍在（对象轴的另一张卡）
    expect(titles).toContain('最近课堂');
  });

  it('目标对话跟随页级路径作用域，行点击进只读座舱', async () => {
    const w = await mountLd([]);
    const text = w.text();
    expect(text).toContain('地理大题怎么练');
    // 别的路径的目标不进当前作用域
    expect(text).not.toContain('另一个路径的目标');
    expect(text).toContain('最近 1 条 · 当前路径');

    const row = w.findAll('.mk-row').find((r) => r.text().includes('地理大题怎么练'))!;
    expect(row.exists()).toBe(true);
    await row.trigger('click');
    expect(openSubPage).toHaveBeenCalledWith(
      'session-real',
      'gc-same-path',
      expect.objectContaining({ from: expect.objectContaining({ id: 'u1' }) })
    );
  });

  /* 2026-10-18 真课实测：目标上存的是路径创建时的临时前缀（lp_x），真实路径末尾还带 _xxxxx。
     严格相等会把本路径的目标全过滤空；按带 _ 边界的同源 id 匹配两边都认。 */
  it('目标存临时前缀、路径带后缀时仍归入当前作用域', async () => {
    const originalPath = liveLearners.value[0].pathId;
    liveLearners.value[0].pathId = 'lp1_oyjo73i';
    listGoals.mockResolvedValue({
      data: {
        data: {
          conversations: [
            { id: 'gc-prefix', description: '临时前缀目标', status: 'completed', learningPathId: 'lp1', createdAt: '2026-10-18T10:00:00Z' }
          ]
        }
      }
    });
    try {
      const w = await mountLd([]);
      expect(w.text()).toContain('临时前缀目标');
      expect(w.text()).toContain('最近 1 条 · 当前路径');
    } finally {
      liveLearners.value[0].pathId = originalPath;
    }
  });

  /* 深链进虚拟学习者不带 ?includeTest 时，靠账号身份兜底：会话与目标两张卡必须与详情同源，
     否则详情有数据、两张卡空读数（2026-10-18 走查）。 */
  it('深链进虚拟账号不带 includeTest：会话与目标对话仍按 includeTest 拉取', async () => {
    const original = subPage.value;
    subPage.value = { view: 'learner', id: 'virtual_demo', label: '' };
    listSessions.mockClear();
    listGoals.mockClear();
    try {
      const w = await mountLd([]);
      expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ userId: 'virtual_demo', includeTest: true }));
      expect(listGoals).toHaveBeenCalledWith(expect.objectContaining({ userId: 'virtual_demo', includeTest: true }));
      w.unmount();
    } finally {
      subPage.value = original;
    }
  });
});

/* 2026-10-21 教学组剔除虚拟学习者后，「学习详情 →」是唯一进虚拟账号学习档案的入口：
   列表兜底（liveLearners）永远取不到它，快照也可能没有 userName / 路径（totalTasks=0）。
   此前这种「稀疏详情」直接落「详情加载失败」，把「还没有学习数据」说成加载错误。 */
describe('LearnerDetail 稀疏虚拟账号：不报加载失败，读数不造假', () => {
  it('没有路径/课堂的虚拟账号：按账号记录渲染，hero 不展示默认的趋势/疲劳', async () => {
    const { getUserIncludingDeleted } = await import('@/api/adminApi');
    const userMock = getUserIncludingDeleted as unknown as ReturnType<typeof vi.fn>;
    const origUser = userMock.getMockImplementation();
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    const original = subPage.value;
    subPage.value = { view: 'learner', id: 'virtual_sparse', includeTest: true };
    routeQuery.tab = 'overview';
    userMock.mockResolvedValue({
      data: { data: { id: 'virtual_sparse', name: '孙浩', email: 'virtual_sparse@test.local', isVirtualLearner: true } },
    });
    detailMock.mockResolvedValue({
      model: { knowledgeMemory: { currentPath: { progress: {} }, globalSignals: {} } },
    });
    try {
      const w = await mountLd([]);
      const text = w.text();
      expect(text).not.toContain('详情加载失败');
      // 名字/邮箱由账号记录兜底（不再是裸 id）
      expect(text).toContain('孙浩');
      expect(text).toContain('virtual_sparse@test.local');
      // 没有学习数据 → 不画「趋势：稳定 / 疲劳：低」（那是默认值，不是读数）
      expect(w.text()).not.toContain('趋势：');
      expect(w.text()).not.toContain('疲劳：');
      w.unmount();
    } finally {
      subPage.value = original;
      if (origUser) userMock.mockImplementation(origUser);
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

/* 2026-11-02 P1-1：进度卡的路径状态徽章原先只由任务完成率推导（0/16=0 → 「未开始」），
   不看 learning_paths.status。真实场景里路径已上过课、子任务却还没被标记完成，
   徽章于是与同屏的路径状态、最近课堂互相打架。改为以路径清单带来的 status 为准
   （active → 学习中），清单给不出状态时才回落到完成率推导。 */
describe('LearnerDetail 进度卡路径状态徽章（P1-1）', () => {
  /** 详情载荷：路径 active、但一条子任务都没标完成（看板尚未回写任务完成） */
  function zeroProgressDetail() {
    return {
      model: {
        name: '测试学习者',
        knowledgeMemory: {
          currentPath: {
            learningPathId: 'lp1',
            pathTitle: '测试路径',
            progress: { totalTasks: 16, completedTasks: 0, totalMilestones: 3, completedMilestones: 0 },
            conceptStates: [],
          },
          globalSignals: {},
        },
      },
    };
  }

  it('已开课但 0/16 任务完成：徽章报路径状态「学习中」，不再推导成「未开始」', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'overview';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '测试路径', status: 'active', updatedAt: '2026-10-14T00:00:00Z' }] } },
    });
    detailMock.mockResolvedValue(zeroProgressDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '当前进度');
      expect(card, '当前进度卡应存在').toBeTruthy();
      const badge = card!.find('.mk-badge');
      expect(badge.text()).toBe('学习中');
      expect(badge.classes()).toContain('mk-badge--ok');
      expect(badge.attributes('title')).toBe('路径状态：学习中');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  it('路径清单给不出状态时回落到完成率推导（0/16 → 未开始），不凭空写「学习中」', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'overview';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    detailMock.mockResolvedValue(zeroProgressDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '当前进度');
      expect(card!.find('.mk-badge').text()).toBe('未开始');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

/* 2026-11-09 用户实测（user_sim19）：路径已下线（archived）时后端下发顶层 displayPath 作展示兜底，
   快照 currentPath 为空。此前 hasSnapshotPath 把顶层 model.pathTitle 也当 active 路径 → 徽章「进行中」、
   进度卡无「（已下线）」后缀，与真实状态矛盾。锁住只认快照锚点：路径名带「（已下线）」、徽章「已下线」、
   pct 与里程碑取 displayPath，且路径范围下拉选中同一条路径。 */
describe('LearnerDetail 已下线兜底路径（user_sim19 回归）', () => {
  function archivedDetail() {
    return {
      model: {
        name: '测试学习者',
        // 顶层 pathTitle 是展示兜底（不是 active 锚点）——不能据此判 active
        pathTitle: '行测资料分析速算 25 分钟做完 20 题',
        knowledgeMemory: {
          // 快照只锚 active 路径 → 已下线时无 pathTitle；里程碑读数仍从 progress 取
          currentPath: { progress: { completedMilestones: 5, totalMilestones: 15 }, conceptStates: [] },
          globalSignals: {},
        },
      },
      displayPath: {
        id: 'lp-archived',
        title: '行测资料分析速算 25 分钟做完 20 题',
        status: 'archived',
        totalTasks: 15,
        completedTasks: 5,
      },
    };
  }

  it('徽章读「已下线」、路径名带（已下线）后缀、进度取 displayPath、作用域回填该路径', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    // 真实场景（user_sim19）：路径已下线 → 学习者列表行不带 pathId / pathTitle，
    // 展示信息只能来自详情接口的 displayPath。清空列表行的路径兜底才能复现。
    const origLearners = JSON.parse(JSON.stringify(liveLearners.value));
    liveLearners.value = [{ userId: 'u1', name: '测试学习者', pathId: undefined, pathTitle: null, email: '', currentTask: null, currentMilestone: null, trend: 'flat', fatigue: '低', confidence: 0.8, generatedAt: '2026-10-01T08:00:00Z', struggling: [], fragile: [] } as never];
    setActivePinia(createPinia());
    routeQuery.tab = 'overview';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp-archived', title: '行测资料分析速算 25 分钟做完 20 题', status: 'archived', updatedAt: '2026-09-01T00:00:00Z' }] } },
    });
    detailMock.mockResolvedValue(archivedDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '当前进度');
      expect(card, '当前进度卡应存在').toBeTruthy();
      // 徽章：真实状态 archived → 「已下线」，不得误读成「进行中/学习中」
      const badge = card!.find('.mk-badge');
      expect(badge.text()).toBe('已下线');
      expect(badge.text()).not.toBe('进行中');
      // 路径名带（已下线）后缀，并保留原路径名
      const pathText = card!.find('.ld-progress strong').text();
      expect(pathText).toContain('行测资料分析速算 25 分钟做完 20 题');
      expect(pathText).toContain('已下线');
      // 里程碑分母取 displayPath 的 5/15
      expect(card!.text()).toContain('里程碑 5/15');
      // pct 33% = 5/15，落在进度条填充宽度上（不是文本）
      const fill = card!.find('.ld-progress__bar .mk-minibar__fill');
      expect(fill.attributes('style')).toContain('width: 33%');
      // 路径范围下拉已回填该路径（不再停在「该学习者暂无学习路径」占位）
      const opts = mkSelectLabels(w as never, '路径范围');
      expect(opts.some((t) => t.includes('行测资料分析速算 25 分钟做完 20 题'))).toBe(true);
      w.unmount();
    } finally {
      liveLearners.value = origLearners;
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

/* 2026-11-02 P1-2：概览「概念掌握」与证据「概念信号与背景」原先在「当前路径」标签下摆的
   是学习者级概念清单（同页图谱才是路径级），掌握分档还各叫一套名字。这里锁住：
   （a）两张卡片把真实作用域写进可见卡头，（b）四档名与图谱同源（utils/conceptBands）。 */
describe('LearnerDetail 概念卡作用域与分档名（P1-2）', () => {
  function ledgerDetail() {
    // 与真实响应同形：接口把快照摊在 data 顶层（route 里读 snapshot.knowledgeMemory），
    // 页内 computeds 也读 rawDetail.knowledgeMemory；model 只为 hero 的姓名兜底
    const knowledgeMemory = {
      currentPath: {
        learningPathId: 'lp1',
        pathTitle: '测试路径',
        progress: { totalTasks: 16, completedTasks: 0, totalMilestones: 3, completedMilestones: 0 },
        conceptStates: [],
      },
      globalSignals: {
        masteredConcepts: ['变量'],
        strugglingConcepts: ['递归'],
        fragileConcepts: ['闭包'],
      },
      globalBackground: {
        conceptLedger: [{ label: '变量' }, { label: '递归' }, { label: '闭包' }, { label: '生成器' }],
      },
    };
    return {
      userName: '测试学习者',
      knowledgeMemory,
      model: { name: '测试学习者', knowledgeMemory },
    };
  }

  it('概览「概念掌握」卡头报用户级作用域，不再挂「当前路径」', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'overview';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    detailMock.mockResolvedValue(ledgerDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '概念掌握');
      expect(card, '概念掌握卡应存在').toBeTruthy();
      const meta = card!.find('.mk-card__meta').text();
      expect(meta).toContain('4 个概念');
      expect(meta).toContain('跨全部路径');
      expect(meta).toContain('按学员统计');
      expect(meta).not.toContain('当前路径');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  it('证据「概念信号与背景」卡头同样报用户级作用域，四档名与图谱一致', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    detailMock.mockResolvedValue(ledgerDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '概念信号与背景');
      expect(card, '概念信号与背景卡应存在').toBeTruthy();
      const meta = card!.find('.mk-card__meta').text();
      expect(meta).toContain('跨全部路径');
      expect(meta).toContain('按学员统计');
      expect(card!.findAll('.ld-sig-tier strong').map((s) => s.text())).toEqual([
        '已掌握 1',
        '进行中 1',
        '记忆偏弱 1',
        '待学习 1',
        '不在概念清单 0',
      ]);
      // 2026-11-11 P1：进行中独占一行；0 状态收成紧凑读数，不再占整列空位。
      expect(card!.findAll('.ld-sig-tier--wide').map((t) => t.find('strong').text())).toEqual(['进行中 1']);
      expect(card!.findAll('.ld-sig-tier--zero').map((t) => t.text())).toEqual(['不在概念清单 0']);
      expect(card!.find('.ld-sig-tier__none').exists()).toBe(false);
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  /* 2026-11-02 P1-6：脚注原先把「0 + 1 + 1 + 2 = 4，与卡头对得上」这种实现侧加总自检
     直接印给用户。只保留「另有 N 个标签不在当前概念清单里」这一句对读者有意义的披露；
     没有清单外标签时整行不出现。 */
  it('概念信号脚注只披露清单外的标签，不输出四档加总自检', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    try {
      const clean = ledgerDetail();
      detailMock.mockResolvedValue(clean as never);
      const noOutside = await mountLd([]);
      const cleanCard = noOutside.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '概念信号与背景');
      expect(cleanCard!.find('.ld-sig-sec__foot').exists()).toBe(false);
      expect(cleanCard!.text()).not.toContain('对得上');
      noOutside.unmount();

      // 清单外多一个标签：脚注点名它，且不再出现「a + b + c = N」这类算式
      const withOutside = ledgerDetail();
      withOutside.knowledgeMemory.globalSignals.masteredConcepts = ['变量', '读取Excel表对象'];
      detailMock.mockResolvedValue(withOutside as never);
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '概念信号与背景');
      const foot = card!.find('.ld-sig-sec__foot');
      expect(foot.exists()).toBe(true);
      expect(foot.text()).toBe('另有 1 个标签不在当前概念清单里、未计入：读取Excel表对象');
      expect(card!.text()).not.toContain('对得上');
      expect(card!.text()).not.toContain('只数概念清单里的那些');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

/* 2026-11-02 P1-8：画像 KV 原先按字段原样 String()（读到 moderate / 0.5 / true），
   「这格是实测还是默认常量」又只靠整页「证据为空」一枚徽章兜底——有目标对话没上过课时，
   认知/偏好来自对话、行为基线仍是默认值，一枚徽章会把整卡标错。改为逐格标注 + 口径翻译。 */
describe('LearnerDetail 画像 KV：分档词表 / 量纲 / 逐格来源（P1-8）', () => {
  function profileDetail() {
    return {
      userName: '测试学习者',
      knowledgeMemory: {
        currentPath: {
          learningPathId: 'lp1',
          pathTitle: '测试路径',
          progress: { totalTasks: 16, completedTasks: 0, totalMilestones: 3, completedMilestones: 0 },
          conceptStates: [],
        },
        globalSignals: {},
      },
      profile: {
        cognitive: {
          metacognitionLevel: 'high', thinkingStyle: 'practical', confusionPattern: 'none',
          priorKnowledgeStructure: 'blank', selfAssessmentAccuracy: 'accurate',
        },
        behavioral: {
          avgResponseTime: 10, avgMessageLength: 50, avgInteractionInterval: 5,
          engagementLevel: 0.5, consistencyScore: 0.5,
        },
        preferences: {
          preferredStyle: 'practice', theoryVsPractice: 'practice-first', sessionLength: 'medium',
          preferredDifficulty: 'medium', prefersHints: true,
        },
        emotional: {
          motivationTrigger: 'interest', urgencyLevel: 'medium', confidenceLevel: 'anxious',
          frustrationTolerance: 0.5, rewardSensitivity: 'medium',
        },
        history: { totalSessions: 0, totalMessages: 0, avgSessionDuration: 0 },
        curriculumControls: { taskGranularityLevel: 'medium', conceptDensityLevel: 'medium', reviewFrequencyLevel: 'medium' },
        derivedInsights: {
          learningVelocity: 0.5, optimalSessionLength: 30, recommendedDifficulty: 'medium',
          suggestedApproach: '采用平衡的学习方式',
        },
      },
      /* 只有认知两项/偏好两项/情绪一项来自对话；行为基线、课程控制与派生数值仍是默认常量 */
      profileSources: {
        cognitive: ['metacognitionLevel', 'thinkingStyle'],
        behavioral: [],
        learning: [],
        preferences: ['preferredStyle', 'theoryVsPractice'],
        emotional: ['confidenceLevel'],
        history: [],
        curriculumControls: [],
        derivedInsights: ['recommendedDifficulty'],
      },
    };
  }

  async function mountProfile() {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    setActivePinia(createPinia());
    routeQuery.tab = 'profile';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    detailMock.mockResolvedValue(profileDetail() as never);
    return mountLd([]);
  }

  function kvRow(w: Awaited<ReturnType<typeof mountProfile>>, label: string) {
    return w.findAll('.ld-kv__row').find((r) => r.find('span').text() === label)!;
  }
  /** 读数文本（不含紧随其后的「规则推导」标注） */
  function kvValue(w: Awaited<ReturnType<typeof mountProfile>>, label: string) {
    return kvRow(w, label).find('strong').text().replace('规则推导', '')
  }

  it('枚举翻成中文分档，比率标成百分比并带量纲说明', async () => {
    const w = await mountProfile();
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    try {
      expect(kvValue(w, '元认知水平')).toBe('高');
      expect(kvValue(w, '困惑模式')).toBe('暂无明显模式');
      expect(kvValue(w, '是否偏好提示')).toBe('需要提示');
      expect(kvValue(w, '自信水平')).toBe('容易紧张');
      // 行为基线数据源已退役：无来源时不再把默认常量渲染成读数（priorAsDash → —）
      expect(kvValue(w, '投入度')).toBe('—');
      expect(kvRow(w, '投入度').find('strong').attributes('title')).toBe('课堂互动的投入程度，0-100%');
      expect(kvValue(w, '学习速度')).toBe('50%');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  it('默认值改用「灰字 + 卡头一句图例」：不再逐格挂胶囊，实测格不上灰', async () => {
    const w = await mountProfile();
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    try {
      // 实测：正常墨色
      expect(kvRow(w, '元认知水平').find('.ld-kv__val--prior').exists()).toBe(false);
      expect(kvRow(w, '自信水平').find('.ld-kv__val--prior').exists()).toBe(false);
      // 默认：读数格上灰（同屏 11 枚「初始默认值」胶囊已撤）
      for (const label of ['困惑模式', '平均响应（秒）', '平均消息长度（字）', '互动间隔（分钟）', '投入度', '一致性', '学习速度']) {
        expect(kvRow(w, label).find('strong').classes()).toContain('ld-kv__val--prior');
      }
      // 规则建议（非实测非默认）不上灰，但仍标「规则推导」
      expect(kvRow(w, '建议方式').find('.ld-kv__val--prior').exists()).toBe(false)
      expect(kvRow(w, '建议方式').find('.ld-kv__derived').text()).toBe('规则推导')
      // 图例在卡头说一次，不再逐格复读标签文字
      expect(w.text()).toContain('灰字 = 初始默认值')
      // 只剩「规则推导」这一类标注；「初始默认值」胶囊已全部撤除
      expect(w.findAll('.ld-kv__derived')).toHaveLength(1)
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

describe('LearnerDetail · 页签 URL 同步（2026-11-09 走查）', () => {
  // 本组会把 routeQuery.tab 留在最后点过的页签，复位到文件默认值，避免污染后续 describe
  afterEach(() => { routeQuery.tab = 'sessions' })

  it('从 ?tab=evidence 进来后点「概览」：URL 里的 tab 参数被删掉，不再「界面在概览、URL 在证据」', async () => {
    routeQuery.tab = 'evidence';
    routerPush.mockClear();
    const w = await mountLd([]);
    await flushPromises();
    expect(w.find('#ld-panel-evidence').exists()).toBe(true);

    await w.find('#ld-tab-overview').trigger('click');
    await flushPromises();
    expect(w.find('#ld-panel-overview').exists()).toBe(true);
    // 回默认页签 = 从 query 里删掉 tab（早前用展开空对象的方式删，旧值原地留着）
    const lastCall = routerPush.mock.calls.at(-1)!;
    expect(lastCall[0]).toEqual({ query: {} });

    // 非默认页签仍写着 tab=…
    routeQuery.tab = 'overview';
    routerPush.mockClear();
    await w.find('#ld-tab-graph').trigger('click');
    await flushPromises();
    expect(routerPush.mock.calls.at(-1)![0]).toEqual({ query: { tab: 'graph' } });
    w.unmount();
  });

  it('点五个页签都走 push（后退可回上一个页签），URL 与面板同步', async () => {
    routeQuery.tab = 'overview';
    routerPush.mockClear();
    const w = await mountLd([]);
    await flushPromises();

    const cases: Array<[string, string, string | undefined]> = [
      ['ld-tab-profile', 'ld-panel-profile', 'profile'],
      ['ld-tab-evidence', 'ld-panel-evidence', 'evidence'],
      ['ld-tab-graph', 'ld-panel-graph', 'graph'],
      ['ld-tab-sessions', 'ld-panel-sessions', 'sessions'],
      ['ld-tab-memory', 'ld-panel-memory', 'memory'],
    ];
    for (const [tabId, panelId, queryTab] of cases) {
      routerPush.mockClear();
      await w.find(`#${tabId}`).trigger('click');
      await flushPromises();
      expect(w.find(`#${panelId}`).exists(), `${queryTab} 面板应显示`).toBe(true);
      expect(routerPush.mock.calls.at(-1)?.[0]).toEqual({ query: { tab: queryTab } });
      // 模拟 router 已落位到新 URL：下一次点击的 cur 才是上一个页签
      routeQuery.tab = queryTab as string;
    }
    w.unmount();
  });

  it('带 ?tab=memory 刷新：直接落在记忆页签（URL 是唯一真相）', async () => {
    routeQuery.tab = 'memory';
    const w = await mountLd([]);
    await flushPromises();
    expect(w.find('#ld-panel-memory').exists()).toBe(true);
    w.unmount();
  });
});

describe('LearnerDetail · 身份信息复制（2026-11-11 第二轮）', () => {
  it('邮箱与用户 ID 各一枚复制按钮：复制全文，并给「已复制」反馈', async () => {
    liveUsers.value = [{
      id: 'u1',
      name: '测试学习者',
      email: 'student@example.com',
      isAdmin: false,
      isVirtualLearner: false,
      isTestAccount: false,
      xp: 0,
      currentLevel: 'L1',
      lastLoginAt: '2026-11-10T09:30:00Z',
      createdAt: '2026-11-01T08:00:00Z',
      paths: 1,
      sessions: 2,
    }];
    routeQuery.tab = 'overview';
    copyText.mockClear();
    const w = await mountLd([]);
    await flushPromises();
    const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '账号信息');
    expect(card, '账号信息卡应存在').toBeTruthy();
    const buttons = card!.findAll('.ld-copy');
    expect(buttons.length, '只给邮箱与用户 ID 两枚，不逐行铺').toBe(2);
    expect(buttons.map((b) => b.text())).toEqual(['复制', '复制']);

    await buttons[0].trigger('click');
    await flushPromises();
    expect(copyText).toHaveBeenLastCalledWith('student@example.com');
    expect(buttons[0].text()).toBe('已复制');

    await buttons[1].trigger('click');
    await flushPromises();
    expect(copyText).toHaveBeenLastCalledWith('u1');
    w.unmount();
    liveUsers.value = [];
    routeQuery.tab = 'sessions';
  });
});

/**
 * 2026-11-10 概览两张卡的可读性修复：
 *  1) 最近目标对话行左侧已有状态徽章（已完成），副行再写「已生成学习路径」是把同一结论说两遍；
 *     只有「已完成却没挂路径」这种异常才需要补一句。
 *  2) 学习状态追踪右侧常驻一列「取值参考」（0–100 · 参考 40–70 …），同质、看一次就够，
 *     收进卡头的小问号，行内只留柱条与读数。
 */
describe('LearnerDetail 概览：目标对话副行 + 取值参考小问号', () => {
  beforeEach(() => {
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    routeQuery.tab = 'overview';
  });
  afterEach(() => {
    routeQuery.tab = 'sessions';
  });

  function goalRowIn(w: Awaited<ReturnType<typeof mountLd>>, text: string) {
    const row = w.findAll('.mk-row').find((r) => r.text().includes(text));
    expect(row, `未找到目标行：${text}`).toBeTruthy();
    return row!;
  }

  it('已完成且挂上路径：不再复读「已生成学习路径」', async () => {
    listGoals.mockReset().mockResolvedValue({
      data: { data: { conversations: [
        { id: 'g-done', description: '目标已完成', status: 'completed', learningPathId: 'lp1', createdAt: '2026-10-18T10:00:00Z' }
      ] } }
    });
    const w = await mountLd([]);
    const row = goalRowIn(w, '目标已完成');
    expect(row.text()).not.toContain('已生成学习路径');
    // 副行整块不渲染（MkRow 的 v-if="sub"）
    expect(row.find('.mk-row__sub').exists()).toBe(false);
    expect(row.text()).toContain('已完成');
  });

  it('已完成却没有路径：仍补「未生成学习路径」——这才是这一列需要被看见的异常', async () => {
    /* 作用域收到某条路径时，没挂路径的目标本就被过滤掉（goalInScope），
       故先切到「全部路径」才看得见这一行。 */
    listGoals.mockReset().mockResolvedValue({
      data: { data: { conversations: [
        { id: 'g-miss', description: '目标没挂路径', status: 'completed', learningPathId: null, createdAt: '2026-10-18T10:00:00Z' }
      ] } }
    });
    const detailMock = vi.mocked(liveGetLearnerDetail as unknown as ReturnType<typeof vi.fn>);
    const originalDetail = detailMock.getMockImplementation();
    const originalPath = liveLearners.value[0].pathId;
    liveLearners.value[0].pathId = '';
    detailMock.mockResolvedValue({
      model: { name: '测试学习者', knowledgeMemory: { currentPath: null, globalSignals: {} } }
    });
    try {
      const w = await mountLd([]);
      expect(goalRowIn(w, '目标没挂路径').text()).toContain('未生成学习路径');
    } finally {
      liveLearners.value[0].pathId = originalPath;
      if (originalDetail) detailMock.mockImplementation(originalDetail);
    }
  });

  it('学习状态追踪：四行取值参考收进卡头「?」，行内不再有参考列', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail as unknown as ReturnType<typeof vi.fn>);
    const original = detailMock.getMockImplementation();
    detailMock.mockResolvedValue({
      model: { name: '测试学习者', knowledgeMemory: { currentPath: null, globalSignals: {} } },
      dynamicState: { metrics: { lss: 2.7, ktl: 7.8, lf: 1.9, lsb: 5.9 } },
      freshness: { generatedAt: new Date().toISOString(), confidence: 0.2 }
    });
    try {
      const w = await mountLd([]);
      const help = w.find('.ld-lsm__help');
      expect(help.exists()).toBe(true);
      expect(help.find('.ld-lsm__help-btn').text()).toBe('?');
      expect(help.find('.ld-lsm__help-btn').attributes('aria-label')).toBe('取值参考');
      // 逐行参考带都在弹层里（默认收起 = details 没有 open）
      const items = help.findAll('.ld-lsm__help-pop li');
      expect(items.length).toBe(4);
      expect(items.map((i) => i.text()).join(' | ')).toContain('参考');
      expect(help.attributes('open')).toBeUndefined();
      // 行内不再常驻参考文字
      expect(w.find('.ld-lsm__hint').exists()).toBe(false);
      expect(w.findAll('.ld-lsm__row').length).toBe(4);
    } finally {
      if (original) detailMock.mockImplementation(original);
    }
  });
});

/* 2026-11-11 多路径串台修复（用户评审 P0）：
   （a）证据页概念信号/密度按台账 sourcePaths 收窄到当前路径；
   （b）画像叙述只取当前路径自己的目标对话，不再拿全局最近一次（可能是另一条路径）顶替；
   （c）探索主题/挣扎概念取该路径的课堂历史，不与另一条路径混排。 */
describe('LearnerDetail 多路径作用域：概念与叙述按路径收窄', () => {
  function scopedDetail(overrides: Record<string, unknown> = {}) {
    const knowledgeMemory = {
      currentPath: {
        learningPathId: 'lp1',
        pathTitle: '心理学路径',
        progress: { totalTasks: 20, completedTasks: 10, totalMilestones: 5, completedMilestones: 2 },
        conceptStates: [],
      },
      globalSignals: {
        masteredConcepts: ['变量'],
        strugglingConcepts: ['递归', '闭包'],
        fragileConcepts: [],
      },
      globalBackground: {
        conceptLedger: [
          { label: '变量', sourcePaths: ['lp1'] },
          { label: '递归', sourcePaths: ['lp1', 'lp2'] },
          { label: '闭包', sourcePaths: ['lp2'] },
        ],
      },
    };
    return {
      userName: '测试学习者',
      knowledgeMemory,
      model: { name: '测试学习者', knowledgeMemory },
      ...overrides,
    };
  }

  it('概念信号/密度按 sourcePaths 收窄：另一条路径的概念不出现', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '心理学路径', status: 'active', updatedAt: new Date().toISOString() }] } },
    });
    detailMock.mockResolvedValue(scopedDetail() as never);
    try {
      const w = await mountLd([]);
      const card = w.findAll('.mk-card').find((c) => c.find('.mk-card__title').text() === '概念信号与背景');
      expect(card, '概念信号与背景卡应存在').toBeTruthy();
      const text = card!.text();
      expect(text).toContain('2 个概念');
      expect(text).toContain('仅统计该路径概念');
      expect(text).not.toContain('闭包');
      // 四档：变量→已掌握、递归→进行中、另一条路径的闭包被排除
      expect(card!.findAll('.ld-sig-tier strong').map((s) => s.text())).toEqual([
        '已掌握 1', '进行中 1', '记忆偏弱 0', '待学习 0', '不在概念清单 0',
      ]);
      // 概念密度表同样只剩 2 行
      expect(w.findAll('#ld-panel-evidence .ld-bar:not(.ld-bar--head)').length).toBe(2);
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  it('画像叙述只认当前路径：全局叙述是另一条路径时不得顶上', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'profile';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '心理学路径', status: 'active', updatedAt: new Date().toISOString() }] } },
    });
    detailMock.mockResolvedValue(scopedDetail({
      profile: {
        narrativeInsights: { goalNarrative: '奶茶店目标：学会排班', motivationNarrative: '奶茶店经营需要' },
        history: { topicsExplored: ['奶茶店分时客流'], conceptsStruggled: ['时间戳归集'] },
        narrativeSource: { goalTitle: '奶茶店排班目标', completedAt: '2026-11-11T10:00:00.000Z', learningPathId: 'lp2' },
      },
      pathContext: {
        pathId: 'lp1',
        narrative: {
          narrativeInsights: { goalNarrative: '心理学目标：看懂主要流派', motivationNarrative: '一直有兴趣' },
          narrativeSource: { goalTitle: '系统了解心理学流派', completedAt: '2026-11-09T15:00:00.000Z', learningPathId: 'lp1' },
          personaCapturedAt: '2026-11-09T15:00:00.000Z',
        },
        history: {
          totalSessions: 18,
          totalMessages: 232,
          avgSessionDuration: 3,
          topicsExplored: ['米勒的数字广度实验'],
          conceptsStruggled: ['混淆流派前提'],
        },
      },
    }) as never);
    try {
      const w = await mountLd([]);
      const card = w.find('.ld-pf-narr');
      expect(card.exists()).toBe(true);
      const text = card.text();
      expect(text).toContain('心理学目标：看懂主要流派');
      expect(text).toContain('米勒的数字广度实验');
      expect(text).toContain('系统了解心理学流派');
      expect(text).not.toContain('奶茶店目标');
      expect(text).not.toContain('奶茶店分时客流');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });

  it('当前路径没有目标对话叙述：显示说明，不回落另一条路径', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'profile';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '心理学路径', status: 'active', updatedAt: new Date().toISOString() }] } },
    });
    detailMock.mockResolvedValue(scopedDetail({
      profile: {
        narrativeInsights: { goalNarrative: '奶茶店目标：学会排班' },
        history: { topicsExplored: ['奶茶店分时客流'] },
        narrativeSource: { goalTitle: '奶茶店排班目标', completedAt: '2026-11-11T10:00:00.000Z' },
      },
      pathContext: { pathId: 'lp1', narrative: null, history: { topicsExplored: [], conceptsStruggled: [] } },
    }) as never);
    try {
      const w = await mountLd([]);
      const card = w.find('.ld-pf-narr');
      expect(card.exists()).toBe(true);
      expect(card.text()).toContain('当前路径暂无目标对话叙述');
      expect(card.text()).not.toContain('奶茶店目标');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

describe('LearnerDetail 多路径作用域：记忆表按路径概念收窄', () => {
  const trace = (label: string) => ({
    conceptKey: `kc-${label}`,
    label,
    masteryScore: 0.5,
    stability: 'developing',
    extractionCount: 2,
    lastSeenAt: new Date().toISOString(),
    fsrsStability: 1,
    fsrsDifficulty: 5,
    ktMasteryEma: null,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    retrievability: 0.9,
    updatedAt: new Date().toISOString(),
  });

  it('当前路径只保留台账里属于该路径的概念；另一条路径的痕迹不显示', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    setActivePinia(createPinia());
    routeQuery.tab = 'memory';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '心理学路径', status: 'active', updatedAt: new Date().toISOString() }] } },
    });
    getMemoryTraces.mockReset().mockResolvedValue([trace('变量'), trace('递归'), trace('闭包')]);
    const knowledgeMemory = {
      currentPath: {
        learningPathId: 'lp1',
        pathTitle: '心理学路径',
        progress: { totalTasks: 20, completedTasks: 10, totalMilestones: 5, completedMilestones: 2 },
        conceptStates: [],
      },
      globalBackground: {
        conceptLedger: [
          { label: '变量', sourcePaths: ['lp1'] },
          { label: '递归', sourcePaths: ['lp1', 'lp2'] },
          { label: '闭包', sourcePaths: ['lp2'] },
        ],
      },
    };
    detailMock.mockResolvedValue({
      userName: '测试学习者',
      knowledgeMemory,
      model: { name: '测试学习者', knowledgeMemory },
    } as never);
    try {
      const w = await mountLd([]);
      await flushPromises();
      const rows = w.findAll('#ld-panel-memory tbody tr');
      expect(rows.length).toBe(2);
      expect(rows.map((r) => r.text()).join(' ')).not.toContain('闭包');
      expect(w.find('#ld-panel-memory .mk-card__meta').text()).toContain('仅统计该路径记忆');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
      routeQuery.tab = 'sessions';
    }
  });
});

/* 2026-11-11 学习者详情评审剩余三项：
   1) 教学会话行点击改为只读预览抽屉，头部「展开全屏监控」才进原课堂页；
   2) 概览「当前进度」增加学习路径卡片组，点卡即切页级路径范围；
   3) 证据页概念信号由文字墙改 pill，点档位/概念筛选概念证据密度。 */
describe('LearnerDetail 教学会话：只读预览抽屉', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'sessions';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [sessionRow('s1', 1)] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({ data: { data: { paths: [] } } });
    vi.mocked(openSubPage).mockClear();
  });

  it('行点击打开抽屉而不整页跳转；「展开全屏监控」才调用 openSessionCockpit', async () => {
    const w = await mountLd([sessionRow('s1', 1)]);
    const row = w.find('tbody .ld-pane-row');
    expect(row.exists()).toBe(true);
    await row.trigger('click');
    await flushPromises();
    // 抽屉已开，但尚未发生整页跳转
    expect(w.find('.ld-sess-drawer').exists()).toBe(true);
    expect(openSubPage).not.toHaveBeenCalled();

    const expand = w.findAll('.ld-sess-drawer__actions button').find((b) => b.text() === '展开全屏监控');
    expect(expand, '抽屉头部应有「展开全屏监控」').toBeTruthy();
    await expand!.trigger('click');
    expect(openSubPage).toHaveBeenCalledWith(
      'session-real',
      's1',
      expect.objectContaining({ from: expect.objectContaining({ id: 'u1' }) })
    );
    // 展开后抽屉关闭，回到页内
    expect(w.find('.ld-sess-drawer').exists()).toBe(false);
    w.unmount();
  });

  it('主题按钮同样打开抽屉（行内入口与整行一致）', async () => {
    const w = await mountLd([sessionRow('s1', 1)]);
    await w.find('.ld-topic-btn').trigger('click');
    await flushPromises();
    expect(w.find('.ld-sess-drawer').exists()).toBe(true);
    expect(openSubPage).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('LearnerDetail 概览：学习路径卡片组', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'overview';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({
      data: {
        data: {
          paths: [
            {
              id: 'lp1', title: '测试路径', status: 'active', updatedAt: '2026-10-14T00:00:00Z',
              totalMilestones: 3, completedMilestones: 1, totalTasks: 10, completedTasks: 4,
              lastActivityAt: '2026-10-14T00:00:00Z',
            },
            {
              id: 'lp2', title: '另一条路径', status: 'archived', updatedAt: '2026-10-01T00:00:00Z',
              totalMilestones: 5, completedMilestones: 5, totalTasks: 20, completedTasks: 20,
              lastActivityAt: '2026-10-01T00:00:00Z',
            },
          ],
        },
      },
    });
  });
  afterEach(() => {
    routeQuery.tab = 'sessions';
  });

  it('列出名下每条路径的里程碑/任务/百分比，当前路径带「当前」标识', async () => {
    const w = await mountLd([]);
    const cards = w.findAll('.ld-pathcard');
    expect(cards.length).toBe(2);
    const first = cards[0].text();
    expect(first).toContain('测试路径');
    expect(first).toContain('里程碑 1/3');
    expect(first).toContain('任务 4/10');
    expect(first).toContain('完成 40%');
    expect(first).toContain('学习中');
    expect(first).toContain('当前');
    const second = cards[1].text();
    expect(second).toContain('另一条路径');
    expect(second).toContain('里程碑 5/5');
    expect(second).toContain('任务 20/20');
    expect(second).toContain('完成 100%');
    expect(second).toContain('已下线');
    expect(second).not.toContain('当前');
    w.unmount();
  });

  it('点任意卡片即切页级路径范围（走既有 watch 重读，不另造数据流）', async () => {
    const w = await mountLd([]);
    await w.findAll('.ld-pathcard')[1].trigger('click');
    await flushPromises();
    expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: 'lp2' }));
    w.unmount();
  });
});

describe('LearnerDetail 证据页：概念信号 pill 筛选概念证据密度', () => {
  function scopedDetail() {
    const knowledgeMemory = {
      currentPath: {
        learningPathId: 'lp1',
        pathTitle: '心理学路径',
        progress: { totalTasks: 20, completedTasks: 10, totalMilestones: 5, completedMilestones: 2 },
        conceptStates: [],
      },
      globalSignals: { masteredConcepts: ['变量'], strugglingConcepts: ['递归'], fragileConcepts: [] },
      globalBackground: {
        conceptLedger: [
          { label: '变量', sourcePaths: ['lp1'], evidenceCount: 3 },
          { label: '递归', sourcePaths: ['lp1'], evidenceCount: 1 },
          { label: '闭包', sourcePaths: ['lp2'], evidenceCount: 2 },
        ],
      },
    };
    return { userName: '测试学习者', knowledgeMemory, model: { name: '测试学习者', knowledgeMemory } };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    routeQuery.tab = 'evidence';
    listSessions.mockReset().mockResolvedValue({ data: { data: { items: [] } } });
    getMemoryTraces.mockReset().mockResolvedValue([]);
    listPaths.mockReset().mockResolvedValue({
      data: { data: { paths: [{ id: 'lp1', title: '心理学路径', status: 'active', updatedAt: new Date().toISOString() }] } },
    });
  });
  afterEach(() => {
    routeQuery.tab = 'sessions';
  });

  it('概念名渲染为 pill，点单个概念只筛该行，清除后恢复全表', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    detailMock.mockResolvedValue(scopedDetail() as never);
    try {
      const w = await mountLd([]);
      const chips = w.findAll('.ld-sig-chip');
      expect(chips.length).toBe(2);
      const variable = chips.find((c) => c.text() === '变量');
      expect(variable, '变量 pill 应存在').toBeTruthy();
      await variable!.trigger('click');
      await flushPromises();
      expect(w.findAll('#ld-panel-evidence .ld-bar:not(.ld-bar--head)').length).toBe(1);
      expect(w.find('.ld-density__filter').text()).toContain('筛选：变量');

      await w.find('.ld-density__filter button').trigger('click');
      await flushPromises();
      expect(w.findAll('#ld-panel-evidence .ld-bar:not(.ld-bar--head)').length).toBe(2);
      expect(w.find('.ld-density__filter').exists()).toBe(false);
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
    }
  });

  it('点档位筛选整档概念，档位计数本身不变', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    detailMock.mockResolvedValue(scopedDetail() as never);
    try {
      const w = await mountLd([]);
      const head = w.findAll('.ld-sig-tier__head').find((b) => b.text().includes('已掌握'));
      expect(head, '已掌握档位应存在').toBeTruthy();
      await head!.trigger('click');
      await flushPromises();
      expect(w.findAll('#ld-panel-evidence .ld-bar:not(.ld-bar--head)').length).toBe(1);
      // 档位计数仍保留（不因筛选而变）
      expect(head!.text()).toContain('已掌握 1');
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
    }
  });

  it('按概念名过滤（2026-11-11 第二轮）：客户端筛行、空态可一键清除', async () => {
    const detailMock = vi.mocked(liveGetLearnerDetail);
    const origDetail = detailMock.getMockImplementation();
    detailMock.mockResolvedValue(scopedDetail() as never);
    try {
      const w = await mountLd([]);
      const rows = () => w.findAll('#ld-panel-evidence .ld-bar:not(.ld-bar--head)');
      expect(rows().length).toBe(2);

      const input = w.find('.ld-density__search');
      expect(input.exists(), '按概念名过滤输入框应存在').toBe(true);
      await input.setValue('递');
      await nextTick();
      expect(rows().length).toBe(1);
      expect(rows()[0].text()).toContain('递归');

      await input.setValue('不存在的概念');
      await nextTick();
      expect(rows().length).toBe(0);
      expect(w.find('.ld-density__empty').text()).toContain('没有名称包含「不存在的概念」的概念');
      await w.find('.ld-density__empty button').trigger('click');
      await nextTick();
      expect((w.find('.ld-density__search').element as HTMLInputElement).value).toBe('');
      expect(rows().length).toBe(2);
      w.unmount();
    } finally {
      if (origDetail) detailMock.mockImplementation(origDetail);
    }
  });
});
