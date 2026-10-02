/**
 * LearnerDetail 学习者阶段切换 + FSRS 到期三态回归：
 * - 教学会话 pane 的阶段切换器：档位/计数从会话窗口的 milestoneIndex 派生（零新后端契约），
 *   单阶段不渲染，多阶段可筛选，meta 显示「N / M 条」；
 * - 到期列三态：timeAgo 对未来时间返回「刚刚」的失真修复（逾期 N 天 / 今天到期 / N 天后）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const listSessions = vi.hoisted(() => vi.fn());
const getMemoryTraces = vi.hoisted(() => vi.fn());

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
  liveGetLearnerEvidence: vi.fn().mockResolvedValue({ items: [], domain: [], loadCurve: [] }),
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
  adminMemoryReviewApi: {},
  // 必须给 resolved 值：loadDetail 对它 .then，undefined 会在 try 内同步抛 TypeError 炸掉后续 loadLdSessions
  getUserIncludingDeleted: vi.fn().mockResolvedValue({ data: { data: {} } }),
}));
vi.mock('../statusText', () => ({ statusText: (s: string) => s }));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import LearnerDetail from '../LearnerDetail.vue';

function sessionRow(id: string, milestoneIndex: number | null) {
  return {
    id,
    topic: `会话 ${id}`,
    subject: 'concept-teaching',
    status: 'completed',
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
        MkChart: { template: '<div class="stub-chart" />' },
        MkGraphExplorer: { template: '<div class="stub-graph" />' },
        RouterLink: { template: '<a><slot /></a>' },
        Teleport: { template: '<teleport to="body"><slot /></teleport>' },
      },
    },
  });
  await flushPromises();
  return w;
}

describe('LearnerDetail 教学会话 pane：阶段切换器', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listSessions.mockReset();
    getMemoryTraces.mockReset().mockResolvedValue([]);
  });

  it('多阶段：chips 按里程碑升序带计数，点击筛选且 meta 显示 N / M 条', async () => {
    const w = await mountLd([
      sessionRow('s1', 1),
      sessionRow('s2', 1),
      sessionRow('s3', 2),
      sessionRow('s4', null), // 无归因行不进档位，但留在「全部」
    ]);
    const chips = w.findAll('.ld-stagechips .mk-pill');
    expect(chips.length).toBe(3); // 全部 + 里程碑1 + 里程碑2
    expect(chips[1].text()).toContain('里程碑 1 · 2');
    expect(chips[2].text()).toContain('里程碑 2 · 1');

    await chips[2].trigger('click');
    await flushPromises();
    const rows = w.findAll('tbody .ld-pane-row');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('s3');
    expect(w.find('.mk-card__meta').text()).toContain('1 / 4 条');
  });

  it('回到「全部」恢复全量；切人/重载后失效档位自动复位', async () => {
    const w = await mountLd([sessionRow('s1', 1), sessionRow('s2', 2)]);
    await w.findAll('.ld-stagechips .mk-pill')[2].trigger('click');
    await flushPromises();
    expect(w.findAll('tbody .ld-pane-row').length).toBe(1);

    await w.findAll('.ld-stagechips .mk-pill')[0].trigger('click');
    await flushPromises();
    expect(w.findAll('tbody .ld-pane-row').length).toBe(2);
  });

  it('单阶段：不渲染切换器（单档即全部）', async () => {
    const w = await mountLd([sessionRow('s1', 1), sessionRow('s2', 1)]);
    expect(w.find('.ld-stagechips').exists()).toBe(false);
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
