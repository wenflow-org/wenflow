/**
 * ContentAgent v3.0 - 评估参数生成器
 * 
 * 生成课堂内评估所需参数，供 AssessmentAgent 使用
 * 
 * 核心功能：
 * 1. 根据策略和学生状态生成期望的理解表现
 * 2. 生成多维度评估标准（优秀/良好/一般/需改进）
 * 3. 计算补救和进阶触发阈值
 * 4. 提取关键概念
 * 5. 预测常见误解
 */

import {
  EvaluationParams,
  ExpectedUnderstanding,
  AssessmentCriteria,
  RubricCriteria,
  PredictedMisconception,
  BloomLevel,
  StudentState,
  TaskInfo,
  ContentStrategy
} from './types';
import { StrategyConfig } from '../strategies/types';
import aiService from '../../../services/ai/ai.service';
import { logger } from '../../../utils/logger';

/**
 * 评估参数生成器类
 */
export class EvaluationParamsGenerator {
  
  /**
   * 生成评估参数
   * 
   * @param conversationObjective 对话目标
   * @param strategy 当前策略
   * @param studentState 学生状态
   * @param taskInfo 任务信息
   * @returns 评估参数
   */
  async generate(
    conversationObjective: string,
    strategy: ContentStrategy,
    studentState: StudentState,
    taskInfo: TaskInfo
  ): Promise<EvaluationParams> {
    logger.info('开始生成评估参数', {
      objective: conversationObjective.substring(0, 100),
      strategy,
      studentState: {
        problemClarity: studentState.problemClarity,
        cognitiveDepth: studentState.cognitiveDepth,
        currentKTL: studentState.currentKTL,
        currentLF: studentState.currentLF
      }
    });

    try {
      const expectedUnderstanding = this.generateExpectedUnderstanding(
        conversationObjective,
        strategy,
        studentState
      );
      
      const assessmentCriteria = this.generateAssessmentCriteria(
        conversationObjective,
        strategy,
        studentState
      );
      
      const remedialThreshold = this.calculateRemedialThreshold(strategy, studentState);
      const advancementThreshold = this.calculateAdvancementThreshold(strategy, studentState);
      
      const keyConcepts = await this.extractKeyConcepts(conversationObjective, taskInfo);
      const predictedMisconceptions = await this.predictMisconceptions(
        conversationObjective,
        taskInfo,
        studentState
      );

      const result: EvaluationParams = {
        expectedUnderstanding,
        assessmentCriteria,
        remedialThreshold,
        advancementThreshold,
        keyConcepts,
        predictedMisconceptions
      };

      logger.info('评估参数生成完成', {
        keyConceptsCount: keyConcepts.length,
        misconceptionsCount: predictedMisconceptions.length,
        remedialThreshold,
        advancementThreshold
      });

      return result;
    } catch (error: any) {
      logger.error('评估参数生成失败:', error);
      
      // 返回默认参数（降级处理）
      return this.getDefaultParams(strategy);
    }
  }

  /**
   * 生成期望的理解表现
   * 
   * @param objective 学习目标
   * @param strategy 内容策略
   * @param studentState 学生状态
   * @returns 期望的理解表现
   */
  private generateExpectedUnderstanding(
    objective: string,
    strategy: ContentStrategy,
    studentState: StudentState
  ): ExpectedUnderstanding {
    // 根据策略调整期望的认知层级
    const cognitiveLevel = this.determineCognitiveLevel(strategy, studentState);
    
    return {
      canDo: this.generateCanDoStatements(objective, cognitiveLevel, strategy),
      canExplain: this.generateCanExplainStatements(objective, cognitiveLevel, strategy),
      canIdentify: this.generateCanIdentifyStatements(objective, cognitiveLevel, strategy),
      cognitiveLevel
    };
  }

