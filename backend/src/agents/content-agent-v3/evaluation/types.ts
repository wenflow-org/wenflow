/**
 * ContentAgent v3.0 - 评估参数生成器类型定义
 * 
 * 定义课堂内评估所需参数接口
 */

// ==================== 布鲁姆认知层级 ====================

/**
 * 布鲁姆认知过程维度（修订版）
 * 
 * 从低阶思维到高阶思维的六个层级
 */
export type BloomLevel = 
  | 'remember'      // 记忆：回忆、识别
  | 'understand'    // 理解：解释、举例、分类、总结、推断、比较、说明
  | 'apply'         // 应用：执行、实施
  | 'analyze'       // 分析：区分、组织、归因
  | 'evaluate'      // 评估：检查、判断
  | 'create';       // 创造：生成、计划、生产

// ==================== 期望的理解表现 ====================

/**
 * 期望的理解表现
 * 
 * 定义学生在完成任务后应该达到的理解水平
 */
export interface ExpectedUnderstanding {
  /** 学生应该能够做什么（技能） */
  canDo: string[];
  
  /** 学生应该能够解释什么（理解） */
  canExplain: string[];
  
  /** 学生应该能够识别什么（辨识） */
  canIdentify: string[];
  
  /** 认知层级（布鲁姆分类法） */
  cognitiveLevel: BloomLevel;
}

// ==================== 评估标准 ====================

/**
 * 评分标准细则
 * 
 * 定义每个等级的具体评判标准
 */
export interface RubricCriteria {
  /** 理解深度描述 */
  understandingDepth: string;
  
  /** 表达清晰度描述 */
  clarityOfExpression: string;
  
  /** 应用能力描述 */
  applicationAbility: string;
  
  /** 允许的关键错误数量 */
  criticalErrorsAllowed: number;
  
  /** 示例回答特征 */
  exampleCharacteristics: string[];
}

/**
 * 评估标准
 * 
 * 包含四个等级的评分标准
 */
export interface AssessmentCriteria {
  /** 优秀（90-100 分） */
  excellent: RubricCriteria;
  
  /** 良好（70-89 分） */
  good: RubricCriteria;
  
  /** 一般（50-69 分） */
  fair: RubricCriteria;
  
  /** 需改进（0-49 分） */
  poor: RubricCriteria;
}

// ==================== 预测的误解 ====================

/**
 * 误解类型
 */
export type MisconceptionType = 
  | 'conceptual'    // 概念性误解（理解错误）
  | 'procedural'    // 程序性误解（操作错误）
  | 'factual';      // 事实性误解（记忆错误）

/**
 * 预测的误解
 * 
 * 基于任务和学生状态预测可能出现的误解
 */
export interface PredictedMisconception {
  /** 误解内容描述 */
  misconception: string;
  
  /** 可能出现的概率（0-1） */
  probability: number;
  
  /** 误解类型 */
  type: MisconceptionType;
  
  /** 如何检测该误解 */
  detectionHint: string;
  
  /** 如何纠正该误解 */
  correctionStrategy: string;
}

// ==================== 评估参数输出 ====================

/**
 * 评估参数
 * 
 * 课堂内评估的完整参数配置，供 AssessmentAgent 使用
 */
export interface EvaluationParams {
  /** 期望的理解表现 */
  expectedUnderstanding: ExpectedUnderstanding;
  
  /** 评估标准 */
  assessmentCriteria: AssessmentCriteria;
  
  /** 补救触发阈值（0-100）
   * 低于此分数触发针对性补救策略
   */
  remedialThreshold: number;
  
  /** 进阶触发阈值（0-100）
   * 高于此分数触发挑战深化策略
   */
  advancementThreshold: number;
  
  /** 关键概念列表（3-5 个） */
  keyConcepts: string[];
  
  /** 常见误解预测（2-3 个） */
  predictedMisconceptions: PredictedMisconception[];
}

// ==================== 辅助类型 ====================

/**
 * 任务信息
 * 
 * 当前学习任务的元数据
 */
export interface TaskInfo {
  /** 任务标题 */
  title: string;
  
  /** 任务描述 */
  description: string;
  
  /** 任务类型 */
  type?: 'reading' | 'practice' | 'project' | 'quiz';
  
  /** 所属学科 */
  subject?: string;
  
  /** 预计时长（分钟） */
  estimatedMinutes?: number;
}

/**
 * 学生状态（简化版，用于评估参数生成）
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
 * 内容策略类型（引用自策略模块）
 */
export type ContentStrategy = 
  | 'SUPPORTIVE'    // 支持鼓励
  | 'BASIC'         // 基础引导
  | 'STANDARD'      // 标准对话
  | 'CHALLENGE'     // 挑战深化
  | 'REMEDIAL';     // 针对性补救
