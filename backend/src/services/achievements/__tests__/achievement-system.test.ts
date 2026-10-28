import AchievementSystem, { ACHIEVEMENTS } from '../achievement-system';
import { calculateCurrentStreak } from '../achievement.service';
import { parseDayKeyStart } from '../../time/day-boundary';

/** 本地日 + 小时 → 绝对时刻（连击按应用时区本地日，测试数据须按本地日构造） */
const localAt = (dayKey: string, hour: number) =>
  new Date(parseDayKeyStart(dayKey).getTime() + hour * 3600 * 1000);

describe('achievement statistics', () => {
  const now = localAt('2026-07-18', 12);

  it('只统计从今天或昨天开始的连续自然日', () => {
    expect(calculateCurrentStreak([
      localAt('2026-07-18', 8),
      localAt('2026-07-17', 20),
      localAt('2026-07-16', 3),
      localAt('2026-07-16', 10),
    ], now)).toBe(3);

    expect(calculateCurrentStreak([
      localAt('2026-07-17', 8),
      localAt('2026-07-16', 8),
    ], now)).toBe(2);
  });

  it('遇到日期断档时停止累计', () => {
    expect(calculateCurrentStreak([
      localAt('2026-07-18', 8),
      localAt('2026-07-16', 8),
      localAt('2026-07-15', 8),
    ], now)).toBe(1);

    expect(calculateCurrentStreak([
      localAt('2026-07-15', 8),
    ], now)).toBe(0);
  });

  it('本地日界：本地 00:30 的学习算「今天」（UTC 切日会算成昨天）', () => {
    expect(calculateCurrentStreak([localAt('2026-07-18', 0.5)], now)).toBe(1);
  });

  it('路径完成成就展示真实进度', () => {
    const achievement = ACHIEVEMENTS.find(item => item.id === 'path_first');
    expect(achievement).toBeDefined();

    expect(AchievementSystem.getAchievementProgress(achievement!, {
      completedPaths: 1,
    })).toEqual({
      current: 1,
      total: 1,
      percentage: 100,
    });
  });

  it('掌握类成就按已掌握知识点数解锁，不再读 KTL', () => {
    const mastery = ACHIEVEMENTS.filter(item => item.id.startsWith('ktl_'));
    expect(mastery.map(item => item.requirement)).toEqual([
      { type: 'mastered_concepts', value: 3 },
      { type: 'mastered_concepts', value: 5 },
      { type: 'mastered_concepts', value: 10 },
    ]);

    const base = {
      completedTasks: 0,
      currentStreak: 0,
      completedPaths: 0,
      totalPaths: 0,
    };
    const unlockedAt = (masteredConcepts: number) =>
      AchievementSystem.checkAchievements({ ...base, masteredConcepts })
        .filter(item => item.id.startsWith('ktl_'))
        .map(item => item.name);

    expect(unlockedAt(2)).toEqual([]);
    expect(unlockedAt(3)).toEqual(['知识小成']);
    expect(unlockedAt(5)).toEqual(['知识小成', '知识大成']);
    expect(unlockedAt(10)).toEqual(['知识小成', '知识大成', '知识宗师']);
  });

  it('掌握类成就进度用知识点计数，不用高=坏的 KTL 数值', () => {
    const achievement = ACHIEVEMENTS.find(item => item.id === 'ktl_7');
    expect(achievement).toBeDefined();

    expect(AchievementSystem.getAchievementProgress(achievement!, {
      masteredConcepts: 4,
      ktl: 9,
    })).toEqual({
      current: 4,
      total: 5,
      percentage: 80,
    });
  });
});
