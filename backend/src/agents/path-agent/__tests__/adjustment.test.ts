/**
 * Path Adjustment 测试
 */

import { pathAdjustmentEngine, PathAdjustment } from '../adjustment';
import { LearningSignal, AgentContext } from '../../protocol';

const mockPath = {
  id: 'test-path',
  name: 'Python 入门',
  totalWeeks: 4,
  weeks: [
    {
      weekNumber: 1,
      title: 'Python 基础',
      tasks: [
        { id: 't1', title: '变量和数据类型', type: 'reading' as const, estimatedMinutes: 30 },
        { id: 't2', title: '练习：变量声明', type: 'practice' as const, estimatedMinutes: 20 }
      ]
    },
    {
      weekNumber: 2,
      title: '控制流程',
      tasks: [
        { id: 't3', title: '条件语句', type: 'reading' as const, estimatedMinutes: 30 },
        { id: 't4', title: '循环', type: 'reading' as const, estimatedMinutes: 30 },
        { id: 't5', title: '练习：循环', type: 'practice' as const, estimatedMinutes: 40 }
      ]
    },
    {
      weekNumber: 3,
      title: '函数',
      tasks: [
        { id: 't6', title: '函数定义', type: 'reading' as const, estimatedMinutes: 30 },
        { id: 't7', title: '参数和返回值', type: 'reading' as const, estimatedMinutes: 30 }
      ]
    },
    {
      weekNumber: 4,
      title: '数据结构',
      tasks: [
        { id: 't8', title: '列表', type: 'reading' as const, estimatedMinutes: 30 },
        { id: 't9', title: '字典', type: 'reading' as const, estimatedMinutes: 30 }
      ]
    }
  ]
};

const mockContext: AgentContext = {
  userId: 'test-user'
};

describe('Path Adjustment Engine', () => {
  describe('smartAdjust', () => {
    it('should handle accelerating signal by compressing path', async () => {
      const signal: LearningSignal = {
        type: 'accelerating',
        intensity: 0.8,
        context: '学习速度加快',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      expect(result.weeks.length).toBeLessThanOrEqual(mockPath.weeks.length);
      expect(result.adjustments.length).toBeGreaterThan(0);
      expect(result.reason).toContain('加速');
    });
    
    it('should handle decelerating signal by extending path', async () => {
      const signal: LearningSignal = {
        type: 'decelerating',
        intensity: 0.7,
        context: '学习速度减慢',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      if (result.adjustments.length > 0) {
        expect(result.reason).toContain('复习');
      }
    });
    
    it('should handle fatigue signal by reducing task density', async () => {
      const signal: LearningSignal = {
        type: 'fatigue-high',
        intensity: 0.8,
        context: '疲劳度高',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      expect(result.reason).toContain('疲劳');
    });
    
    it('should handle struggling signal by inserting review week', async () => {
      const signal: LearningSignal = {
        type: 'struggling',
        intensity: 0.6,
        context: '遇到困难',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      if (signal.intensity > 0.4 && result.adjustments.length > 0) {
        expect(result.reason).toContain('巩固');
      }
    });
    
    it('should handle mastery signal by skipping content', async () => {
      const signal: LearningSignal = {
        type: 'mastery',
        intensity: 0.9,
        context: '已掌握',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      expect(result.adjustments.some(a => a.reason === 'mastery')).toBe(true);
    });
    
    it('should not adjust when intensity is low', async () => {
      const signal: LearningSignal = {
        type: 'accelerating',
        intensity: 0.2,
        context: '轻微加速',
        timestamp: new Date().toISOString()
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(mockPath, signal, mockContext);
      
      expect(result.reason).toContain('保持现有节奏');
    });
  });
  
  describe('adjustWeeks', () => {
    it('should insert a week at specified position', async () => {
      const adjustment: PathAdjustment = {
        type: 'insert',
        target: 'week',
        position: 1,
        reason: 'manual'
      };
      
      const result = await pathAdjustmentEngine.adjustWeeks(mockPath, adjustment, mockContext);
      
      expect(result.weeks.length).toBe(mockPath.weeks.length + 1);
    });
    
    it('should remove a week at specified position', async () => {
      const adjustment: PathAdjustment = {
        type: 'remove',
        target: 'week',
        position: 0,
        reason: 'manual'
      };
      
      const result = await pathAdjustmentEngine.adjustWeeks(mockPath, adjustment, mockContext);
      
      expect(result.weeks.length).toBe(mockPath.weeks.length - 1);
    });
    
    it('should renumber weeks after removal', async () => {
      const adjustment: PathAdjustment = {
        type: 'remove',
        target: 'week',
        position: 1,
        reason: 'manual'
      };
      
      const result = await pathAdjustmentEngine.adjustWeeks(mockPath, adjustment, mockContext);
      
      result.weeks.forEach((week, index) => {
        expect(week.weekNumber).toBe(index + 1);
      });
    });
  });
  
  describe('adjustTasks', () => {
    it('should insert a task in specified week', async () => {
      const adjustment: PathAdjustment = {
        type: 'insert',
        target: 'task',
        weekNumber: 1,
        position: 1,
        reason: 'manual'
      };
      
      const result = await pathAdjustmentEngine.adjustTasks(mockPath, 1, adjustment, mockContext);
      
      expect(result.weeks[0].tasks.length).toBe(mockPath.weeks[0].tasks.length + 1);
    });
    
    it('should remove a task from specified week', async () => {
      const adjustment: PathAdjustment = {
        type: 'remove',
        target: 'task',
        weekNumber: 2,
        position: 0,
        reason: 'manual'
      };
      
      const result = await pathAdjustmentEngine.adjustTasks(mockPath, 2, adjustment, mockContext);
      
      expect(result.weeks[1].tasks.length).toBe(mockPath.weeks[1].tasks.length - 1);
    });
  });
});