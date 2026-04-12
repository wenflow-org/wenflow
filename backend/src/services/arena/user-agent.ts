/**
 * Rule-Based User Agent - 基于轮次的规则回复
 * 
 * 简化版设计：
 * 1. 不再使用 AI 生成回复
 * 2. 基于轮次使用预定义模板
 * 3. 状态仅用于记录，不参与复杂决策
 * 
 * 设计理念：
 * Arena 作为测试模式，UserAgent 应该可预测、可复现
 */

import { logger } from '../../utils/logger';

export interface PersonaData {
  name?: string;
  surfaceGoal?: string;
  realProblem?: string;
  level?: string;
  timePerDay?: string;
  totalWeeks?: string;
  motivation?: string;
  urgency?: string;
  background?: {
    priorKnowledge?: string[];
    learningHistory?: string;
    challenges?: string[];
  };
  psychology?: {
    contradictions?: string[];
    fears?: string[];
    biases?: string[];
    learningState?: string;
  };
  external?: {
    timeConstraints?: string[];
    economicPressure?: string;
    socialPressure?: string;
  };
  scenario?: {
    who?: string;
    why?: string;
    context?: string;
  };
  // 认知维度
  realScenario?: {
    context?: string;
    frequency?: string;
    duration?: string;
    currentSolution?: string;
    biggestPain?: string;
  };
  thinkingBlocks?: Array<{
    type: string;
    description: string;
    indicators?: string[];
  }>;
  analogyMaterials?: {
    work?: string[];
    hobbies?: string[];
    priorSkills?: string[];
  };
}

/**
 * 简化的交互结果
 */
export interface InteractionResult {
  userResponse: string;           // 用户的回复内容
  round: number;                  // 当前轮次
  revealedInfo: string[];         // 本轮透露的信息类型
  metadata: {
    templateUsed: string;         // 使用的模板名称
  };
}

/**
 * 回复模板定义
 */
interface ResponseTemplate {
  name: string;
  patterns: string[];  // 多个可选回复模式
}

/**
 * 基于轮次的规则回复生成器
 */
export class RuleBasedUserAgent {
  private persona: PersonaData;
  private currentRound: number = 0;
  private revealedInfo: Set<string> = new Set();

  // 按轮次定义的回复模板
  private readonly ROUND_TEMPLATES: Record<number, ResponseTemplate> = {
    1: {
      name: 'opening',
      patterns: [
        '嗯...其实我想学{surfaceGoal}...',
        '我想学{surfaceGoal}，但不太确定从哪里开始...',
        '你好，我想学习{surfaceGoal}...'
      ]
    },
    2: {
      name: 'scenario_reveal',
      patterns: [
        '主要是在{scenario}的时候会用到...',
        '可能每天能有{timePerDay}吧...',
        '工作中经常遇到这个场景：{realScenario}'
      ]
    },
    3: {
      name: 'pain_point',
      patterns: [
        '有点担心{fear}...',
        '怕坚持不下来...',
        '最头疼的是{biggestPain}...'
      ]
    },
    4: {
      name: 'background',
      patterns: [
        '之前{learningHistory}...',
        '我目前是{level}水平...',
        '尝试过{priorSkill}，但感觉不太适合...'
      ]
    },
    5: {
      name: 'motivation',
      patterns: [
        '主要是想{motivation}...',
        '这个对我来说{urgency}...',
        '如果能学会的话，就能{realProblem}...'
      ]
    },
    6: {
      name: 'hesitation',
      patterns: [
        '嗯...让我再想想...',
        '其实也不太确定这样对不对...',
        '可能需要再考虑一下...'
      ]
    },
    7: {
      name: 'interest',
      patterns: [
        '好像有点兴趣...',
        '这个方向听起来不错...',
        '我觉得可以试试...'
      ]
    },
    8: {
      name: 'confirmation',
      patterns: [
        '好的，试试看吧...',
        '那就这样吧...',
        '行吧，开始吧...'
      ]
    }
  };

  // 默认回复（超过预定义轮次时使用）
  private readonly DEFAULT_TEMPLATES: ResponseTemplate = {
    name: 'default',
    patterns: [
      '嗯...',
      '好的...',
      '明白了...',
      '我再想想...',
      '可以...'
    ]
  };

  constructor(persona: PersonaData) {
    this.persona = persona;
    logger.info('RuleBasedUserAgent 初始化', {
      name: persona.name || '匿名',
      surfaceGoal: persona.surfaceGoal
    });
  }

