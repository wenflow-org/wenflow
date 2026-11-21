// 单测只验证实验循环本身；不加载 skills barrel（避免被无关 skill 的编译状态牵连）。
jest.mock('../../../../skills', () => ({
  executeSkillWithResult: jest.fn(),
}));

import {
  MAX_PATH_REPLAN_DEPTH,
  runPathReviewComparisonExperiment,
  type PathReviewInvocationResult,
  type PathReviewSnapshotV1,
} from '../path-review-replan';

const SNAPSHOT: PathReviewSnapshotV1 = {
  version: 1,
  pathPlan: {
    name: '分数与小数',
    summary: '从生活情境建立分数概念',
    topology: 'builder',
    cognitiveCore: { domainAnchors: ['Pólya'] },
    milestones: [
      { stage: 1, name: '均分情境', goal: '能把整块均分成若干份' },
      { stage: 2, name: '分数记号', goal: '能用分数表示均分结果' },
    ],
    estimatedHours: 4,
  },
  goalContext: { surfaceGoal: '学会分数' },
  prerequisiteTree: null,
};

const REPLANNED_ANALYSIS = {
  pathName: '分数与小数（返工）',
  summary: '补足均分到记号的过渡',
  topology: 'builder',
  cognitiveCore: { domainAnchors: ['Pólya'] },
  estimatedTotalHours: 5,
  suggestedMilestones: [
    { stage: 1, name: '均分情境', goal: '能把整块均分成若干份' },
    { stage: 2, name: '过渡练习', goal: '能从均分说出分数记号' },
    { stage: 3, name: '分数记号', goal: '能用分数表示均分结果' },
  ],
};

function output(score: number, passed: boolean, replanInstructions?: string): PathReviewInvocationResult {
  return {
    output: { score, passed, replanInstructions, dimensions: {} },
    errorCode: null,
    errorMessage: null,
  };
}

const DATA = {
  userId: 'u1',
  description: '学会分数',
  source: 'api' as const,
  userProfile: { normalizedInput: { learnerProfile: { level: 'beginner' } } },
};

describe('runPathReviewComparisonExperiment（显式虚拟试验分组）', () => {
  it('原方案通过 → 不返工，保留原评审', async () => {
    const analyzePath = jest.fn();
    const review = jest.fn(async () => output(0.9, true));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });
    expect(analyzePath).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledTimes(1);
    expect(result.replanned).toBe(false);
    expect(result.replanDepth).toBe(0);
    expect(result.originalReview?.passed).toBe(true);
    expect(result.skippedReason).toBe('original_review_passed');
  });

  it('低分且有返工指令 → 最多一次重规划 + 再评审，原方案与返工方案都保留', async () => {
    const analyzePath = jest.fn(async (_data: any) => REPLANNED_ANALYSIS);
    const review = jest.fn()
      .mockResolvedValueOnce(output(0.55, false, '把 milestone-2 的过渡补出来'))
      .mockResolvedValueOnce(output(0.82, true));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });

    expect(analyzePath).toHaveBeenCalledTimes(1);
    const replanData = analyzePath.mock.calls[0][0];
    expect(replanData.source).toBe('replan');
    expect(replanData.mode).toBe('replan');
    expect(replanData.userProfile.replan).toMatchObject({
      triggerSource: 'path-reviewer',
      reviewerFeedback: '把 milestone-2 的过渡补出来',
      previousPlan: { name: '分数与小数', milestones: [{ title: '均分情境', goal: '能把整块均分成若干份' }, { title: '分数记号', goal: '能用分数表示均分结果' }] },
    });

    expect(review).toHaveBeenCalledTimes(2);
    const replannedSnapshot = review.mock.calls[1][0] as PathReviewSnapshotV1;
    expect(replannedSnapshot.pathPlan.name).toBe('分数与小数（返工）');
    expect(replannedSnapshot.goalContext).toEqual(SNAPSHOT.goalContext);

    expect(result.replanned).toBe(true);
    expect(result.replanDepth).toBe(MAX_PATH_REPLAN_DEPTH);
    expect(result.originalAnalysis.pathName).toBe('分数与小数');
    expect(result.replannedAnalysis?.pathName).toBe('分数与小数（返工）');
    expect(result.replannedSnapshot?.pathPlan.milestones).toHaveLength(3);
    expect(result.originalReview?.score).toBe(0.55);
    expect(result.replannedReview?.score).toBe(0.82);
    expect(result.comparison).toMatchObject({
      originalScore: 0.55,
      replannedScore: 0.82,
      passedChanged: true,
    });
  });

  it('返工后再次低分 → 不进行第二次重规划（深度上限 1）', async () => {
    const analyzePath = jest.fn(async (_data: any) => REPLANNED_ANALYSIS);
    const review = jest.fn()
      .mockResolvedValueOnce(output(0.5, false, '补过渡'))
      .mockResolvedValueOnce(output(0.6, false, '仍需补过渡'));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });
    expect(analyzePath).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(2);
    expect(result.replanned).toBe(true);
    expect(result.replanDepth).toBe(1);
    expect(result.replannedReview?.passed).toBe(false);
  });

  it('低分但没有返工指令 → 不重规划（由调用方记证据不足）', async () => {
    const analyzePath = jest.fn();
    const review = jest.fn(async () => output(0.5, false));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });
    expect(analyzePath).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe('replan_instructions_missing');
  });

  it('原评审不可用 → 不重规划', async () => {
    const analyzePath = jest.fn();
    const review = jest.fn(async (): Promise<PathReviewInvocationResult> => ({
      output: null,
      errorCode: 'PATH_REVIEWER_FAILED',
      errorMessage: 'PATH_REVIEWER_DIMENSION_INVALID:depth',
    }));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });
    expect(analyzePath).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe('original_review_unavailable');
  });

  it('重规划结果为空 → 保留原方案', async () => {
    const analyzePath = jest.fn(async (_data: any) => ({}));
    const review = jest.fn(async () => output(0.5, false, '补过渡'));
    const result = await runPathReviewComparisonExperiment({
      data: DATA,
      snapshot: SNAPSHOT,
      analyzePath,
      review,
    });
    expect(result.replanned).toBe(false);
    expect(result.skippedReason).toBe('replan_empty');
    expect(result.originalReview?.score).toBe(0.5);
  });
});
