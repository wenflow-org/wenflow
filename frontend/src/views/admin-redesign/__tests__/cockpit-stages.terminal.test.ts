/**
 * 阶段推进判定的终态语义（cockpitStages.useCockpitStages）。
 *
 * 回归来源（2026-10-08 develop 走查 d-session-vl）：虚拟会话 156f6cd2 状态 abandoned、
 * 停在 currentStage=path，接口响应里没有 stageStatus。旧判据
 *   `st === 'learning' && (isTerminal || learning?.wrapup)`
 * 让 Learn 因为「会话已终止」而判完成，于是阶段条同屏出现
 *   ✓ Goal → Path 进行中 → ✓ Learn 0/6 课已完成
 * ——后一阶段已完成、前一阶段仍进行中。此处锁定：终止 ≠ 学完。
 */
import { describe, expect, it } from 'vitest';
import { computed, type ComputedRef } from 'vue';
import { useCockpitStages } from '../cockpitStages';
import type { PathMilestoneView } from '../cockpitPathViews';
import type { LearnLesson } from '../cockpitLessons';

type Deps = Parameters<typeof useCockpitStages>[0];

/** 只填与判定相关的字段，其余取空值；调用方按需覆盖。 */
function build(over: Partial<Record<keyof Deps, ComputedRef<unknown>>> = {}) {
  const base: Record<keyof Deps, ComputedRef<unknown>> = {
    currentStage: computed(() => 'path'),
    bindings: computed(() => ({}) as Record<string, unknown>),
    stageStatus: computed(() => ({}) as Record<string, Record<string, unknown>>),
    stageResults: computed(() => ({}) as Record<string, unknown>),
    isTerminal: computed(() => false),
    isFailedTerminal: computed(() => false),
    hasWrapup: computed(() => false),
    goalConversationMessages: computed(() => [] as Array<{ role: string; content: string }>),
    pathStatusPath: computed(() => ({}) as Record<string, unknown>),
    pathMilestonesView: computed(() => [] as PathMilestoneView[]),
    learnLessons: computed(() => [] as LearnLesson[])
  };
  return useCockpitStages({ ...base, ...over } as unknown as Deps);
}

/** 6 门课、全未完成——对齐走查现场 Learn 副标的 0/6。 */
function untouchedLessons(total: number): LearnLesson[] {
  return Array.from({ length: total }, (_, i) => ({
    taskId: `t${i}`,
    title: `第 ${i + 1} 课`,
    milestone: 'm1',
    state: 'pending' as const,
    teachingSessionId: ''
  }));
}

describe('useCockpitStages 终态语义', () => {
  it('已放弃、停在 Path：Learn 不得判完成（回归 d-session-vl）', () => {
    const s = build({
      currentStage: computed(() => 'path'),
      isTerminal: computed(() => true),
      isFailedTerminal: computed(() => true),
      learnLessons: computed(() => untouchedLessons(6))
    });

    expect(s.stageDone('learning')).toBe(false);
    // 副标仍是真实的 0/6，只是不再与勾同时出现
    expect(s.stageProgress('learning')).toBe('0/6 课已完成');
  });

  it('已放弃、停在 Path：已走过的 Goal 仍判完成（不误伤）', () => {
    const s = build({
      currentStage: computed(() => 'path'),
      isTerminal: computed(() => true),
      isFailedTerminal: computed(() => true)
    });

    expect(s.stageDone('goal')).toBe(true);
    // 终止点所在阶段由 isFailedTerminal 拦住，不伪装成完成
    expect(s.stageDone('path')).toBe(false);
  });

  it('失败终态停在 Learn：Learn 本身不判完成', () => {
    const s = build({
      currentStage: computed(() => 'learning'),
      isTerminal: computed(() => true),
      isFailedTerminal: computed(() => true)
    });

    expect(s.stageDone('learning')).toBe(false);
    expect(s.stageDone('goal')).toBe(true);
    expect(s.stageDone('path')).toBe(true);
  });

  it('正常完成（completed，停在 Learn）：Learn 判完成', () => {
    const s = build({
      currentStage: computed(() => 'learning'),
      isTerminal: computed(() => true),
      isFailedTerminal: computed(() => false)
    });

    expect(s.stageDone('learning')).toBe(true);
  });

  it('确实写出学习总结：Learn 判完成（保留的唯一正向证据）', () => {
    const s = build({
      currentStage: computed(() => 'learning'),
      stageStatus: computed(() => ({ learning: { wrapup: true } }))
    });

    expect(s.stageDone('learning')).toBe(true);
  });

  it('已放弃、停在 Goal：Learn 与 Path 都不判完成', () => {
    const s = build({
      currentStage: computed(() => 'goal'),
      isTerminal: computed(() => true),
      isFailedTerminal: computed(() => true)
    });

    expect(s.stageDone('path')).toBe(false);
    expect(s.stageDone('learning')).toBe(false);
  });
});
