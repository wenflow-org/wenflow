/**
 * 路径调整策略
 * 
 * 定义不同信号对应的调整策略
 */

import { LearningSignal } from '../protocol';
import { AdjustmentStrategy, AdjustmentReason, PathAdjustment } from './adjustment';
import { conceptPriorityStrategy } from '../../strategies/concept-priority';

export const compressStrategy: AdjustmentStrategy = {
  name: 'compress',
  description: '压缩路径，合并相似内容，适合加速学习者',
  applicableSignals: ['accelerating'],
  
  async execute(path: any, signal: LearningSignal, context): Promise<PathAdjustment[]> {
    const adjustments: PathAdjustment[] = [];
    const milestones = path.milestones;
    
    if (milestones.length < 3) return adjustments;
    
    const intensity = signal.intensity;
    
    if (intensity > 0.7) {
      adjustments.push({
        type: 'remove',
        target: 'milestone',
        position: Math.floor(milestones.length / 2),
        reason: 'accelerating',
        signal
      });
    }
    
    if (intensity > 0.5) {
      for (let i = 0; i < milestones.length; i++) {
        const subtasks = milestones[i].subtasks || [];
        if (subtasks.length > 3) {
          adjustments.push({
            type: 'remove',
            target: 'subtask',
            stageNumber: i + 1,
            position: subtasks.length - 1,
            reason: 'accelerating',
            signal
          });
        }
      }
    }
    
    return adjustments;
  }
};

export const extendStrategy: AdjustmentStrategy = {
  name: 'extend',
  description: '扩展路径，增加复习和练习，适合减速学习者',
  applicableSignals: ['decelerating', 'struggling'],
  
  async execute(path: any, signal: LearningSignal, context): Promise<PathAdjustment[]> {
    const adjustments: PathAdjustment[] = [];
    const milestones = path.milestones;
    
    const insertPosition = signal.type === 'struggling' ? 1 : Math.floor(milestones.length / 2);
    
    adjustments.push({
      type: 'insert',
      target: 'milestone',
      position: insertPosition,
      reason: signal.type as AdjustmentReason,
      signal
    });
    
    return adjustments;
  }
};

export const fatigueAdjustStrategy: AdjustmentStrategy = {
  name: 'fatigue-adjust',
  description: '降低内容密度，增加休息，适合疲劳学习者',
  applicableSignals: ['fatigue-high'],
  
  async execute(path: any, signal: LearningSignal, context): Promise<PathAdjustment[]> {
    const adjustments: PathAdjustment[] = [];
    const milestones = path.milestones;
    
    for (let i = 0; i < milestones.length; i++) {
      const subtasks = milestones[i].subtasks || [];
      if (subtasks.length > 2) {
        adjustments.push({
          type: 'modify',
          target: 'milestone',
          position: i,
          reason: 'fatigue-high',
          signal
        });
      }
    }
    
    return adjustments;
  }
};

export const challengeBoostStrategy: AdjustmentStrategy = {
  name: 'challenge-boost',
  description: '增加挑战性内容，适合高掌握度学习者',
  applicableSignals: ['mastery'],
  
  async execute(path: any, signal: LearningSignal, context): Promise<PathAdjustment[]> {
    const adjustments: PathAdjustment[] = [];
    const milestones = path.milestones;
    
    if (signal.intensity > 0.8 && milestones.length > 1) {
      adjustments.push({
        type: 'remove',
        target: 'milestone',
        position: 0,
        reason: 'mastery',
        signal
      });
    }
    
    adjustments.push({
      type: 'insert',
      target: 'subtask',
      stageNumber: milestones.length,
      position: 0,
      reason: 'mastery',
      signal
    });
    
    return adjustments;
  }
};

export const deviationResponseStrategy: AdjustmentStrategy = {
  name: 'deviation-response',
  description: '响应学习重点转移，建议重新规划',
  applicableSignals: ['lane-change'],
  
  async execute(path: any, signal: LearningSignal, context): Promise<PathAdjustment[]> {
    return [{
      type: 'modify',
      target: 'milestone',
      position: 0,
      reason: 'lane-change',
      signal
    }];
  }
};

export const allAdjustmentStrategies: AdjustmentStrategy[] = [
  compressStrategy,
  extendStrategy,
  fatigueAdjustStrategy,
  challengeBoostStrategy,
  deviationResponseStrategy,
  conceptPriorityStrategy
];

export function getApplicableStrategies(signal: LearningSignal): AdjustmentStrategy[] {
  return allAdjustmentStrategies.filter(s => 
    s.applicableSignals.includes(signal.type as AdjustmentReason)
  );
}