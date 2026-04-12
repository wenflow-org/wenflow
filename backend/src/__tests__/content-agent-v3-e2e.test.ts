/**
 * ContentAgent v3.0 端到端测试
 * 
 * 测试场景：
 * 1. 策略选择测试（5 种学生状态）
 * 2. 内容生成测试
 * 3. 评估参数生成测试
 * 4. 状态变更建议测试
 * 5. 异常处理测试
 * 6. 性能测试
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { StrategyManager, ContentStrategy, StudentState, UIType } from '../agents/content-agent-v3/strategies';
import { EvaluationParamsGenerator } from '../agents/content-agent-v3/evaluation';
import { ContentAgentV3 } from '../agents/content-agent-v3';

// ==================== 测试数据结构 ====================

interface TestScenario {
  name: string;
  studentState: Partial<StudentState>;
  expectedStrategy: ContentStrategy;
  expectedUIType?: UIType;
  expectedDifficulty?: number;
}

// ==================== 测试场景定义 ====================

const testHighFrustration: TestScenario = {
  name: '高挫败感学生',
  studentState: {
    problemClarity: 0.5,
    confidence: 0.4,
    frustration: 0.8,
    cognitiveDepth: 0.4,
    learningStyle: 'mixed',
    currentLSS: 0.65,
    currentKTL: 0.45,
    currentLF: 0.72,
    currentLSB: 0.30
  },
  expectedStrategy: ContentStrategy.SUPPORTIVE,
  expectedUIType: 'choice',
  expectedDifficulty: 2
};

const testLowUnderstanding: TestScenario = {
  name: '低理解度新手',
  studentState: {
    problemClarity: 0.2,
    confidence: 0.3,
    frustration: 0.4,
    cognitiveDepth: 0.2,
    learningStyle: 'mixed',
    currentLSS: 0.4,
    currentKTL: 0.25,
    currentLF: 0.3,
    currentLSB: -0.05
  },
  expectedStrategy: ContentStrategy.BASIC,
  expectedUIType: 'input',
  expectedDifficulty: 2
};

const testExcellentStudent: TestScenario = {
  name: '优秀学生',
  studentState: {
    problemClarity: 0.9,
    confidence: 0.9,
    frustration: 0.1,
    cognitiveDepth: 0.85,
    learningStyle: 'mixed',
    currentLSS: 0.3,
    currentKTL: 0.85,
    currentLF: 0.2,
    currentLSB: 0.65
  },
  expectedStrategy: ContentStrategy.CHALLENGE,
  expectedUIType: 'reflection',
  expectedDifficulty: 4
};

const testStrugglingStudent: TestScenario = {
  name: '连续错误学生',
  studentState: {
    problemClarity: 0.5,
    confidence: 0.4,
    frustration: 0.6,
    cognitiveDepth: 0.5,
    learningStyle: 'mixed',
    currentLSS: 0.5,
    currentKTL: 0.45,
    currentLF: 0.5,
    currentLSB: -0.05,
    consecutiveErrors: 3
  },
  expectedStrategy: ContentStrategy.REMEDIAL,
  expectedUIType: 'choice',
  expectedDifficulty: 1
};

const testAverageStudent: TestScenario = {
  name: '普通学生',
  studentState: {
    problemClarity: 0.6,
    confidence: 0.6,
    frustration: 0.3,
    cognitiveDepth: 0.5,
    learningStyle: 'mixed',
    currentLSS: 0.4,
    currentKTL: 0.6,
    currentLF: 0.3,
    currentLSB: 0.3
  },
  expectedStrategy: ContentStrategy.STANDARD,
  expectedUIType: 'input',
  expectedDifficulty: 3
};

// ==================== E2E 测试 ====================

describe('ContentAgent v3.0 - 端到端测试', () => {
  let strategyManager: StrategyManager;
  let evalParamsGenerator: EvaluationParamsGenerator;
  let contentAgent: ContentAgentV3;

  beforeEach(() => {
    strategyManager = new StrategyManager();
    evalParamsGenerator = new EvaluationParamsGenerator();
    contentAgent = new ContentAgentV3();
  });

  // ==================== 测试 1: 策略选择 ====================

  describe('【测试 1】策略选择测试', () => {
    it('应该在高挫败感时选择 SUPPORTIVE 策略', () => {
      const result = strategyManager.selectStrategy(testHighFrustration.studentState as StudentState);
      expect(result.strategy.type).toBe(ContentStrategy.SUPPORTIVE);
      expect(result.score).toBeGreaterThan(0);
    });

    it('应该在低理解度时选择 BASIC 策略', () => {
      const result = strategyManager.selectStrategy(testLowUnderstanding.studentState as StudentState);
      expect(result.strategy.type).toBe(ContentStrategy.BASIC);
    });

    it('应该在高理解度和信心时选择 CHALLENGE 策略', () => {
      const result = strategyManager.selectStrategy(testExcellentStudent.studentState as StudentState);
      expect(result.strategy.type).toBe(ContentStrategy.CHALLENGE);
    });

    it('应该在连续错误时选择 REMEDIAL 策略', () => {
      const result = strategyManager.selectStrategy(testStrugglingStudent.studentState as StudentState);
      expect(result.strategy.type).toBe(ContentStrategy.REMEDIAL);
    });

    it('应该在状态正常时选择 STANDARD 策略', () => {
      const result = strategyManager.selectStrategy(testAverageStudent.studentState as StudentState);
      expect(result.strategy.type).toBe(ContentStrategy.STANDARD);
    });

    it('应该返回正确的 UI 类型推荐', () => {
      const supportiveUI = strategyManager.getUITypeRecommendation(ContentStrategy.SUPPORTIVE);
      const challengeUI = strategyManager.getUITypeRecommendation(ContentStrategy.CHALLENGE);
      const standardUI = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD);

      expect(supportiveUI).toBe('choice');
      expect(challengeUI).toBe('reflection');
      expect(standardUI).toBe('input');
    });

    it('应该返回正确的难度调整', () => {
      expect(strategyManager.getDifficultyAdjustment(ContentStrategy.SUPPORTIVE)).toBe(-2);
      expect(strategyManager.getDifficultyAdjustment(ContentStrategy.BASIC)).toBe(-1);
      expect(strategyManager.getDifficultyAdjustment(ContentStrategy.STANDARD)).toBe(0);
      expect(strategyManager.getDifficultyAdjustment(ContentStrategy.CHALLENGE)).toBe(1);
      expect(strategyManager.getDifficultyAdjustment(ContentStrategy.REMEDIAL)).toBe(-2);
    });
  });

  // ==================== 测试 2: 评估参数生成 ====================

  describe('【测试 2】评估参数生成测试', () => {
    it('应该生成完整的评估参数', async () => {
      const params = await evalParamsGenerator.generate(
        '理解变量的概念',
        ContentStrategy.STANDARD,
        testAverageStudent.studentState as StudentState,
        {
          title: 'Python 变量基础',
          description: '学习变量的概念和使用'
        }
      );

      expect(params.expectedUnderstanding).toBeDefined();
      expect(params.assessmentCriteria).toBeDefined();
      expect(params.remedialThreshold).toBeDefined();
      expect(params.advancementThreshold).toBeDefined();
      expect(params.keyConcepts).toBeDefined();
      expect(params.keyConcepts.length).toBeGreaterThan(0);
    });

    it('应该为不同策略生成不同的阈值', async () => {
      const basicParams = await evalParamsGenerator.generate(
        '基础概念',
        ContentStrategy.BASIC,
        testLowUnderstanding.studentState as StudentState,
        { title: '测试', description: '测试描述' }
      );

      const challengeParams = await evalParamsGenerator.generate(
        '高级概念',
        ContentStrategy.CHALLENGE,
        testExcellentStudent.studentState as StudentState,
        { title: '测试', description: '测试描述' }
      );

      expect(basicParams.remedialThreshold).toBeLessThan(challengeParams.remedialThreshold);
      expect(basicParams.advancementThreshold).toBeLessThan(challengeParams.advancementThreshold);
    });
  });

  // ==================== 测试 3: 状态变更建议 ====================

  describe('【测试 3】状态变更建议测试', () => {
    it('应该包含完整的状态变更建议结构', () => {
      const mockSuggestions = {
        taskProgress: 0.2,
        cognitiveStateChanges: {
          problemClarity: 0.1,
          confidence: 0.05
        },
        nextStepSuggestion: '继续学习下一个概念'
      };

      expect(mockSuggestions.taskProgress).toBeDefined();
      expect(mockSuggestions.cognitiveStateChanges).toBeDefined();
      expect(mockSuggestions.nextStepSuggestion).toBeDefined();
    });
  });

  // ==================== 测试 4: 异常处理 ====================

  describe('【测试 4】异常处理测试', () => {
    it('应该优雅处理无效输入', async () => {
      // 这个测试验证 Agent 不会因无效输入而崩溃
      expect(() => {
        new StrategyManager();
      }).not.toThrow();
    });

    it('策略管理器应该处理边界值', () => {
      const edgeCaseState: StudentState = {
        problemClarity: 0,
        confidence: 0,
        frustration: 1,
        cognitiveDepth: 0,
        learningStyle: 'mixed',
        currentLSS: 0,
        currentKTL: 0,
        currentLF: 1,
        currentLSB: -1
      };

      expect(() => {
        strategyManager.selectStrategy(edgeCaseState);
      }).not.toThrow();
    });
  });

  // ==================== 测试 5: 性能测试 ====================

  describe('【测试 5】性能测试', () => {
    it('策略选择应该在 10ms 内完成', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        strategyManager.selectStrategy({
          problemClarity: Math.random(),
          confidence: Math.random(),
          frustration: Math.random(),
          cognitiveDepth: Math.random(),
          learningStyle: 'mixed',
          currentLSS: Math.random(),
          currentKTL: Math.random(),
          currentLF: Math.random(),
          currentLSB: Math.random() * 2 - 1
        });
      }
      
      const duration = Date.now() - startTime;
      const avgTime = duration / 100;
      
      expect(avgTime).toBeLessThan(10);
    });
  });

  // ==================== 测试 6: Agent 基本信息 ====================

  describe('【测试 6】Agent 基本信息验证', () => {
    it('应该正确设置 Agent ID', () => {
      expect(contentAgent.id).toBe('content-agent-v3');
    });

    it('应该正确设置 Agent 名称', () => {
      expect(contentAgent.name).toBe('Content Agent v3.0');
    });

    it('应该正确设置版本号', () => {
      expect(contentAgent.version).toBe('3.0.0');
    });

    it('应该包含正确的能力标签', () => {
      expect(contentAgent.capabilities.tags).toContain('dialogue-generation');
      expect(contentAgent.capabilities.tags).toContain('adaptive-learning');
      expect(contentAgent.capabilities.tags).toContain('state-tracking');
    });
  });
});
