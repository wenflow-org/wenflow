/**
 * StudentBaselineService 单元测试
 * 
 * 测试 EMA 工具函数和基线服务的正确性
 */

import {
  updateEMA,
  calculateZScore,
  initEMABaseline,
  isAnomaly,
  batchUpdateEMA,
  computeEMAFromHistory,
  EMABaseline
} from '../../utils/ema'
import { StudentBaselineService } from '../student-baseline.service'

describe('EMA 工具函数', () => {
  describe('updateEMA', () => {
    it('应该正确更新 EMA 值', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 5 }
      const result = updateEMA(baseline, 12, 0.1)

      // newEma = 0.1 * 12 + 0.9 * 10 = 1.2 + 9 = 10.2
      expect(result.ema).toBeCloseTo(10.2, 5)
      
      // newEmVar = 0.1 * (12 - 10.2)^2 + 0.9 * 1 = 0.1 * 3.24 + 0.9 = 0.324 + 0.9 = 1.224
      expect(result.emVar).toBeCloseTo(1.224, 5)
      
      // updateCount 应该增加
      expect(result.updateCount).toBe(6)
    })

    it('应该处理较小的 alpha 值', () => {
      const baseline: EMABaseline = { ema: 100, emVar: 10, updateCount: 10 }
      const result = updateEMA(baseline, 110, 0.05)

      // newEma = 0.05 * 110 + 0.95 * 100 = 5.5 + 95 = 100.5
      expect(result.ema).toBeCloseTo(100.5, 5)
    })

    it('应该处理较大的 alpha 值', () => {
      const baseline: EMABaseline = { ema: 100, emVar: 10, updateCount: 10 }
      const result = updateEMA(baseline, 110, 0.3)

      // newEma = 0.3 * 110 + 0.7 * 100 = 33 + 70 = 103
      expect(result.ema).toBeCloseTo(103, 5)
    })

    it('应该处理边界情况：alpha = 1', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 5, updateCount: 3 }
      const result = updateEMA(baseline, 20, 1)

      // newEma = 1 * 20 + 0 * 10 = 20
      expect(result.ema).toBe(20)
    })

    it('应该抛出错误：alpha <= 0', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 1 }
      expect(() => updateEMA(baseline, 12, 0)).toThrow('alpha 必须在 (0, 1] 范围内')
      expect(() => updateEMA(baseline, 12, -0.1)).toThrow('alpha 必须在 (0, 1] 范围内')
    })

    it('应该抛出错误：alpha > 1', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 1 }
      expect(() => updateEMA(baseline, 12, 1.5)).toThrow('alpha 必须在 (0, 1] 范围内')
    })

    it('应该处理未指定 updateCount 的情况', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1 }
      const result = updateEMA(baseline, 12, 0.1)
      expect(result.updateCount).toBe(1)
    })
  })

  describe('calculateZScore', () => {
    it('应该正确计算 Z-Score（异常情况）', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 }
      const z = calculateZScore(15, baseline)

      // Z = (15 - 10) / sqrt(1) = 5 / 1 = 5
      expect(z).toBeCloseTo(5, 5)
    })

    it('应该正确计算 Z-Score（正常情况）', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 }
      const z = calculateZScore(10.5, baseline)

      // Z = (10.5 - 10) / sqrt(1) = 0.5 / 1 = 0.5
      expect(z).toBeCloseTo(0.5, 5)
    })

    it('应该处理 updateCount 不足的情况', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 3 }
      const z = calculateZScore(15, baseline)

      // updateCount < 5，应该返回 0
      expect(z).toBe(0)
    })

    it('应该处理 emVar 太小的情况', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 0.0001, updateCount: 10 }
      const z = calculateZScore(15, baseline)

      // emVar < 0.001，应该返回 0
      expect(z).toBe(0)
    })

    it('应该处理负的 Z-Score', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 4, updateCount: 10 }
      const z = calculateZScore(6, baseline)

      // Z = (6 - 10) / sqrt(4) = -4 / 2 = -2
      expect(z).toBeCloseTo(-2, 5)
    })

    it('应该使用自定义的 minUpdates', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 3 }
      const z = calculateZScore(15, baseline, { minUpdates: 3 })

      // updateCount >= 3，应该正常计算
      expect(z).toBeCloseTo(5, 5)
    })

    it('应该使用自定义的 minVariance', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 0.01, updateCount: 10 }
      const z = calculateZScore(15, baseline, { minVariance: 0.001 })

      // emVar >= 0.001，应该正常计算
      // Z = (15 - 10) / sqrt(0.01) = 5 / 0.1 = 50
      expect(z).toBeCloseTo(50, 5)
    })
  })

  describe('initEMABaseline', () => {
    it('应该正确初始化基线', () => {
      const baseline = initEMABaseline(100)

      expect(baseline.ema).toBe(100)
      expect(baseline.emVar).toBe(10) // 100 的 10%
      expect(baseline.updateCount).toBe(1)
    })

    it('应该使用自定义的 initialVar', () => {
      const baseline = initEMABaseline(100, { initialVar: 50 })

      expect(baseline.ema).toBe(100)
      expect(baseline.emVar).toBe(50)
      expect(baseline.updateCount).toBe(1)
    })

    it('应该处理负值', () => {
      const baseline = initEMABaseline(-50)

      expect(baseline.ema).toBe(-50)
      expect(baseline.emVar).toBe(5) // |-50| 的 10%
      expect(baseline.updateCount).toBe(1)
    })

    it('应该处理零值', () => {
      const baseline = initEMABaseline(0)

      expect(baseline.ema).toBe(0)
      expect(baseline.emVar).toBe(1) // 最小值
      expect(baseline.updateCount).toBe(1)
    })
  })

  describe('isAnomaly', () => {
    it('应该检测到异常', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 }
      
      expect(isAnomaly(15, baseline)).toBe(true)  // Z = 5
      expect(isAnomaly(5, baseline)).toBe(true)   // Z = -5
    })

    it('应该判断为正常', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 }
      
      expect(isAnomaly(11, baseline)).toBe(false) // Z = 1
      expect(isAnomaly(9, baseline)).toBe(false)  // Z = -1
    })

    it('应该使用自定义阈值', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 }
      
      expect(isAnomaly(11.5, baseline, 1)).toBe(true)  // Z = 1.5 >= 1
      expect(isAnomaly(11.5, baseline, 2)).toBe(false) // Z = 1.5 < 2
    })
  })

  describe('batchUpdateEMA', () => {
    it('应该批量更新 EMA', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 0 }
      const values = [12, 14, 11, 13]
      const result = batchUpdateEMA(baseline, values, 0.1)

      expect(result.updateCount).toBe(4)
      expect(result.ema).toBeGreaterThan(10)
      expect(result.ema).toBeLessThan(14)
    })

    it('应该处理空数组', () => {
      const baseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 5 }
      const result = batchUpdateEMA(baseline, [], 0.1)

      expect(result.ema).toBe(10)
      expect(result.updateCount).toBe(5)
    })
  })

  describe('computeEMAFromHistory', () => {
    it('应该从历史数据计算 EMA', () => {
      const values = [10, 12, 14, 11, 13]
      const result = computeEMAFromHistory(values, 0.1)

      expect(result.updateCount).toBe(5)
      expect(result.ema).toBeGreaterThan(10)
      expect(result.ema).toBeLessThan(14)
    })

    it('应该抛出错误：空数组', () => {
      expect(() => computeEMAFromHistory([], 0.1)).toThrow('历史数据不能为空')
    })

    it('应该处理单个值', () => {
      const values = [50]
      const result = computeEMAFromHistory(values, 0.1)

      expect(result.ema).toBe(50)
      expect(result.updateCount).toBe(1)
    })
  })
})

