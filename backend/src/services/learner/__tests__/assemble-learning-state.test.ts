/**
 * #155：无 active 路径（路径已完成/归档）时，assembleLearningState 不得把用户级画像整块置空。
 *
 * 旧实现：learning_paths 只查 active（:72），无 active → primaryPath=null → 直接返回
 * learnerSnapshot:null（:146/:153），于是 dashboard / learning-state-guidance / review 三个面
 * 都拿不到任何用户级画像（globalSignals 是跨路径并集，本不依赖具体路径）。
 *
 * 本测试锁定：无 active 路径但存在非 abandoned 路径时，回退该路径作结构锚点并构建快照；
 * 有 active 路径时行为不变（不走回退）；连非 abandoned 路径都没有时仍返回空快照。
 * #205：回退路径不得作画像锚点——快照以 scope:'global'、不传 pathId 构建（currentPath 不伪造），
 * 否则 summary 会给出指向「已下线不可继续学习」路径的 continue-learning/open-path。
 * 显式 pathId 同样只在该路径 status='active' 时才锚定（否则 archived/completed 路径仍会被伪造为 currentPath）。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findUnique: jest.fn() },
    learning_paths: { findMany: jest.fn(), findFirst: jest.fn() },
    subtasks: { findMany: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
  },
}));
jest.mock('../LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}));
jest.mock('../deadline-notify.service', () => ({
  notifyDeadlineBehindOnce: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../learning/learning-state.service', () => ({
  __esModule: true,
  default: {
    checkWarnings: jest.fn().mockResolvedValue([]),
    getCurrentStateDisplay: jest.fn().mockResolvedValue(null),
    generateDisplaySuggestion: jest.fn(),
  },
}));
jest.mock('../../ai-teaching/teaching-session-message-store', () => ({
  loadTeachingMessagesForIds: jest.fn().mockResolvedValue(new Map()),
}));

import { assembleLearningState } from '../assemble-learning-state';
import { learnerStateSummaryService } from '../LearnerStateSummaryService';
import { learnerSnapshotRefreshService } from '../LearnerSnapshotRefreshService';

const prisma = require('../../../config/database').default as {
  users: { findUnique: jest.Mock };
  learning_paths: { findMany: jest.Mock; findFirst: jest.Mock };
  subtasks: { findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
};
const refresh = learnerSnapshotRefreshService.refresh as unknown as jest.Mock;

const NOW = new Date('2026-10-01T10:00:00.000Z');

function pathRow(id: string, status: string) {
  return {
    id,
    userId: 'u1',
    title: id,
    name: id,
    status,
    deadline: null,
    updatedAt: NOW,
    milestones: [],
  };
}

describe('assembleLearningState · 无 active 路径不清零（#155）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.users.findUnique.mockResolvedValue({ id: 'u1', name: 'U', xp: 100 });
    prisma.learning_paths.findMany.mockResolvedValue([]);
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.subtasks.findMany.mockResolvedValue([]);
    refresh.mockResolvedValue({ knowledgeMemory: { globalSignals: {} } });
  });

  it('无 active 路径但存在归档路径时，回退该路径并构建 learnerSnapshot', async () => {
    prisma.learning_paths.findFirst.mockResolvedValue(pathRow('p1', 'archived'));

    const assembled = await assembleLearningState('u1', { snapshotScope: 'global' });

    expect(assembled).not.toBeNull();
    expect(assembled!.primaryPath?.id).toBe('p1');
    expect(assembled!.learnerSnapshot).toBeTruthy();
    // 回退路径被并入 paths，payload 口径自洽
    expect(assembled!.paths.map((p: any) => p.id)).toContain('p1');
    // 回退查询排除 abandoned
    expect(prisma.learning_paths.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: { not: 'abandoned' } } }),
    );
    // #205：回退路径只作结构锚点，不再传给快照——以 global 口径构建，currentPath 不伪造
    const refreshArg = refresh.mock.calls[0][0];
    expect(refreshArg.userId).toBe('u1');
    expect(refreshArg.pathId).toBeUndefined();
    expect(refreshArg.scope).toBe('global');
  });

  it('显式 pathId 指向非 active（archived）路径时，不锚定——仍走 global 口径（#205 复核第二轮）', async () => {
    prisma.learning_paths.findFirst
      .mockResolvedValueOnce(pathRow('p1', 'archived')) // 回退路径（结构锚点）
      .mockResolvedValueOnce(null); // 显式 pathId 非 active → 不锚定

    await assembleLearningState('u1', { snapshotScope: 'path', pathId: 'p9' });

    expect(prisma.learning_paths.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'p9', userId: 'u1', status: 'active' } }),
    );
    const refreshArg = refresh.mock.calls[0][0];
    expect(refreshArg.pathId).toBeUndefined();
    expect(refreshArg.scope).toBe('global');
  });

  it('显式 pathId 指向 active 路径时，按其口径锚定', async () => {
    prisma.learning_paths.findMany.mockResolvedValue([pathRow('ap', 'active')]);
    prisma.learning_paths.findFirst.mockResolvedValue({ id: 'p9' });

    await assembleLearningState('u1', { snapshotScope: 'path', pathId: 'p9' });

    const refreshArg = refresh.mock.calls[0][0];
    expect(refreshArg.pathId).toBe('p9');
    expect(refreshArg.scope).toBe('path');
  });

  it('有 active 路径时不走回退，行为与原先一致', async () => {
    prisma.learning_paths.findMany.mockResolvedValue([pathRow('ap', 'active')]);

    const assembled = await assembleLearningState('u1', { snapshotScope: 'global' });

    expect(prisma.learning_paths.findFirst).not.toHaveBeenCalled();
    expect(assembled!.primaryPath?.id).toBe('ap');
    expect(assembled!.learnerSnapshot).toBeTruthy();
  });

  it('连非 abandoned 路径都没有时仍返回空快照（不凭空造画像）', async () => {
    prisma.learning_paths.findFirst.mockResolvedValue(null);

    const assembled = await assembleLearningState('u1', { snapshotScope: 'global' });

    expect(assembled).not.toBeNull();
    expect(assembled!.primaryPath).toBeNull();
    expect(assembled!.learnerSnapshot).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * #188：同一载荷里曾有两套进度口径——learningState.tasks 数**全部路径**的 subtasks，
 * 而 summary.path.progressPercent（页面进度条）按**主路径**算。多路径用户的进度条与
 * 文案数字因此对不上，提示词也被硬绑到语义不同的那个源。
 */
