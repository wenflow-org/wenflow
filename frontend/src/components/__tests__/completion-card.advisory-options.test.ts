/**
 * 「查看调整建议」弹窗读的是 advisory.ui.body——与卡面正文同一段话。
 * 卡面已经展示正文、并且另有确认/压缩等真实动作时，这颗按钮只会复读，必须去掉；
 * 正文为空或没有其它动作的旧建议保留它，避免删掉唯一入口。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { WrapupArtifact } from '@/api/aiTeaching';

const wrapup = {
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
} as unknown as WrapupArtifact;

function mountWith(advisory: Record<string, unknown>) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount: 4,
      masteredCount: 4,
      duration: '25 分钟',
      messageCount: 10,
      wrapup,
      advisory: advisory as never,
    },
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        MarkdownRenderer: { template: '<div><slot /></div>' },
      },
    },
  });
}

const labels = (wrapper: ReturnType<typeof mountWith>) =>
  wrapper.findAll('.advisory-options button').map((button) => button.text());

describe('CompletionCard 建议卡按钮', () => {
  it('正文已展示且有「确认调整」时，不再摆复读正文的「查看调整建议」', () => {
    const wrapper = mountWith({
      shouldSuggest: true,
      priority: 'high',
      recommendation: 'reinforce',
      scope: 'next_milestone',
      rationale: 'r',
      reasonCodes: [],
      attribution: null,
      ui: {
        title: '建议先确认路径调整',
        body: '系统检测到识别列名错位现象仍会影响后续推进。',
        options: [
          { key: 'keep', label: '保持原计划', description: '' },
          { key: 'preview', label: '查看调整建议', description: '' },
          { key: 'confirm', label: '确认调整后续阶段', description: '' },
        ],
      },
    });
    expect(labels(wrapper)).toEqual(['保持原计划', '确认调整后续阶段']);
    // 只剩两颗时走并排布局；否则窄屏主按钮整行，旁边会空半格
    expect(wrapper.find('.advisory-options').classes()).toContain('advisory-options--pair');
  });

  it('加速分支同样去掉「先看建议」，保留压缩动作', () => {
    const wrapper = mountWith({
      shouldSuggest: true,
      priority: 'low',
      recommendation: 'accelerate',
      scope: 'next_milestone',
      rationale: 'r',
      reasonCodes: [],
      attribution: null,
      ui: {
        title: '可以考虑加速下一阶段',
        body: '你在当前阶段的掌握比较稳定。',
        options: [
          { key: 'keep', label: '保持原计划', description: '' },
          { key: 'accelerate', label: '压缩下一阶段', description: '' },
          { key: 'preview', label: '先看建议', description: '' },
        ],
      },
    });
    expect(labels(wrapper)).toEqual(['保持原计划', '压缩下一阶段']);
  });

  it('正文为空时保留「查看调整建议」——它是旧建议唯一的正文入口', () => {
    const wrapper = mountWith({
      shouldSuggest: true,
      priority: 'medium',
      recommendation: 'reinforce',
      scope: 'next_milestone',
      rationale: '旧建议只有 rationale。',
      reasonCodes: [],
      attribution: null,
      ui: {
        title: '建议先确认路径调整',
        body: '',
        options: [
          { key: 'keep', label: '保持原计划', description: '' },
          { key: 'preview', label: '查看调整建议', description: '' },
          { key: 'confirm', label: '确认调整后续阶段', description: '' },
        ],
      },
    });
    expect(labels(wrapper)).toEqual(['保持原计划', '查看调整建议', '确认调整后续阶段']);
  });
});
