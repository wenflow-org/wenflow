/**
 * 渐进式设计 DTO 归一化回归（2026-11-21）。
 *
 * - 学习进度（learningProgress）只数真实任务，与设计进度分离；
 * - 设计进度 `design.active` 只在 queued/processing 时为 true（stale/failed/ready 停表）；
 * - 路径「已有阶段可学」时，后续设计失败也不把整条路径降级成 failed、不抹掉学习进度。
 */
import { describe, expect, it } from 'vitest';
import { mergeGenerationLifecycle, normalizeGenerationLifecycle } from '../learning';

const stages = [
  { subtasks: [{ status: 'completed' }, { status: 'in_progress' }] },
  { tasks: [{ status: 'completed' }, { status: 'completed' }] },
  { subtasks: [] },
];

describe('normalizeGenerationLifecycle · 权威学习进度', () => {
  it('后端未给 learningProgress 时按任务状态确定性推导（只数真实任务）', () => {
    const lc = normalizeGenerationLifecycle({
      phase: 'stage_design',
      status: 'processing',
      canStartLearning: true,
      milestones: stages,
    });

    expect(lc.learningProgress).toEqual({
      completedTasks: 3,
      startedTasks: 4,
      inProgressTasks: 1,
      totalTasks: 4,
      completedStages: 1,
      totalStages: 3,
      percent: 75,
    });
  });

  it('后端已给 learningProgress 时以其为准（不在前端重新估算）', () => {
    const lc = normalizeGenerationLifecycle({
      phase: 'stage_design',
      status: 'processing',
      canStartLearning: true,
      learningProgress: {
        totalTasks: 10,
        completedTasks: 4,
        inProgressTasks: 2,
        startedTasks: 6,
        completedStages: 2,
        totalStages: 5,
        percent: 40,
      },
      milestones: stages,
    });

    expect(lc.learningProgress).toEqual({
      completedTasks: 4,
      startedTasks: 6,
      inProgressTasks: 2,
      totalTasks: 10,
      completedStages: 2,
      totalStages: 5,
      percent: 40,
    });
  });

  it('percent 被夹在 0-100；脏 completed 不会超过 total', () => {
    const lc = normalizeGenerationLifecycle({
      phase: 'stage_design',
      status: 'processing',
      learningProgress: { totalTasks: 2, completedTasks: 9, percent: 180 },
    });
    expect(lc.learningProgress.completedTasks).toBe(2);
    expect(lc.learningProgress.percent).toBe(100);
  });
});

describe('normalizeGenerationLifecycle · 设计进度', () => {
  it('queued/processing 时 active=true，并透传 design 明细', () => {
    const lc = normalizeGenerationLifecycle({
      phase: 'stage_design',
      status: 'processing',
      design: {
        active: true,
        status: 'processing',
        progressive: true,
        completedStages: 2,
        totalStages: 5,
        designedStages: 2,
        totalPathStages: 6,
      },
    });

    expect(lc.design).toMatchObject({
      active: true,
      status: 'processing',
      phase: 'stage_design',
      progressive: true,
      completedStages: 2,
      totalStages: 5,
      designedStages: 2,
      totalPathStages: 6,
    });
  });

  it('status=running 不是轮询依据（回归：通知中心曾把它当进行中）', () => {
    const lc = normalizeGenerationLifecycle({
      status: 'active',
      generationLifecycle: { phase: 'stage_design', status: 'running' },
    });

    expect(lc.design.active).toBe(false);
    expect(lc.design.status).toBeNull();
  });

  it('设计失败但已有阶段可学：active=false，学习不阻塞', () => {
    const lc = normalizeGenerationLifecycle({
      phase: 'stage_design',
      status: 'failed',
      canStartLearning: true,
      milestones: stages,
    });

    expect(lc.design.active).toBe(false);
    expect(lc.design.status).toBeNull();
    expect(lc.canStartLearning).toBe(true);
  });
});

describe('mergeGenerationLifecycle · 渐进式失败不吞学习进度', () => {
  it('可学路径后续设计失败：路径仍 active，清掉 learningBlockedReason', () => {
    const merged = mergeGenerationLifecycle(
      { id: 'lp_1', status: 'active', learningBlockedReason: '等待课程准备' } as never,
      { phase: 'stage_design', status: 'failed', canStartLearning: true, errorMessage: '后续阶段设计失败', milestones: stages }
    );

    expect(merged.status).toBe('active');
    expect(merged.canStartLearning).toBe(true);
    expect(merged.learningBlockedReason).toBeNull();
    expect(merged.generationLifecycle?.design.active).toBe(false);
  });

  it('不可学且设计失败：路径落 failed（仍然是真失败）', () => {
    const merged = mergeGenerationLifecycle(
      { id: 'lp_2', status: 'active' } as never,
      { phase: 'stage_design', status: 'failed', canStartLearning: false }
    );

    expect(merged.status).toBe('failed');
    expect(merged.canStartLearning).toBe(false);
  });
});
