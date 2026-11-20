/**
 * 课程已结算且 4/4 全掌握时，AI 仍可能把某个知识点标成 learning（「会了但还不稳」）。
 * 列表标签不能写「继续练习」——那会和卡头「4/4 已学会」正面矛盾；
 * 统一改口径为「建议巩固」，保留提醒但不否定已完成的掌握状态。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { WrapupArtifact } from '@/api/aiTeaching';

function wrapupWithLearningItem(): WrapupArtifact {
  return {
    status: 'complete',
    sources: { summary: 'model', evaluation: 'model' },
    summary: {
      topicSummary: 't',
      knowledgeSummary: 'k',
      practiceAdvice: 'p',
      learningEvaluation: 'e',
      knowledgeItems: [
        { name: '识别列名错位现象', status: 'learning', evidence: '能指出错位，但判断标准还不稳。' },
        { name: '读入Excel为DataFrame', status: 'mastered', evidence: '已能独立说明表头与行索引。' },
      ],
    },
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
  } as unknown as WrapupArtifact;
}

function mountCard(masteredCount: number, totalCount: number) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount,
      masteredCount,
      duration: '25 分钟',
      messageCount: 10,
      wrapup: wrapupWithLearningItem(),
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

describe('CompletionCard 知识点状态口径', () => {
  it('全掌握时 learning 标成「建议巩固」，不再和「4/4 已学会」打架', () => {
    const wrapper = mountCard(2, 2);
    const tags = wrapper.findAll('.status-tag').map((tag) => tag.text());
    expect(tags).toEqual(['建议巩固', '已学会']);
  });

  it('未全掌握时 learning 仍是「继续练习」', () => {
    const wrapper = mountCard(1, 2);
    const tags = wrapper.findAll('.status-tag').map((tag) => tag.text());
    expect(tags).toEqual(['继续练习', '已学会']);
  });
});