  /**
   * 确定认知层级（布鲁姆分类法）
   * 
   * 基于策略和学生状态动态调整
   * 
   * @param strategy 内容策略
   * @param studentState 学生状态
   * @returns 布鲁姆认知层级
   */
  private determineCognitiveLevel(
    strategy: ContentStrategy,
    studentState: StudentState
  ): BloomLevel {
    // 基础引导和支持鼓励 → 记忆/理解（低阶思维）
    if (strategy === 'BASIC' || strategy === 'SUPPORTIVE') {
      // 问题清晰度低 → 记忆层级
      // 问题清晰度中等 → 理解层级
      return studentState.problemClarity < 0.3 ? 'remember' : 'understand';
    }
    
    // 标准对话 → 理解/应用（中阶思维）
    if (strategy === 'STANDARD') {
      // 根据认知深度调整
      return studentState.cognitiveDepth > 0.5 ? 'apply' : 'understand';
    }
    
    // 挑战深化 → 分析/评估/创造（高阶思维）
    if (strategy === 'CHALLENGE') {
      // 认知深度高 → 评估/创造
      // 认知深度中等 → 分析
      if (studentState.cognitiveDepth > 0.7) {
        return 'evaluate';
      } else if (studentState.cognitiveDepth > 0.5) {
        return 'analyze';
      } else {
        return 'apply';
      }
    }
    
    // 针对性补救 → 回到理解（重建基础）
    if (strategy === 'REMEDIAL') {
      return 'understand';
    }
    
    // 默认返回理解层级
    return 'understand';
  }

  /**
   * 生成"能够做"的陈述
   * 
   * @param objective 学习目标
   * @param cognitiveLevel 认知层级
   * @param strategy 策略类型
   * @returns 能够做的陈述列表
   */
  private generateCanDoStatements(
    objective: string,
    cognitiveLevel: BloomLevel,
    strategy: ContentStrategy
  ): string[] {
    const statements: string[] = [];
    
    // 根据认知层级生成对应的能力陈述
    switch (cognitiveLevel) {
      case 'remember':
        statements.push('能够准确回忆关键概念和术语');
        statements.push('能够识别相关示例和非示例');
        statements.push('能够列出主要步骤或要素');
        break;
        
      case 'understand':
        statements.push('能够用自己的话解释核心概念');
        statements.push('能够区分相关和不相关的信息');
        statements.push('能够举例说明概念的应用场景');
        break;
        
      case 'apply':
        statements.push('能够应用概念解决标准问题');
        statements.push('能够选择合适的工具或方法');
        statements.push('能够按照步骤执行操作');
        break;
        
      case 'analyze':
        statements.push('能够分析问题并识别关键因素');
        statements.push('能够比较不同方法的优劣');
        statements.push('能够分解复杂问题为简单部分');
        break;
        
      case 'evaluate':
        statements.push('能够评估解决方案的有效性');
        statements.push('能够提出改进建议');
        statements.push('能够判断信息的质量和可靠性');
        break;
        
      case 'create':
        statements.push('能够设计新的解决方案');
        statements.push('能够综合运用多个概念完成任务');
        statements.push('能够创造性地应用所学知识');
        break;
    }
    
    // 根据策略调整语气
    if (strategy === 'SUPPORTIVE') {
      statements.unshift('在提示下能够完成基本操作');
    } else if (strategy === 'CHALLENGE') {
      statements.push('能够独立解决具有挑战性的问题');
    }
    
    return statements;
  }

