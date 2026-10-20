/**
 * 同课多会话的课堂映射分级（cockpitLessons.buildLearnLessons）。
 *
 * 回归来源（2026-10-12 总结页走查）：真实路径一节课留下 10 条教学会话（9 discarded +
 * 1 timeout），旧实现 last-write-wins 把课映射到无总结的废弃会话——总结页展开只见
 * 「该课暂无可显示的总结」。分级取优：completed（全量总结）> timeout / finalization_failed
 * （课堂发生过，常有 summary-only 降级总结）> 其余；同分保持先到（后端历史新→旧，先到=最新）。
 */
import { describe, expect, it } from 'vitest';
import { buildLearnLessons, type TeachHistoryItem } from '../cockpitLessons';
import type { PathMilestoneView } from '../cockpitPathViews';

const milestones: PathMilestoneView[] = [
  {
    stageNumber: 1,
    title: 'M1',
    description: '',
    estimatedHours: null,
    tasks: [{ id: 'task_1', title: '第1课', completed: true, current: false }]
  }
];

const CURRENT = { currentTaskId: '', currentTeachingId: '', runtimeStatus: '' };

function lessons(history: TeachHistoryItem[]) {
  return buildLearnLessons(milestones, history, CURRENT);
}

describe('buildLearnLessons：同课多会话的课堂映射分级', () => {
  it('discarded 重试在前也不遮蔽 completed 会话', () => {
    const result = lessons([
      { id: 'ts_disc_1', taskId: 'task_1', taskTitle: '', status: 'discarded' },
      { id: 'ts_disc_2', taskId: 'task_1', taskTitle: '', status: 'discarded' },
      { id: 'ts_done', taskId: 'task_1', taskTitle: '', status: 'completed' }
    ]);
    expect(result[0].teachingSessionId).toBe('ts_done');
  });

  it('无 completed 时 timeout（summary-only 降级总结常挂在它身上）优先于 discarded', () => {
    const result = lessons([
      { id: 'ts_disc', taskId: 'task_1', taskTitle: '', status: 'discarded' },
      { id: 'ts_tmo', taskId: 'task_1', taskTitle: '', status: 'timeout' },
      { id: 'ts_disc_2', taskId: 'task_1', taskTitle: '', status: 'discarded' }
    ]);
    expect(result[0].teachingSessionId).toBe('ts_tmo');
  });

  it('全为 discarded 时取最新一条（历史新→旧，先到=最新）', () => {
    const result = lessons([
      { id: 'ts_disc_new', taskId: 'task_1', taskTitle: '', status: 'discarded' },
      { id: 'ts_disc_old', taskId: 'task_1', taskTitle: '', status: 'discarded' }
    ]);
    expect(result[0].teachingSessionId).toBe('ts_disc_new');
  });

  it('hasSummary 随所选会话终态：completed / timeout / finalization_failed 算有总结', () => {
    expect(lessons([{ id: 'ts_done', taskId: 'task_1', taskTitle: '', status: 'completed' }])[0].hasSummary).toBe(true);
    expect(lessons([{ id: 'ts_tmo', taskId: 'task_1', taskTitle: '', status: 'timeout' }])[0].hasSummary).toBe(true);
    expect(
      lessons([{ id: 'ts_fail', taskId: 'task_1', taskTitle: '', status: 'finalization_failed' }])[0].hasSummary
    ).toBe(true);
  });

  it('hasSummary：只有 discarded（中断重试）的课不算已生成总结', () => {
    const result = lessons([{ id: 'ts_disc', taskId: 'task_1', taskTitle: '', status: 'discarded' }]);
    expect(result[0].teachingSessionId).toBe('ts_disc');
    expect(result[0].hasSummary).toBe(false);
  });
});
