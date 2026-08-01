import AchievementSystem, { ACHIEVEMENTS } from '../achievement-system';
import { calculateCurrentStreak } from '../achievement.service';

describe('achievement statistics', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');

  it('只统计从今天或昨天开始的连续自然日', () => {
    expect(calculateCurrentStreak([
      new Date('2026-07-18T08:00:00.000Z'),
      new Date('2026-07-17T20:00:00.000Z'),
      new Date('2026-07-16T03:00:00.000Z'),
      new Date('2026-07-16T10:00:00.000Z'),
    ], now)).toBe(3);

    expect(calculateCurrentStreak([
      new Date('2026-07-17T08:00:00.000Z'),
      new Date('2026-07-16T08:00:00.000Z'),
    ], now)).toBe(2);
  });

  it('遇到日期断档时停止累计', () => {
    expect(calculateCurrentStreak([
      new Date('2026-07-18T08:00:00.000Z'),
      new Date('2026-07-16T08:00:00.000Z'),
      new Date('2026-07-15T08:00:00.000Z'),
    ], now)).toBe(1);

    expect(calculateCurrentStreak([
      new Date('2026-07-15T08:00:00.000Z'),
    ], now)).toBe(0);
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
