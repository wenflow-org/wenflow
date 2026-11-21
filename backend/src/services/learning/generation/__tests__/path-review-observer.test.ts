import type { DurableDomainEvent } from '../../../../events/contracts';

const mockPrisma: any = {
  learning_paths: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  path_generation_runs: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../../utils/with-transaction', () => ({
  withTransaction: async (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
}));
jest.mock('../path-review-replan', () => ({
  requestPathReviewSnapshot: jest.fn(),
  runPathReviewComparisonExperiment: jest.fn(),
}));

import { observePathQualityReview } from '../path-review-observer';
import { requestPathReviewSnapshot } from '../path-review-replan';

const requestReviewMock = requestPathReviewSnapshot as jest.MockedFunction<typeof requestPathReviewSnapshot>;

const SNAPSHOT = {
  version: 1,
  pathPlan: { name: '路径', milestones: [{ stage: 1, name: '起点' }], estimatedHours: 2 },
  goalContext: { surfaceGoal: '目标' },
  prerequisiteTree: null,
};

function buildTemplate(overrides: {
  pathVersion?: string;
  pathReview?: Record<string, unknown>;
} = {}): string {
  return JSON.stringify({
    suggestedMilestones: [{ stage: 1, name: '起点' }],
    _generation: {
      core: 'succeeded',
      coreStep: 'completed',
      stageDesign: 'pending',
      pathVersion: overrides.pathVersion ?? 'run-1',
      pathReview: overrides.pathReview ?? {
        status: 'pending',
        reviewedGenerationRunId: 'run-1',
        reviewEventId: 'pqr_run-1',
      },
    },
  });
}

function buildEvent(overrides: Partial<any> = {}): DurableDomainEvent {
  return {
    id: 'pqr_run-1',
    type: 'path:quality-review',
    schemaVersion: 1,
    aggregateType: 'path',
    aggregateId: 'lp_1',
    userId: 'u1',
    source: 'learning-service',
    data: {
      pathId: 'lp_1',
      userId: 'u1',
      reviewedGenerationRunId: 'run-1',
      reviewerKind: 'platform_path_quality',
      mode: 'observe',
      requestedBy: 'path-generation',
      reviewConfig: { threshold: 0.75, dimensionWeights: {} },
      snapshot: SNAPSHOT,
      snapshotHash: 'snapshot-hash',
      requestedAt: '2026-11-21T00:00:00.000Z',
      ...overrides,
    },
    occurredAt: new Date('2026-11-21T00:00:00.000Z'),
  };
}

function updatedGeneration(): any {
  const data = mockPrisma.learning_paths.update.mock.calls[0][0].data;
  return JSON.parse(data.aiPromptTemplate)._generation;
}

function highScoreOutput() {
  const dimensions = { clarity: 0.9, integrity: 0.9, depth: 0.9, practicality: 0.9, pertinence: 0.9 };
  return {
    output: { score: 0.9, dimensions, passed: true, issues: [], replanInstructions: null },
    errorCode: null,
    errorMessage: null,
  };
}

