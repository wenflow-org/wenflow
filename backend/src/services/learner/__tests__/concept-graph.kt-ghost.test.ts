/**
 * KT 幽灵痕口径一致（2026-11-09 运营字段真值核查）
 *
 * 背景：教学回合会把模型输出 `analysis.ktEstimate.conceptMastery[].mastery` 直写
 * memory_traces（source='kt-estimate'、extractionCount=0）。这是**模型自报的掌握概率**，
 * 不是学习证据。
 *
 * 画像聚合（LearnerKnowledgeMemoryService #59/#60）和复习队列（review-plan.service）都排除了它，
 * 唯独概念图谱读路径漏了这道门 → 图谱节点上的百分比可能是模型编的数。
 * 本测试锁定共用判定函数，并断言图谱 deps 的读路径确实用它过滤。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    memory_traces: { findMany: jest.fn() },
    concepts: { findMany: jest.fn() },
    concept_edges: { findMany: jest.fn() },
    concept_aliases: { findUnique: jest.fn() },
    learning_paths: { findMany: jest.fn() },
  },
}));

import { isKtGhostTrace, KT_GHOST_TRACE_WHERE } from '../../memory/kt-ghost';

describe('isKtGhostTrace', () => {
  it('kt-estimate 且从未真正提取过 → 幽灵痕', () => {
    expect(isKtGhostTrace({ source: 'kt-estimate', extractionCount: 0 })).toBe(true);
    expect(isKtGhostTrace({ source: 'kt-estimate', extractionCount: null })).toBe(true);
    expect(isKtGhostTrace({ source: 'kt-estimate' })).toBe(true);
  });

  it('kt-estimate 但已真正提取过 → 不是幽灵痕（有学习证据支撑）', () => {
    expect(isKtGhostTrace({ source: 'kt-estimate', extractionCount: 2 })).toBe(false);
  });

  it('确定性来源（derived / review-event）不受影响', () => {
    expect(isKtGhostTrace({ source: 'derived', extractionCount: 0 })).toBe(false);
    expect(isKtGhostTrace({ source: 'review-event', extractionCount: 0 })).toBe(false);
    expect(isKtGhostTrace({ source: null, extractionCount: 0 })).toBe(false);
  });

  it('SQL 条件与函数同口径（防止清理脚本与读侧漂移）', () => {
    expect(KT_GHOST_TRACE_WHERE).toEqual({ source: 'kt-estimate', extractionCount: 0 });
    // 函数对 where 条件选出的行必须全部判真
    expect(isKtGhostTrace(KT_GHOST_TRACE_WHERE)).toBe(true);
  });
});
