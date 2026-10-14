/**
 * CompletionCard 不再重复渲染 summary-only 降级提示（2026-10-14 文案收敛）。
 * 背景：页级横幅（LearningEvaluationPage 的 .evaluation-degraded）已承载 summary-only
 * 的诚实说明并带重试入口，卡片内再写一遍属复读。契约：卡片任何 status 下都不渲染
 * .summary-only-notice；该提示的唯一出处是页级横幅。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { WrapupArtifact } from '@/api/aiTeaching';

const baseWrapup = {
  status: 'complete',
  sources: { summary: 'model', evaluation: 'model' },
  summary: { topicSummary: 't', knowledgeSummary: 'k', practiceAdvice: 'p', learningEvaluation: 'e' },
  evaluation: null,
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

function mountCard(status: WrapupArtifact['status']) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount: 3,
      masteredCount: 2,
      duration: '25 分钟',
      messageCount: 10,
      wrapup: { ...baseWrapup, status },
      advisory: null,
    },
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        MarkdownRenderer: { template: '<div><slot /></div>' },
      },
    },
  });
}

describe('CompletionCard summary-only 降级提示已收敛到页级横幅', () => {
  it('summary-only 时卡片内不再重复渲染提示（唯一出处是页级横幅）', () => {
    const wrapper = mountCard('summary-only');
    expect(wrapper.find('.summary-only-notice').exists()).toBe(false);
  });

  it('complete 时同样不渲染提示', () => {
    const wrapper = mountCard('complete');
    expect(wrapper.find('.summary-only-notice').exists()).toBe(false);
  });
});
