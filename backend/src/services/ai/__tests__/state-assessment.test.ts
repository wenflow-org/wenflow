/**
 * 状态评估服务测试
 * 测试基于对话历史的 AI 状态评估系统
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import stateAssessmentService, { StateAssessmentService } from '../state-assessment.service';
import type { Message, ZScores } from '../../../types/state';

// 测试超时时间（AI 调用可能需要较长时间）
const TEST_TIMEOUT = 60000;

describe('StateAssessmentService', () => {
  let service: StateAssessmentService;

  beforeAll(() => {
    service = stateAssessmentService;
  });

  /**
   * 测试用例 1：高认知深度对话
   * 学生展示原创观点、逻辑推演、自我纠错
   */
  describe('assessCognitiveDepth', () => {
    it(
      '应该识别高认知深度的对话',
      async () => {
        const highCognitiveHistory: Message[] = [
          {
            role: 'user',
            content: '我在学习 Python 的装饰器，我理解它可以在不修改原函数的情况下添加功能，但我不太清楚实际应用场景。',
            timestamp: new Date('2026-03-16T10:00:00')
          },
          {
            role: 'assistant',
            content: '很好的问题！装饰器的核心价值是"横切关注点"。比如日志记录、性能监控、权限验证等。你能想到哪些场景可能需要这些功能吗？',
            timestamp: new Date('2026-03-16T10:00:15')
          },
          {
            role: 'user',
            content: '我想了想，比如在一个 Web 应用中，每个 API 接口都需要验证用户登录状态，这时候可以用装饰器统一处理，而不是在每个函数里重复写验证代码。另外，我还想到可以用装饰器来记录函数执行时间，帮助性能优化。我的理解对吗？',
            timestamp: new Date('2026-03-16T10:01:30')
          },
          {
            role: 'assistant',
            content: '完全正确！你已经掌握了装饰器的精髓。那你觉得如果要实现一个计时装饰器，应该怎么做？',
            timestamp: new Date('2026-03-16T10:01:45')
          },
          {
            role: 'user',
            content: '我觉得应该是这样的：首先装饰器接收一个函数，然后返回一个新函数。新函数在调用原函数前后分别记录时间，然后计算差值。不过我有个疑问，如果被装饰的函数有参数怎么办？装饰器需要处理这些参数的传递吗？',
            timestamp: new Date('2026-03-16T10:03:00')
          },
          {
            role: 'assistant',
            content: '很好的思考！那你觉得应该怎么处理参数传递呢？',
            timestamp: new Date('2026-03-16T10:03:15')
          },
          {
            role: 'user',
            content: '我想...应该用 *args 和 **kwargs 吧？这样可以接收任意位置的参数和关键字参数，然后原封不动地传给原函数。等等，这样的话装饰器内部的包装函数也需要定义成接受 *args 和 **kwargs 对吗？让我试着写一下...（思考中）',
            timestamp: new Date('2026-03-16T10:04:30')
          }
        ];

        const result = await service.assessCognitiveDepth(highCognitiveHistory);

        console.log('高认知深度评估结果:', result);

        // 验证分数范围
        expect(result.depth).toBeGreaterThanOrEqual(0);
        expect(result.depth).toBeLessThanOrEqual(1);

        // 高认知深度应该得分较高
        expect(result.depth).toBeGreaterThan(0.6);

        // 应该有详细的推理过程
        expect(result.reasoning).toBeDefined();
        expect(result.reasoning.length).toBeGreaterThan(50);

        // 推理应该引用学生的具体话语
        expect(result.reasoning).toMatch(/学生|用户|学习者/);
      },
      TEST_TIMEOUT
    );

    it(
      '应该识别低认知深度的对话',
      async () => {
        const lowCognitiveHistory: Message[] = [
          {
            role: 'user',
            content: '这道题怎么做？',
            timestamp: new Date('2026-03-16T11:00:00')
          },
          {
            role: 'assistant',
            content: '你能告诉我具体是哪道题吗？另外，你已经尝试过什么方法了吗？',
            timestamp: new Date('2026-03-16T11:00:15')
          },
          {
            role: 'user',
            content: '就是第 5 题，我不会。',
            timestamp: new Date('2026-03-16T11:00:30')
          },
          {
            role: 'assistant',
            content: '第 5 题是关于什么的呢？你可以把题目内容发给我看看吗？',
            timestamp: new Date('2026-03-16T11:00:45')
          },
          {
            role: 'user',
            content: '算了，你直接告诉我答案吧。',
            timestamp: new Date('2026-03-16T11:01:00')
          }
        ];

        const result = await service.assessCognitiveDepth(lowCognitiveHistory);

        console.log('低认知深度评估结果:', result);

        // 验证分数范围
        expect(result.depth).toBeGreaterThanOrEqual(0);
        expect(result.depth).toBeLessThanOrEqual(1);

        // 低认知深度应该得分较低
        expect(result.depth).toBeLessThan(0.4);

        // 应该有推理过程
        expect(result.reasoning).toBeDefined();
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 2：压力程度评估
   */
  describe('assessStressLevel', () => {
    it(
      '应该识别高压力状态的对话',
      async () => {
        const highStressHistory: Message[] = [
          {
            role: 'user',
            content: '这个算法我看了三遍了，还是完全看不懂！',
            timestamp: new Date('2026-03-16T14:00:00')
          },
          {
            role: 'assistant',
            content: '理解算法确实需要时间。你卡在哪个部分了呢？',
            timestamp: new Date('2026-03-16T14:00:15')
          },
          {
            role: 'user',
            content: '全部都不懂！我是不是太笨了？为什么别人都能学会，就我不行？',
            timestamp: new Date('2026-03-16T14:00:45')
          },
          {
            role: 'assistant',
            content: '请不要这样想。学习遇到困难是很正常的。要不我们从一个更简单的例子开始？',
            timestamp: new Date('2026-03-16T14:01:00')
          },
          {
            role: 'user',
            content: '算了算了，我学不会的。浪费时间。',
            timestamp: new Date('2026-03-16T14:01:30')
          }
        ];

        const result = await service.assessStressLevel(highStressHistory);

        console.log('高压力评估结果:', result);

        // 验证分数范围
        expect(result.stress).toBeGreaterThanOrEqual(0);
        expect(result.stress).toBeLessThanOrEqual(1);

        // 高压力应该得分较高
        expect(result.stress).toBeGreaterThan(0.6);

        // 应该有推理过程
        expect(result.reasoning).toBeDefined();
        expect(result.reasoning.length).toBeGreaterThan(50);
      },
      TEST_TIMEOUT
    );

    it(
      '应该识别低压力状态的对话',
      async () => {
        const lowStressHistory: Message[] = [
          {
            role: 'user',
            content: '我想了解一下快速排序的原理，能讲讲吗？',
            timestamp: new Date('2026-03-16T15:00:00')
          },
          {
            role: 'assistant',
            content: '当然可以！快速排序的核心思想是"分治法"。简单来说...',
            timestamp: new Date('2026-03-16T15:00:15')
          },
          {
            role: 'user',
            content: '明白了，那基准值的选择会影响性能吗？',
            timestamp: new Date('2026-03-16T15:01:30')
          },
          {
            role: 'assistant',
            content: '很好的问题！基准值的选择确实会影响...',
            timestamp: new Date('2026-03-16T15:01:45')
          },
          {
            role: 'user',
            content: '懂了，我自己写写看，有问题再来问你。',
            timestamp: new Date('2026-03-16T15:02:30')
          }
        ];

        const result = await service.assessStressLevel(lowStressHistory);

        console.log('低压力评估结果:', result);

        // 验证分数范围
        expect(result.stress).toBeGreaterThanOrEqual(0);
        expect(result.stress).toBeLessThanOrEqual(1);

        // 低压力应该得分较低
        expect(result.stress).toBeLessThan(0.4);

        // 应该有推理过程
        expect(result.reasoning).toBeDefined();
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 3：投入程度评估
   */
  describe('assessEngagement', () => {
    it(
      '应该识别高投入状态的对话',
      async () => {
        const highEngagementHistory: Message[] = [
          {
            role: 'user',
            content: '我在学习 React 的 useEffect，它和 componentDidMount 有什么区别？',
            timestamp: new Date('2026-03-16T16:00:00')
          },
          {
            role: 'assistant',
            content: '很好的问题！useEffect 是一个 Hook，它可以合并 componentDidMount、componentDidUpdate 和 componentWillUnmount 的功能...',
            timestamp: new Date('2026-03-16T16:00:15')
          },
          {
            role: 'user',
            content: '那如果我只想让它执行一次，是不是传个空数组就行？等等，那如果我想监听某个 state 的变化呢？',
            timestamp: new Date('2026-03-16T16:01:30')
          },
          {
            role: 'assistant',
            content: '没错！空数组会让它只在挂载和卸载时执行。如果要监听 state 变化...',
            timestamp: new Date('2026-03-16T16:01:45')
          },
          {
            role: 'user',
            content: '明白了！那如果依赖项太多怎么办？每次 state 变化都要重新执行吗？有没有什么优化方法？另外，cleanup 函数是什么时候调用的？',
            timestamp: new Date('2026-03-16T16:03:00')
          },
          {
            role: 'assistant',
            content: '很好的深入思考！关于优化，你可以使用 useMemo...',
            timestamp: new Date('2026-03-16T16:03:15')
          },
          {
            role: 'user',
            content: 'useMemo 和 useCallback 呢？它们有什么区别？我应该在什么场景下用哪个？能给我一些具体的例子吗？',
            timestamp: new Date('2026-03-16T16:04:30')
          }
        ];

        const result = await service.assessEngagement(highEngagementHistory);

        console.log('高投入评估结果:', result);

        // 验证分数范围
        expect(result.engagement).toBeGreaterThanOrEqual(0);
        expect(result.engagement).toBeLessThanOrEqual(1);

        // 高投入应该得分较高
        expect(result.engagement).toBeGreaterThan(0.6);

        // 应该有推理过程
        expect(result.reasoning).toBeDefined();
        expect(result.reasoning.length).toBeGreaterThan(50);
      },
      TEST_TIMEOUT
    );

    it(
      '应该识别低投入状态的对话',
      async () => {
        const lowEngagementHistory: Message[] = [
          {
            role: 'user',
            content: '在吗？',
            timestamp: new Date('2026-03-16T17:00:00')
          },
          {
            role: 'assistant',
            content: '在的！有什么可以帮助你的吗？',
            timestamp: new Date('2026-03-16T17:00:15')
          },
          {
            role: 'user',
            content: '嗯',
            timestamp: new Date('2026-03-16T17:00:30')
          },
          {
            role: 'assistant',
            content: '你在学习什么内容呢？有什么问题吗？',
            timestamp: new Date('2026-03-16T17:00:45')
          },
          {
            role: 'user',
            content: '随便看看',
            timestamp: new Date('2026-03-16T17:01:00')
          },
          {
            role: 'assistant',
            content: '好的，如果有任何问题随时问我哦！',
            timestamp: new Date('2026-03-16T17:01:15')
          },
          {
            role: 'user',
            content: '好的',
            timestamp: new Date('2026-03-16T17:01:30')
          }
        ];

        const result = await service.assessEngagement(lowEngagementHistory);

        console.log('低投入评估结果:', result);

        // 验证分数范围
        expect(result.engagement).toBeGreaterThanOrEqual(0);
        expect(result.engagement).toBeLessThanOrEqual(1);

        // 低投入应该得分较低
        expect(result.engagement).toBeLessThan(0.4);

        // 应该有推理过程
        expect(result.reasoning).toBeDefined();
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 4：AI+EMA 融合评估
   */
  describe('integrateAIandEMA', () => {
    it(
      '应该正确融合 AI 评估和 EMA 数值指标',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '我想学习 TypeScript，它的类型系统是怎么工作的？',
            timestamp: new Date('2026-03-16T18:00:00')
          },
          {
            role: 'assistant',
            content: 'TypeScript 的类型系统是在编译时进行类型检查...',
            timestamp: new Date('2026-03-16T18:00:15')
          },
          {
            role: 'user',
            content: '那泛型呢？泛型的作用是什么？',
            timestamp: new Date('2026-03-16T18:01:30')
          }
        ];

        const aiAssessment = {
          cognitiveDepth: 0.65,
          stressLevel: 0.25,
          engagement: 0.70
        };

        // 正常的 Z-Score（在 -2 到 2 之间）
        const normalZScores: ZScores = {
          responseTime: 0.5,
          messageLength: 0.3,
          interactionInterval: -0.2
        };

        const result = await service.integrateAIandEMA(
          aiAssessment,
          normalZScores,
          conversationHistory
        );

        console.log('融合评估结果（正常 Z-Score）:', result);

        // 验证分数范围
        expect(result.cognitive).toBeGreaterThanOrEqual(0);
        expect(result.cognitive).toBeLessThanOrEqual(1);
        expect(result.stress).toBeGreaterThanOrEqual(0);
        expect(result.stress).toBeLessThanOrEqual(1);
        expect(result.engagement).toBeGreaterThanOrEqual(0);
        expect(result.engagement).toBeLessThanOrEqual(1);

        // 正常 Z-Score 下，anomaly 应该为 false
        expect(result.anomaly).toBe(false);

        // 结果应该接近 AI 评估（权重 60-70%）
        expect(Math.abs(result.cognitive - aiAssessment.cognitiveDepth)).toBeLessThan(0.3);
      },
      TEST_TIMEOUT
    );

    it(
      '应该检测异常情况（Z-Score > 2.5）',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '...',
            timestamp: new Date('2026-03-16T19:00:00')
          }
        ];

        const aiAssessment = {
          cognitiveDepth: 0.2,
          stressLevel: 0.8,
          engagement: 0.15
        };

        // 异常 Z-Score（> 2.5）
        const abnormalZScores: ZScores = {
          responseTime: 3.2,      // 响应时间极长
          messageLength: -2.8,    // 消息极短
          interactionInterval: 2.9 // 交互间隔极长
        };

        const result = await service.integrateAIandEMA(
          aiAssessment,
          abnormalZScores,
          conversationHistory
        );

        console.log('融合评估结果（异常 Z-Score）:', result);

        // 应该检测到异常
        expect(result.anomaly).toBe(true);
        expect(result.anomalyReason).toBeDefined();

        // 应该给出干预建议
        expect(result.intervention).toBeDefined();
        expect(result.intervention!.length).toBeGreaterThan(20);
      },
      TEST_TIMEOUT
    );

    it(
      '应该检测高压力低投入的异常情况',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '我学不会了，太难了。',
            timestamp: new Date('2026-03-16T20:00:00')
          }
        ];

        const aiAssessment = {
          cognitiveDepth: 0.15,
          stressLevel: 0.85,    // 高压力
          engagement: 0.20      // 低投入
        };

        const normalZScores: ZScores = {
          responseTime: 0.5,
          messageLength: 0.0,
          interactionInterval: 0.0
        };

        const result = await service.integrateAIandEMA(
          aiAssessment,
          normalZScores,
          conversationHistory
        );

        console.log('融合评估结果（高压力低投入）:', result);

        // 高压力低投入应该标记为异常
        expect(result.anomaly).toBe(true);
        
        // 应该有干预建议
        expect(result.intervention).toBeDefined();
        expect(result.intervention!).toMatch(/压力|休息|支持|干预/i);
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 5：完整状态评估
   */
  describe('assessFullState', () => {
    it(
      '应该一次性评估所有维度',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '我想学习机器学习，但不知道从哪里开始。',
            timestamp: new Date('2026-03-16T21:00:00')
          },
          {
            role: 'assistant',
            content: '很好的目标！机器学习确实需要系统学习。你有编程基础吗？',
            timestamp: new Date('2026-03-16T21:00:15')
          },
          {
            role: 'user',
            content: '会一些 Python，但不太熟练。数学基础还行，学过线性代数和概率统计。',
            timestamp: new Date('2026-03-16T21:01:30')
          },
          {
            role: 'assistant',
            content: '那很好！Python 和数学基础是机器学习的必备技能。建议从 scikit-learn 开始...',
            timestamp: new Date('2026-03-16T21:01:45')
          },
          {
            role: 'user',
            content: '好的，那我先从 scikit-learn 入手。有什么推荐的学习资源吗？',
            timestamp: new Date('2026-03-16T21:02:30')
          }
        ];

        const result = await service.assessFullState(conversationHistory);

        console.log('完整状态评估结果:', result);

        // 验证所有字段存在
        expect(result.cognitive).toBeDefined();
        expect(result.stress).toBeDefined();
        expect(result.engagement).toBeDefined();
        expect(result.anomaly).toBeDefined();
        expect(result.assessedAt).toBeDefined();

        // 验证分数范围
        expect(result.cognitive).toBeGreaterThanOrEqual(0);
        expect(result.cognitive).toBeLessThanOrEqual(1);
        expect(result.stress).toBeGreaterThanOrEqual(0);
        expect(result.stress).toBeLessThanOrEqual(1);
        expect(result.engagement).toBeGreaterThanOrEqual(0);
        expect(result.engagement).toBeLessThanOrEqual(1);

        // assessedAt 应该是最近的时间
        const now = new Date();
        const timeDiff = Math.abs(now.getTime() - result.assessedAt.getTime());
        expect(timeDiff).toBeLessThan(60000); // 1 分钟内
      },
      TEST_TIMEOUT
    );

    it(
      '应该支持带 Z-Score 的完整评估',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '这个概念我还是不太理解，能再解释一下吗？',
            timestamp: new Date('2026-03-16T22:00:00')
          },
          {
            role: 'assistant',
            content: '当然可以！让我换个角度解释...',
            timestamp: new Date('2026-03-16T22:00:15')
          }
        ];

        const zScores: ZScores = {
          responseTime: 1.2,
          messageLength: 0.5,
          interactionInterval: 0.8
        };

        const result = await service.assessFullState(conversationHistory, zScores);

        console.log('带 Z-Score 的完整状态评估结果:', result);

        // 验证所有字段存在
        expect(result.cognitive).toBeDefined();
        expect(result.stress).toBeDefined();
        expect(result.engagement).toBeDefined();
        expect(result.anomaly).toBeDefined();
        expect(result.assessedAt).toBeDefined();

        // 验证分数范围
        expect(result.cognitive).toBeGreaterThanOrEqual(0);
        expect(result.cognitive).toBeLessThanOrEqual(1);
        expect(result.stress).toBeGreaterThanOrEqual(0);
        expect(result.stress).toBeLessThanOrEqual(1);
        expect(result.engagement).toBeGreaterThanOrEqual(0);
        expect(result.engagement).toBeLessThanOrEqual(1);
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 6：评分稳定性测试
   * 验证多次调用结果接近
   */
  describe('评分稳定性', () => {
    it(
      '应该保持评分稳定性（多次调用结果接近）',
      async () => {
        const conversationHistory: Message[] = [
          {
            role: 'user',
            content: '我想学习 React，它和 Vue 有什么区别？',
            timestamp: new Date('2026-03-16T23:00:00')
          },
          {
            role: 'assistant',
            content: 'React 和 Vue 都是流行的前端框架...',
            timestamp: new Date('2026-03-16T23:00:15')
          },
          {
            role: 'user',
            content: '那哪个更容易上手？',
            timestamp: new Date('2026-03-16T23:01:00')
          }
        ];

        // 多次调用
        const results = await Promise.all([
          service.assessCognitiveDepth(conversationHistory),
          service.assessCognitiveDepth(conversationHistory),
          service.assessCognitiveDepth(conversationHistory)
        ]);

        console.log('稳定性测试结果:', results.map(r => r.depth));

        // 验证结果都在合理范围内
        results.forEach(result => {
          expect(result.depth).toBeGreaterThanOrEqual(0);
          expect(result.depth).toBeLessThanOrEqual(1);
        });

        // 验证结果差异不大（允许一定波动）
        const depths = results.map(r => r.depth);
        const maxDiff = Math.max(...depths) - Math.min(...depths);
        expect(maxDiff).toBeLessThan(0.3); // 差异不超过 0.3
      },
      TEST_TIMEOUT
    );
  });

  /**
   * 测试用例 7：边界情况测试
   */
  describe('边界情况', () => {
    it('应该处理空对话历史', async () => {
      const emptyHistory: Message[] = [];

      // 空对话应该能处理（可能返回默认值或低分）
      const result = await service.assessCognitiveDepth(emptyHistory);

      expect(result.depth).toBeGreaterThanOrEqual(0);
      expect(result.depth).toBeLessThanOrEqual(1);
    });

    it('应该处理单条消息', async () => {
      const singleMessage: Message[] = [
        {
          role: 'user',
          content: '你好',
          timestamp: new Date()
        }
      ];

      const result = await service.assessEngagement(singleMessage);

      expect(result.engagement).toBeGreaterThanOrEqual(0);
      expect(result.engagement).toBeLessThanOrEqual(1);
    });

    it('应该处理超长对话历史', async () => {
      const longHistory: Message[] = [];
      for (let i = 0; i < 50; i++) {
        longHistory.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `消息内容 ${i}`,
          timestamp: new Date(Date.now() + i * 1000)
        });
      }

      const result = await service.assessFullState(longHistory);

      expect(result.cognitive).toBeGreaterThanOrEqual(0);
      expect(result.cognitive).toBeLessThanOrEqual(1);
      expect(result.assessedAt).toBeDefined();
    });
  });
});
