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

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

import LearnerDetail from '../LearnerDetail.vue';
import { liveVirtuals, liveGetLearnerDetail, liveLearners, type LiveVirtual } from '../live';
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

  it('操作列已撤（无单点复习接口）；列方言=知识点/记忆强度/复习到期/提取史/状态；调度面板拆到「记忆调度」页签（2026-10-12 拍板）', async () => {
    const w = await mountMemory([trace({})]);
    expect(w.findAll('#ld-panel-memory thead th').map((t) => t.text())).toEqual([
      '知识点', '记忆强度', '复习到期', '提取史', '状态',
    ]);
    // 记忆与复习页签 = FSRS 普查（读数）；调度面板（温故计划/归并审计/回滚）在「记忆调度」页签
    expect(w.findAll('#ld-panel-memory tbody button').length).toBe(0);
    expect(w.find('#ld-panel-memory .mk-card__head .mk-link').exists()).toBe(false);
    expect(w.find('#ld-panel-memory .mr-panels').exists()).toBe(false);

    routeQuery.tab = 'memory-ops';
    const ops = await mountMemory([trace({})]);
    expect(ops.find('#ld-panel-memory-ops .mr-panels').exists(), '记忆调度页签应渲染调度面板').toBe(true);
    // 本夹具的 review-detail mock 返回 null → 面板显示暂无兜底（栏与卡片按明细有无渲染）
    expect(ops.find('#ld-panel-memory-ops .mr-panels').text()).toContain('暂无可复盘的记忆数据');
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

  it('列头排序（2026-10-18）：记忆强度首击升序（弱在前）、提取史首击降序（多在前）', async () => {
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

    // 提取史：首击降序（9 次 → 5 次 → 2 次）
    const extractTh = w.findAll('#ld-panel-memory thead th').find((t) => t.text() === '提取史')!;
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

  it('卡头读数给出状态分档；提取史输出「N 次 · 最近 时间」', async () => {
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
    await chooseMkSelect(w as never, '路径范围', 'lp2');
    await flushPromises();
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
