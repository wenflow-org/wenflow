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
});
