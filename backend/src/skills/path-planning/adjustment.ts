import { AgentContext, MilestoneOutput, SubtaskOutput, LearningSignal } from '../../agents/protocol';
import { logger } from '../../utils/logger';
import { memoryTraceService } from '../../services/memory/memory-trace.service';

export type AdjustmentType = 'insert' | 'remove' | 'modify' | 'reorder';
export type AdjustmentTarget = 'milestone' | 'subtask';
export type AdjustmentReason = 
  | 'accelerating'
  | 'decelerating'
  | 'fatigue-high'
  | 'struggling'
  | 'mastery'
  | 'lane-change'
  | 'manual';

export interface PathAdjustment {
  type: AdjustmentType;
  target: AdjustmentTarget;
  position?: number;
  stageNumber?: number;
  content?: MilestoneOutput | SubtaskOutput;
  reason: AdjustmentReason;
  signal?: LearningSignal;
}

export interface AdjustmentResult {
  success: boolean;
  pathId: string;
  adjustments: PathAdjustment[];
  beforeSnapshot: string;
  afterSnapshot: string;
  reason: string;
}

export interface AdjustmentStrategy {
  name: string;
  description: string;
  applicableSignals: AdjustmentReason[];
  execute: (path: any, signal: LearningSignal, context: AgentContext) => Promise<PathAdjustment[]>;
}

const ADJUSTMENT_PROMPTS: Record<AdjustmentReason, string> = {
  accelerating: '学习者进度超前，压缩后续内容，合并相似知识点',
  decelerating: '学习者进度落后，扩展学习周期，增加复习和练习',
  'fatigue-high': '学习者疲劳度高，降低内容密度，插入休息任务',
  struggling: '学习者遇到困难，插入前置知识，增加基础练习',
  mastery: '学习者已掌握当前内容，跳过基础任务，添加挑战任务',
  'lane-change': '学习重点转移，调整后续内容方向',
  manual: '手动调整'
};