  /**
   * 生成"能够解释"的陈述
   * 
   * @param objective 学习目标
   * @param cognitiveLevel 认知层级
   * @param strategy 策略类型
   * @returns 能够解释的陈述列表
   */
  private generateCanExplainStatements(
    objective: string,
    cognitiveLevel: BloomLevel,
    strategy: ContentStrategy
  ): string[] {
    const statements: string[] = [];
    
    switch (cognitiveLevel) {
      case 'remember':
        statements.push('能够说出概念的基本定义');
        break;
        
      case 'understand':
        statements.push('能够解释概念的含义和重要性');
        statements.push('能够说明为什么使用这个方法');
        break;
        
      case 'apply':
        statements.push('能够解释解题思路和步骤');
        statements.push('能够说明方法选择的理由');
        break;
        
      case 'analyze':
        statements.push('能够分析不同方案的优缺点');
        statements.push('能够解释各部分之间的关系');
        break;
        
      case 'evaluate':
        statements.push('能够评估方案的有效性并说明理由');
        statements.push('能够提出批判性的见解');
        break;
        
      case 'create':
        statements.push('能够解释设计方案的整体思路');
        statements.push('能够说明创新点的价值');
        break;
    }
    
    return statements;
  }

  /**
   * 生成"能够识别"的陈述
   * 
   * @param objective 学习目标
   * @param cognitiveLevel 认知层级
   * @param strategy 策略类型
   * @returns 能够识别的陈述列表
   */
  private generateCanIdentifyStatements(
    objective: string,
    cognitiveLevel: BloomLevel,
    strategy: ContentStrategy
  ): string[] {
    const statements: string[] = [];
    
    switch (cognitiveLevel) {
      case 'remember':
        statements.push('能够识别关键术语和概念');
        statements.push('能够辨认基本类型和分类');
        break;
        
      case 'understand':
        statements.push('能够识别概念的正例和反例');
        statements.push('能够辨认常见的应用场景');
        break;
        
      case 'apply':
        statements.push('能够识别问题所属的类型');
        statements.push('能够辨认适用的方法或工具');
        break;
        
      case 'analyze':
        statements.push('能够识别问题中的关键因素');
        statements.push('能够辨认潜在的假设和限制');
        break;
        
      case 'evaluate':
        statements.push('能够识别论证中的逻辑漏洞');
        statements.push('能够辨认信息的质量问题');
        break;
        
      case 'create':
        statements.push('能够识别创新的机会点');
        statements.push('能够辨认整合资源的可能性');
        break;
    }
    
    return statements;
  }

  /**
   * 生成评估标准细则
   * 
   * @param objective 学习目标
   * @param strategy 内容策略
   * @param studentState 学生状态
   * @returns 评估标准
   */
  private generateAssessmentCriteria(
    objective: string,
    strategy: ContentStrategy,
    studentState: StudentState
  ): AssessmentCriteria {
    const cognitiveLevel = this.determineCognitiveLevel(strategy, studentState);
    const difficulty = this.calculateDifficulty(strategy, studentState);
    
    return {
      excellent: this.generateRubric('excellent', cognitiveLevel, difficulty, strategy),
      good: this.generateRubric('good', cognitiveLevel, difficulty, strategy),
      fair: this.generateRubric('fair', cognitiveLevel, difficulty, strategy),
      poor: this.generateRubric('poor', cognitiveLevel, difficulty, strategy)
    };
  }