describe('StudentBaselineService', () => {
  let service: StudentBaselineService

  beforeEach(() => {
    service = new StudentBaselineService()
  })

  afterEach(() => {
    service.clear()
  })

  describe('getOrCreateBaseline', () => {
    it('应该创建新的基线', async () => {
      const baseline = await service.getOrCreateBaseline('user1')

      expect(baseline.userId).toBe('user1')
      expect(baseline.responseTime.ema).toBe(1000)
      expect(baseline.messageLength.ema).toBe(50)
      expect(baseline.interactionInterval.ema).toBe(30)
      expect(baseline.aiScore.ema).toBe(70)
      expect(baseline.responseTime.updateCount).toBe(1)
    })

    it('应该返回已存在的基线', async () => {
      const baseline1 = await service.getOrCreateBaseline('user1')
      const baseline2 = await service.getOrCreateBaseline('user1')

      expect(baseline1.id).toBe(baseline2.id)
      expect(baseline1.userId).toBe(baseline2.userId)
    })

    it('应该为不同用户创建不同的基线', async () => {
      const baseline1 = await service.getOrCreateBaseline('user1')
      const baseline2 = await service.getOrCreateBaseline('user2')

      expect(baseline1.id).not.toBe(baseline2.id)
      expect(baseline1.userId).toBe('user1')
      expect(baseline2.userId).toBe('user2')
    })
  })

  describe('updateBaseline', () => {
    it('应该更新所有指标', async () => {
      const result = await service.updateBaseline('user1', {
        responseTime: 1200,
        messageLength: 60,
        interactionInterval: 35,
        aiScore: 75
      })

      expect(result.responseTime.ema).toBeGreaterThan(1000)
      expect(result.responseTime.ema).toBeLessThan(1200)
      expect(result.responseTime.updateCount).toBe(2)

      expect(result.messageLength.ema).toBeGreaterThan(50)
      expect(result.messageLength.ema).toBeLessThan(60)
      expect(result.messageLength.updateCount).toBe(2)

      expect(result.interactionInterval.ema).toBeGreaterThan(30)
      expect(result.interactionInterval.ema).toBeLessThan(35)
      expect(result.interactionInterval.updateCount).toBe(2)

      expect(result.aiScore.ema).toBeGreaterThan(70)
      expect(result.aiScore.ema).toBeLessThan(75)
      expect(result.aiScore.updateCount).toBe(2)
    })

    it('应该只更新提供的指标', async () => {
      const result1 = await service.updateBaseline('user1', {
        responseTime: 1200
      })

      expect(result1.responseTime.updateCount).toBe(2)
      expect(result1.messageLength.updateCount).toBe(1) // 未更新
    })

    it('应该计算 Z-Score', async () => {
      // 先更新几次以建立基线
      await service.updateBaseline('user1', { responseTime: 1000 })
      await service.updateBaseline('user1', { responseTime: 1050 })
      await service.updateBaseline('user1', { responseTime: 950 })
      await service.updateBaseline('user1', { responseTime: 1020 })
      await service.updateBaseline('user1', { responseTime: 980 })

      // 现在更新一个异常值
      const result = await service.updateBaseline('user1', { responseTime: 2000 })

      expect(result.responseTime.zScore).toBeGreaterThan(2)
    })
  })

  describe('getZScores', () => {
    it('应该获取所有指标的 Z-Score', async () => {
      await service.updateBaseline('user1', { responseTime: 1000 })
      await service.updateBaseline('user1', { responseTime: 1050 })
      await service.updateBaseline('user1', { responseTime: 950 })
      await service.updateBaseline('user1', { responseTime: 1020 })
      await service.updateBaseline('user1', { responseTime: 980 })

      const zScores = await service.getZScores('user1', {
        responseTime: 1500
      })

      expect(zScores.responseTime).toBeDefined()
      expect(zScores.responseTime).toBeGreaterThan(2)
    })

    it('应该只返回提供的指标的 Z-Score', async () => {
      const zScores = await service.getZScores('user1', {
        messageLength: 100
      })

      expect(Object.keys(zScores)).toEqual(['messageLength'])
    })
  })

  describe('getBaseline', () => {
    it('应该获取已存在的基线', async () => {
      await service.getOrCreateBaseline('user1')
      const baseline = await service.getBaseline('user1')

      expect(baseline).not.toBeNull()
      expect(baseline?.userId).toBe('user1')
    })

    it('应该返回 null 对于不存在的基线', async () => {
      const baseline = await service.getBaseline('user1')

      expect(baseline).toBeNull()
    })
  })

  describe('deleteBaseline', () => {
    it('应该删除基线', async () => {
      await service.getOrCreateBaseline('user1')
      const deleted = await service.deleteBaseline('user1')
      const baseline = await service.getBaseline('user1')

      expect(deleted).toBe(true)
      expect(baseline).toBeNull()
    })

    it('应该返回 false 对于不存在的基线', async () => {
      const deleted = await service.deleteBaseline('user1')

      expect(deleted).toBe(false)
    })
  })

  describe('getBaselineCount', () => {
    it('应该返回基线数量', async () => {
      expect(await service.getBaselineCount()).toBe(0)

      await service.getOrCreateBaseline('user1')
      expect(await service.getBaselineCount()).toBe(1)

      await service.getOrCreateBaseline('user2')
      expect(await service.getBaselineCount()).toBe(2)
    })
  })

  describe('batchUpdate', () => {
    it('应该批量更新多个学生', async () => {
      const updates = {
        user1: { responseTime: 1200 },
        user2: { responseTime: 900 }
      }

      const results = await service.batchUpdate(updates)

      expect(results.user1).toBeDefined()
      expect(results.user2).toBeDefined()
      expect(results.user1.responseTime.ema).toBeGreaterThan(1000)
      expect(results.user2.responseTime.ema).toBeLessThan(1000)
    })
  })

  describe('detectAnomalies', () => {
    it('应该检测到异常', async () => {
      // 建立基线
      for (let i = 0; i < 5; i++) {
        await service.updateBaseline('user1', { responseTime: 1000 + i * 10 })
      }

      const result = await service.detectAnomalies('user1', {
        responseTime: 2000
      })

      expect(result.isAnomaly).toBe(true)
      expect(result.anomalies.responseTime).toBeDefined()
      expect(result.anomalies.responseTime.zScore).toBeGreaterThan(2)
      expect(result.anomalies.responseTime.direction).toBe('high')
    })

    it('应该检测到低值异常', async () => {
      // 建立基线
      for (let i = 0; i < 5; i++) {
        await service.updateBaseline('user1', { aiScore: 70 + i })
      }

      const result = await service.detectAnomalies('user1', {
        aiScore: 30
      })

      expect(result.isAnomaly).toBe(true)
      expect(result.anomalies.aiScore).toBeDefined()
      expect(result.anomalies.aiScore.direction).toBe('low')
    })

    it('应该判断为正常', async () => {
      // 建立基线
      for (let i = 0; i < 5; i++) {
        await service.updateBaseline('user1', { responseTime: 1000 + i * 10 })
      }

      const result = await service.detectAnomalies('user1', {
        responseTime: 1020
      })

      expect(result.isAnomaly).toBe(false)
      expect(Object.keys(result.anomalies).length).toBe(0)
    })
  })
})
