/**
 * 完课卡「长期状态四维」的 KTL 口径（2026-10-14 用户令「统一一下」）。
 *
 * 背景：同一个数在两处结论相反——学习端把长期 `stateUpdate.ktl` 叫「KTL 知识掌握」并判**高=好（绿）**，
 * 管理端按后端定义（Knowledge Training Load 训练负荷）判**高=坏（红）**。
 * 后端语义：长期 ktl = 训练负荷（高=负荷重）；而**会话级** `evaluation.sessionKtl`
 * = 本节知识获得质量（high=好），两者同名不同义——本用例同时锁住"会话级不跟着翻"。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { WrapupArtifact } from '@/api/aiTeaching';

function wrapup(over: Partial<WrapupArtifact> = {}): WrapupArtifact {
  return {
    status: 'complete',
    sources: { summary: 'model', evaluation: 'model' },
    summary: { topicSummary: 't', knowledgeSummary: 'k', practiceAdvice: 'p', learningEvaluation: 'e' },
    evaluation: {
      lss: 7, ktl: 8, lf: 2, lsb: 5, messageCount: 10, avgUnderstanding: 0.8, duration: 900,
      sessionKtl: 8, sessionLss: 7, sessionLf: 2,
    },
    progress: { newlyMastered: [], movedToReview: [], stillLearning: [], unchangedMastered: [] },
    evidence: { turnCount: 10, avgUnderstanding: 0.8, avgEngagement: 0.7, dominantCognitiveLevel: null, lastCognitiveLevel: null, topConfusionPoints: [], emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 }, completionCandidateSeen: true },
    stateUpdate: { ktl: 7.8, lsb: 5.9, lf: 1.9, lss: 2.7 },
    ...over,
  } as WrapupArtifact;
}

function mountCard(w: WrapupArtifact = wrapup()) {
  return mount(CompletionCard, {
    props: { topic: '测试主题', totalCount: 3, masteredCount: 2, duration: '25 分钟', messageCount: 10, wrapup: w, advisory: null },
    global: {
      stubs: {
        'el-icon': true,
        'el-button': { template: '<button><slot /></button>' },
        RouterLink: { template: '<a><slot /></a>' },
        MarkdownRenderer: { template: '<div><slot /></div>' },
        CircleCheckFilled: true, MagicStick: true, Opportunity: true, DataAnalysis: true,
      },
    },
  });
}

/** 取某张指标卡的 { label, level, tone, desc }（tone 从 .metric-card--<tone> 类名读，是渲染结果不是内部值） */
function card(w: ReturnType<typeof mountCard>, key: string) {
  const blocks = w.findAll('.metric-card');
  for (const b of blocks) {
    const label = b.find('.metric-label').text();
    if (label.startsWith(key)) {
      return {
        label,
        level: b.find('.metric-badge').text(),
        tone: Array.from(b.classes()).find((c) => c.startsWith('metric-card--'))?.replace('metric-card--', '') || '',
        desc: b.find('.metric-desc').text(),
      };
    }
  }
  return null;
}

describe('长期状态四维：KTL = 训练负荷（高=坏）', () => {
  it('标签是「KTL 训练负荷」而非「知识掌握」，且高值不给 good', () => {
    const w = mountCard();
    const ktl = card(w, 'KTL');
    expect(ktl, '长期四维应含 KTL 卡').toBeTruthy();
    expect(ktl!.label).toBe('KTL 训练负荷');
    expect(ktl!.desc).toContain('训练负荷');
    // 7.8 属高负荷：必须不是 good（原先 getSimpleLevel 会判 高/good）
    expect(ktl!.tone).not.toBe('good');
    expect(ktl!.tone).toBe('warn');
  });

  it('低负荷 KTL 归一为 good（与 LSS/LF 同向）', () => {
    const w = mountCard(wrapup({ stateUpdate: { ktl: 2, lsb: 5.9, lf: 1.9, lss: 2.7 } as never }));
    const ktl = card(w, 'KTL')!;
    expect(ktl.tone).toBe('good');
    expect(ktl.level).toBe('低');
  });

  it('会话级 KTL（本节知识获得质量）保持高=好，不跟着长期口径一起翻', () => {
    const w = mountCard();
    const sess = card(w, '本节掌握增量');
    expect(sess, '应含会话级 KTL 卡').toBeTruthy();
    expect(sess!.tone).toBe('good');
    expect(sess!.level).toBe('高');
  });
});
