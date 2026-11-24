/**
 * 知识点证据文本的清洗口径（2026-11-23 真人测试实锤）。
 *
 * 复盘卡会把证据里的内部枚举词翻成学员话术（newlyMastered/mastered/avgUnderstanding）。
 * 但原实现对 `status` 做了裸词全局替换，结果把学员 SQL 证据里的列名一起改了：
 * DB 原文 `AND status = 'paid'`，页面显示 `AND 当前表现 = 'paid'`——证据被改写，
 * 学员对照自己的答案会发现对不上。本用例钉住：SQL 里的 status 原样保留，
 * 只有「字段名姿态」（后接冒号）的 status 才翻译。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CompletionCard from '../CompletionCard.vue';
import type { WrapupArtifact } from '@/api/aiTeaching';

function wrapupWithEvidence(evidence: string): WrapupArtifact {
  return {
    status: 'complete',
    sources: { summary: 'model', evaluation: 'model' },
    summary: {
      topicSummary: 't',
      knowledgeSummary: 'k',
      practiceAdvice: 'p',
      learningEvaluation: 'e',
      knowledgeItems: [
        { name: '编写单表取数语句', status: 'learning', evidence },
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

function mountWithEvidence(evidence: string) {
  return mount(CompletionCard, {
    props: {
      topic: '测试主题',
      totalCount: 1,
      masteredCount: 0,
      duration: '25 分钟',
      messageCount: 10,
      wrapup: wrapupWithEvidence(evidence),
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

describe('CompletionCard 证据文本清洗', () => {
  it('SQL 里的 status 列名不被翻译（保留原始证据）', () => {
    const text = mountWithEvidence(
      "你独立写出 SELECT order_id FROM orders WHERE order_time >= '2026-11-22 00:00:00' AND status = 'paid'"
    ).text();
    expect(text).toContain("status = 'paid'");
    expect(text).not.toContain('当前表现');
  });

  it('字段名姿态的 status 仍翻成「当前表现」', () => {
    const text = mountWithEvidence('status: learning').text();
    expect(text).toContain('当前表现');
  });

  it('内部枚举词照常翻译', () => {
    const text = mountWithEvidence('avgUnderstanding 低，状态 unchangedMastered').text();
    expect(text).toContain('课堂理解度');
    expect(text).toContain('已学会');
  });
});
