/**
 * #250：「当前路径没有可重设计的阶段」是可预期的业务前置条件，不能落 500。
 *
 * 现场：空壳路径 / 全部阶段已完成的路径调 POST /replan（非 preview）→ 裸 Error 落
 * http-app 的 500 INTERNAL_ERROR；同一状态 previewOnly:true 却是 200 no-signal。
 * 修复后该条件具名为 PathReplanNoTargetStageError（status=409 + PATH_ code），
 * 被路由的 isPathMutationConflictError 认出并回 409；有可重设计阶段时行为不变。
 */
const mockFindUnique = jest.fn();

jest.mock('../../../../config/database', () => ({
  __esModule: true,
  default: { learning_paths: { findUnique: mockFindUnique } },
}));
jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn(async () => ({ replanSignal: { shouldSuggest: false } })) },
}));
jest.mock('../../../learner/LearnerProjectionService', () => ({
  learnerProjectionService: {
    toReplanProjection: jest.fn(() => ({
      path: { currentPosition: { milestoneTitle: 'M1' } },
      mastery: { stableConcepts: [], fragileConcepts: [], strugglingConcepts: [] },
      risk: { prerequisiteGaps: [] },
    })),
  },
}));
jest.mock('../../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: jest.fn() },
}));

import { requestPathReplan, PathReplanNoTargetStageError } from '../path-replan.service';
import { isPathMutationConflictError } from '../../path-mutation-safety';

function milestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    stageNumber: 1,
    title: 'M1',
    status: 'active',
    updatedAt: new Date('2026-11-05T06:00:00.000Z'),
    subtasks: [{ id: 't-1', status: 'todo', updatedAt: new Date('2026-11-05T06:00:00.000Z') }],
    ...overrides,
  };
}

describe('requestPathReplan：没有可重设计阶段时的 4xx 契约（#250）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('空壳路径（0 里程碑）→ 抛具名 409，而不是裸 Error（旧行为落 500）', async () => {
    mockFindUnique.mockResolvedValue({ id: 'lp-empty', userId: 'user-1', milestones: [] });

    let caught: unknown = null;
    await requestPathReplan({ pathId: 'lp-empty', userId: 'user-1', mode: 'overwrite' } as never)
      .catch((error) => { caught = error });

    expect(caught).toBeInstanceOf(PathReplanNoTargetStageError);
    expect(caught).toMatchObject({ status: 409, code: 'PATH_REPLAN_NO_TARGET_STAGE' });
    expect(String((caught as Error)?.message)).toContain('没有可重设计的阶段');
    // 路由 sendPathMutationConflict 的准入判据：认出 → res.status(409)
    expect(isPathMutationConflictError(caught)).toBe(true);
  });

  it('全部阶段已完成 → 同样抛具名 409，不落 500', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'lp-done',
      userId: 'user-1',
      milestones: [milestone({ status: 'completed', subtasks: [{ id: 't-1', status: 'completed' }] })],
    });

    let caught: unknown = null;
    await requestPathReplan({ pathId: 'lp-done', userId: 'user-1', mode: 'overwrite' } as never)
      .catch((error) => { caught = error });

    expect(caught).toMatchObject({ status: 409, code: 'PATH_REPLAN_NO_TARGET_STAGE' });
    expect(isPathMutationConflictError(caught)).toBe(true);
  });

  it('防修过头：仍有可重设计阶段（previewOnly）→ 正常返回，不抛错', async () => {
    mockFindUnique.mockResolvedValue({ id: 'lp-live', userId: 'user-1', milestones: [milestone()] });

    await expect(requestPathReplan({
      pathId: 'lp-live',
      userId: 'user-1',
      mode: 'overwrite',
      previewOnly: true,
    } as never)).resolves.toMatchObject({ enabled: false, status: 'awaiting-confirmation' });
  });

  it('防修过头：空壳路径 previewOnly 仍走既有 200 no-signal（与修复前一致）', async () => {
    mockFindUnique.mockResolvedValue({ id: 'lp-empty', userId: 'user-1', milestones: [] });

    await expect(requestPathReplan({
      pathId: 'lp-empty',
      userId: 'user-1',
      previewOnly: true,
    } as never)).resolves.toMatchObject({ status: 'no-signal' });
  });
});
