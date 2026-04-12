/**
 * ContentAgent v3.0 - 评估参数生成器单元测试
 * 
 * 测试重点：
 * 1. 认知层级判断逻辑
 * 2. 阈值计算逻辑
 * 3. 降级处理（AI 调用失败）
 */

import { EvaluationParamsGenerator } from '../agents/content-agent-v3/evaluation/evaluation-params-generator';
import { StudentState, TaskInfo, BloomLevel, ContentStrategy } from '../agents/content-agent-v3/evaluation/types';

// Mock AI 服务
jest.mock('../services/ai/ai.service', () => {
  return {
    __esModule: true,
    default: {
      chat: jest.fn().mockRejectedValue(new Error('Mocked AI service'))
    }
  };
});

describe('EvaluationParamsGenerator', () => {
  let generator: EvaluationParamsGenerator;
  
  const mockStudentState: StudentState = {
    problemClarity: 0.5,
    confidence: 0.6,
    frustration: 0.3,
    cognitiveDepth: 0.5,
    learningStyle: 'visual',
    currentLSS: 50,
    currentKTL: 0.5,
    currentLF: 0.3,
    currentLSB: 0.2,
    consecutiveErrors: 0,
    previousScore: 75,
    silenceCount: 0,
    responseTime: 30
  };
  
  const mockTaskInfo: TaskInfo = {
    title: 'Python 变量与数据类型',
    description: '学习 Python 中的变量定义和基本数据类型',
    type: 'practice',
    subject: '编程',
    estimatedMinutes: 30
  };
  
  const mockObjective = '理解 Python 中的变量定义、赋值和基本数据类型';
  
  beforeEach(() => {
    generator = new EvaluationParamsGenerator();
    jest.clearAllMocks();
  });
  
  describe('认知层级判断', () => {
    it('基础引导策略 - 问题清晰度低时应返回记忆层级', () => {
      const state: StudentState = { ...mockStudentState, problemClarity: 0.2 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'BASIC', state);
      expect(result).toBe('remember');
    });
    
    it('基础引导策略 - 问题清晰度中等时应返回理解层级', () => {
      const state: StudentState = { ...mockStudentState, problemClarity: 0.5 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'BASIC', state);
      expect(result).toBe('understand');
    });
    
    it('标准对话策略 - 认知深度低时应返回理解层级', () => {
      const state: StudentState = { ...mockStudentState, cognitiveDepth: 0.3 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'STANDARD', state);
      expect(result).toBe('understand');
    });
    
    it('标准对话策略 - 认知深度高时应返回应用层级', () => {
      const state: StudentState = { ...mockStudentState, cognitiveDepth: 0.8 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'STANDARD', state);
      expect(result).toBe('apply');
    });
    
    it('挑战深化策略 - 认知深度高时应返回评估层级', () => {
      const state: StudentState = { ...mockStudentState, cognitiveDepth: 0.85 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'CHALLENGE', state);
      expect(result).toBe('evaluate');
    });
    
    it('挑战深化策略 - 认知深度中等时应返回分析层级', () => {
      const state: StudentState = { ...mockStudentState, cognitiveDepth: 0.6 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'CHALLENGE', state);
      expect(result).toBe('analyze');
    });
    
    it('针对性补救策略应返回理解层级', () => {
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'REMEDIAL', mockStudentState);
      expect(result).toBe('understand');
    });
    
    it('支持鼓励策略 - 问题清晰度低时应返回记忆层级', () => {
      const state: StudentState = { ...mockStudentState, problemClarity: 0.25, frustration: 0.8 };
      const method = (generator as any).determineCognitiveLevel;
      const result: BloomLevel = method.call(generator, 'SUPPORTIVE', state);
      expect(result).toBe('remember');
    });
  });
  
  describe('阈值计算', () => {
    describe('补救阈值', () => {
      it('基础引导策略的补救阈值应为 50', () => {
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'BASIC', mockStudentState);
        expect(result).toBe(50);
      });
      
      it('支持鼓励策略的补救阈值应为 50', () => {
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'SUPPORTIVE', mockStudentState);
        expect(result).toBe(50);
      });
      
      it('标准对话策略的补救阈值应为 60', () => {
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'STANDARD', mockStudentState);
        expect(result).toBe(60);
      });
      
      it('挑战深化策略的补救阈值应为 70', () => {
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'CHALLENGE', mockStudentState);
        expect(result).toBe(70);
      });
      
      it('针对性补救策略的补救阈值应为 40', () => {
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'REMEDIAL', mockStudentState);
        expect(result).toBe(40);
      });
      
      it('连续错误多时应降低补救阈值', () => {
        const state: StudentState = { ...mockStudentState, consecutiveErrors: 5 };
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'STANDARD', state);
        expect(result).toBeLessThan(60);
      });
      
      it('挫败感高时应降低补救阈值', () => {
        const state: StudentState = { ...mockStudentState, frustration: 0.9 };
        const method = (generator as any).calculateRemedialThreshold;
        const result = method.call(generator, 'STANDARD', state);
        expect(result).toBeLessThan(60);
      });
    });
    
    describe('进阶阈值', () => {
      it('基础引导策略的进阶阈值应为 75', () => {
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'BASIC', mockStudentState);
        expect(result).toBe(75);
      });
      
      it('支持鼓励策略的进阶阈值应为 75', () => {
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'SUPPORTIVE', mockStudentState);
        expect(result).toBe(75);
      });
      
      it('标准对话策略的进阶阈值应为 85', () => {
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'STANDARD', mockStudentState);
        expect(result).toBe(85);
      });
      
      it('挑战深化策略的进阶阈值应为 90', () => {
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'CHALLENGE', mockStudentState);
        expect(result).toBe(90);
      });
      
      it('针对性补救策略的进阶阈值应为 80', () => {
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'REMEDIAL', mockStudentState);
        expect(result).toBe(80);
      });
      
      it('知识掌握度高时应降低进阶阈值', () => {
        const state: StudentState = { ...mockStudentState, currentKTL: 0.85 };
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'STANDARD', state);
        expect(result).toBeLessThan(85);
      });
      
      it('学习疲劳度高时应提高进阶阈值', () => {
        const state: StudentState = { ...mockStudentState, currentLF: 0.8 };
        const method = (generator as any).calculateAdvancementThreshold;
        const result = method.call(generator, 'STANDARD', state);
        expect(result).toBeGreaterThan(85);
      });
    });
  });
  
  describe('降级处理', () => {
    it('AI 调用失败时应返回默认参数', async () => {
      const result = await generator.generate(
        mockObjective,
        'STANDARD',
        mockStudentState,
        mockTaskInfo
      );
      
      // 验证基本结构完整
      expect(result).toHaveProperty('expectedUnderstanding');
      expect(result).toHaveProperty('assessmentCriteria');
      expect(result).toHaveProperty('remedialThreshold');
      expect(result).toHaveProperty('advancementThreshold');
      expect(result).toHaveProperty('keyConcepts');
      expect(result).toHaveProperty('predictedMisconceptions');
      
      // AI 失败时应返回空数组
      expect(result.keyConcepts).toEqual([]);
      expect(result.predictedMisconceptions).toEqual([]);
      
      // 阈值应正确计算
      expect(result.remedialThreshold).toBe(60);
      expect(result.advancementThreshold).toBe(85);
    });
    
    it('挑战深化策略应生成更高的进阶阈值', async () => {
      const result = await generator.generate(
        mockObjective,
        'CHALLENGE',
        mockStudentState,
        mockTaskInfo
      );
      
      expect(result.advancementThreshold).toBe(90);
      expect(result.remedialThreshold).toBe(70);
    });
    
    it('支持鼓励策略应生成更低的进阶门槛', async () => {
      const result = await generator.generate(
        mockObjective,
        'SUPPORTIVE',
        { ...mockStudentState, frustration: 0.8 },
        mockTaskInfo
      );
      
      expect(result.advancementThreshold).toBe(75);
      // 挫败感高时会降低补救阈值（从 50 降到 45）
      expect(result.remedialThreshold).toBeLessThanOrEqual(50);
    });
  });
  
  describe('边界情况处理', () => {
    it('应处理极端的学生状态值', () => {
      const extremeState: StudentState = {
        ...mockStudentState,
        problemClarity: 0,
        confidence: 0,
        frustration: 1,
        cognitiveDepth: 1,
        currentLSS: 100,
        currentKTL: 1,
        currentLF: 1,
        currentLSB: 0
      };
      
      const method = (generator as any).determineCognitiveLevel;
      const result = method.call(generator, 'STANDARD', extremeState);
      
      // 应该能正常处理极端值
      expect(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).toContain(result);
    });
    
    it('应处理空的任务信息', async () => {
      const emptyTaskInfo: TaskInfo = {
        title: '',
        description: '',
        type: 'practice',
        subject: '',
        estimatedMinutes: 0
      };
      
      const result = await generator.generate(
        mockObjective,
        'STANDARD',
        mockStudentState,
        emptyTaskInfo
      );
      
      expect(result).toBeDefined();
      expect(result.remedialThreshold).toBe(60);
    });
    
    it('应处理空的对话目标', async () => {
      const result = await generator.generate(
        '',
        'STANDARD',
        mockStudentState,
        mockTaskInfo
      );
      
      expect(result).toBeDefined();
      expect(result.expectedUnderstanding).toBeDefined();
    });
  });
});
