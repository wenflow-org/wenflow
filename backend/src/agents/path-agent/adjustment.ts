import { AgentContext, MilestoneOutput, SubtaskOutput, LearningSignal } from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { EventBus, getEventBus } from '../../gateway/event-bus';

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
    const client = getOpenAIClient();
    const existingTopics = milestones.map((m, i) => `${i + 1}. ${m.title}`).join('\n');
    const systemPrompt = `你是一位课程设计专家。需要在现有学习路径中插入一个新的里程碑。现有里程碑主题：${existingTopics}插入位置：第 ${adjustment.position} 个里程碑之前插入原因：${ADJUSTMENT_PROMPTS[adjustment.reason]}请生成一个合适的新里程碑，返回JSON格式。{ "title": "里程碑标题", "description": "里程碑描述", "goal": "里程碑目标", "estimatedHours": 4, "subtasks": [{ "title": "子任务标题", "type": "reading|practice|project|quiz", "estimatedMinutes": 30, "description": "任务描述" }] }`;
    try {
      const response = await client.chatCompletion({ messages: [{ role: 'system', content: systemPrompt }], temperature: 0.7 });
      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const milestoneData = JSON.parse(jsonMatch[0]);
        return { stageNumber: (adjustment.position || 0) + 1, title: milestoneData.title, description: milestoneData.description, goal: milestoneData.goal, estimatedHours: milestoneData.estimatedHours, subtasks: milestoneData.subtasks.map((s: any, i: number) => ({ id: `subtask_${Date.now()}_${i}`, ...s })) };
      }
    } catch (error) { console.error('[PathAdjustment] Failed to generate milestone:', error); }
    return null;
  }
  private async generateSubtaskForInsertion(milestone: MilestoneOutput, existingSubtasks: SubtaskOutput[], adjustment: PathAdjustment, context: AgentContext): Promise<SubtaskOutput | null> {
    const client = getOpenAIClient();
    const existingSubtasksList = existingSubtasks.map((t, i) => `${i + 1}. ${t.title} (${t.type})`).join('\n');
    const systemPrompt = `你是一位课程设计专家。需要在现有里程碑中插入一个新的子任务。里程碑主题：${milestone.title}里程碑描述：${milestone.description || '无'}现有子任务：${existingSubtasksList}插入原因：${ADJUSTMENT_PROMPTS[adjustment.reason]}请生成一个合适的新子任务，返回JSON格式。{ "title": "子任务标题", "type": "reading|practice|project|quiz", "estimatedMinutes": 30, "description": "任务描述" }`;
    try {
      const response = await client.chatCompletion({ messages: [{ role: 'system', content: systemPrompt }], temperature: 0.7 });
      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const subtaskData = JSON.parse(jsonMatch[0]);
        return { id: `subtask_${Date.now()}`, ...subtaskData };
      }
    } catch (error) { console.error('[PathAdjustment] Failed to generate subtask:', error); }
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
        newMilestone.title = `复习：${milestones[insertPosition]?.title || '巩固所学'}`;
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