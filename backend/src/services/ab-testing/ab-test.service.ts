// A/B 测试服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

interface CreateABTestParams {
  name: string;
  description?: string;
  testType: 'prompt' | 'strategy' | 'ui_type' | 'difficulty';
  variants: Array<{
    id: string;
    name: string;
    config: any;
  }>;
  trafficSplit: Record<string, number>;
  startDate?: Date;
  endDate?: Date;
}

interface RecordResultParams {
  testId: string;
  userId: string;
  sessionId: string;
  taskId: string;
  variantId: string;
  metrics: {
    completionTime?: number;
    successRate?: number;
    averageScore?: number;
    engagement?: number;
    frustration?: number;
    satisfaction?: number;
    preTestScore?: number;
    postTestScore?: number;
    learningGain?: number;
  };
}

export class ABTestService {
  /**
   * 创建 A/B 测试
   */
  async createABTest(params: CreateABTestParams): Promise<any> {
    try {
      const abTest = await prisma.ab_test.create({
        data: {
          id: `abt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          name: params.name,
          description: params.description,
          testType: params.testType,
          variants: JSON.stringify(params.variants),
          trafficSplit: JSON.stringify(params.trafficSplit),
          status: 'draft',
          startDate: params.startDate,
          endDate: params.endDate,
          updatedAt: new Date()
        }
      });
      
      logger.info('[ABTest] 创建测试', { testId: abTest.id, name: abTest.name });
      return abTest;
    } catch (error) {
      logger.error('[ABTest] 创建测试失败', error);
      throw error;
    }
  }
  
  /**
   * 启动测试
   */
  async startTest(testId: string): Promise<void> {
    try {
      await prisma.ab_test.update({
        where: { id: testId },
        data: {
          status: 'running',
          startDate: new Date()
        }
      });
      
      logger.info('[ABTest] 启动测试', { testId });
    } catch (error) {
      logger.error('[ABTest] 启动测试失败', error);
      throw error;
    }
  }
  
  /**
   * 暂停测试
   */
  async pauseTest(testId: string): Promise<void> {
    try {
      await prisma.ab_test.update({
        where: { id: testId },
        data: { status: 'paused' }
      });
      
      logger.info('[ABTest] 暂停测试', { testId });
    } catch (error) {
      logger.error('[ABTest] 暂停测试失败', error);
      throw error;
    }
  }
  
  /**
   * 完成测试
   */
  async completeTest(testId: string): Promise<void> {
    try {
      await prisma.ab_test.update({
        where: { id: testId },
        data: {
          status: 'completed',
          endDate: new Date()
        }
      });
      
      logger.info('[ABTest] 完成测试', { testId });
    } catch (error) {
      logger.error('[ABTest] 完成测试失败', error);
      throw error;
    }
  }
  
  /**
   * 分配变体（核心逻辑）
   */
  async assignVariant(userId: string, testId: string): Promise<string> {
    try {
      // 检查是否已有分配
      const existing = await prisma.ab_test_result.findFirst({
        where: {
          testId,
          userId
        }
      });
      
      if (existing) {
        return existing.variantId;
      }
      
      // 获取测试
      const test = await prisma.ab_test.findUnique({
        where: { id: testId }
      });
      
      if (!test || test.status !== 'running') {
        throw new Error('测试未运行');
      }
      
      // 解析流量分配（从 JSON 字符串）
      const trafficSplit = typeof test.trafficSplit === 'string' 
        ? JSON.parse(test.trafficSplit) 
        : test.trafficSplit;
      
      // 根据流量分配随机选择变体
      const variantId = this.selectVariantByTraffic(trafficSplit);
      
      // 记录分配
      await prisma.ab_test_result.create({
        data: {
          id: `abr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          testId,
          userId,
          sessionId: 'session-' + Date.now(),
          taskId: 'task-' + Date.now(),
          variantId
        }
      });
      
      logger.info('[ABTest] 分配变体', { userId, testId, variantId });
      return variantId;
    } catch (error) {
      logger.error('[ABTest] 分配变体失败', error);
      throw error;
    }
  }
  
  /**
   * 根据流量分配选择变体
   */
  private selectVariantByTraffic(trafficSplit: Record<string, number>): string {
    const rand = Math.random() * 100;
    let cumulative = 0;
    
    for (const [variantId, percentage] of Object.entries(trafficSplit)) {
      cumulative += percentage;
      if (rand <= cumulative) {
        return variantId;
      }
    }
    
    return Object.keys(trafficSplit)[0];
  }
  