export class PathAdjustmentEngine {
  async adjustMilestones(path: any, adjustment: PathAdjustment, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[] }> {
    const milestones = [...path.milestones] as MilestoneOutput[];
    const adjustments: PathAdjustment[] = [];
    switch (adjustment.type) {
      case 'insert': return await this.insertMilestone(milestones, adjustment, context);
      case 'remove':
        if (typeof adjustment.position === 'number' && adjustment.position < milestones.length) {
          milestones.splice(adjustment.position, 1);
          this.renumberMilestones(milestones);
          adjustments.push(adjustment);
        }
        break;
      case 'modify':
        if (typeof adjustment.position === 'number' && adjustment.position < milestones.length && adjustment.content) {
          milestones[adjustment.position] = adjustment.content as MilestoneOutput;
          adjustments.push(adjustment);
        }
        break;
    }
    return { milestones, adjustments };
  }
  async adjustSubtasks(path: any, stageNumber: number, adjustment: PathAdjustment, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[] }> {
    const milestones = [...path.milestones] as MilestoneOutput[];
    const adjustments: PathAdjustment[] = [];
    const milestoneIndex = milestones.findIndex(m => m.stageNumber === stageNumber);
    if (milestoneIndex === -1) return { milestones, adjustments };
    const milestone = milestones[milestoneIndex];
    const subtasks = [...(milestone.subtasks || [])];
    switch (adjustment.type) {
      case 'insert': return await this.insertSubtask(milestones, milestoneIndex, subtasks, adjustment, context);
      case 'remove':
        if (typeof adjustment.position === 'number' && adjustment.position < subtasks.length) {
          subtasks.splice(adjustment.position, 1);
          milestones[milestoneIndex] = { ...milestone, subtasks };
          adjustments.push(adjustment);
        }
        break;
      case 'modify':
        if (typeof adjustment.position === 'number' && adjustment.position < subtasks.length && adjustment.content) {
          subtasks[adjustment.position] = adjustment.content as SubtaskOutput;
          milestones[milestoneIndex] = { ...milestone, subtasks };
          adjustments.push(adjustment);
        }
        break;
    }
    return { milestones, adjustments };
  }
  private async insertMilestone(milestones: MilestoneOutput[], adjustment: PathAdjustment, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[] }> {
    const adjustments: PathAdjustment[] = [];
    const newMilestone = adjustment.content as MilestoneOutput || await this.generateMilestoneForInsertion(milestones, adjustment, context);
    if (newMilestone) {
      const position = adjustment.position ?? milestones.length;
      milestones.splice(position, 0, newMilestone);
      this.renumberMilestones(milestones);
      adjustments.push({ ...adjustment, content: newMilestone });
    }
    return { milestones, adjustments };
  }
  private async insertSubtask(milestones: MilestoneOutput[], milestoneIndex: number, subtasks: SubtaskOutput[], adjustment: PathAdjustment, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[] }> {
    const adjustments: PathAdjustment[] = [];
    const milestone = milestones[milestoneIndex];
    const newSubtask = adjustment.content as SubtaskOutput || await this.generateSubtaskForInsertion(milestone, subtasks, adjustment, context);
    if (newSubtask) {
      const position = adjustment.position ?? subtasks.length;
      subtasks.splice(position, 0, newSubtask);
      milestones[milestoneIndex] = { ...milestone, subtasks };
      adjustments.push({ ...adjustment, content: newSubtask });
    }
    return { milestones, adjustments };
  }
  private async generateMilestoneForInsertion(milestones: MilestoneOutput[], adjustment: PathAdjustment, context: AgentContext): Promise<MilestoneOutput | null> {
    const existingTopics = milestones.map((m, i) => `${i + 1}. ${m.title}`).join('\n');
    try {
      // 懒加载避免 skills/index -> path-planning -> skills/index 循环依赖
      const { executeSkill, auxSkillDefinitionMap } = await import('..');
      const milestoneData = await executeSkill(auxSkillDefinitionMap['path-adjustment-generator'], {
        adjustmentTarget: 'milestone',
        position: adjustment.position ?? null,
        reason: ADJUSTMENT_PROMPTS[adjustment.reason],
        existingTopics,
        milestones: milestones.map((m) => ({ stageNumber: m.stageNumber, title: m.title, description: m.description, goal: m.goal })),
        __fallback: null,
        __prompt: { userId: context.userId, requestPath: '/skills/path-planning/adjustment/milestone', callerAgentId: 'path-agent' },
      });
      if (!milestoneData) return null;
      return {
        stageNumber: (adjustment.position || 0) + 1,
        title: milestoneData.title,
        description: milestoneData.description,
        goal: milestoneData.goal,
        estimatedHours: milestoneData.estimatedHours,
        subtasks: Array.isArray(milestoneData.subtasks)
          ? milestoneData.subtasks.map((s: any, i: number) => ({ id: `subtask_${Date.now()}_${i}`, ...s }))
          : [],
      };
    } catch (error) {
      logger.error('[path-adjustment] failed to generate milestone', {
        userId: context.userId,
        reason: adjustment.reason,
        position: adjustment.position,
        error,
      });
    }
    return null;
  }
  private async generateSubtaskForInsertion(milestone: MilestoneOutput, existingSubtasks: SubtaskOutput[], adjustment: PathAdjustment, context: AgentContext): Promise<SubtaskOutput | null> {
    const existingSubtasksList = existingSubtasks.map((t, i) => `${i + 1}. ${t.title} (${t.type})`).join('\n');
    try {
      // 懒加载避免 skills/index -> path-planning -> skills/index 循环依赖
      const { executeSkill, auxSkillDefinitionMap } = await import('..');
      const subtaskData = await executeSkill(auxSkillDefinitionMap['path-adjustment-generator'], {
        adjustmentTarget: 'subtask',
        reason: ADJUSTMENT_PROMPTS[adjustment.reason],
        milestone: { title: milestone.title, description: milestone.description || '无' },
        existingSubtasks: existingSubtasksList,
        __fallback: null,
        __prompt: { userId: context.userId, requestPath: '/skills/path-planning/adjustment/subtask', callerAgentId: 'path-agent' },
      });
      if (!subtaskData) return null;
      return { id: `subtask_${Date.now()}`, ...subtaskData };
    } catch (error) {
      logger.error('[path-adjustment] failed to generate subtask', {
        userId: context.userId,
        reason: adjustment.reason,
        position: adjustment.position,
        milestoneTitle: milestone.title,
        error,
      });
    }
    return null;
  }
  private renumberMilestones(milestones: MilestoneOutput[]): void { milestones.forEach((milestone, index) => { milestone.stageNumber = index + 1; }); }
  async smartAdjust(path: any, signal: LearningSignal, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const milestones = [...path.milestones] as MilestoneOutput[];
    const adjustments: PathAdjustment[] = [];
    const reason = '';
    const intensity = signal.intensity;
    switch (signal.type) {
      case 'accelerating': return await this.handleAccelerating(milestones, signal, intensity, context);
      case 'decelerating': return await this.handleDecelerating(milestones, signal, intensity, context);
      case 'fatigue-high': return await this.handleFatigue(milestones, signal, intensity, context);
      case 'struggling': return await this.handleStruggling(milestones, signal, intensity, context);
      case 'mastery': return await this.handleMastery(milestones, signal, intensity, context);
      case 'lane-change': return await this.handleLaneChange(milestones, signal, intensity, context);
      default: return { milestones, adjustments, reason: '无需调整' };
    }
  }
  private async handleAccelerating(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const adjustments: PathAdjustment[] = [];
    if (intensity > 0.7 && milestones.length > 2) {
      const mergeIndex = Math.floor(milestones.length / 2);
      const milestone1 = milestones[mergeIndex];
      const milestone2 = milestones[mergeIndex + 1];
      if (milestone1 && milestone2) {
        milestones[mergeIndex] = { ...milestone1, title: `${milestone1.title} & ${milestone2.title}`, subtasks: [...(milestone1.subtasks || []), ...(milestone2.subtasks?.slice(0, 2) || [])] };
        milestones.splice(mergeIndex + 1, 1);
        this.renumberMilestones(milestones);
        adjustments.push({ type: 'remove', target: 'milestone', position: mergeIndex + 1, reason: 'accelerating', signal });
      }
    }
    return { milestones, adjustments, reason: intensity > 0.7 ? '合并里程碑以加速进度' : '保持现有节奏' };
  }
  private async handleDecelerating(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const adjustments: PathAdjustment[] = [];
    if (intensity > 0.5) {
      const insertPosition = Math.floor(milestones.length / 2);
      const newMilestone = await this.generateMilestoneForInsertion(milestones, { type: 'insert', target: 'milestone', position: insertPosition, reason: 'decelerating', signal }, context);
      if (newMilestone) {
        const baseTitle = milestones[insertPosition]?.title || '巩固所学';
        // 记忆引擎 M2：优先用到期记忆痕迹作为旧知唤醒内容（best-effort，查询失败回退原逻辑）
        const dueLabels = await memoryTraceService
          .getDueTraces(context.userId, { limit: 3 })
          .then((traces) => traces.map((trace) => trace.label || trace.conceptKey).filter(Boolean).slice(0, 2))
          .catch(() => [] as string[]);
        newMilestone.title = dueLabels.length > 0
          ? `复习：${baseTitle}（旧知唤醒：${dueLabels.join('、')}）`
          : `复习：${baseTitle}`;
        milestones.splice(insertPosition, 0, newMilestone);
        this.renumberMilestones(milestones);
        adjustments.push({ type: 'insert', target: 'milestone', position: insertPosition, content: newMilestone, reason: 'decelerating', signal });
      }
    }
    return { milestones, adjustments, reason: intensity > 0.5 ? '插入复习里程碑以放慢节奏' : '保持现有节奏' };
  }
  private async handleFatigue(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const adjustments: PathAdjustment[] = [];
    for (let i = 0; i < milestones.length; i++) {
      const milestone = milestones[i];
      const subtasks = milestone.subtasks || [];
      const reducedSubtasks = subtasks.filter((_, index) => index % 2 === 0 || index === subtasks.length - 1);
      if (reducedSubtasks.length < subtasks.length) {
        milestones[i] = { ...milestone, subtasks: reducedSubtasks };
        adjustments.push({ type: 'modify', target: 'milestone', position: i, reason: 'fatigue-high', signal });
      }
    }
    return { milestones, adjustments, reason: '减少每个里程碑的子任务密度以缓解疲劳' };
  }
  private async handleStruggling(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const adjustments: PathAdjustment[] = [];
    if (intensity > 0.4) {
      const insertPosition = 1;
      const newMilestone = await this.generateMilestoneForInsertion(milestones, { type: 'insert', target: 'milestone', position: insertPosition, reason: 'struggling', signal }, context);
      if (newMilestone) {
        newMilestone.title = '基础巩固';
        milestones.splice(insertPosition, 0, newMilestone);
        this.renumberMilestones(milestones);
        adjustments.push({ type: 'insert', target: 'milestone', position: insertPosition, content: newMilestone, reason: 'struggling', signal });
      }
    }
    return { milestones, adjustments, reason: intensity > 0.4 ? '插入基础巩固里程碑' : '继续观察' };
  }
  private async handleMastery(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    const adjustments: PathAdjustment[] = [];
    if (intensity > 0.8 && milestones.length > 1) {
      milestones.splice(0, 1);
      this.renumberMilestones(milestones);
      adjustments.push({ type: 'remove', target: 'milestone', position: 0, reason: 'mastery', signal });
    }
    return { milestones, adjustments, reason: intensity > 0.8 ? '跳过已掌握的基础里程碑' : '继续按计划学习' };
  }
  private async handleLaneChange(milestones: MilestoneOutput[], signal: LearningSignal, intensity: number, context: AgentContext): Promise<{ milestones: MilestoneOutput[]; adjustments: PathAdjustment[]; reason: string }> {
    return { milestones, adjustments: [], reason: '学习重点已转移，建议重新规划路径' };
  }
}
export const pathAdjustmentEngine = new PathAdjustmentEngine();
