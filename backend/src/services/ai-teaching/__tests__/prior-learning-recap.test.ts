import { fetchPriorLearningRecap } from '../TeachingContextBuilder';

// TeachingContextBuilder 顶层 import 的模块不触发真实 DB（仅实例/函数定义），
// 这里只 mock prisma 用到的模型方法，验证「按路径位置接续前序」的选源优先级。
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    milestones: { findMany: jest.fn() },
    subtasks: { findMany: jest.fn() },
    teaching_sessions: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const prisma = require('../../../config/database').default as any;

function wrapup(summary: string, knowledgeItems: any[] = [], actionPlan: string[] = []) {
  return {
    topicSummary: summary,
    knowledgeItems,
    actionPlan,
  };
}

describe('fetchPriorLearningRecap（按路径位置接续前序）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.milestones.findMany.mockReset();
    prisma.subtasks.findMany.mockReset();
    prisma.teaching_sessions.findMany.mockReset();
    prisma.teaching_sessions.findFirst.mockReset();
  });

  const base = {
    userId: 'user-1',
    learningPathId: 'path-1',
    currentMilestoneId: 'ms-2',
    currentTaskId: 'task-b',
    currentStageNumber: 2,
    milestoneTitle: '第二阶段',
  };

  function mockMilestones() {
    prisma.milestones.findMany.mockResolvedValue([
      { id: 'ms-1', stageNumber: 1, title: '第一阶段' },
      { id: 'ms-2', stageNumber: 2, title: '第二阶段' },
      { id: 'ms-3', stageNumber: 3, title: '第三阶段' },
    ]);
  }

  function mockTasksInMilestone(tasks: Array<{ id: string; title: string }>) {
    prisma.subtasks.findMany.mockResolvedValue(tasks);
  }

  it('优先接续同阶段前一任务（same-milestone-prev-task）', async () => {
    mockMilestones();
    mockTasksInMilestone([
      { id: 'task-a', title: '任务A' },
      { id: 'task-b', title: '任务B' },
    ]);
    prisma.teaching_sessions.findMany.mockResolvedValue([]); // 同任务历史为空
    prisma.teaching_sessions.findFirst.mockResolvedValue({
      topic: '任务A',
      wrapup: JSON.stringify(wrapup('任务A总结', [
        { name: '概念X', status: 'learning', progress: 60, evidence: '' },
        { name: '概念Y', status: 'mastered', progress: 100, evidence: '' },
      ], ['继续完成练习'])),
    });

    const { recap } = await fetchPriorLearningRecap(base);
    expect(recap?.relation).toBe('same-milestone-prev-task');
    expect(recap?.sourceTaskTitle).toBe('任务A');
    expect(recap?.unresolvedPoints).toEqual(['概念X']);
    expect(recap?.retrievalCue).toBe('继续完成练习');
    // 同任务历史空 → sameTaskHistory undefined
    expect(recap?.sameTaskHistory).toBeUndefined();
  });

  it('同阶段无前一任务时接续上一阶段（prev-milestone）', async () => {
    mockMilestones();
    mockTasksInMilestone([{ id: 'task-b', title: '任务B' }]); // 第一个任务，无前一任务
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    // 同 milestone 前一任务查询（subtasks findMany 被 tasks mock 消费），
    // 上一阶段的任务列表与最近完成课
    prisma.subtasks.findMany.mockResolvedValue([{ id: 'task-a1', title: '任务A1' }]);
    prisma.teaching_sessions.findFirst.mockResolvedValue({
      topic: '任务A1',
      wrapup: JSON.stringify(wrapup('上一阶段总结', [], [])),
    });

    const { recap } = await fetchPriorLearningRecap(base);
    expect(recap?.relation).toBe('prev-milestone');
    expect(recap?.sourceMilestoneTitle).toBe('第一阶段');
    expect(recap?.sourceStageNumber).toBe(1);
  });

  it('同任务学过多轮时接续同任务历史（same-task），并带 attemptCount', async () => {
    mockMilestones();
    mockTasksInMilestone([{ id: 'task-b', title: '任务B' }]);
    // 同任务历史：2 轮 completed
    prisma.teaching_sessions.findMany.mockResolvedValue([
      {
        topic: '任务B',
        status: 'completed',
        endTime: new Date('2026-09-01T10:00:00Z'),
        wrapup: JSON.stringify(wrapup('上次学到这里', [
          { name: '难点Z', status: 'learning', progress: 40, evidence: '' },
        ], ['下次先复习难点Z'])),
      },
      {
        topic: '任务B',
        status: 'completed',
        endTime: new Date('2026-08-30T10:00:00Z'),
        wrapup: JSON.stringify(wrapup('更早一次')),
      },
    ]);
    // 前一任务查询无结果（同阶段第一个任务 / 无完成课）→ 落到同任务
    prisma.subtasks.findMany.mockResolvedValue([{ id: 'task-b', title: '任务B' }]);
    prisma.teaching_sessions.findFirst.mockResolvedValue(null);

    const { recap, sameTaskSessions } = await fetchPriorLearningRecap(base);
    expect(sameTaskSessions).toBe(2);
    expect(recap?.relation).toBe('same-task');
    expect(recap?.sameTaskHistory?.attemptCount).toBe(2);
    expect(recap?.sameTaskHistory?.lastUnresolvedPoints).toEqual(['难点Z']);
  });

  it('无任何前序时回退最近任意完成课（last-any）', async () => {
    mockMilestones();
    mockTasksInMilestone([{ id: 'task-b', title: '任务B' }]);
    prisma.teaching_sessions.findMany.mockReset().mockResolvedValue([]);
    prisma.subtasks.findMany.mockReset().mockResolvedValue([{ id: 'task-other', title: '其它阶段任务' }]);
    prisma.teaching_sessions.findFirst.mockReset()
      .mockResolvedValueOnce(null)  // 上一阶段无完成课
      .mockResolvedValueOnce({      // last-any 兜底
        topic: '早前课程',
        wrapup: JSON.stringify(wrapup('很久以前的课')),
      });

    const { recap } = await fetchPriorLearningRecap(base);
    expect(recap?.relation).toBe('last-any');
  });

  it('完全无历史时返回 null', async () => {
    mockMilestones();
    mockTasksInMilestone([{ id: 'task-b', title: '任务B' }]);
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.subtasks.findMany.mockResolvedValue([]);
    prisma.teaching_sessions.findFirst.mockResolvedValue(null);

    const { recap } = await fetchPriorLearningRecap(base);
    expect(recap).toBeNull();
  });
});