describe('assembleLearningState · 进度口径统一到主路径（#188）', () => {
  function pathWithTasks(id: string, statuses: string[]) {
    return {
      id,
      userId: 'u1',
      title: id,
      name: id,
      status: 'active',
      deadline: null,
      updatedAt: NOW,
      milestones: [
        {
          id: `${id}-m1`,
          title: 'M1',
          stageNumber: 1,
          subtasks: statuses.map((status, index) => ({
            id: `${id}-t${index}`,
            title: `T${index}`,
            status,
            estimatedMinutes: 10,
            completedAt: null,
          })),
        },
      ],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.users.findUnique.mockResolvedValue({ id: 'u1', name: 'U', xp: 100 });
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    refresh.mockResolvedValue({
      dynamicState: {
        metrics: { lss: 4, ktl: 5, lf: 3, lsb: 1 },
        recentTrend: 'stable',
        fatigueRisk: 'low',
        recommendedPacing: 'moderate',
      },
      knowledgeMemory: {
        globalSignals: { masteredConcepts: [], fragileConcepts: [], strugglingConcepts: [] },
        globalBackground: {},
        // 快照的 currentPath 锚在主路径：4 个任务完成 1 个（= 25%）
        currentPath: {
          learningPathId: 'A',
          pathTitle: 'A',
          progress: { totalTasks: 4, completedTasks: 1 },
          currentPosition: { milestoneTitle: 'M1', taskTitle: 'T1' },
          prerequisiteGaps: [],
        },
      },
    });
    // 主路径 A：4 个任务完成 1 个；另一条 active 路径 B：3 个任务全完成
    prisma.learning_paths.findMany.mockResolvedValue([
      pathWithTasks('A', ['completed', 'in_progress', 'todo', 'todo']),
      pathWithTasks('B', ['completed', 'completed', 'completed']),
    ]);
    // 全量 subtasks 查询（跨路径）：修复前 tasks.* 由它派生 → total=7
    prisma.subtasks.findMany.mockResolvedValue([
      ...['completed', 'in_progress', 'todo', 'todo'].map((status) => ({ status, estimatedMinutes: 10, completedAt: null })),
      ...['completed', 'completed', 'completed'].map((status) => ({ status, estimatedMinutes: 10, completedAt: null })),
    ]);
  });

  it('tasks 只数主路径（不再是全路径总和），并显式声明口径', async () => {
    const assembled = await assembleLearningState('u1', { snapshotScope: 'path' });
    const tasks = assembled!.learningState.tasks as any;

    expect(tasks.scope).toBe('primary-path');
    expect(tasks.total).toBe(4);          // 修复前 = 7（A+B）
    expect(tasks.completed).toBe(1);      // 修复前 = 4
    expect(tasks.inProgress).toBe(1);
    expect(tasks.todo).toBe(2);
    expect(tasks.completionRate).toBe(25);
  });

  it('同一载荷内 tasks 派生值与 summary.path.progressPercent 同口径', async () => {
    const assembled = await assembleLearningState('u1', { snapshotScope: 'path' });
    const tasks = assembled!.learningState.tasks as any;
    const summary = learnerStateSummaryService.build({
      learnerSnapshot: assembled!.learnerSnapshot,
      learningState: assembled!.learningState,
      path: assembled!.primaryPath,
    });

    const fromTasks = tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0;
    expect(summary.path?.progressPercent).toBe(25);
    expect(fromTasks).toBe(summary.path!.progressPercent);
    // 时间块的进度与 tasks 同源（同一载荷只允许一套完成任务百分比）
    expect(assembled!.learningState.time.progress).toBe(tasks.completionRate);
    expect(assembled!.learningState.time.completionRate).toBe('25.0');
  });
});