  /**
   * 生成回复（核心方法）
   * 基于轮次选择模板，填充画像信息
   */
  generateResponse(systemMessage: string): InteractionResult {
    this.currentRound++;
    const round = this.currentRound;

    // 获取当前轮次的模板
    const template = this.ROUND_TEMPLATES[round] || this.DEFAULT_TEMPLATES;

    // 随机选择一个模板模式
    const pattern = template.patterns[Math.floor(Math.random() * template.patterns.length)];

    // 填充模板中的占位符
    const userResponse = this.fillTemplate(pattern);

    // 确保不超过50字
    const finalResponse = userResponse.length > 50 
      ? userResponse.substring(0, 47) + '...' 
      : userResponse;

    // 记录本轮透露的信息
    const revealedThisRound = this.detectRevealedInfo(pattern);

    logger.debug('RuleBasedUserAgent 回复', {
      round,
      templateUsed: template.name,
      response: finalResponse,
      revealedInfo: revealedThisRound
    });

    return {
      userResponse: finalResponse,
      round,
      revealedInfo: revealedThisRound,
      metadata: {
        templateUsed: template.name
      }
    };
  }

  /**
   * 填充模板占位符
   */
  private fillTemplate(pattern: string): string {
    const { persona } = this;
    let result = pattern;

    // 基础信息
    if (persona.surfaceGoal) {
      result = result.replace('{surfaceGoal}', persona.surfaceGoal);
    }
    if (persona.realProblem) {
      result = result.replace('{realProblem}', persona.realProblem);
    }
    if (persona.timePerDay) {
      result = result.replace('{timePerDay}', persona.timePerDay);
    }
    if (persona.level) {
      result = result.replace('{level}', persona.level);
    }
    if (persona.motivation) {
      result = result.replace('{motivation}', persona.motivation);
    }
    if (persona.urgency) {
      result = result.replace('{urgency}', persona.urgency);
    }

    // 场景信息
    if (persona.scenario?.context) {
      result = result.replace('{scenario}', persona.scenario.context);
    }
    if (persona.realScenario?.context) {
      result = result.replace('{realScenario}', persona.realScenario.context);
    }
    if (persona.realScenario?.biggestPain) {
      result = result.replace('{biggestPain}', persona.realScenario.biggestPain);
    }

    // 心理信息
    if (persona.psychology?.fears && persona.psychology.fears.length > 0) {
      result = result.replace('{fear}', persona.psychology.fears[0]);
    }

    // 背景信息
    if (persona.background?.learningHistory) {
      result = result.replace('{learningHistory}', persona.background.learningHistory);
    }
    if (persona.background?.priorKnowledge && persona.background.priorKnowledge.length > 0) {
      result = result.replace('{priorSkill}', persona.background.priorKnowledge[0]);
    }

    // 类比素材
    if (persona.analogyMaterials?.work && persona.analogyMaterials.work.length > 0) {
      result = result.replace('{workAnalogy}', persona.analogyMaterials.work[0]);
    }

    // 清理未填充的占位符
    result = result.replace(/\{[^}]+\}/g, '这个');

    return result;
  }

  /**
   * 检测本轮透露的信息类型
   */
  private detectRevealedInfo(pattern: string): string[] {
    const revealed: string[] = [];

    if (pattern.includes('{surfaceGoal}') && !this.revealedInfo.has('surfaceGoal')) {
      revealed.push('surfaceGoal');
      this.revealedInfo.add('surfaceGoal');
    }
    if (pattern.includes('{realProblem}') && !this.revealedInfo.has('realProblem')) {
      revealed.push('realProblem');
      this.revealedInfo.add('realProblem');
    }
    if (pattern.includes('{timePerDay}') && !this.revealedInfo.has('timePerDay')) {
      revealed.push('timePerDay');
      this.revealedInfo.add('timePerDay');
    }
    if (pattern.includes('{level}') && !this.revealedInfo.has('level')) {
      revealed.push('level');
      this.revealedInfo.add('level');
    }
    if (pattern.includes('{fear}') && !this.revealedInfo.has('fears')) {
      revealed.push('fears');
      this.revealedInfo.add('fears');
    }
    if (pattern.includes('{biggestPain}') && !this.revealedInfo.has('biggestPain')) {
      revealed.push('biggestPain');
      this.revealedInfo.add('biggestPain');
    }
    if (pattern.includes('{motivation}') && !this.revealedInfo.has('motivation')) {
      revealed.push('motivation');
      this.revealedInfo.add('motivation');
    }

    return revealed;
  }

  /**
   * 获取当前状态（只读）
   */
  getState(): {
    currentRound: number;
    revealedInfo: string[];
  } {
    return {
      currentRound: this.currentRound,
      revealedInfo: Array.from(this.revealedInfo)
    };
  }

  /**
   * 重置状态（用于重新开始对话）
   */
  reset(): void {
    this.currentRound = 0;
    this.revealedInfo.clear();
    logger.debug('RuleBasedUserAgent 状态已重置');
  }

  /**
   * 获取画像信息
   */
  getPersona(): PersonaData {
    return { ...this.persona };
  }
}

// 兼容旧代码的别名
export const AIUserAgent = RuleBasedUserAgent;

// 默认导出
export default RuleBasedUserAgent;