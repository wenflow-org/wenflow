/**
 * CompletionCard 的「路径调整建议」归因注记
 * 背景：阈值召回给出建议后，用户看模板句不知道该不该点确认；归因层补一句"主要因为…"。
 * 约束：归因缺失时不渲染（不能出现空标签）。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { ReplanAdvisory, WrapupArtifact } from '@/api/aiTeaching';

const wrapup = {
  status: 'complete',
  sources: { summary: 'model', evaluation: 'model' },
  summary: { topicSummary: 't', knowledgeSummary: 'k', practiceAdvice: 'p', learningEvaluation: 'e' },
  evaluation: {
    lss: 0, ktl: 0, lf: 0, lsb: 0, messageCount: 0, avgUnderstanding: 0, duration: 0,
  },
  progress: { newlyMastered: [], movedToReview: [], stillLearning: [], unchangedMastered: [] },
  evidence: {
    turnCount: 0,
    avgUnderstanding: null,
    avgEngagement: null,
    dominantCognitiveLevel: null,
    lastCognitiveLevel: null,
    topConfusionPoints: [],
    emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
    completionCandidateSeen: false,
  },
} as WrapupArtifact;

function mountCard(advisory: ReplanAdvisory | null, extraProps: Record<string, unknown> = {}) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount: 3,
      masteredCount: 2,
      duration: '25 分钟',
      messageCount: 10,
      wrapup,
      advisory,
      ...extraProps,
    },
    global: {
      stubs: {
        'el-icon': true,
        'el-button': { template: '<button><slot /></button>' },
        RouterLink: { template: '<a><slot /></a>' },
        MarkdownRenderer: { template: '<div><slot /></div>' },
        CircleCheckFilled: true,
        MagicStick: true,
        Opportunity: true,
        DataAnalysis: true,
      },
    },
  });
}

const baseAdvisory = {
  shouldSuggest: true,
  priority: 'high' as const,
  recommendation: 'reinforce' as const,
  scope: 'next_milestone' as const,
  rationale: '阈值理由',
  reasonCodes: ['fragile_concepts'],
  ui: {
    title: '建议先调整下一阶段安排',
    body: '系统检测到你刚完成的阶段里有些点还不够稳。',
    options: [
      { key: 'keep', label: '保持原计划', description: '' },
      { key: 'reinforce', label: '补强后再进', description: '' },
    ],
  },
};

describe('CompletionCard 归因注记', () => {
  it('有归因时渲染「主要因为 + 一句话」', () => {
    const w = mountCard({
      ...baseAdvisory,
      attribution: {
        primaryReasonCode: 'fragile_concepts',
        reason: '「取大取小依据」连着两次没答对',
        claim: '这些点下一节仍会不稳',
        expect: '仍不稳',
        checkOn: 'next_lesson',
        evidenceRefs: ['signal:fragile'],
        thresholdRecommendation: 'slow_down',
      },
    });
    const note = w.find('.section-attribution');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('主要因为');
    expect(note.text()).toContain('连着两次没答对');
  });

  it('没有归因时不渲染该行（避免空标签）', () => {
    const w = mountCard({ ...baseAdvisory, attribution: null });
    expect(w.find('.section-attribution').exists()).toBe(false);
  });

  it('不建议调整时整块不渲染', () => {
    const w = mountCard({ ...baseAdvisory, shouldSuggest: false });
    expect(w.find('.advisory-section').exists()).toBe(false);
  });

  it('图标以内联 SVG 渲染（element-plus 已移除，无字形回退）', () => {
    const w = mountCard(baseAdvisory);
    expect(w.findAll('svg').length).toBeGreaterThan(0);
    expect(w.html()).not.toContain('completion-glyph');
  });
});

/**
 * 摘要区排版契约（2026-11-03 排版优化）。
 * 报告宽屏下摘要区是 4 等分格（每格 231px）：「主题」这种整句标题被压成 3 行，
 * 而同排的「31 分钟」只占一行。修法是主题独占整行、其余读数平分下面一行。
 * CSS 行为 jsdom 量不到，这里锁住"哪一项带整行类"这个 DOM 契约。
 */
