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

function mountCard(advisory: ReplanAdvisory | null) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount: 3,
      masteredCount: 2,
      duration: '25 分钟',
      messageCount: 10,
      wrapup,
      advisory,
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
