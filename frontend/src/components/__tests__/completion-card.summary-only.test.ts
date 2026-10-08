/**
 * CompletionCard 的 summary-only 降级档透明化（TONIGHT-BROAD 立刻#4）
 * 背景：完课大多数落在 summary-only 降级档（仅简要总结、课堂表现评估未生成），
 * 但完课卡此前照常渲染，学生看不出这不是一次完整结课产出。
 * 契约：wrapup.status === 'summary-only' 时显示一行诚实文案；'complete' 时不渲染（不出现空提示）。
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

describe('CompletionCard summary-only 降级档透明化', () => {
  it('summary-only 时显示诚实文案（不用 emoji）', () => {
    const wrapper = mountCard('summary-only');
    const notice = wrapper.find('.summary-only-notice');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('本次结课仅生成简要总结');
    expect(notice.text()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('complete 时不渲染提示（不能出现空提示）', () => {
    const wrapper = mountCard('complete');
    expect(wrapper.find('.summary-only-notice').exists()).toBe(false);
  });
});