  /**
   * 记录测试结果
   */
  async recordResult(params: RecordResultParams): Promise<void> {
    try {
      await prisma.ab_test_result.updateMany({
        where: {
          testId: params.testId,
          userId: params.userId
        },
        data: params.metrics
      });
      
      logger.info('[ABTest] 记录结果', { testId: params.testId, userId: params.userId });
    } catch (error) {
      logger.error('[ABTest] 记录结果失败', error);
      throw error;
    }
  }
  
  /**
   * 获取测试结果统计
   */
  async getTestResults(testId: string) {
    try {
      const results = await prisma.ab_test_result.groupBy({
        by: ['variantId'],
        where: { testId },
        _avg: {
          completionTime: true,
          successRate: true,
          averageScore: true,
          engagement: true,
          frustration: true,
          satisfaction: true,
          learningGain: true
        },
        _count: true
      });
      
      return results;
    } catch (error) {
      logger.error('[ABTest] 获取测试结果失败', error);
      throw error;
    }
  }
  
  /**
   * 获取所有测试
   */
  async getAllTests() {
    try {
      const tests = await prisma.ab_test.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { ab_test_result: true }
          }
        }
      });
      
      return tests;
    } catch (error) {
      logger.error('[ABTest] 获取测试列表失败', error);
      throw error;
    }
  }
  
  /**
   * 获取单个测试详情
   */
  async getTestById(testId: string) {
    try {
      const test = await prisma.ab_test.findUnique({
        where: { id: testId },
        include: {
          ab_test_result: {
            orderBy: { createdAt: 'desc' },
            take: 100
          }
        }
      });
      
      return test;
    } catch (error) {
      logger.error('[ABTest] 获取测试详情失败', error);
      throw error;
    }
  }
  
  /**
   * 统计显著性检验（简化版 t 检验）
   */
  calculateSignificance(groupA: number[], groupB: number[]): {
    tValue: number;
    pValue: number;
    significant: boolean;
  } {
    const n1 = groupA.length;
    const n2 = groupB.length;
    
    if (n1 < 2 || n2 < 2) {
      return {
        tValue: 0,
        pValue: 1,
        significant: false
      };
    }
    
    const mean1 = groupA.reduce((a, b) => a + b, 0) / n1;
    const mean2 = groupB.reduce((a, b) => a + b, 0) / n2;
    const variance1 = groupA.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / (n1 - 1);
    const variance2 = groupB.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / (n2 - 1);
    
    const se = Math.sqrt(variance1 / n1 + variance2 / n2);
    const tValue = se > 0 ? (mean1 - mean2) / se : 0;
    
    // 简化的 p 值估算（实际应查表）
    const pValue = Math.exp(-Math.abs(tValue));
    const significant = pValue < 0.05;
    
    return { tValue, pValue, significant };
  }
  
  /**
   * 分析测试结果（包含显著性检验）
   */
  async analyzeTestResults(testId: string) {
    try {
      const results = await prisma.ab_test_result.findMany({
        where: { testId }
      });
      
      // 按变体分组
      const variants = new Map<string, any[]>();
      results.forEach(result => {
        if (!variants.has(result.variantId)) {
          variants.set(result.variantId, []);
        }
        variants.get(result.variantId)!.push(result);
      });
      
      // 计算每个变体的统计信息
      const stats: any = {};
      variants.forEach((results, variantId) => {
        const metric = results.map(r => r.satisfaction || 0);
        stats[variantId] = {
          count: results.length,
          avgSatisfaction: metric.reduce((a, b) => a + b, 0) / metric.length,
          data: metric
        };
      });
      
      // 如果有两个变体，进行显著性检验
      let significance = null;
      if (variants.size === 2) {
        const variantIds = Array.from(variants.keys());
        const groupA = variants.get(variantIds[0])!.map(r => r.satisfaction || 0);
        const groupB = variants.get(variantIds[1])!.map(r => r.satisfaction || 0);
        significance = this.calculateSignificance(groupA, groupB);
      }
      
      return {
        stats,
        significance,
        totalResults: results.length
      };
    } catch (error) {
      logger.error('[ABTest] 分析测试结果失败', error);
      throw error;
    }
  }
}

export const abTestService = new ABTestService();