describe('CompletionCard 摘要区排版', () => {
  it('主题独占整行，其余读数不带该类（不被挤进等分格）', () => {
    const w = mountCard(baseAdvisory);
    const items = w.findAll('.summary-item');
    expect(items.length).toBe(4);
    expect(items[0].classes()).toContain('summary-item--topic');
    expect(items[0].text()).toContain('测试主题');
    expect(items.slice(1).some((it) => it.classes().includes('summary-item--topic'))).toBe(false);
  });
});

/**
 * 知识点读数（2026-11-03 走查 S4-3）。
 * 实测：当堂两次小测都答对、导师说"动作你已经独立走完了"，页头却单摆「知识点 0/2 已学会」——
 * 数字没错（两条都还在 learning、进度 80/90），错在把它当结论单独呈现。
 * 修法：把同源的进行中进度一并说出来，判定阈值不动。
 */
describe('CompletionCard 知识点读数', () => {
  const knowledgeCell = (w: ReturnType<typeof mountCard>) => w.findAll('.summary-item')
    .find((el) => el.text().includes('知识点'))?.text() || '';

  it('一条都没判定时，补出进行中进度（0/2 不再单独成句）', () => {
    const w = mountCard(baseAdvisory, {
      masteredCount: 0,
      totalCount: 2,
      knowledgePoints: [
        { status: 'learning', progress: 90 },
        { status: 'learning', progress: 80 },
      ],
    });
    expect(knowledgeCell(w)).toContain('0/2 已学会 · 2 项在学，最高 90%');
  });

  it('部分判定时，只数剩下的在学项', () => {
    const w = mountCard(baseAdvisory, {
      masteredCount: 1,
      totalCount: 2,
      knowledgePoints: [
        { status: 'mastered', progress: 100 },
        { status: 'learning', progress: 60 },
      ],
    });
    expect(knowledgeCell(w)).toContain('1/2 已学会 · 1 项在学，最高 60%');
  });

  it('全部判定后不再带尾巴', () => {
    const w = mountCard(baseAdvisory, {
      masteredCount: 2,
      totalCount: 2,
      knowledgePoints: [
        { status: 'mastered', progress: 100 },
        { status: 'mastered', progress: 100 },
      ],
    });
    const cell = knowledgeCell(w);
    expect(cell).toContain('已学会');
    expect(cell).not.toContain('项在学');
  });

  it('不传知识点（旧调用方）时保持原口径', () => {
    const w = mountCard(baseAdvisory, { masteredCount: 0 });
    expect(knowledgeCell(w)).toContain('0/3 已学会');
    expect(knowledgeCell(w)).not.toContain('项在学');
  });
});

/**
 * 已结算的任务不再递「完成任务」（2026-11-03 走查 S4-5 根因修复）。
 * 实测：评估页顶部写「本次学习已结束」，同页底部又给一颗「完成任务」并注明会推进路径进度，
 * 而路径页早已把这节算进完成（阶段 1 = 1/2）——同一件事像是没做完、还能再做一遍。
 */
describe('CompletionCard 动作栏 · 已结算任务', () => {
  it('taskCompleted=true 时不渲染「完成任务」，只留继续练习与返回路径', () => {
    const w = mountCard(baseAdvisory, { taskCompleted: true });
    const labels = w.findAll('.completion-actions__row button').map((b) => b.text());
    expect(labels.some((t) => t.includes('完成任务'))).toBe(false);
    expect(labels.some((t) => t.includes('继续练习'))).toBe(true);
    expect(labels.some((t) => t.includes('返回学习路径'))).toBe(true);
    expect(w.find('.completion-actions__hint').text()).toContain('已计入路径进度');
  });

  it('未结算（默认）仍渲染「完成任务」，提示句保持原口径', () => {
    const w = mountCard(baseAdvisory);
    const labels = w.findAll('.completion-actions__row button').map((b) => b.text());
    expect(labels.some((t) => t.includes('完成任务'))).toBe(true);
    expect(w.find('.completion-actions__hint').text()).toContain('完成任务会推进路径进度');
  });
});
