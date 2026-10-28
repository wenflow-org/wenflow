/* eslint-disable @typescript-eslint/no-explicit-any -- 契约测试：jest mock 调用项无法索引、storyPool 载荷形状动态（对齐 simulation.memory.test.ts 先例） */
/**
 * 多故事续章生长（story-chapter.service，2026-10-11 人物立体化）契约测试：
 * - growStoryChapter 幂等：同一 predecessor 已有续章 → 跳过；
 * - 生命周期：前一章标 completed、续章 status=pending + progressesFrom + chapterIndex+1；
 * - 池上限护栏；
 * - onTeachingSessionCompleted 守卫：非 VL 跳过、wrapup 不可靠跳过、无虚拟会话且池内有头故事时回退取头。
 */
const prismaMock = {
  virtual_learner_profiles: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
  virtual_sessions: { findMany: jest.fn(async () => []) },
  users: { findUnique: jest.fn(async () => ({ isVirtualLearner: true })) },
};
jest.mock('../../../config/database', () => ({ __esModule: true, prisma: prismaMock }));
jest.mock('../../../skills', () => ({ __esModule: true, executeSkill: jest.fn() }));
jest.mock('../../../skills/virtual-learner-scenario-designer', () => ({
  __esModule: true,
  virtualLearnerScenarioDesignerDefinition: { name: 'virtual-learner-scenario-designer', version: '1.1.0' },
}));
jest.mock('../../../virtual-lab/learner-memory', () => ({
  __esModule: true,
  buildLearnerMemorySnapshot: jest.fn(async () => ({ mastered: [], dueReview: [], struggling: [], recentCompleted: [], recentTaskTitles: [] })),
}));
jest.mock('../../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { growStoryChapter, onTeachingSessionCompleted, STORY_POOL_MAX, buildStoryDirectionHints, STORY_DIRECTION_MAX } from '../story-chapter.service';
import { executeSkill } from '../../../skills';

function profileWith(pool: any[]) {
  return { id: 'p1', userId: 'u1', profile: JSON.stringify({ storyPool: pool, nameHint: '阿明' }) };
}

/** 取最近一次 update 写回的 storyPool（原型 mock 调用项类型无法索引，统一 any 化）。 */
function savedPool(): any[] {
  const calls = prismaMock.virtual_learner_profiles.update.mock.calls as any[];
  return JSON.parse(calls[calls.length - 1][0].data.profile).storyPool;
}

beforeEach(() => {
  jest.resetAllMocks();
  prismaMock.users.findUnique.mockResolvedValue({ isVirtualLearner: true });
  prismaMock.virtual_sessions.findMany.mockResolvedValue([]);
  prismaMock.virtual_learner_profiles.update.mockResolvedValue({});
});

describe('growStoryChapter', () => {
  it('幂等：同一 predecessor 已有续章则跳过', async () => {
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith([
      { id: 'story_1', title: '第一章' },
      { id: 'story_2', title: '第二章', progressesFrom: 'story_1' },
    ]));
    const res = await growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_1' });
    expect(res).toEqual({ added: false, reason: 'successor-exists' });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it('池上限护栏', async () => {
    const pool = Array.from({ length: STORY_POOL_MAX }, (_, i) => ({ id: `story_${i}`, title: `第 ${i} 章` }));
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith(pool));
    const res = await growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_0' });
    expect(res).toEqual({ added: false, reason: 'pool-max' });
  });

  it('成功：前一章标 completed，续章 pending + progressesFrom + chapterIndex+1 写回', async () => {
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith([
      { id: 'story_1', title: '熬不动的夜班' },
    ]));
    (executeSkill as jest.Mock).mockResolvedValue({ story: { id: 'story_new', title: '第二章：复查那天', storyOutline: '体检复查' } });
    const res = await growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_1', predecessorTitle: '熬不动的夜班' });
    expect(res.added).toBe(true);
    expect(res.storyId).toBe('story_new');
    const saved = savedPool();
    const prev = saved.find((s: any) => s.id === 'story_1');
    const next = saved.find((s: any) => s.id === 'story_new');
    expect(prev.status).toBe('completed');
    expect(next.status).toBe('pending');
    expect(next.progressesFrom).toBe('story_1');
    expect(next.chapterIndex).toBe(2);
    // 生成提示词带「下一章承接」指令 + 记忆 hints 通道
    const call = (executeSkill as jest.Mock).mock.calls[0][1];
    expect(call.recentScenarioHints.join(' ')).toContain('下一章');
  });

  it('技能无有效产出 → 不写库', async () => {
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith([{ id: 'story_1', title: '第一章' }]));
    (executeSkill as jest.Mock).mockResolvedValue({ story: { title: '' } });
    const res = await growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_1' });
    expect(res.added).toBe(false);
    expect(prismaMock.virtual_learner_profiles.update).not.toHaveBeenCalled();
  });
});

