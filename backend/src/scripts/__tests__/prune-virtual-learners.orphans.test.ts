/**
 * prune-virtual-learners `--orphans` 计划契约（issue #90）
 *
 * 锁三件事：
 *  1. learningPathId 三张软指针表（virtual_sessions / goal_conversations / teaching_sessions）
 *     全部纳入孤儿清理；
 *  2. dry-run 计数与执行 SQL 分列：计数一律只读 SELECT，写语句只在 apply；
 *  3. 指针清理只置空（UPDATE ... SET learningPathId = NULL）、只清真正悬空（NOT EXISTS 指向
 *     learning_paths），不删行——行承载学习历史（stageResults 快照）。
 */
import { ORPHAN_CLEANUP, ORPHAN_POINTER_STEPS, orphanCountSql, orphanApplySql } from '../prune-virtual-learners';

describe('prune --orphans 计划（#90 悬空指针）', () => {
  it('覆盖三张 learningPathId 软指针表，且并入完整清理计划', () => {
    expect(ORPHAN_POINTER_STEPS.map((step) => step.label)).toEqual([
      'virtual_sessions.learningPathId',
      'goal_conversations.learningPathId',
      'teaching_sessions.learningPathId',
    ]);
    for (const step of ORPHAN_POINTER_STEPS) {
      expect(ORPHAN_CLEANUP).toContain(step);
    }
  });

  it('dry-run 计数 SQL 全部只读；执行 SQL 才是写语句', () => {
    for (const step of ORPHAN_CLEANUP) {
      expect(orphanCountSql(step)).toMatch(/^SELECT COUNT\(\*\) AS n FROM /);
      expect(orphanApplySql(step)).toMatch(/^(DELETE FROM|UPDATE) /);
    }
  });

  it('指针执行 SQL 只置空、不删行，且限定 NOT EXISTS 指向 learning_paths', () => {
    for (const step of ORPHAN_POINTER_STEPS) {
      const apply = orphanApplySql(step);
      expect(apply.startsWith('UPDATE ')).toBe(true);
      expect(apply).toContain('SET learningPathId = NULL');
      expect(apply).toContain('IS NOT NULL');
      expect(apply).toContain('NOT EXISTS (SELECT 1 FROM learning_paths');
    }
  });

  it('原有 6 项悬空子行清理不回归', () => {
    const labels = ORPHAN_CLEANUP.map((step) => step.label);
    for (const label of [
      'teaching_session_messages',
      'session_finalization_operations',
      'subtasks',
      'path_generation_stage_items',
      'path_generation_runs',
      'milestones',
    ]) {
      expect(labels).toContain(label);
    }
  });
});