describe('observePathQualityReview（后台评审观察）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      id: 'lp_1',
      status: 'active',
      activeGenerationRunId: 'stage-run',
      aiPromptTemplate: buildTemplate(),
    });
    mockPrisma.learning_paths.update.mockResolvedValue({});
    mockPrisma.path_generation_runs.findUnique.mockResolvedValue(null);
  });

  it('通过评审：只写 _generation.pathReview/history，不改路径状态与阶段设计状态', async () => {
    requestReviewMock.mockResolvedValue(highScoreOutput());

    await observePathQualityReview(buildEvent());

    expect(requestReviewMock).toHaveBeenCalledWith(SNAPSHOT);
    expect(mockPrisma.learning_paths.update).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.learning_paths.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty('status');
    const generation = updatedGeneration();
    expect(generation.pathVersion).toBe('run-1');
    expect(generation.stageDesign).toBe('pending');
    expect(generation.pathReview).toMatchObject({
      status: 'passed',
      passed: true,
      reviewEventId: 'pqr_run-1',
      reviewedGenerationRunId: 'run-1',
      replanRecommended: false,
    });
    expect(generation.pathReview.score).toBeCloseTo(0.9, 10);
    expect(generation.pathReviewHistory).toHaveLength(1);
  });

  it('版本已变（迟到任务）→ 不调用模型、不写路径', async () => {
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      id: 'lp_1',
      status: 'active',
      activeGenerationRunId: 'stage-run-2',
      aiPromptTemplate: buildTemplate({ pathVersion: 'run-2' }),
    });

    await observePathQualityReview(buildEvent());

    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(mockPrisma.learning_paths.update).not.toHaveBeenCalled();
  });

  it('同一版本已处理 → 幂等跳过', async () => {
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      id: 'lp_1',
      status: 'active',
      activeGenerationRunId: 'stage-run',
      aiPromptTemplate: buildTemplate({
        pathReview: { status: 'passed', reviewEventId: 'pqr_run-1', reviewedGenerationRunId: 'run-1' },
      }),
    });

    await observePathQualityReview(buildEvent());

    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(mockPrisma.learning_paths.update).not.toHaveBeenCalled();
  });

  it('低分但缺返工指令（重试耗尽）→ 证据不足，仅更新评审状态', async () => {
    const dimensions = { clarity: 0.5, integrity: 0.5, depth: 0.5, practicality: 0.5, pertinence: 0.5 };
    requestReviewMock.mockResolvedValue({
      output: { score: 0.5, dimensions, passed: false, issues: [], replanInstructions: '' },
      errorCode: null,
      errorMessage: null,
    });

    await observePathQualityReview(buildEvent());

    const generation = updatedGeneration();
    expect(generation.pathReview).toMatchObject({
      status: 'insufficient_evidence',
      degradedSource: 'invalid_model_output',
      replanRecommended: false,
    });
    expect(generation.pathReview.evidence.reason).toBe('PATH_REVIEWER_REPLAN_INSTRUCTIONS_REQUIRED');
  });

  it('评审超时 → unavailable，路径仍可学习', async () => {
    requestReviewMock.mockResolvedValue({
      output: null,
      errorCode: 'PATH_REVIEWER_FAILED',
      errorMessage: 'LLM request timeout',
    });

    await observePathQualityReview(buildEvent());

    const generation = updatedGeneration();
    expect(generation.pathReview).toMatchObject({
      status: 'unavailable',
      degradedSource: 'reviewer_timeout',
    });
    expect(mockPrisma.learning_paths.update.mock.calls[0][0].data).not.toHaveProperty('status');
  });

  it('模型缺字段（调用失败）→ 证据不足，并记录错误来源', async () => {
    requestReviewMock.mockResolvedValue({
      output: null,
      errorCode: 'PATH_REVIEWER_FAILED',
      errorMessage: 'PATH_REVIEWER_DIMENSION_INVALID:depth',
    });

    await observePathQualityReview(buildEvent());

    const generation = updatedGeneration();
    expect(generation.pathReview).toMatchObject({
      status: 'insufficient_evidence',
      degradedSource: 'invalid_model_output',
      evidence: { errorCode: 'PATH_REVIEWER_FAILED', reason: 'invalid_model_output' },
    });
  });

  it('快照缺失 → 证据不足，不调用模型', async () => {
    await observePathQualityReview(buildEvent({ snapshot: null }));

    expect(requestReviewMock).not.toHaveBeenCalled();
    const generation = updatedGeneration();
    expect(generation.pathReview).toMatchObject({
      status: 'insufficient_evidence',
      degradedSource: 'snapshot_missing',
    });
  });

  it('普通 observe 模式不触发返工实验', async () => {
    requestReviewMock.mockResolvedValue({
      output: {
        score: 0.5,
        dimensions: { clarity: 0.5, integrity: 0.5, depth: 0.5, practicality: 0.5, pertinence: 0.5 },
        passed: false,
        issues: [],
        replanInstructions: '补 milestone-2',
      },
      errorCode: null,
      errorMessage: null,
    });

    await observePathQualityReview(buildEvent());

    const generation = updatedGeneration();
    expect(generation.pathReview.status).toBe('failed');
    expect(generation.pathReview.replanRecommended).toBe(true);
    expect(generation).not.toHaveProperty('pathReviewExperiment');
    expect(mockPrisma.path_generation_runs.findUnique).not.toHaveBeenCalled();
  });
});
