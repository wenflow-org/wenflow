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
