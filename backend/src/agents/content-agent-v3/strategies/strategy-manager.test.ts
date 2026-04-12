/**
 * ContentAgent v3.0 - 策略管理器单元测试
 * 
 * 测试覆盖：
 * 1. 策略选择逻辑
 * 2. 触发条件评估
 * 3. 优先级排序
 * 4. UI 类型推荐
 * 5. 内容指导获取
 * 6. 难度调整获取
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { StrategyManager } from './strategy-manager';
import { ContentStrategy, StudentState, UIType } from './types';

describe('StrategyManager', () => {
  let strategyManager: StrategyManager;

  beforeEach(() => {
    strategyManager = new StrategyManager();
  });

  // ==================== 策略选择逻辑测试 ====================

  describe('selectStrategy', () => {
    it('应该在高挫败感时选择 SUPPORTIVE 策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.5,
        confidence: 0.4,
        frustration: 0.8,  // 高挫败感
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.7,
        currentKTL: 0.5,
        currentLF: 0.6,
        currentLSB: -0.1
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.strategy.type).toBe(ContentStrategy.SUPPORTIVE);
      expect(result.score).toBeGreaterThan(0);
      expect(result.triggeredConditions.length).toBeGreaterThan(0);
    });

    it('应该在低理解度时选择 BASIC 策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.2,  // 低清晰度
        confidence: 0.3,
        frustration: 0.3,
        cognitiveDepth: 0.3,
        learningStyle: 'mixed',
        currentLSS: 0.4,
        currentKTL: 0.2,  // 低 KTL
        currentLF: 0.3,
        currentLSB: -0.1
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.strategy.type).toBe(ContentStrategy.BASIC);
    });

    it('应该在高理解度和信心时选择 CHALLENGE 策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.9,  // 高清晰度
        confidence: 0.9,      // 高信心
        frustration: 0.1,
        cognitiveDepth: 0.8,
        learningStyle: 'mixed',
        currentLSS: 0.3,
        currentKTL: 0.8,  // 高 KTL
        currentLF: 0.2,
        currentLSB: 0.6
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.strategy.type).toBe(ContentStrategy.CHALLENGE);
    });

    it('应该在连续错误时选择 REMEDIAL 策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.5,
        confidence: 0.4,
        frustration: 0.5,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.5,
        currentLF: 0.5,
        currentLSB: 0,
        consecutiveErrors: 3  // 连续错误 >= 2
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.strategy.type).toBe(ContentStrategy.REMEDIAL);
    });

    it('应该在状态正常时选择 STANDARD 策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.6,
        confidence: 0.6,
        frustration: 0.3,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.4,
        currentKTL: 0.6,
        currentLF: 0.3,
        currentLSB: 0.3
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.strategy.type).toBe(ContentStrategy.STANDARD);
    });

    it('应该返回策略选择原因', () => {
      const studentState: StudentState = {
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.8,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.7,
        currentKTL: 0.5,
        currentLF: 0.6,
        currentLSB: -0.1
      };

      const result = strategyManager.selectStrategy(studentState);

      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toContain('挫败感');
    });
  });

  // ==================== 触发条件评估测试 ====================

  describe('evaluateCondition', () => {
    it('应该正确评估 > 运算符', () => {
      const studentState: StudentState = {
        problemClarity: 0.9,
        confidence: 0.5,
        frustration: 0.5,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.5,
        currentLF: 0.5,
        currentLSB: 0
      };

      const result = strategyManager.selectStrategy(studentState);
      
      // problemClarity 0.9 > 0.8 应该触发
      const hasHighClarityCondition = result.triggeredConditions.some(
        c => c.field === 'problemClarity' && c.operator === '>'
      );
      
      expect(hasHighClarityCondition).toBe(true);
    });

    it('应该正确评估 < 运算符', () => {
      const studentState: StudentState = {
        problemClarity: 0.2,
        confidence: 0.5,
        frustration: 0.5,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.2,
        currentLF: 0.5,
        currentLSB: 0
      };

      const result = strategyManager.selectStrategy(studentState);
      
      // problemClarity 0.2 < 0.3 应该触发
      const hasLowClarityCondition = result.triggeredConditions.some(
        c => c.field === 'problemClarity' && c.operator === '<'
      );
      
      expect(hasLowClarityCondition).toBe(true);
    });

    it('应该正确评估 >= 运算符', () => {
      const studentState: StudentState = {
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.5,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.5,
        currentLF: 0.5,
        currentLSB: 0,
        consecutiveErrors: 2  // 刚好等于阈值
      };

      const result = strategyManager.selectStrategy(studentState);
      
      // consecutiveErrors 2 >= 2 应该触发
      const hasErrorCondition = result.triggeredConditions.some(
        c => c.field === 'consecutiveErrors' && c.operator === '>='
      );
      
      expect(hasErrorCondition).toBe(true);
    });
  });

  // ==================== 优先级排序测试 ====================

  describe('sortByPriority', () => {
    it('应该优先返回得分最高的策略', () => {
      const studentState: StudentState = {
        problemClarity: 0.9,
        confidence: 0.9,
        frustration: 0.8,  // 高挫败感
        cognitiveDepth: 0.8,
        learningStyle: 'mixed',
        currentLSS: 0.7,
        currentKTL: 0.8,
        currentLF: 0.6,
        currentLSB: 0.2
      };

      const result = strategyManager.selectStrategy(studentState);

      // 虽然 CHALLENGE 条件满足，但 SUPPORTIVE 优先级更高（priority=1）
      // 因为挫败感 0.8 > 0.7 触发 SUPPORTIVE
      expect(result.strategy.type).toBe(ContentStrategy.SUPPORTIVE);
    });

    it('应该在得分相同时按优先级排序', () => {
      // 这个测试验证优先级机制
      const studentState: StudentState = {
        problemClarity: 0.2,  // 触发 BASIC
        confidence: 0.5,
        frustration: 0.8,     // 触发 SUPPORTIVE
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.2,
        currentLF: 0.5,
        currentLSB: -0.3
      };

      const result = strategyManager.selectStrategy(studentState);

      // SUPPORTIVE 优先级为 1，BASIC 优先级为 2
      // 两者都可能触发，但 SUPPORTIVE 优先级更高
      expect(result.strategy.type).toBe(ContentStrategy.SUPPORTIVE);
    });
  });

  // ==================== UI 类型推荐测试 ====================

  describe('getUITypeRecommendation', () => {
    it('应该为 SUPPORTIVE 策略推荐 choice 类型', () => {
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.SUPPORTIVE);
      expect(uiType).toBe('choice');
    });

    it('应该为 CHALLENGE 策略推荐 reflection 类型', () => {
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.CHALLENGE);
      expect(uiType).toBe('reflection');
    });

    it('应该为 STANDARD 策略推荐 input 类型', () => {
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD);
      expect(uiType).toBe('input');
    });

    it('应该为 code 任务类型推荐 code UI', () => {
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD, 'code');
      expect(uiType).toBe('code');
    });

    it('应该为 coding 任务类型推荐 code UI', () => {
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD, 'coding');
      expect(uiType).toBe('code');
    });

    it('应该在 SUPPORTIVE 策略下忽略 code 任务类型', () => {
      // SUPPORTIVE 策略下即使是 code 任务也用 choice
      const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.SUPPORTIVE, 'code');
      expect(uiType).toBe('choice');
    });

    it('应该对未知策略抛出错误', () => {
      expect(() => {
        strategyManager.getUITypeRecommendation('INVALID' as any);
      }).toThrow('Unknown strategy');
    });
  });

  // ==================== 内容指导获取测试 ====================

  describe('getContentGuidelines', () => {
    it('应该返回 SUPPORTIVE 策略的内容指导', () => {
      const guidelines = strategyManager.getContentGuidelines(ContentStrategy.SUPPORTIVE);
      
      expect(guidelines.tone).toBe('轻松、亲切、鼓励');
      expect(guidelines.pronounUsage).toBe('咱们、我们一起');
      expect(guidelines.difficultyLevel).toBe(2);
      expect(guidelines.explanationDepth).toBe('浅');
      expect(guidelines.hintFrequency).toBe(0.8);
    });

    it('应该返回 CHALLENGE 策略的内容指导', () => {
      const guidelines = strategyManager.getContentGuidelines(ContentStrategy.CHALLENGE);
      
      expect(guidelines.tone).toBe('挑战性、激发思考');
      expect(guidelines.difficultyLevel).toBe(4);
      expect(guidelines.hintFrequency).toBe(0.1);
    });

    it('应该对未知策略抛出错误', () => {
      expect(() => {
        strategyManager.getContentGuidelines('INVALID' as any);
      }).toThrow('Unknown strategy');
    });
  });

  // ==================== 难度调整获取测试 ====================

  describe('getDifficultyAdjustment', () => {
    it('应该返回 SUPPORTIVE 策略的难度调整 -2', () => {
      const adjustment = strategyManager.getDifficultyAdjustment(ContentStrategy.SUPPORTIVE);
      expect(adjustment).toBe(-2);
    });

    it('应该返回 BASIC 策略的难度调整 -1', () => {
      const adjustment = strategyManager.getDifficultyAdjustment(ContentStrategy.BASIC);
      expect(adjustment).toBe(-1);
    });

    it('应该返回 STANDARD 策略的难度调整 0', () => {
      const adjustment = strategyManager.getDifficultyAdjustment(ContentStrategy.STANDARD);
      expect(adjustment).toBe(0);
    });

    it('应该返回 CHALLENGE 策略的难度调整 +1', () => {
      const adjustment = strategyManager.getDifficultyAdjustment(ContentStrategy.CHALLENGE);
      expect(adjustment).toBe(1);
    });

    it('应该返回 REMEDIAL 策略的难度调整 -2', () => {
      const adjustment = strategyManager.getDifficultyAdjustment(ContentStrategy.REMEDIAL);
      expect(adjustment).toBe(-2);
    });

    it('应该对未知策略抛出错误', () => {
      expect(() => {
        strategyManager.getDifficultyAdjustment('INVALID' as any);
      }).toThrow('Unknown strategy');
    });
  });

  // ==================== 辅助方法测试 ====================

  describe('getAllStrategies', () => {
    it('应该返回所有 5 种策略', () => {
      const strategies = strategyManager.getAllStrategies();
      expect(strategies.size).toBe(5);
      expect(strategies.has(ContentStrategy.SUPPORTIVE)).toBe(true);
      expect(strategies.has(ContentStrategy.BASIC)).toBe(true);
      expect(strategies.has(ContentStrategy.STANDARD)).toBe(true);
      expect(strategies.has(ContentStrategy.CHALLENGE)).toBe(true);
      expect(strategies.has(ContentStrategy.REMEDIAL)).toBe(true);
    });
  });

  describe('getStrategyReason', () => {
    it('应该返回策略原因说明', () => {
      const reason = strategyManager.getStrategyReason(ContentStrategy.SUPPORTIVE);
      expect(reason).toContain('挫败感');
    });

    it('应该对所有已知策略返回原因', () => {
      const strategies = Object.values(ContentStrategy);
      
      for (const strategy of strategies) {
        const reason = strategyManager.getStrategyReason(strategy);
        expect(reason).toBeDefined();
        expect(reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('forceStrategy', () => {
    it('应该能够强制指定策略', () => {
      const config = strategyManager.forceStrategy(ContentStrategy.CHALLENGE);
      expect(config.type).toBe(ContentStrategy.CHALLENGE);
      expect(config.difficultyAdjustment).toBe(1);
    });

    it('应该对未知策略抛出错误', () => {
      expect(() => {
        strategyManager.forceStrategy('INVALID' as any);
      }).toThrow('Unknown strategy');
    });
  });
});
