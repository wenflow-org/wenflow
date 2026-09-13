// 学习服务 - 模块级常量（自 learning.service.ts 抽离，行为保持不变）

export const STALE_GENERATING_PATH_MINUTES = 15;
export const ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES = [1, 5, 15] as const;

/**
 * P4：阶段任务自动重试的「不可自愈」冲突码。命中这些错误时重试多少次都不会好
 * （例如路径下已有已完成课堂，任务覆盖被安全校验永久挡住），应直接把自动重试计数
 * 顶到上限、停止自动重试；用户仍可在页面手动「重新准备阶段任务」。
 */
export const TERMINAL_STAGE_DESIGN_RETRY_CODES = new Set<string>([
  'PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE',
  'PATH_MUTATION_HAS_OPEN_SESSION',
  'PATH_VERSIONING_NOT_SUPPORTED'
]);

export const NEW_PATH_TASK_TYPES = ['acquire', 'deconstruct', 'model', 'execute', 'diagnose', 'refine', 'consolidate'] as const;

export const DISPLAY_LABEL_MAP: Record<string, Record<string, string>> = {
  factual: {
    remember: '了解基础知识',
    understand: '理解基本概念',
    apply: '应用基础知识',
    analyze: '分析知识结构',
    evaluate: '评估信息准确性',
    create: '构建知识框架'
  },
  conceptual: {
    remember: '记住关键概念',
    understand: '理解核心原理',
    apply: '应用概念解决问题',
    analyze: '深入分析原理',
    evaluate: '评估概念适用性',
    create: '构建概念模型'
  },
  procedural: {
    remember: '记住操作步骤',
    understand: '理解方法原理',
    apply: '动手实践',
    analyze: '分析操作逻辑',
    evaluate: '评估方法效果',
    create: '设计新方法'
  },
  metacognitive: {
    remember: '了解学习策略',
    understand: '理解学习方法',
    apply: '应用学习技巧',
    analyze: '分析学习状态',
    evaluate: '反思学习效果',
    create: '规划学习路径'
  }
};
