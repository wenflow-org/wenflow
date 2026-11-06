/* eslint-disable @typescript-eslint/no-explicit-any -- jest mock 调用项与动态 JSON 载荷无法索引 */
/**
 * #170 回归：续章生长（growStoryChapter）与课后记忆回写并发时不得互相覆盖。
 *
 * 病灶：growStoryChapter 在「读画像快照 → scenario-designer LLM（数十秒）→ 整包写回」之间
 * 持着旧快照；同窗口内 learner-memory 写进 knownConcepts / recentCompleted / selfAssessmentAccuracy，
 * 会被 `{...profileData, storyPool}` 整包写回**回滚**（或反向丢掉新续章）。
 *
 * 本用例：growStoryChapter 卡在 LLM 期间，用同一把 `vlab-profile:<userId>` 锁模拟一次
 * 「读→改→写」的记忆回写；断言最终画像同时保留记忆字段与续章。修复前（整包写回旧快照）
 * knownConcepts 会消失。
 */
const prismaMock = {
  virtual_learner_profiles: { findUnique: jest.fn(), update: jest.fn() },
};
jest.mock('../../../config/database', () => ({ __esModule: true, prisma: prismaMock }));
jest.mock('../../../skills', () => ({ __esModule: true, executeSkill: jest.fn() }));
jest.mock('../../../skills/virtual-learner-scenario-designer', () => ({
  __esModule: true,
  virtualLearnerScenarioDesignerDefinition: { name: 'virtual-learner-scenario-designer', version: '1.1.0' },
}));
jest.mock('../../../virtual-lab/learner-memory', () => ({
  __esModule: true,
  buildLearnerMemorySnapshot: jest.fn(async () => ({
    mastered: [], dueReview: [], struggling: [], recentCompleted: [], recentTaskTitles: [],
  })),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { growStoryChapter } from '../story-chapter.service';
import { executeSkill } from '../../../skills';
import { withKeyedLock } from '../../../utils/keyed-lock';

/** 单行画像的内存替身：findUnique 每次返回**当前**值（模拟真实重读）。 */
let row: { id: string; userId: string; profile: string };

function currentProfile(): Record<string, any> {
  return JSON.parse(row.profile);
}

/** learner-memory 侧「读→改→写」的记忆回写（同一把 vlab-profile 锁）。 */
async function memoryWriteback(concept: string): Promise<void> {
  await withKeyedLock(`vlab-profile:${row.userId}`, async () => {
    const fresh = currentProfile();
    fresh.knownConcepts = [...(fresh.knownConcepts || []), concept];
    fresh.selfAssessmentAccuracy = 'overconfident';
    await prismaMock.virtual_learner_profiles.update({
      where: { id: row.id },
      data: { profile: JSON.stringify(fresh) },
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  row = {
    id: 'p1',
    userId: 'u1',
    profile: JSON.stringify({ nameHint: '阿明', knownConcepts: [], storyPool: [{ id: 'story_1', title: '熬不动的夜班' }] }),
  };
  prismaMock.virtual_learner_profiles.findUnique.mockImplementation(async () => ({ ...row }));
  prismaMock.virtual_learner_profiles.update.mockImplementation(async ({ data }: any) => {
    if (typeof data?.profile === 'string') row.profile = data.profile;
    return { ...row };
  });
});

describe('#170 growStoryChapter 与记忆回写并发', () => {
  it('LLM 窗口内的记忆回写不被旧快照整包覆盖，续章与记忆字段同时保留', async () => {
    let releaseLlm: () => void = () => {};
    const llmGate = new Promise<void>((resolve) => { releaseLlm = resolve; });
    (executeSkill as jest.Mock).mockImplementation(async () => {
      await llmGate;
      return { story: { id: 'story_new', title: '第二章：复查那天', storyOutline: '体检复查' } };
    });

    const grow = growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_1' });
    // 让 grow 读到画像并停在 LLM 上
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // 同窗口：课后记忆回写（knownConcepts / selfAssessmentAccuracy）
    await memoryWriteback('光合作用');
    releaseLlm();
    const res = await grow;

    expect(res.added).toBe(true);
    const saved = currentProfile();
    // 续章写入成功
    expect(saved.storyPool.some((s: any) => s.progressesFrom === 'story_1')).toBe(true);
    expect(saved.storyPool.find((s: any) => s.id === 'story_1').status).toBe('completed');
    // 记忆回写没有被回滚
    expect(saved.knownConcepts).toEqual(['光合作用']);
    expect(saved.selfAssessmentAccuracy).toBe('overconfident');
    expect(saved.nameHint).toBe('阿明');
  });

  it('幂等：LLM 窗口内已有并发续章写入则不重复生长', async () => {
    let releaseLlm: () => void = () => {};
    const llmGate = new Promise<void>((resolve) => { releaseLlm = resolve; });
    (executeSkill as jest.Mock).mockImplementation(async () => {
      await llmGate;
      return { story: { id: 'story_dup', title: '重复续章' } };
    });

    const grow = growStoryChapter({ profileId: 'p1', predecessorStoryId: 'story_1' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // 并发调用先写入了一条续章（幂等键 progressesFrom = story_1）
    await withKeyedLock(`vlab-profile:${row.userId}`, async () => {
      const fresh = currentProfile();
      fresh.storyPool = [...fresh.storyPool, { id: 'story_other', title: '别处长的', progressesFrom: 'story_1' }];
      await prismaMock.virtual_learner_profiles.update({ where: { id: row.id }, data: { profile: JSON.stringify(fresh) } });
    });
    releaseLlm();
    const res = await grow;

    expect(res).toEqual({ added: false, reason: 'successor-exists' });
    const saved = currentProfile();
    expect(saved.storyPool.some((s: any) => s.id === 'story_dup')).toBe(false);
    expect(saved.storyPool.filter((s: any) => s.progressesFrom === 'story_1')).toHaveLength(1);
  });
});