  /**
   * 生成评分标准
   * 
   * @param level 等级
   * @param cognitiveLevel 认知层级
   * @param difficulty 难度系数
   * @param strategy 策略类型
   * @returns 评分标准细则
   */
  private generateRubric(
    level: 'excellent' | 'good' | 'fair' | 'poor',
    cognitiveLevel: BloomLevel,
    difficulty: number,
    strategy: ContentStrategy
  ): RubricCriteria {
    // 基础 rubric 模板
    const rubrics: Record<string, RubricCriteria> = {
      excellent: {
        understandingDepth: '完全理解概念，能够深入解释原理和内在联系',
        clarityOfExpression: '表达清晰准确，使用恰当的学科术语',
        applicationAbility: '能够灵活应用概念解决新问题，展示迁移能力',
        criticalErrorsAllowed: 0,
        exampleCharacteristics: [
          '回答完整且深入，展示系统性理解',
          '包含多个角度的理解和分析',
          '能够举出恰当的例子或应用',
          '展示出高阶思维（分析/评估/创造）',
          '逻辑清晰，论证充分'
        ]
      },
      good: {
        understandingDepth: '理解核心概念，解释基本准确，偶有模糊点',
        clarityOfExpression: '表达较清晰，偶有术语使用不当但不影响理解',
        applicationAbility: '能够应用概念解决标准问题，需要少量提示',
        criticalErrorsAllowed: 1,
        exampleCharacteristics: [
          '回答较为完整，覆盖主要知识点',
          '展示了主要理解，但深度有限',
          '能够解决大部分标准问题',
          '偶有小错误但不影响整体理解',
          '逻辑基本清晰'
        ]
      },
      fair: {
        understandingDepth: '部分理解概念，但存在模糊点和误解',
        clarityOfExpression: '表达基本清楚，但不够准确或完整',
        applicationAbility: '在提示下能够应用概念，独立应用能力有限',
        criticalErrorsAllowed: 2,
        exampleCharacteristics: [
          '回答不够完整，遗漏关键点',
          '理解停留在表面，缺乏深度',
          '需要额外提示才能完成任务',
          '存在一些误解但不严重',
          '逻辑不够清晰，需要整理'
        ]
      },
      poor: {
        understandingDepth: '理解有限，存在明显误解或概念混淆',
        clarityOfExpression: '表达模糊或混乱，难以理解其意图',
        applicationAbility: '难以应用概念，需要重新讲解和引导',
        criticalErrorsAllowed: 3,
        exampleCharacteristics: [
          '回答严重不完整或偏离主题',
          '展示明显误解或概念错误',
          '无法独立解决问题',
          '需要重新讲解核心概念',
          '逻辑混乱，缺乏条理'
        ]
      }
    };
    
    const baseRubric = rubrics[level];
    
    // 根据策略调整
    if (strategy === 'SUPPORTIVE' || strategy === 'BASIC') {
      // 支持鼓励策略：降低要求，增加容错
      return {
        ...baseRubric,
        criticalErrorsAllowed: baseRubric.criticalErrorsAllowed + 1,
        exampleCharacteristics: [
          '在提示下能够展示基本理解',
          ...baseRubric.exampleCharacteristics.slice(1)
        ]
      };
    } else if (strategy === 'CHALLENGE') {
      // 挑战深化策略：提高要求，强调深度
      return {
        ...baseRubric,
        understandingDepth: level === 'excellent' 
          ? '深刻理解概念，能够进行批判性思考和拓展' 
          : baseRubric.understandingDepth,
        exampleCharacteristics: [
          '展示独立思考和深度分析能力',
          ...baseRubric.exampleCharacteristics.slice(1)
        ]
      };
    }
    
    return baseRubric;
  }

  /**
   * 计算难度系数
   * 
   * @param strategy 策略类型
   * @param studentState 学生状态
   * @returns 难度系数 0-1
   */
  private calculateDifficulty(
    strategy: ContentStrategy,
    studentState: StudentState
  ): number {
    // 基础难度（策略决定）
    let baseDifficulty = 0.5;
    
    switch (strategy) {
      case 'SUPPORTIVE':
        baseDifficulty = 0.3;
        break;
      case 'BASIC':
        baseDifficulty = 0.4;
        break;
      case 'STANDARD':
        baseDifficulty = 0.5;
        break;
      case 'CHALLENGE':
        baseDifficulty = 0.8;
        break;
      case 'REMEDIAL':
        baseDifficulty = 0.3;
        break;
    }
    
    // 根据学生状态调整
    const stateAdjustment = (
      (1 - studentState.problemClarity) * 0.2 +
      (1 - studentState.confidence) * 0.1 +
      studentState.frustration * 0.1
    );
    
    return Math.min(1, Math.max(0, baseDifficulty + stateAdjustment));
  }

