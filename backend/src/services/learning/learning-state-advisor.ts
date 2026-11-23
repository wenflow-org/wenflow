/**
 * 对话认知层级分析与学习建议（2026-10-24 架构优化批 1 拆分）。
 *
 * 从 learning-state.service.ts 迁出的**纯逻辑**：与状态持久化无关的旧展示 API
 * （布鲁姆分类法关键词启发式 + 静态建议文案）。服务类保留同名薄委托，既有调用方不受影响。
 */
import { type LearningStateMetrics } from './learning-state-types';
import { classifyLoad } from './learning-load-verdict';

// 认知层级
export enum CognitiveLevel {
  REMEMBER = 'remember',      // 记忆
  UNDERSTAND = 'understand',  // 理解
  APPLY = 'apply',            // 应用
  ANALYZE = 'analyze',        // 分析
  EVALUATE = 'evaluate',      // 评估
  CREATE = 'create',          // 创造
}

// 对话分析结果
export interface DialogueAnalysis {
  cognitiveLevel: CognitiveLevel;
  understanding: number;       // 理解度 0-1
  confusionPoints: string[];   // 困惑点
  engagement: number;          // 参与度 0-1
  emotionalState: 'positive' | 'neutral' | 'frustrated' | 'confused';
}

// 干预类型
export type InterventionType =
  | 'hint'           // 提示
  | 'explanation'    // 解释
  | 'example'        // 示例
  | 'simplification' // 简化
  | 'challenge'      // 挑战
  | 'break'          // 休息建议
  | 'encouragement'; // 鼓励

// 干预决策
export interface InterventionDecision {
  type: InterventionType;
  priority: number;        // 优先级 1-10
  content: string;         // 干预内容
  reasoning: string;       // 决策理由
}

/**
 * 分析对话认知层级
 * 基于布鲁姆分类法 (Bloom's Taxonomy)
 */
export function analyzeCognitiveLevel(studentMessage: string, _contextMessage?: string): DialogueAnalysis {
  const message = studentMessage.toLowerCase();

  // 关键词映射到认知层级
  const levelKeywords: Record<CognitiveLevel, string[]> = {
    [CognitiveLevel.REMEMBER]: ['什么是', '定义', '记住', '列举', '名称', '概念'],
    [CognitiveLevel.UNDERSTAND]: ['为什么', '解释', '理解', '意思', '区别', '比较'],
    [CognitiveLevel.APPLY]: ['怎么用', '应用', '实践', '例子', '如何使用', '实现'],
    [CognitiveLevel.ANALYZE]: ['分析', '分解', '关系', '结构', '原理', '为什么这样'],
    [CognitiveLevel.EVALUATE]: ['评估', '判断', '优劣', '哪个更好', '建议', '推荐'],
    [CognitiveLevel.CREATE]: ['创造', '设计', '构建', '方案', '如果', '改进'],
  };

  // 困惑关键词
  const confusionKeywords = ['不懂', '不明白', '困惑', '疑惑', '为什么', '怎么', '错', '失败'];
  const confusionPoints: string[] = [];

  for (const keyword of confusionKeywords) {
    if (message.includes(keyword)) {
      confusionPoints.push(keyword);
    }
  }

  // 判断认知层级
  let detectedLevel: CognitiveLevel = CognitiveLevel.REMEMBER;
  let maxMatches = 0;

  for (const [level, keywords] of Object.entries(levelKeywords)) {
    const matches = keywords.filter(k => message.includes(k)).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      detectedLevel = level as CognitiveLevel;
    }
  }

  // 计算理解度（基于问题复杂度）
  const understanding = maxMatches > 0 ? Math.min(1, 0.3 + maxMatches * 0.2) : 0.5;

  // 计算参与度（基于消息长度和复杂度）
  const engagement = Math.min(1, studentMessage.length / 100);

  // 判断情绪状态
  let emotionalState: DialogueAnalysis['emotionalState'] = 'neutral';
  if (message.includes('谢谢') || message.includes('明白') || message.includes('懂了')) {
    emotionalState = 'positive';
  } else if (message.includes('难') || message.includes('不会') || message.includes('失败')) {
    emotionalState = 'frustrated';
  } else if (confusionPoints.length > 0) {
    emotionalState = 'confused';
  }

  return {
    cognitiveLevel: detectedLevel,
    understanding,
    confusionPoints,
    engagement,
    emotionalState,
  };
}

/**
 * 生成学习建议。
 *
 * 2026-11-23 复核（控制面/状态页双判据分裂）：原实现自写一套绝对阈值（lf>7 / lsb<0 / ktl>7&&lsb<2），
 * 与快照 paceMode 的 ACWR/form 判据不同源——会出现「后台已 recover、状态页一派祥和」或反向打架。
 * 现统一消费 `classifyLoad` 的裁决（与 LearnerSnapshotService / 课堂同一真理源）：
 * - 高疲劳 = ACWR ≥ 1.5（相对量，尺度无关；冷启动 ktl<3 时 acwr=null 不误报）
 * - 状态不佳 = form<0 且基座成熟（冷启动爬升期 lsb<0 属正常，不再报「状态不佳」）
 * - 该巩固 = 知识基座已厚（ktl≥7）且明显有余力（ACWR≤0.5）——继续加新内容不如练习巩固
 * - 状态良好 = 恢复良好（ACWR≤0.85）且本节压力低（lss<5）
 */
export function generateSuggestion(metrics: LearningStateMetrics): {
  type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy' | 'good';
  title: string;
  message: string;
} {
  const { lss, ktl, lf } = metrics;
  const verdict = classifyLoad({ ktl, lf });

  // 高疲劳（ACWR 高档）
  if (verdict.fatigueRisk === 'high') {
    return {
      type: 'fatigue',
      title: '需要休息',
      message: '你的学习疲劳度较高，建议休息后再继续。',
    };
  }

  // 负荷失衡（form<0 且基座成熟）
  if (verdict.imbalanced) {
    return {
      type: 'lsb_negative',
      title: '状态不佳',
      message: '当前疲劳超过知识积累，建议调整学习节奏。',
    };
  }

  // 需要巩固（基座已厚 + 明显有余力）
  if (verdict.accelerateReady && ktl >= 7) {
    return {
      type: 'overstudy',
      title: '需要巩固',
      message: '已掌握较多知识，建议通过练习巩固而非继续学习新内容。',
    };
  }

  // 状态良好（恢复良好 + 本节压力低）
  if (verdict.recovered && lss < 5) {
    return {
      type: 'good',
      title: '状态良好',
      message: '你的学习状态很好，继续保持！',
    };
  }

  // 默认
  return {
    type: 'efficiency_drop',
    title: '注意效率',
    message: '当前学习效率一般，建议调整学习方法。',
  };
}
