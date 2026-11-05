/**
 * #241：`rebuild-all` 之后路径 `active` 但 0 个任务时，两个重试入口必须同口径。
 *
 * 真实事故：core succeeded 后 stageDesign 被
 * PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE 取消，路径留下「active + 全部阶段零任务」。
 * 同一状态下：
 *   PATCH /retry              → 400「路径已经生成完成，无需重试」（resolveGenerationRetry 只看 run.status）
 *   POST /retry-stage-design  → 200 {accepted:true, mode:'append', emptyMilestoneCount:2}
 * 本文件锁定修复后的判定：
 *  - run 成功/被取消但仍有零任务阶段 → 可重试（retryType=stageDesign, reason=incomplete），
 *    服务层走 append-tasks 只补齐、不覆盖；
 *  - 真的有任务（阶段非空）→ 仍判「已完成」，不得放宽（防修过头）；
 *  - 生成在途（processing 未过期）→ 仍不可重试，避免叠加第二次生成。
 */
const mockPrisma: any = {
  learning_paths: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  path_generation_runs: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  milestones: { findMany: jest.fn(), count: jest.fn() },
  users: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};
const mockRunBackgroundTask = jest.fn();

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../learning-state.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../achievements/achievement.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({ learnerSnapshotRefreshService: {} }));
jest.mock('../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: jest.fn() }
}));
jest.mock('../../learner/LearnerProjectionService', () => ({ learnerProjectionService: {} }));
jest.mock('../../learner/LearnerProgressService', () => ({ learnerProgressService: {} }));
jest.mock('../../background-task-tracker.service', () => ({ runBackgroundTask: mockRunBackgroundTask }));
jest.mock('../../../skills', () => ({ executeSkill: jest.fn() }));
jest.mock('../../../skills/stage-designer', () => ({ stageDesignerDefinition: {} }));
jest.mock('../../../skills/path-planning', () => ({ pathAgentDefinition: {} }));

import learningService from '../learning.service';

const TEMPLATE = (stageDesign: string) => JSON.stringify({
  _generation: { core: 'succeeded', stageDesign }
});

const PATH = (overrides: Record<string, unknown> = {}) => ({
  id: 'lp-empty',
  userId: 'user-1',
  status: 'active',
  title: '重建后的空路径',
  name: '重建后的空路径',
  description: '重建后的空路径',
  subject: '吉他',
  aiPromptTemplate: TEMPLATE('succeeded'),
  activeGenerationRunId: 'run-stage',
  updatedAt: new Date('2026-11-05T07:11:25.000Z'),
  ...overrides,
});

const STAGE_RUN = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-stage',
  phase: 'stageDesign',
  status: 'succeeded',
  retryAllowed: false,
  ...overrides,
});

describe('getPathGenerationRetry：#241 零任务路径的可重试判定', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.learning_paths.findUnique.mockResolvedValue(PATH());
    mockPrisma.path_generation_runs.findFirst.mockResolvedValue(STAGE_RUN());
    mockPrisma.milestones.findMany.mockResolvedValue([]);
    mockPrisma.users.findUnique.mockResolvedValue(null);
  });

  it('stageDesign run 成功但仍有零任务阶段 → 可重试且走 stageDesign（旧行为是 400 已完成）', async () => {
    mockPrisma.milestones.findMany.mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }]);

    await expect(learningService.getPathGenerationRetry('lp-empty', 'user-1')).resolves.toMatchObject({
      allowed: true,
      retryType: 'stageDesign',
      reason: 'incomplete',
    });
  });

  it('被重建流程取消的 stageDesign run + 零任务阶段 → 同样可重试（真实事故的 run 终态）', async () => {
    mockPrisma.path_generation_runs.findFirst.mockResolvedValue(STAGE_RUN({ status: 'cancelled' }));
    mockPrisma.milestones.findMany.mockResolvedValue([{ id: 'm-1' }]);

    await expect(learningService.getPathGenerationRetry('lp-empty', 'user-1')).resolves.toMatchObject({
      allowed: true,
      retryType: 'stageDesign',
      reason: 'incomplete',
    });
  });

  it('防修过头：确有任务、run 已成功 → 仍判「已完成」，不放宽重试', async () => {
    mockPrisma.milestones.findMany.mockResolvedValue([]);

    await expect(learningService.getPathGenerationRetry('lp-empty', 'user-1')).resolves.toMatchObject({
      allowed: false,
      retryType: null,
      reason: 'completed',
    });
  });

  it('防修过头：阶段设计在途（processing 未过期）即便阶段为空也不许叠加重试', async () => {
    mockPrisma.learning_paths.findUnique.mockResolvedValue(PATH({ aiPromptTemplate: TEMPLATE('processing') }));
    mockPrisma.path_generation_runs.findFirst.mockResolvedValue(STAGE_RUN({
      status: 'processing',
      leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }));
    mockPrisma.milestones.findMany.mockResolvedValue([{ id: 'm-1' }]);

    await expect(learningService.getPathGenerationRetry('lp-empty', 'user-1')).resolves.toMatchObject({
      allowed: false,
      reason: 'not-failed',
    });
  });

  it('成功路径行为不变：failed stageDesign run 仍按 replace 重试', async () => {
    mockPrisma.path_generation_runs.findFirst.mockResolvedValue(STAGE_RUN({ status: 'failed', retryAllowed: true }));

    await expect(learningService.getPathGenerationRetry('lp-empty', 'user-1')).resolves.toMatchObject({
      allowed: true,
      retryType: 'stageDesign',
      reason: 'failed',
    });
  });
});

describe('retryPathEnrichment：#241 零任务路径走追加式补齐', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.learning_paths.findUnique.mockResolvedValue(PATH());
    mockPrisma.path_generation_runs.findFirst.mockResolvedValue(STAGE_RUN());
    mockPrisma.milestones.findMany.mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }]);
    mockPrisma.users.findUnique.mockResolvedValue(null);
    jest.spyOn(learningService as any, 'createAndClaimGenerationRun').mockResolvedValue({ id: 'run-append' });
    jest.spyOn(learningService as any, 'updatePathGenerationStatus').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('run 成功但零任务 → append-tasks（只创建、不覆盖），与 POST /retry-stage-design 既有 200 语义一致', async () => {
    await expect(learningService.retryPathEnrichment('lp-empty', 'user-1')).resolves.toMatchObject({
      accepted: true,
      retryType: 'stageDesign',
      mode: 'append',
      emptyMilestoneCount: 2,
      runId: 'run-append',
    });

    const createRun = (learningService as any).createAndClaimGenerationRun as jest.Mock;
    expect(createRun).toHaveBeenCalledWith(
      'lp-empty',
      'stageDesign',
      'stageDesign',
      0,
      'append-tasks',
      'run-stage',
      { milestoneIds: ['m-1', 'm-2'] }
    );
  });
});