  /**
   * 计算补救触发阈值
   * 
   * 低于此分数触发针对性补救策略
   * 
   * @param strategy 策略类型
   * @param studentState 学生状态
   * @returns 补救阈值（0-100）
   */
  private calculateRemedialThreshold(
    strategy: ContentStrategy,
    studentState: StudentState
  ): number {
    // 基础阈值
    let baseThreshold = 60;
    
    // 基础引导和支持鼓励 → 降低阈值（更容易触发补救）
    if (strategy === 'BASIC' || strategy === 'SUPPORTIVE') {
      baseThreshold = 50;
    }
    
    // 挑战深化 → 提高阈值（更难触发补救，鼓励尝试）
    if (strategy === 'CHALLENGE') {
      baseThreshold = 70;
    }
    
    // 针对性补救 → 最低阈值
    if (strategy === 'REMEDIAL') {
      baseThreshold = 40;
    }
    
    // 根据学生状态微调
    // 连续错误多 → 降低阈值
    if (studentState.consecutiveErrors && studentState.consecutiveErrors >= 3) {
      baseThreshold -= 10;
    }
    
    // 挫败感高 → 降低阈值（更容易获得帮助）
    if (studentState.frustration > 0.7) {
      baseThreshold -= 5;
    }
    
    return Math.min(100, Math.max(0, baseThreshold));
  }

  /**
   * 计算进阶触发阈值
   * 
   * 高于此分数触发挑战深化策略
   * 
   * @param strategy 策略类型
   * @param studentState 学生状态
   * @returns 进阶阈值（0-100）
   */
  private calculateAdvancementThreshold(
    strategy: ContentStrategy,
    studentState: StudentState
  ): number {
    // 基础阈值
    let baseThreshold = 85;
    
    // 基础引导 → 降低进阶门槛（鼓励进步）
    if (strategy === 'BASIC' || strategy === 'SUPPORTIVE') {
      baseThreshold = 75;
    }
    
    // 挑战深化 → 提高进阶门槛（更高要求）
    if (strategy === 'CHALLENGE') {
      baseThreshold = 90;
    }
    
    // 针对性补救 → 标准门槛
    if (strategy === 'REMEDIAL') {
      baseThreshold = 80;
    }
    
    // 根据学生状态微调
    // 知识掌握度高 → 降低门槛（更容易进阶）
    if (studentState.currentKTL > 0.7) {
      baseThreshold -= 5;
    }
    
    // 学习疲劳度高 → 提高门槛（谨慎进阶）
    if (studentState.currentLF > 0.6) {
      baseThreshold += 5;
    }
    
    return Math.min(100, Math.max(0, baseThreshold));
  }

