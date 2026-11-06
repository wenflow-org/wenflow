/**
 * #41（2026-10-20）学习状态页数据门回归：
 *
 * 三张 KPI 全 0（连续天数 / 本周分钟 / 已掌握知识点都为 0）时，页面不得出现
 * 「你已投入时间」「有点疲劳」这类 skill 生成文案，也不得出现由 decisions 派生的
 * 「系统已自动处理」块——否则同一屏自相矛盾。
 *
 * 病根：旧实现用 hasAnyLoad（/state/trends 逐日后向填充，只要窗口里有一天 metric，
 * 整窗 lsb 都非空）当数据门；本用例故意让 trends 返回有值数据、KPI 全 0。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import V2LearningState from '../V2LearningState.vue';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({
  default: { get: getMock, post: vi.fn() }
}));

vi.mock('@/api/metrics', () => ({
  metricsAPI: {
    getCurrentState: vi.fn(async () => ({ lss: 30, ktl: 1, lf: 20, lsb: -10 }))
  }
}));

vi.mock('@/api/learning', () => ({
  learningAPI: { getPaths: vi.fn(async () => []) }
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));
vi.mock('@/components/AiContentNote.vue', () => ({ default: { template: '<p class="stub-ai-note" />' } }));

/** 疲劳语义的 skill 文案 + pace 决策卡：KPI 全 0 时这些都不该渲染 */
const FATIGUE_COPY = {
  headline: '你已投入时间',
  subtitle: '最近有点疲劳，先稳住节奏',
  todayActions: [],
  pathHint: '',
  nextStep: '今天轻量学习',
  paceHint: '放慢一点',
  emptyStateCopy: '',
  warningCopy: '近 7 天疲劳度持续高于健康度'
};

function trendsWithLsB() {
  const now = new Date();
  const out: Array<Record<string, unknown>> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      ktl: 0.1,
      lf: 0.3,
      lsb: -0.2
    });
  }
  return out;
}

function mockApi(opts: { sessions?: unknown[]; nodes?: unknown[]; warnings?: unknown[] }) {
  getMock.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/users/me/sessions')) return Promise.resolve({ success: true, data: opts.sessions ?? [] });
    if (u.includes('/learning/concept-graph')) return Promise.resolve({ success: true, data: { nodes: opts.nodes ?? [] } });
    if (u.includes('/state/trends')) return Promise.resolve({ success: true, data: { trends: trendsWithLsB(), range: 'recent' } });
    if (u.includes('/state/warnings')) return Promise.resolve({ success: true, data: { warnings: opts.warnings ?? [] } });
    if (u.includes('/ai-teaching/review/due')) return Promise.resolve({ success: true, data: { items: [] } });
    if (u.includes('/ai-teaching/review/plan')) return Promise.resolve({ success: true, data: { items: [] } });
    if (u.includes('/adaptive-guidance/copy')) {
      return Promise.resolve({
        success: true,
        data: {
          copy: FATIGUE_COPY,
          decisions: [
            {
              id: 'pace',
              kind: 'pace',
              captured: '近 7 天疲劳度持续高于健康度',
              judgment: '继续加量，吸收效率会下降',
              action: '建议今天轻量学习或休息',
              priority: 'info',
              at: null
            }
          ]
        }
      });
    }
    return Promise.resolve({ success: true, data: {} });
  });
}

describe('学习状态页数据门（#41）', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('三 KPI 全 0（趋势有后向填充值）：不渲染 skill 文案，advisory 落中性空态（#41 原判例）', async () => {
    mockApi({ sessions: [], nodes: [] });
    const w = mount(V2LearningState);
    await flushPromises();

    expect(w.find('.guide__diag').exists()).toBe(false);
    expect(w.find('.advisory__sub').exists()).toBe(false);
    const text = w.text();
    expect(text).not.toContain('你已投入时间');
    expect(text).not.toContain('有点疲劳');
    expect(text).not.toContain('近 7 天疲劳度持续高于健康度');
    expect(text).toContain('完成第一次学习后，这里会出现 AI 建议。');
  });

  it('真·全空态（趋势无数据且 KPI 全 0）：收成一张 state__hero 整卡，碎片空卡不渲染', async () => {
    mockApi({ sessions: [], nodes: [] });
    // 覆写 trends 为空数组：stateEmpty = !hasAnyLoad && !hasKpiData
    getMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/state/trends')) return Promise.resolve({ success: true, data: { trends: [], range: 'recent' } });
      return Promise.resolve({ success: true, data: {} });
    });
    const w = mount(V2LearningState);
    await flushPromises();

    const text = w.text();
    expect(w.find('.state__hero').exists()).toBe(true);
    expect(text).toContain('学习状态正在积累中');
    expect(text).toContain('完成第一次学习后，这里会出现训练负荷曲线、AI 建议与掌握分布。');
    expect(text).toContain('去开始学习');
    /* 碎片空卡退场：AI 建议卡 / 趋势图空壳 / 三张 0 值 KPI */
    expect(w.find('.advisory').exists()).toBe(false);
    expect(w.find('.chart__empty--first').exists()).toBe(false);
    expect(w.find('.kpis').exists()).toBe(false);
  });

  it('本周有真实分钟：正常渲染 skill 文案与自动处理块', async () => {
    mockApi({
      sessions: [{ startTime: new Date().toISOString(), durationMinutes: 30 }],
      nodes: []
    });
    const w = mount(V2LearningState);
    await flushPromises();

    // 2026-11-06 审计 §3：学习台首页的破冰引导（headline/warningCopy）整段移出本页卡片，
    // compact 档只留一行本页自有的结论；自动处理与已执行两节合并为「近期自动调控记录」一条流水
    expect(w.find('.guide__title').exists()).toBe(false);
    expect(w.text()).not.toContain('你已投入时间');
    expect(w.text()).toContain('当前无需调整，有需要时会在这里提醒。');
    expect(w.find('.advisory__sub').exists()).toBe(true);
    expect(w.text()).toContain('近期自动调控记录');
  });

  it('同时有真预警时：诊断/建议破冰话术退场，预警接管（2026-11-05 PC 自查矛盾修复）', async () => {
    mockApi({
      sessions: [{ startTime: new Date().toISOString(), durationMinutes: 30 }],
      nodes: [],
      warnings: [
        { level: 'critical', title: '学习疲劳预警', message: '连续 3 天急性负荷高于适应基座' }
      ]
    });
    const w = mount(V2LearningState);
    await flushPromises();

    // 破冰话术（"还没到需要提醒疲劳的程度"）不得与真预警同屏
    expect(w.find('.guide__diag').exists()).toBe(false);
    expect(w.find('.guide__plan').exists()).toBe(false);
    expect(w.text()).toContain('学习疲劳预警');
  });
});
