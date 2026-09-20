import {
  PATH_DIFFICULTY_LEVELS,
  isPathDifficulty,
  normalizePathDifficulty,
} from '../path-difficulty';

describe('normalizePathDifficulty（路径难度唯一枚举口径）', () => {
  it('已是契约值：原样返回（大小写归一）', () => {
    for (const level of PATH_DIFFICULTY_LEVELS) {
      expect(normalizePathDifficulty(level)).toBe(level);
      expect(normalizePathDifficulty(level.toUpperCase())).toBe(level);
      expect(normalizePathDifficulty(`  ${level}  `)).toBe(level);
    }
  });

  it('明确零基础/无经验的短词 → beginner', () => {
    for (const raw of ['零基础', '零编程基础', '入门', '新手', '初学', '没学过', 'basic', 'novice']) {
      expect(normalizePathDifficulty(raw)).toBe('beginner');
    }
  });

  it('中级/进阶 → intermediate；高级/熟练 → advanced', () => {
    expect(normalizePathDifficulty('中级')).toBe('intermediate');
    expect(normalizePathDifficulty('有一定基础')).toBe('intermediate');
    expect(normalizePathDifficulty('进阶')).toBe('intermediate');
    expect(normalizePathDifficulty('高级')).toBe('advanced');
    expect(normalizePathDifficulty('熟练')).toBe('advanced');
    expect(normalizePathDifficulty('精通')).toBe('advanced');
  });

  it('缺失 / 空 / 非字符串 → unknown（不再默认 beginner）', () => {
    expect(normalizePathDifficulty(undefined)).toBe('unknown');
    expect(normalizePathDifficulty(null)).toBe('unknown');
    expect(normalizePathDifficulty('')).toBe('unknown');
    expect(normalizePathDifficulty('   ')).toBe('unknown');
    expect(normalizePathDifficulty(3)).toBe('unknown');
    expect(normalizePathDifficulty({ level: 'beginner' })).toBe('unknown');
  });

  it('自述长句 → unknown（不猜；含"非零基础"这类否定句）', () => {
    expect(normalizePathDifficulty('非零基础：护理本科、ICU 临床十几年，具备医药卫生专业背景')).toBe('unknown');
    expect(normalizePathDifficulty('能跑 pandas groupby 与尝试 Plotly，但缺失值处理不熟')).toBe('unknown');
    expect(normalizePathDifficulty('有 Python 编程基础，能写脚本，但无深度学习和图像处理经验')).toBe('unknown');
  });

  it('短但无水平语义的片段 → unknown', () => {
    expect(normalizePathDifficulty('见过类似逻辑')).toBe('unknown');
    expect(normalizePathDifficulty('不确定')).toBe('unknown');
  });

  it('isPathDifficulty 只认契约值', () => {
    expect(isPathDifficulty('beginner')).toBe(true);
    expect(isPathDifficulty('unknown')).toBe(true);
    expect(isPathDifficulty('零基础')).toBe(false);
    expect(isPathDifficulty(null)).toBe(false);
  });
});