  /**
   * 提取关键概念
   * 
   * 使用 AI 从学习目标中提取关键概念（3-5 个）
   * 
   * @param objective 学习目标
   * @param taskInfo 任务信息
   * @returns 关键概念列表
   */
  private async extractKeyConcepts(
    objective: string,
    taskInfo: TaskInfo
  ): Promise<string[]> {
    const prompt = `从以下学习目标中提取关键概念（3-5 个）：

学习目标：${objective}
任务主题：${taskInfo.title}
任务描述：${taskInfo.description}
${taskInfo.subject ? `学科领域：${taskInfo.subject}` : ''}

请只返回 JSON 数组格式的概念列表，不要其他内容：
["概念 1", "概念 2", "概念 3"]`;

    try {
      const response = await this.callAI(prompt, 'extractKeyConcepts');
      
      // 尝试解析 JSON
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const concepts = JSON.parse(jsonMatch[0]);
        logger.info('关键概念提取成功', { concepts });
        return Array.isArray(concepts) ? concepts : [];
      }
      
      return [];
    } catch (error: any) {
      logger.error('关键概念提取失败:', error.message);
      // 降级处理：返回空数组
      return [];
    }
  }

  /**
   * 预测常见误解
   * 
   * 基于历史数据和任务特点预测学生可能出现的误解（2-3 个）
   * 
   * @param objective 学习目标
   * @param taskInfo 任务信息
   * @param studentState 学生状态
   * @returns 预测的误解列表
   */
  private async predictMisconceptions(
    objective: string,
    taskInfo: TaskInfo,
    studentState: StudentState
  ): Promise<PredictedMisconception[]> {
    const studentLevel = studentState.problemClarity < 0.3 ? '初学者' : 
                         studentState.problemClarity < 0.6 ? '有一定基础' : '基础较好';
    
    const prompt = `预测学生在学习以下内容时可能出现的误解：

学习目标：${objective}
任务主题：${taskInfo.title}
${taskInfo.subject ? `学科领域：${taskInfo.subject}` : ''}
学生当前水平：${studentLevel}

请预测 2-3 个最可能的误解，以 JSON 数组格式返回：
[
  {
    "misconception": "误解的具体内容描述",
    "probability": 0.7,
    "type": "conceptual",
    "detectionHint": "通过学生的什么表现可以检测到这个误解",
    "correctionStrategy": "如何纠正这个误解的具体策略"
  }
]

误解类型（type）只能是：conceptual（概念性）、procedural（程序性）、factual（事实性）`;

    try {
      const response = await this.callAI(prompt, 'predictMisconceptions');
      
      // 尝试解析 JSON
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const misconceptions = JSON.parse(jsonMatch[0]);
        logger.info('误解预测成功', { count: misconceptions.length });
        return Array.isArray(misconceptions) ? misconceptions : [];
      }
      
      return [];
    } catch (error: any) {
      logger.error('误解预测失败:', error.message);
      return [];
    }
  }

  /**
   * 调用 AI 服务
   * 
   * @param prompt 提示词
   * @param action 操作类型（用于日志记录）
   * @returns AI 响应内容
   */
  private async callAI(prompt: string, action: string): Promise<string> {
    try {
      const response = await aiService.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,  // 较低温度保证稳定性
        maxTokens: 1000,
        agentId: 'content-agent-v3',
        userId: 'system',
        action
      });
      
      return response.content;
    } catch (error: any) {
      logger.error('AI 调用失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取默认评估参数（降级处理）
   * 
   * @param strategy 策略类型
   * @returns 默认评估参数
   */
  private getDefaultParams(strategy: ContentStrategy): EvaluationParams {
    const cognitiveLevel: BloomLevel = strategy === 'CHALLENGE' ? 'analyze' : 'understand';
    
    return {
      expectedUnderstanding: {
        canDo: ['能够完成基本任务'],
        canExplain: ['能够解释基本思路'],
        canIdentify: ['能够识别关键信息'],
        cognitiveLevel
      },
      assessmentCriteria: {
        excellent: {
          understandingDepth: '完全理解概念',
          clarityOfExpression: '表达清晰准确',
          applicationAbility: '能够灵活应用',
          criticalErrorsAllowed: 0,
          exampleCharacteristics: ['回答完整', '逻辑清晰']
        },
        good: {
          understandingDepth: '理解核心概念',
          clarityOfExpression: '表达较清晰',
          applicationAbility: '能够应用概念',
          criticalErrorsAllowed: 1,
          exampleCharacteristics: ['回答较为完整']
        },
        fair: {
          understandingDepth: '部分理解概念',
          clarityOfExpression: '表达基本清楚',
          applicationAbility: '在提示下能够应用',
          criticalErrorsAllowed: 2,
          exampleCharacteristics: ['回答不够完整']
        },
        poor: {
          understandingDepth: '理解有限',
          clarityOfExpression: '表达模糊',
          applicationAbility: '难以应用概念',
          criticalErrorsAllowed: 3,
          exampleCharacteristics: ['回答严重不完整']
        }
      },
      remedialThreshold: strategy === 'REMEDIAL' ? 40 : 60,
      advancementThreshold: strategy === 'CHALLENGE' ? 90 : 85,
      keyConcepts: [],
      predictedMisconceptions: []
    };
  }
}

// 导出单例
export const evaluationParamsGenerator = new EvaluationParamsGenerator();
