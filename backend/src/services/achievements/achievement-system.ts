// 成就系统定义
// Achievement Types and Unlock Logic

export interface AchievementDefinition {
  id: string;
  type: 'milestone' | 'streak' | 'completion' | 'mastery' | 'social';
  name: string;
  description: string;
  icon?: string;
  xpReward: number;
  requirement: {
    type: 'task_count' | 'streak_days' | 'path_completion' | 'mastered_concepts' | 'custom';
    value: number | string;
    condition?: (stats: any) => boolean;
  };
}

// 成就定义列表
export const ACHIEVEMENTS: AchievementDefinition[] = [
  // ===== 里程碑成就 =====
  {
    id: 'first_task',
    type: 'milestone',
    name: '初学者',
    description: '完成第一个任务',
    xpReward: 10,
    requirement: {
      type: 'task_count',
      value: 1
    }
  },
  {
    id: 'task_10',
    type: 'milestone',
    name: '渐入佳境',
    description: '完成10个任务',
    xpReward: 50,
    requirement: {
      type: 'task_count',
      value: 10
    }
  },
  {
    id: 'task_50',
    type: 'milestone',
    name: '学习达人',
    description: '完成50个任务',
    xpReward: 200,
    requirement: {
      type: 'task_count',
      value: 50
    }
  },
  {
    id: 'task_100',
    type: 'milestone',
    name: '学习专家',
    description: '完成100个任务',
    xpReward: 500,
    requirement: {
      type: 'task_count',
      value: 100
    }
  },

  // ===== 连续学习成就 =====
  {
    id: 'streak_3',
    type: 'streak',
    name: '持之以恒',
    description: '连续3天学习',
    xpReward: 30,
    requirement: {
      type: 'streak_days',
      value: 3
    }
  },
  {
    id: 'streak_7',
    type: 'streak',
    name: '七日坚持',
    description: '连续7天学习',
    xpReward: 100,
    requirement: {
      type: 'streak_days',
      value: 7
    }
  },
  {
    id: 'streak_30',
    type: 'streak',
    name: '月度冠军',
    description: '连续30天学习',
    xpReward: 500,
    requirement: {
      type: 'streak_days',
      value: 30
    }
  },

  // ===== 完成度成就 =====
  {
    id: 'path_first',
    type: 'completion',
    name: '初登路径',
    description: '完成第一条学习路径',
    xpReward: 100,
    requirement: {
      type: 'path_completion',
      value: 1
    }
  },
  {
    id: 'path_all',
    type: 'completion',
    name: '全能学习者',
    description: '完成所有任务的学习路径',
    xpReward: 1000,
    requirement: {
      type: 'custom',
      value: 'all_paths_complete',
      condition: (stats: any) => stats.completedPaths === stats.totalPaths && stats.totalPaths > 0
    }
  },

  // ===== 知识掌握成就 =====
  // 2026-10-23：阈值从 KTL 改为「已掌握知识点数」。KTL 是知识训练负荷（高=负荷重），
  // 与成就想要的「掌握水平（高=好）」语义相反；改用 memory_traces 的掌握证据计数。
  // id 保留 ktl_* 只为兼容既有解锁记录与外部引用，不再表示 KTL。
  {
    id: 'ktl_5',
    type: 'mastery',
    name: '知识小成',
    description: '掌握 3 个知识点',
    xpReward: 100,
    requirement: {
      type: 'mastered_concepts',
      value: 3
    }
  },
  {
    id: 'ktl_7',
    type: 'mastery',
    name: '知识大成',
    description: '掌握 5 个知识点',
    xpReward: 300,
    requirement: {
      type: 'mastered_concepts',
      value: 5
    }
  },
  {
    id: 'ktl_9',
    type: 'mastery',
    name: '知识宗师',
    description: '掌握 10 个知识点',
    xpReward: 1000,
    requirement: {
      type: 'mastered_concepts',
      value: 10
    }
  },

  // ===== 特殊成就 =====
  {
    id: 'perfect_week',
    type: 'milestone',
    name: '完美一周',
    description: '一周内完成所有计划任务',
    xpReward: 200,
    requirement: {
      type: 'custom',
      value: 'perfect_week',
      condition: (stats: any) => stats.weekCompletionRate === 1.0
    }
  },
  {
    id: 'speed_learner',
    type: 'mastery',
    name: '速成高手',
    description: '比预计时间提前50%完成任务',
    xpReward: 150,
    requirement: {
      type: 'custom',
      value: 'speed',
      condition: (stats: any) => stats.timeEfficiency >= 1.5
    }
  }
];

// 成就解锁检测
export class AchievementSystem {
  /**
   * 检查并解锁成就
   */
  static checkAchievements(stats: {
    completedTasks: number;
    currentStreak: number;
    completedPaths: number;
    totalPaths: number;
    masteredConcepts: number;
    weekCompletionRate?: number;
    timeEfficiency?: number;
  }): AchievementDefinition[] {
    const unlocked: AchievementDefinition[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (this.isAchievementUnlocked(achievement, stats)) {
        unlocked.push(achievement);
      }
    }

    return unlocked;
  }

  /**
   * 检查单个成就是否解锁
   */
  private static isAchievementUnlocked(
    achievement: AchievementDefinition,
    stats: any
  ): boolean {
    const { requirement } = achievement;

    switch (requirement.type) {
      case 'task_count':
        return stats.completedTasks >= requirement.value;

      case 'streak_days':
        return stats.currentStreak >= requirement.value;

      case 'path_completion':
        return stats.completedPaths >= requirement.value;

      case 'mastered_concepts':
        return (stats.masteredConcepts ?? 0) >= requirement.value;

      case 'custom':
        return requirement.condition?.(stats) || false;

      default:
        return false;
    }
  }

  /**
   * 获取成就进度
   */
  static getAchievementProgress(
    achievement: AchievementDefinition,
    stats: any
  ): { current: number; total: number; percentage: number } {
    const { requirement } = achievement;
    let current = 0;
    let total = 1;

    switch (requirement.type) {
      case 'task_count':
        current = stats.completedTasks || 0;
        total = requirement.value as number;
        break;

      case 'streak_days':
        current = stats.currentStreak || 0;
        total = requirement.value as number;
        break;

      case 'path_completion':
        current = stats.completedPaths || 0;
        total = requirement.value as number;
        break;

      case 'mastered_concepts':
        current = stats.masteredConcepts || 0;
        total = requirement.value as number;
        break;

      default:
        current = 0;
        total = 1;
    }

    const percentage = Math.min(100, Math.round((current / total) * 100));

    return { current, total, percentage };
  }
}

export default AchievementSystem;
