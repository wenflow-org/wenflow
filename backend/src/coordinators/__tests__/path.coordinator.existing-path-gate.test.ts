/**
 * #227：既有路径的闸门（`pathCoordinator.runAsync` → `generate`）跑**真实**凭证解析
 * （`resolveGoalTriageEvidenceForPathId` 读桩掉的 DB）与**真实**闸门，只桩掉生成侧。
 *
 * 这是根因所在的唯一守卫：此前 `if (!input.existingPathId) assertPathGenerationAllowed(...)`
 * 让「带 existingPathId」整条跳过判定。本文件证明空壳路径（POST /paths 建、无 goal 产物）
 * 走既有路径入口时不再进入 `learningService.generateLearningPath`（即不会落库里程碑），
 * 而携带服务端判定投影的路径照常生成。
 */
const mockGenerateLearningPath = jest.fn();
const mockRunBackgroundTask = jest.fn();
const mockIsAccepting = jest.fn(() => true);
const mockPathFindFirst = jest.fn();
const mockGoalFindFirst = jest.fn();

jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { generateLearningPath: mockGenerateLearningPath }
}));
jest.mock('../../services/background-task-tracker.service', () => ({
  runBackgroundTask: mockRunBackgroundTask,
  backgroundTaskTracker: { isAccepting: mockIsAccepting },
  BackgroundTaskRejectedError: class BackgroundTaskRejectedError extends Error {}
}));
jest.mock('../../services/agentConfig.service', () => ({
  getPathAgentInputConfig: jest.fn()
}));
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findFirst: (...args: unknown[]) => mockPathFindFirst(...args) },
    goal_conversations: { findFirst: (...args: unknown[]) => mockGoalFindFirst(...args) },
  }
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

import { pathCoordinator } from '../path.coordinator';
import { MANUAL_PATH_PROMPT_TEMPLATE } from '../../services/learning/path-generation-gate';

const WEDDING = '三个月后在婚礼上自弹自唱一首民谣吉他';

function pathRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lp_shell',
    userId: 'user-1',
    aiPromptTemplate: MANUAL_PATH_PROMPT_TEMPLATE,
    description: WEDDING,
    title: '婚礼弹唱计划',
    name: '婚礼弹唱计划',
    ...overrides,
  };
}

describe('既有路径的闸门（#227）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAccepting.mockReturnValue(true);
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' });
    mockGoalFindFirst.mockResolvedValue(null);
  });

  it('空壳路径（无 goal 产物、无关联会话）→ GOAL_TRIAGE_REQUIRED，不进入 generation', async () => {
    mockPathFindFirst.mockResolvedValue(pathRow());
    const onError = jest.fn().mockResolvedValue(undefined);

    pathCoordinator.runAsync(
      { userId: 'user-1', description: WEDDING, existingPathId: 'lp_shell' },
      { onError }
    );

    const task = mockRunBackgroundTask.mock.calls[0][1];
    await expect(task()).rejects.toThrow(/目标判定结论/);
    expect(mockGenerateLearningPath).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('既有路径自带服务端判定投影 → 放行，照常进入 generation', async () => {
    mockPathFindFirst.mockResolvedValue(pathRow({
      id: 'lp_goal',
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: {
          rawGoal: '学会 TypeScript',
          visibleSummary: { platformJudgment: 'judgeable_output', skillNature: 'tool_operation' },
        },
      }),
    }));

    pathCoordinator.runAsync(
      { userId: 'user-1', description: 'TypeScript 学习', existingPathId: 'lp_goal' }
    );

    const task = mockRunBackgroundTask.mock.calls[0][1];
    await task();
    expect(mockGenerateLearningPath).toHaveBeenCalledTimes(1);
  });

  it('既有路径的判定是硬阻断（not_judgeable × 实体内化）→ 不放行', async () => {
    mockPathFindFirst.mockResolvedValue(pathRow({
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: {
          rawGoal: WEDDING,
          visibleSummary: { platformJudgment: 'not_judgeable', skillNature: 'physical_internalized' },
        },
      }),
    }));
    const onError = jest.fn().mockResolvedValue(undefined);

    pathCoordinator.runAsync(
      { userId: 'user-1', description: WEDDING, existingPathId: 'lp_shell' },
      { onError }
    );

    const task = mockRunBackgroundTask.mock.calls[0][1];
    await expect(task()).rejects.toThrow(/这类目标当前不会生成学习路径/);
    expect(mockGenerateLearningPath).not.toHaveBeenCalled();
  });

  it('关联目标会话有判定字段（旧数据路径）→ 放行，照常进入 generation', async () => {
    mockPathFindFirst.mockResolvedValue(pathRow({ aiPromptTemplate: null }));
    mockGoalFindFirst.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      description: WEDDING,
      stage: 'completed',
      status: 'completed',
      collectedData: JSON.stringify({
        understanding: {
          surface_goal: '三个月后在婚礼上自弹自唱一首民谣',
          platform_judgment: 'judgeable_output',
          skill_nature: 'tool_operation',
          primary_block_type: 'capability',
        },
      }),
    });

    pathCoordinator.runAsync(
      { userId: 'user-1', description: WEDDING, existingPathId: 'lp_shell' }
    );

    const task = mockRunBackgroundTask.mock.calls[0][1];
    await task();
    expect(mockGenerateLearningPath).toHaveBeenCalledTimes(1);
  });
});
