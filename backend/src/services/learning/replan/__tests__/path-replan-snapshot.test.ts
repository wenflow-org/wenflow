/**
 * 重排快照与回退单测（R8 选项 B：快照 + 一键回退）：
 * buildReplanContentSnapshot 原文保真 / appendReplanSnapshot LIFO 截断 /
 * buildRollbackPlan 三类语义（删除新增、按 id 还原、进度保护不倒退）。
 * 触发背景：重排此前只有 overwrite，旧安排永久消失（2026-09-29 审核实证）。
 */
import {
  buildReplanContentSnapshot,
  appendReplanSnapshot,
  readReplanSnapshots,
  latestReplanSnapshot,
  buildRollbackPlan,
  KEEP_LATEST_SNAPSHOTS,
} from '../path-replan-snapshot';

function fakeTasks(stage: number, defs: Array<[string, string, number]>) {
  return defs.map(([id, title, minutes], i) => ({
    id, title, description: `${title}-desc`, taskType: 'practice', estimatedMinutes: minutes,
    acceptanceCriteria: 'ok', order: i, status: 'todo', completedAt: null, rating: null,
    feedback: null, cognitiveLoad: 'medium', cognitiveLevel: 'understand', icapLevel: 'active',
    coreConcept: 'c1', linkedConceptId: 'concept-1', linkedConceptName: 'c1', conceptId: null,
    knowledgeType: 'concept', displayLabel: null, transferable: false, learningObjectives: null,
    annotationConfidence: null,
    milestoneStage: stage,
  }));
}

function fakeMilestone(stageNumber: number, tasks: Record<string, unknown>[]) {
  return {
    id: `ms-${stageNumber}`, stageNumber, title: `M${stageNumber} 原标题`, description: '原描述',
    goal: '原目标', estimatedHours: 5, status: 'unlocked', order: stageNumber - 1,
    coreConceptId: 'concept-1', coreConceptName: '原概念', conceptId: null, subtasks: tasks,
  };
}

const snapshotInput = () => ({
  pathId: 'lp_x',
  milestones: [
    fakeMilestone(1, fakeTasks(1, [['st_1_a', '旧任务A', 30], ['st_1_b', '旧任务B', 60]])),
    fakeMilestone(2, fakeTasks(2, [['st_2_a', '旧任务C', 45]])),
  ],
  reason: '前置缺口',
  triggerSource: 'ai-teaching',
  mode: 'overwrite',
  fromStageNumber: 1,
  pathEstimatedHours: 10,
});

describe('buildReplanContentSnapshot', () => {
  it('任务/阶段原文全量保真（分钟/顺序/概念绑定/完成态）', () => {
    const s = buildReplanContentSnapshot(snapshotInput());
    expect(s.id).toMatch(/^rps_/);
    expect(s.stageNumbers).toEqual([1, 2]);
    expect(s.priorTaskIds).toEqual(['st_1_a', 'st_1_b', 'st_2_a']);
    const t = s.milestones[0].subtasks[1];
    expect(t).toMatchObject({ id: 'st_1_b', title: '旧任务B', estimatedMinutes: 60, order: 1, status: 'todo' });
    expect(s.milestones[0].title).toBe('M1 原标题');
    expect(s.pathEstimatedHours).toBe(10);
  });

  it('已完成任务的 completedAt 被序列化为 ISO', () => {
    const m = fakeMilestone(1, fakeTasks(1, [['st_1_a', '旧任务A', 30]]));
    m.subtasks[0].status = 'completed';
    m.subtasks[0].completedAt = '2026-09-29T08:00:00.000Z';
    const s = buildReplanContentSnapshot({ pathId: 'lp_x', milestones: [m] });
    expect(s.milestones[0].subtasks[0].completedAt).toBe('2026-09-29T08:00:00.000Z');
  });
});

describe('appendReplanSnapshot / read / latest', () => {
  it('LIFO：最新在前；超过上限截断最旧', () => {
    let tpl: Record<string, unknown> | null = null;
    for (let i = 0; i < KEEP_LATEST_SNAPSHOTS + 2; i++) {
      tpl = appendReplanSnapshot(tpl, buildReplanContentSnapshot({
        ...snapshotInput(), snapshotId: `rps_${i}`,
      }));
    }
    const all = readReplanSnapshots(tpl);
    expect(all.length).toBe(KEEP_LATEST_SNAPSHOTS);
    expect(all[0].id).toBe(`rps_${KEEP_LATEST_SNAPSHOTS + 1}`);
    expect(latestReplanSnapshot(tpl)!.id).toBe(`rps_${KEEP_LATEST_SNAPSHOTS + 1}`);
    // 最旧的 KEEP_LATEST_SNAPSHOTS+1 条已被截断，只剩 1..N
    expect(latestReplanSnapshot(tpl, 'rps_1')).toBeNull();
    expect(latestReplanSnapshot(tpl, `rps_${KEEP_LATEST_SNAPSHOTS - 1}`)!.id).toBe(`rps_${KEEP_LATEST_SNAPSHOTS - 1}`);
  });

  it('坏模板/坏条目宽容', () => {
    expect(readReplanSnapshots(null)).toEqual([]);
    expect(readReplanSnapshots({ replanSnapshots: 'oops' })).toEqual([]);
    expect(readReplanSnapshots({ replanSnapshots: [null, {}, { id: 'x' }] })).toEqual([]);
  });
});

describe('buildRollbackPlan', () => {
  const snapshot = () => buildReplanContentSnapshot(snapshotInput());

  it('删除重排新增、按 id 还原旧任务', () => {
    const current = [
      fakeMilestone(1, [
        ...fakeTasks(1, [['st_1_new1', '重排新增1', 30], ['st_1_new2', '重排新增2', 45]]),
        // 旧任务A 保留（同 id）
        { ...fakeTasks(1, [['st_1_a', '旧任务A（被改写）', 90]])[0] },
      ]),
      fakeMilestone(2, []),
    ];
    const plan = buildRollbackPlan(snapshot(), current);
    expect(plan.taskIdsToDelete.sort()).toEqual(['st_1_new1', 'st_1_new2']);
    const restoredA = plan.tasksToRestore.find((t) => t.id === 'st_1_a')!;
    expect(restoredA.title).toBe('旧任务A');
    expect(restoredA.estimatedMinutes).toBe(30);
    expect(plan.pathEstimatedHoursAfter).toBe(3); // 30+60+45=135min
    expect(plan.warnings).toEqual([]);
  });

  it('进度保护：现任务 completed 而快照是 todo → 回退保留 completed', () => {
    const current = [
      fakeMilestone(1, (() => {
        const t = fakeTasks(1, [['st_1_a', '旧任务A', 30]])[0];
        t.status = 'completed';
        t.completedAt = '2026-09-29T09:00:00.000Z';
        return [t];
      })()),
      fakeMilestone(2, []),
    ];
    const plan = buildRollbackPlan(snapshot(), current);
    const restoredA = plan.tasksToRestore.find((t) => t.id === 'st_1_a')!;
    expect(restoredA.status).toBe('completed');
    expect(restoredA.completedAt).toBe('2026-09-29T09:00:00.000Z');
    expect(plan.warnings.join(' ')).toMatch(/完成进度/);
  });

  it('阶段缺失宽容：告警并跳过该阶段的任务清理', () => {
    const plan = buildRollbackPlan(snapshot(), [fakeMilestone(1, [])]);
    expect(plan.warnings.join(' ')).toMatch(/阶段 2/);
    expect(plan.taskIdsToDelete).toEqual([]);
  });
});
