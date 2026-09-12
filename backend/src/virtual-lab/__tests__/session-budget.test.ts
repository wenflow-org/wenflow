import {
  resolveSessionBudget,
  computeLearnProgressSignature,
  DEFAULT_TURN_CHUNK_PER_LESSON,
  DEFAULT_MAX_RETRIES_PER_STEP,
  DEFAULT_NO_PROGRESS_CHUNK_LIMIT,
} from '../session-budget';

describe('session-budget 会话预算解析（教多少 vs 花多少）', () => {
  it('无任何配置：成本不限，其余走默认', () => {
    const b = resolveSessionBudget({});
    expect(b.unlimited).toBe(true);
    expect(b.costCeiling).toBeNull();
    expect(b.maxRetriesPerStep).toBe(DEFAULT_MAX_RETRIES_PER_STEP);
    expect(b.turnChunkPerLesson).toBe(DEFAULT_TURN_CHUNK_PER_LESSON);
    expect(b.noProgressChunkLimit).toBe(DEFAULT_NO_PROGRESS_CHUNK_LIMIT);
    expect(b.source).toBe('default');
  });

  it('画像级 simulationBudget 生效，costCeiling 为真实数字（不再兜底 600）', () => {
    const b = resolveSessionBudget({
      profileData: { simulationBudget: { costCeiling: 1500, turnChunkPerLesson: 60, maxRetriesPerStep: 5 } },
    });
    expect(b.costCeiling).toBe(1500);
    expect(b.unlimited).toBe(false);
    expect(b.turnChunkPerLesson).toBe(60);
    expect(b.maxRetriesPerStep).toBe(5);
    expect(b.source).toBe('profile');
  });

  it('故事级 budget 覆盖画像级', () => {
    const b = resolveSessionBudget({
      stageResults: { story: { budget: { costCeiling: 900, turnChunkPerLesson: 50 } } },
      profileData: { simulationBudget: { costCeiling: 1500, turnChunkPerLesson: 60 } },
    });
    expect(b.source).toBe('story');
    expect(b.costCeiling).toBe(900);
    expect(b.turnChunkPerLesson).toBe(50);
  });

  it('兼容旧键 maxRetriesTotal；<=0 视为不限', () => {
    expect(resolveSessionBudget({ profileData: { simulationBudget: { maxRetriesTotal: 800 } } }).costCeiling).toBe(800);
    expect(resolveSessionBudget({ profileData: { simulationBudget: { costCeiling: 0 } } }).unlimited).toBe(true);
    expect(resolveSessionBudget({ profileData: { simulationBudget: { costCeiling: -5 } } }).unlimited).toBe(true);
  });

  it('数值钳制：maxRetriesPerStep ∈ [1,20]，turnChunkPerLesson ∈ [1,100]', () => {
    const b = resolveSessionBudget({
      profileData: { simulationBudget: { maxRetriesPerStep: 999, turnChunkPerLesson: 999 } },
    });
    expect(b.maxRetriesPerStep).toBe(20);
    expect(b.turnChunkPerLesson).toBe(100);
  });

  it('分片回合数回退到画像运行偏好 / 会话 simulationConfig', () => {
    expect(resolveSessionBudget({ profileData: { runtimePrefs: { turnCapPerLesson: 55 } } }).turnChunkPerLesson).toBe(55);
    expect(resolveSessionBudget({ stageResults: { simulationConfig: { turnCapPerLesson: 45 } } }).turnChunkPerLesson).toBe(45);
  });
});

describe('computeLearnProgressSignature 无进展看门狗指纹', () => {
  it('同一状态指纹稳定', () => {
    const sr = { teaching: { knowledgeState: [{ status: 'mastered' }, { status: 'learning' }] } };
    const a = computeLearnProgressSignature(sr, { completedTasks: 2, currentTaskId: 't3' });
    const b = computeLearnProgressSignature(sr, { completedTasks: 2, currentTaskId: 't3' });
    expect(a).toBe(b);
  });

  it('任务推进或知识状态变化时指纹改变（即判定有净进展）', () => {
    const done = computeLearnProgressSignature(
      { teaching: { knowledgeState: [{ status: 'mastered' }] } },
      { completedTasks: 2, currentTaskId: 't3' }
    );
    const nextTask = computeLearnProgressSignature(
      { teaching: { knowledgeState: [{ status: 'mastered' }] } },
      { completedTasks: 3, currentTaskId: 't4' }
    );
    const moreMastered = computeLearnProgressSignature(
      { teaching: { knowledgeState: [{ status: 'mastered' }, { status: 'mastered' }] } },
      { completedTasks: 2, currentTaskId: 't3' }
    );
    expect(nextTask).not.toBe(done);
    expect(moreMastered).not.toBe(done);
  });
});
