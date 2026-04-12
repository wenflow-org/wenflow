/**
 * ContentAgent v3.0 - 策略选择机制类型定义
 * 
 * 定义 5 种内容策略及其配置
 */

// ==================== 策略枚举 ====================

/**
 * 内容策略类型
 * 
 * 5 种策略融合 v1.0 和 v5.0 的优点：
 * - SUPPORTIVE: 高挫败感时的支持鼓励
 * - BASIC: 低理解度时的基础引导
 * - STANDARD: 默认的标准对话
 * - CHALLENGE: 高掌握度时的挑战深化
 * - REMEDIAL: 连续错误时的针对性补救
 */
export enum ContentStrategy {
  SUPPORTIVE = 'SUPPORTIVE',     // 支持鼓励
  BASIC = 'BASIC',               // 基础引导
  STANDARD = 'STANDARD',         // 标准对话
  CHALLENGE = 'CHALLENGE',       // 挑战深化
  REMEDIAL = 'REMEDIAL'          // 针对性补救
}

// ==================== 核心接口 ====================

/**
 * UI 类型枚举
 */
export type UIType = 'choice' | 'input' | 'code' | 'reflection';

/**
 * 触发条件
 * 
 * 用于判断是否应该使用某个策略
 */
export interface TriggerCondition {
  /** 学生状态字段 */
  field: keyof StudentState;
  /** 比较运算符 */
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  /** 比较值 */
  value: number;
}

/**
 * 内容指导原则
 * 
 * 定义 AI 生成内容时的风格和要求
 */
export interface ContentGuideline {
  /** 语气（亲切/引导/挑战等） */
  tone: string;
  /** 代词使用（咱们/你/您） */
  pronounUsage: string;
  /** 难度级别 1-5 */
  difficultyLevel: number;
  /** 讲解深度（浅/中/深） */
  explanationDepth: string;
  /** 示例类型（生活类比/实际应用/抽象概念） */
  exampleType: string;
  /** 反馈风格（鼓励/中性/挑战） */
  feedbackStyle: string;
  /** 提示频率 0-1 */
  hintFrequency: number;
}

/**
 * 策略配置
 * 
 * 完整定义一个策略的所有属性
 */
export interface StrategyConfig {
  /** 策略类型 */
  type: ContentStrategy;
  /** 优先级（1-5，数字越小优先级越高） */
  priority: number;
  /** 触发条件列表 */
  triggerConditions: TriggerCondition[];
  /** 内容指导原则 */
  contentGuidelines: ContentGuideline;
  /** 推荐的 UI 类型 */
  uiTypeRecommendation: UIType;
  /** 难度调整值（-2 到 +2） */
  difficultyAdjustment: number;
}

/**
 * 学生状态接口
 * 
 * 整合 LSS/KTL/LF/LSB 学习状态追踪系统
 */
export interface StudentState {
  // 基础认知状态
  problemClarity: number;        // 问题清晰度 0-1
  confidence: number;            // 信心水平 0-1
  frustration: number;           // 挫败感 0-1
  cognitiveDepth: number;        // 认知深度 0-1
  learningStyle: string;         // 学习风格
  
  // 学习状态追踪系统指标
  currentLSS: number;            // 学习压力评分 (Learning Stress Score)
  currentKTL: number;            // 知识掌握度 (Knowledge Training Load)
  currentLF: number;             // 学习疲劳度 (Learning Fatigue)
  currentLSB: number;            // 学习状态平衡值 (Learning State Balance = KTL - LF)
  
  // 行为指标
  consecutiveErrors?: number;    // 连续错误次数
  previousScore?: number;        // 前一次得分
  silenceCount?: number;         // 沉默次数
  responseTime?: number;         // 响应时间（秒）
}

/**
 * 策略选择结果
 */
export interface StrategySelectionResult {
  /** 选中的策略配置 */
  strategy: StrategyConfig;
  /** 选择原因 */
  reason: string;
  /** 触发的条件 */
  triggeredConditions: TriggerCondition[];
  /** 得分 */
  score: number;
}

/**
 * 策略得分
 */
export interface StrategyScore {
  strategy: ContentStrategy;
  score: number;
  triggeredConditions: TriggerCondition[];
}