describe('onTeachingSessionCompleted', () => {
  it('wrapup 不可靠 → 跳过（不生长假章）', async () => {
    await onTeachingSessionCompleted({ userId: 'u1', learningPathId: 'lp1', wrapupReliable: false });
    expect(prismaMock.users.findUnique).not.toHaveBeenCalled();
  });

  it('非虚拟学习者 → 跳过', async () => {
    prismaMock.users.findUnique.mockResolvedValue({ isVirtualLearner: false });
    await onTeachingSessionCompleted({ userId: 'u1', learningPathId: 'lp1', wrapupReliable: true });
    expect(prismaMock.virtual_learner_profiles.findUnique).not.toHaveBeenCalled();
  });

  it('虚拟会话带 storyId → 用该故事生长续章', async () => {
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith([{ id: 'story_a', title: 'A' }]));
    prismaMock.virtual_sessions.findMany.mockResolvedValue([
      { stageResults: JSON.stringify({ story: { storyId: 'story_a', title: 'A', outline: 'o' } }) },
    ]);
    (executeSkill as jest.Mock).mockResolvedValue({ story: { id: 'story_b', title: 'B' } });
    await onTeachingSessionCompleted({ userId: 'u1', learningPathId: 'lp1', wrapupReliable: true });
    const saved = savedPool();
    expect(saved.some((s: any) => s.id === 'story_b' && s.progressesFrom === 'story_a')).toBe(true);
  });

  it('无虚拟会话 storyId → 回退取池内最早未完结故事', async () => {
    prismaMock.virtual_learner_profiles.findUnique.mockResolvedValue(profileWith([
      { id: 'story_a', title: 'A' },
      { id: 'story_b', title: 'B', progressesFrom: 'story_a' },
    ]));
    prismaMock.virtual_sessions.findMany.mockResolvedValue([]);
    (executeSkill as jest.Mock).mockResolvedValue({ story: { id: 'story_c', title: 'C' } });
    await onTeachingSessionCompleted({ userId: 'u1', learningPathId: 'lp1', wrapupReliable: true });
    const saved = savedPool();
    // story_b 已有前驱 story_a，故「未完结头」= story_b（无续章），在其后长 story_c
    expect(saved.some((s: any) => s.id === 'story_c' && s.progressesFrom === 'story_b')).toBe(true);
  });
});

describe('buildStoryDirectionHints（生成方向 → 故事约束）', () => {
  it('空值 / 非字符串 / 纯空白 → 不注入提示', () => {
    expect(buildStoryDirectionHints(undefined)).toEqual([]);
    expect(buildStoryDirectionHints(null)).toEqual([]);
    expect(buildStoryDirectionHints(42)).toEqual([]);
    expect(buildStoryDirectionHints('   ')).toEqual([]);
  });

  it('正常方向 → 一条约束，保留用户原文并限定落到具体情境', () => {
    const hints = buildStoryDirectionHints('  化学实验误差分析  ');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('化学实验误差分析');
    expect(hints[0]).toContain('具体学科');
  });

  it('超长输入 → 截断到上限，不整单拒绝', () => {
    const hints = buildStoryDirectionHints('学'.repeat(STORY_DIRECTION_MAX + 30));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('学'.repeat(STORY_DIRECTION_MAX));
    expect(hints[0]).not.toContain('学'.repeat(STORY_DIRECTION_MAX + 1));
  });
});
