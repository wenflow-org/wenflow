/**
 * #212 并发 confirm 留下用户可见 failed 占位路径（回归）：
 * bindGeneratingPath 的 CAS 失配分支必须**删除**本条占位路径（而不是只标 failed），
 * 这样并发确认的落败方不会在 learning_paths 里留下一条打不开的「个性化学习路径」。
 */
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockDeletePath = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: {
      delete: (...args: unknown[]) => mockDeletePath(...args),
    },
  },
}));

jest.mock('../../learning/learning.service', () => ({
  __esModule: true,
  default: {
    claimPathCoreGeneration: (...args: unknown[]) => mockClaimPathCoreGeneration(...args),
    markActiveGenerationFailed: (...args: unknown[]) => mockMarkActiveGenerationFailed(...args),
  },
}));

jest.mock('../../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: { runGoalAsync: jest.fn(), generateFromGoal: jest.fn() },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { bindGeneratingPath, type GoalConversationRejudgeDeps } from '../goal-conversation-rejudge';

function makeDeps(overrides: Partial<GoalConversationRejudgeDeps> = {}): GoalConversationRejudgeDeps {
  return {
    createGeneratingPlaceholderPath: jest.fn(async () => ({ id: 'lp-loser' })),
    updateConversationLifecycle: jest.fn(async () => false),
    buildGoalPathRequest: jest.fn(),
    callAI: jest.fn(),
    withConversationId: jest.fn(),
    getStructuredOutputValid: jest.fn(),
    throwStructuredOutputInvalid: jest.fn(),
    saveMessage: jest.fn(),
    getGoalExt: jest.fn(() => ({})),
    updateCollectedData: jest.fn(),
    buildConfirmedResult: jest.fn(),
    ...overrides,
  } as unknown as GoalConversationRejudgeDeps;
}

const input = {
  conversation: { id: 'conv-1' },
  data: { understanding: {}, collected: {} } as Record<string, unknown>,
  expectedRevision: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
  mockDeletePath.mockResolvedValue({});
});

describe('#212 bindGeneratingPath：CAS 落败方不留占位路径', () => {
  it('CAS 失配 → 删除本条占位路径，且不调用 markActiveGenerationFailed', async () => {
    const deps = makeDeps();

    const result = await bindGeneratingPath(deps, input);

    expect(result.bound).toBe(false);
    expect(deps.createGeneratingPlaceholderPath).toHaveBeenCalledTimes(1);
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('lp-loser', null);
    // 关键：删除而不是只标 failed——failed 行会出现在 GET /api/learning/paths
    expect(mockDeletePath).toHaveBeenCalledWith({ where: { id: 'lp-loser' } });
    expect(mockMarkActiveGenerationFailed).not.toHaveBeenCalled();
  });

  it('CAS 命中 → 不删除占位路径，路径与 run 正常返回', async () => {
    const deps = makeDeps({ updateConversationLifecycle: jest.fn(async () => true) });

    const result = await bindGeneratingPath(deps, input);

    expect(result.bound).toBe(true);
    expect(result.placeholderPath).toEqual({ id: 'lp-loser' });
    expect(result.runId).toBe('run-1');
    expect(mockDeletePath).not.toHaveBeenCalled();
  });

  it('删除失败 → 退回标记 failed（避免生成中占位被 stale 恢复成真路径）', async () => {
    mockDeletePath.mockRejectedValue(new Error('db busy'));
    const deps = makeDeps();

    const result = await bindGeneratingPath(deps, input);

    expect(result.bound).toBe(false);
    expect(mockMarkActiveGenerationFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkActiveGenerationFailed.mock.calls[0][0]).toBe('lp-loser');
  });
});

/**
 * #175 实例 1 回归：`kickPathGeneration` 里「准备请求」抛错必须**就地**置该 run 失败。
 *
 * 病灶：`buildGoalPathRequest` 原先写在 `runGoalAsync` 的实参展开里，先于投递求值，
 * 一抛错就逃出 kick（onError 只覆盖异步运行失败，调用方 catch 只 rethrow）→
 * 会话 completed 而路径停在 generating，用户吃 500，要等 5 分钟租约过期才被 stale 恢复兜住。
 */
describe('#175-1 kickPathGeneration：请求准备失败就地置失败', () => {
  it('buildGoalPathRequest 抛错 → 调 markActiveGenerationFailed 且不投递生成', async () => {
    const pathCoordinator = require('../../../coordinators/path.coordinator').default;
    mockMarkActiveGenerationFailed.mockClear();
    pathCoordinator.runGoalAsync.mockClear();

    const deps = makeDeps({
      buildGoalPathRequest: jest.fn(async () => {
        throw new Error('seed payload unavailable');
      }),
    });

    const { kickPathGeneration } = require('../goal-conversation-rejudge');
    await kickPathGeneration(deps, {
      conversation: { id: 'conv-1' },
      seedResult: { ok: true },
      pathId: 'lp-kick',
      runId: 'run-kick',
    });

    expect(mockMarkActiveGenerationFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkActiveGenerationFailed.mock.calls[0][0]).toBe('lp-kick');
    expect(mockMarkActiveGenerationFailed.mock.calls[0][2]).toBe('run-kick');
    // 准备都没成功，不该投递一次注定失败的生成
    expect(pathCoordinator.runGoalAsync).not.toHaveBeenCalled();
  });

  it('准备成功 → 正常投递，且不误标失败', async () => {
    const pathCoordinator = require('../../../coordinators/path.coordinator').default;
    mockMarkActiveGenerationFailed.mockClear();
    pathCoordinator.runGoalAsync.mockClear();

    const deps = makeDeps({
      buildGoalPathRequest: jest.fn(async () => ({ goal: { subject: '测试' } } as never)),
    });

    const { kickPathGeneration } = require('../goal-conversation-rejudge');
    await kickPathGeneration(deps, {
      conversation: { id: 'conv-1' },
      seedResult: { ok: true },
      pathId: 'lp-kick',
      runId: 'run-kick',
    });

    expect(mockMarkActiveGenerationFailed).not.toHaveBeenCalled();
    expect(pathCoordinator.runGoalAsync).toHaveBeenCalledTimes(1);
    const [request] = pathCoordinator.runGoalAsync.mock.calls[0];
    expect(request.generationRunId).toBe('run-kick');
    expect(request.createdPlaceholder).toBe(true);
  });
});
