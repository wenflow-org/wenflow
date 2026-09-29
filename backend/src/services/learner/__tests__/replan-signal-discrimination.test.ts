/**
 * 完课建议（replan signal）的区分度。
 *
 * 2026-09-29 全库实测：242 条带 advisory 的会话全部 shouldSuggest=true /
 * priority=high / recommendation=resequence，且 rationale 只有 1 种文案
 * （LearnerSnapshotService.ts 的 highRisk 分支）。根因是 structuralRisk 用了
 * 「计数 > 0」：blockedFoundations 由 fragility=high 的概念聚合而来，与
 * globalSignals.fragileConcepts 同源，而"这节课留下脆弱点"是每节课的常态。
 *
 * 本测试钉死修复后的判据：结构性风险只认**一跳直接前置缺口**（severity=high），
 * 口径与 ReplanAdvisoryService.build 的 highRisk 对齐（契约见
 * ai-teaching/__tests__/replan-prerequisite-severity.test.ts）。
 */
import { deriveReplanSignal } from '../LearnerSnapshotService';

function input(over: {
  gaps?: Array<{ label: string; severity: string; source?: string }>;
  fragile?: string[];
  struggling?: string[];
  lf?: number;
  lsb?: number;
  ktl?: number;
  trend?: string;
  paceMode?: string;
  reviewPriority?: string;
  completedTasks?: number;
  totalTasks?: number;
}) {
  const gaps = over.gaps ?? [];
  return {
    dynamicState: {
      metrics: { lf: over.lf ?? 3, lsb: over.lsb ?? 2, ktl: over.ktl ?? 5 },
      recentTrend: over.trend ?? 'steady',
      fatigueRisk: 'medium',
    },
    learningControlState: {
      paceMode: over.paceMode ?? 'steady',
      reviewPriority: over.reviewPriority ?? 'normal',
      checkpointNeed: false,
    },
    knowledgeMemory: {
      globalSignals: {
        fragileConcepts: over.fragile ?? [],
        strugglingConcepts: over.struggling ?? [],
        masteredConcepts: [],
      },
      globalBackground: { blockedFoundations: over.fragile ?? [] },
      currentPath: {
        prerequisiteGaps: gaps,
        progress: {
          totalTasks: over.totalTasks ?? 20,
          completedTasks: over.completedTasks ?? 1,
        },
      },
    },
  } as never;
}

describe('deriveReplanSignal 区分度', () => {
  it('只有脆弱点（每节课常态）→ 补强档，不是高危重排', () => {
    const s = deriveReplanSignal(input({
      fragile: ['从解析式画函数图像', '双向翻译'],
      struggling: ['三角恒等变形'],
      gaps: [{ label: '从解析式画函数图像', severity: 'medium' }],
    }));
    expect(s.shouldSuggest).toBe(true);
    expect(s.priority).toBe('medium');
    expect(s.recommendation).toBe('reinforce');
    expect(s.recommendation).not.toBe('resequence');
  });

  it('一跳直接前置缺口（severity=high，来源=图）→ 高危重排', () => {
    const s = deriveReplanSignal(input({
      gaps: [{ label: '分组键唯一性', severity: 'high', source: 'graph' }],
    }));
    expect(s.shouldSuggest).toBe(true);
    expect(s.priority).toBe('high');
    expect(s.recommendation).toBe('resequence');
    expect(s.scope).toBe('downstream_path');
  });

  // 图缺失时的回落口径算的是「当前任务自己的概念没掌握」，severity 按稳定性而非深度打——
  // 那不是前置缺口，不能构成「重排后续路径」的结构性理由（S4b 注释明确否定了该口径）。
  it('回落口径的高 severity（当前任务自己弱）→ 不构成结构性风险', () => {
    const s = deriveReplanSignal(input({
      fragile: [],
      struggling: [],
      gaps: [{ label: '当前任务概念', severity: 'high', source: 'fallback' }],
    }));
    expect(s.priority).not.toBe('high');
    expect(s.recommendation).not.toBe('resequence');
  });

  it('只有两跳缺口（medium）→ 不构成结构性风险', () => {
    const s = deriveReplanSignal(input({
      gaps: [{ label: '数据结构基础', severity: 'medium' }],
      fragile: [],
      struggling: [],
    }));
    expect(s.recommendation).not.toBe('resequence');
  });

  it('学习者级疲劳 lf>=6 → 高危，建议减速', () => {
    const s = deriveReplanSignal(input({ lf: 7 }));
    expect(s.priority).toBe('high');
    expect(s.recommendation).toBe('slow_down');
  });

  // 2026-09-29：动作必须对准触发源。此前按「缺口/阻塞计数>0」挑派生动作，
  // 导致疲劳/失衡触发的高危也被配成 resequence——学习者拿到与自身状态无关的「重排路径」。
  it('失衡（lsb<0）触发高危 → 降速，不是「重排后续路径」', () => {
    const s = deriveReplanSignal(input({
      lsb: -1,
      // 同时存在脆弱点与 medium 缺口（每节课常态），但都不构成结构性风险
      fragile: ['a'],
      gaps: [{ label: 'b', severity: 'medium' }],
    }));
    expect(s.priority).toBe('high');
    expect(s.recommendation).toBe('slow_down');
    expect(s.scope).toBe('next_milestone');
  });

  it('结构性缺口 + 失衡同时存在 → 结构性缺口优先（重排后续）', () => {
    const s = deriveReplanSignal(input({
      lsb: -1,
      gaps: [{ label: '分组键唯一性', severity: 'high' }],
    }));
    expect(s.recommendation).toBe('resequence');
    expect(s.scope).toBe('downstream_path');
  });

  it('路径已完成 → 不建议（无可调整的下游）', () => {
    const s = deriveReplanSignal(input({
      gaps: [{ label: '分组键唯一性', severity: 'high' }],
      fragile: ['a'],
      completedTasks: 20,
      totalTasks: 20,
    }));
    expect(s.shouldSuggest).toBe(false);
    expect(s.recommendation).toBe('keep');
  });

  it('接近完成（90%）且无结构性风险 → 不再为收尾打断', () => {
    const s = deriveReplanSignal(input({
      completedTasks: 19,
      totalTasks: 20,
      fragile: ['a'],
    }));
    expect(s.shouldSuggest).toBe(false);
  });

  it('reasonCodes 仍上报全部信号（供观测，不因阈值收紧而失明）', () => {
    const s = deriveReplanSignal(input({
      fragile: ['a'],
      struggling: ['b'],
      gaps: [{ label: 'c', severity: 'medium' }],
    }));
    expect(s.reasonCodes).toContain('fragile_concepts');
    expect(s.reasonCodes).toContain('struggling_concepts');
  });
});
