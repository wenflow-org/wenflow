/**
 * Agent 协作服务
 * 
 * 协调四大核心Agent的互相调用
 * 事件驱动架构
 */

import { EventBus, getEventBus, LearningEvent } from '../gateway/event-bus';
import { 
  LearningSignal, 
  AgentContext,
  LessonCompletedData,
  SignalDetectionResult,
  PathAdjustmentRequest
} from '../agents/protocol';
import { pathAdjustmentEngine, PathAdjustment } from '../agents/path-agent/adjustment';
import { userProfileAgent } from '../agents/user-profile-agent';
import prisma from '../config/database';

export interface AgentCollaborationConfig {
  enableAutoAdjustment: boolean;
  adjustmentCooldown: number;
  minSignalsForAdjustment: number;
  profileUpdateInterval: number;
}

const DEFAULT_CONFIG: AgentCollaborationConfig = {
  enableAutoAdjustment: true,
  adjustmentCooldown: 300000,
  minSignalsForAdjustment: 2,
  profileUpdateInterval: 60000
};

export class AgentCollaborationService {
  private eventBus: EventBus;
  private config: AgentCollaborationConfig;
  private lastAdjustmentTime: Map<string, number> = new Map();
  private pendingSignals: Map<string, LearningSignal[]> = new Map();
  
  constructor(config: Partial<AgentCollaborationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = getEventBus();
  }
  
  start(): void {
    this.setupEventListeners();
    console.log('[AgentCollaboration] Service started');
  }
  
  stop(): void {
    console.log('[AgentCollaboration] Service stopped');
  }
  
  private setupEventListeners(): void {
    this.eventBus.on('lesson:completed', async (event) => {
      await this.handleLessonCompleted(event);
    });
    
    this.eventBus.on('learning:signal:detected', async (event) => {
      await this.handleSignalDetected(event);
    });
    
    this.eventBus.on('profile:updated', async (event) => {
      await this.handleProfileUpdated(event);
    });
    
    this.eventBus.on('personalization:request', async (event) => {
      await this.handlePersonalizationRequest(event);
    });
  }
  
  /**
   * 处理一节课完成事件
   * 触发 progress-agent 评估
   */
  private async handleLessonCompleted(event: LearningEvent): Promise<void> {
    const { userId, data } = event;
    if (!userId) return;
    
    const lessonData = data as LessonCompletedData;
    
    const progressResult = await this.callProgressAgent(userId, {
      action: 'lesson_complete',
      lessonData
    });
    
    if (progressResult.success && progressResult.progress?.signal) {
      await this.eventBus.emit({
        type: 'learning:signal:detected',
        source: 'agent-collaboration',
        userId,
        data: {
          signal: progressResult.progress.signal,
          metrics: progressResult.progress.metrics,
          lessonId: lessonData.lessonId
        }
      });
    }
    
    await this.eventBus.emit({
      type: 'profile:updated',
      source: 'agent-collaboration',
      userId,
      data: {
        source: 'lesson',
        performance: lessonData.performance
      }
    });
  }
  
  /**
   * 处理信号检测事件
   * 决定是否需要调整路径或内容
   */
  private async handleSignalDetected(event: LearningEvent): Promise<void> {
    const { userId, data } = event;
    if (!userId || !this.config.enableAutoAdjustment) return;
    
    const signal = data.signal as LearningSignal;
    
    const existingSignals = this.pendingSignals.get(userId) || [];
    existingSignals.push(signal);
    this.pendingSignals.set(userId, existingSignals);
    
    const lastTime = this.lastAdjustmentTime.get(userId) || 0;
    if (Date.now() - lastTime < this.config.adjustmentCooldown) {
      console.log(`[AgentCollaboration] Cooldown active for user ${userId}`);
      return;
    }
    
    if (existingSignals.length < this.config.minSignalsForAdjustment) {
      console.log(`[AgentCollaboration] Not enough signals for adjustment (${existingSignals.length}/${this.config.minSignalsForAdjustment})`);
      return;
    }
    
    const decision = this.evaluateAdjustmentDecision(existingSignals);
    
    if (decision.shouldAdjustPath) {
      await this.triggerPathAdjustment(userId, signal, decision);
    }
    
    if (decision.shouldAdjustContent) {
      await this.triggerContentAdjustment(userId, signal);
    }
    
    this.lastAdjustmentTime.set(userId, Date.now());
    this.pendingSignals.set(userId, []);
  }
  
  /**
   * 评估是否需要调整
   */
  private evaluateAdjustmentDecision(signals: LearningSignal[]): {
    shouldAdjustPath: boolean;
    shouldAdjustContent: boolean;
    urgency: 'low' | 'medium' | 'high';
    reason: string;
  } {
    const avgIntensity = signals.reduce((sum, s) => sum + s.intensity, 0) / signals.length;
    const signalTypes = new Set(signals.map(s => s.type));
    
    const hasFatigue = signalTypes.has('fatigue-high');
    const hasStruggle = signalTypes.has('struggling');
    const hasMastery = signalTypes.has('mastery');
    const hasAccelerating = signalTypes.has('accelerating');
    const hasDecelerating = signalTypes.has('decelerating');
    
    let shouldAdjustPath = false;
    let shouldAdjustContent = false;
    let urgency: 'low' | 'medium' | 'high' = 'low';
    let reason = '';
    
    if (hasFatigue && avgIntensity > 0.6) {
      shouldAdjustPath = true;
      shouldAdjustContent = true;
      urgency = 'high';
      reason = '高疲劳度需要立即调整';
    } else if (hasStruggle && avgIntensity > 0.5) {
      shouldAdjustPath = true;
      shouldAdjustContent = true;
      urgency = 'medium';
      reason = '学习困难需要支持';
    } else if (hasMastery && avgIntensity > 0.8) {
      shouldAdjustPath = true;
      urgency = 'low';
      reason = '已掌握，可加速进度';
    } else if ((hasAccelerating || hasDecelerating) && avgIntensity > 0.6) {
      shouldAdjustPath = true;
      urgency = 'medium';
      reason = '学习节奏变化';
    } else if (avgIntensity > 0.5) {
      shouldAdjustContent = true;
      urgency = 'low';
      reason = '建议内容微调';
    }
    
    return { shouldAdjustPath, shouldAdjustContent, urgency, reason };
  }
  
  /**
   * 触发路径调整
   */
  private async triggerPathAdjustment(
    userId: string,
    signal: LearningSignal,
    decision: { urgency: string; reason: string }
  ): Promise<void> {
    try {
      const activePath = await this.getActivePath(userId);
      if (!activePath) {
        console.log(`[AgentCollaboration] No active path for user ${userId}`);
        return;
      }
      
      const context: AgentContext = {
        userId,
        currentState: {
          activePathId: activePath.id
        }
      };
      
      const result = await pathAdjustmentEngine.smartAdjust(
        activePath,
        signal,
        context
      );
      
      if (result.adjustments.length > 0) {
        await this.savePathAdjustments(activePath.id, result.milestones, result.adjustments);
        
        await this.eventBus.emit({
          type: 'path:adjusted',
          source: 'agent-collaboration',
          userId,
          data: {
            pathId: activePath.id,
            adjustments: result.adjustments,
            reason: result.reason,
            urgency: decision.urgency
          }
        });
        
        console.log(`[AgentCollaboration] Path adjusted for user ${userId}: ${result.reason}`);
      }
    } catch (error) {
      console.error('[AgentCollaboration] Failed to adjust path:', error);
    }
  }
  
  /**
   * 触发内容调整
   */
  private async triggerContentAdjustment(
    userId: string,
    signal: LearningSignal
  ): Promise<void> {
    const direction = signal.type === 'fatigue-high' || signal.type === 'struggling'
      ? 'easier'
      : signal.type === 'mastery' || signal.type === 'accelerating'
        ? 'harder'
        : null;
    
    if (!direction) return;
    
    await this.eventBus.emit({
      type: 'content:adjustment:request',
      source: 'agent-collaboration',
      userId,
      data: {
        direction,
        reason: signal.context || signal.type,
        signal
      }
    });
  }
  
  /**
   * 处理用户画像更新
   */
  private async handleProfileUpdated(event: LearningEvent): Promise<void> {
    const { userId, data } = event;
    if (!userId) return;
    
    console.log(`[AgentCollaboration] Profile updated for user ${userId}: ${JSON.stringify(data.changes || [])}`);
  }
  
  /**
   * 处理个性化请求
   */
  private async handlePersonalizationRequest(event: LearningEvent): Promise<void> {
    const { userId, data } = event;
    if (!userId) return;
    
    try {
      const result = await userProfileAgent.getPersonalization(userId);
      
      await this.eventBus.emit({
        type: 'personalization:ready',
        source: 'agent-collaboration',
        userId,
        data: {
          config: result.config,
          promptEnhancement: result.promptEnhancement,
          contentHints: result.contentHints,
          targetAgent: data.targetAgent
        }
      });
    } catch (error) {
      console.error('[AgentCollaboration] Failed to get personalization:', error);
    }
  }
  
  /**
   * 调用 progress-agent
   */
  private async callProgressAgent(userId: string, input: any): Promise<any> {
    try {
      const { progressAgentHandler } = await import('../agents/progress-agent');
      return await progressAgentHandler(
        { type: 'custom', goal: '', metadata: input },
        { userId }
      );
    } catch (error) {
      console.error('[AgentCollaboration] Failed to call progress-agent:', error);
      return { success: false };
    }
  }
  
  /**
   * 获取用户活跃路径
   */
  private async getActivePath(userId: string): Promise<any> {
    try {
      const path = await prisma.learning_paths.findFirst({
        where: { 
          userId,
          status: 'active'
        },
        include: {
          milestones: {
            include: {
              subtasks: true
            },
            orderBy: { stageNumber: 'asc' }
          }
        }
      });
      
      if (!path) return null;
      
      return {
        id: path.id,
        name: path.name,
        totalMilestones: (path as any).totalMilestones || path.milestones.length,
        milestones: path.milestones.map((m: any) => ({
          stageNumber: m.stageNumber,
          title: m.title,
          description: m.description,
          subtasks: m.subtasks.map((s: any) => ({
            id: s.id,
            title: s.title,
            type: s.taskType || s.type || 'reading',
            estimatedMinutes: s.estimatedMinutes || 30,
            description: s.description
          }))
        }))
      };
    } catch (error) {
      console.error('[AgentCollaboration] Failed to get active path:', error);
      return null;
    }
  }
  
  /**
   * 保存路径调整
   */
  private async savePathAdjustments(
    pathId: string,
    milestones: any[],
    adjustments: PathAdjustment[]
  ): Promise<void> {
    try {
      for (const milestone of milestones) {
        const existingMilestone = await prisma.milestones.findFirst({
          where: { learningPathId: pathId, stageNumber: milestone.stageNumber }
        });
        
        if (existingMilestone) {
          await prisma.milestones.update({
            where: { id: existingMilestone.id },
            data: {
              title: milestone.title,
              description: milestone.description
            }
          });
        } else {
          await prisma.milestones.create({
            data: {
              id: `milestone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              learningPathId: pathId,
              stageNumber: milestone.stageNumber,
              title: milestone.title,
              description: milestone.description,
              updatedAt: new Date()
            }
          });
        }
      }
      
      console.log(`[AgentCollaboration] Saved ${adjustments.length} adjustments for path ${pathId}`);
    } catch (error) {
      console.error('[AgentCollaboration] Failed to save path adjustments:', error);
    }
  }
  
  /**
   * 手动触发一节课完成
   */
  async completeLesson(
    userId: string,
    lessonData: LessonCompletedData
  ): Promise<void> {
    await this.eventBus.emit({
      type: 'lesson:completed',
      source: 'manual',
      userId,
      sessionId: lessonData.sessionId,
      data: lessonData
    });
  }
  
  /**
   * 手动触发个性化请求
   */
  async requestPersonalization(
    userId: string,
    targetAgent: string,
    context: string
  ): Promise<any> {
    const result = await userProfileAgent.getPersonalization(userId);
    return result;
  }
  
  /**
   * 获取用户当前信号状态
   */
  getUserSignalStatus(userId: string): {
    pendingSignals: LearningSignal[];
    lastAdjustment: number | null;
    canAdjust: boolean;
  } {
    const pendingSignals = this.pendingSignals.get(userId) || [];
    const lastAdjustment = this.lastAdjustmentTime.get(userId) || null;
    const canAdjust = lastAdjustment 
      ? Date.now() - lastAdjustment >= this.config.adjustmentCooldown
      : true;
    
    return { pendingSignals, lastAdjustment, canAdjust };
  }
}

let collaborationService: AgentCollaborationService | null = null;

export function createAgentCollaborationService(
  config?: Partial<AgentCollaborationConfig>
): AgentCollaborationService {
  if (!collaborationService) {
    collaborationService = new AgentCollaborationService(config);
  }
  return collaborationService;
}

export function getAgentCollaborationService(): AgentCollaborationService {
  if (!collaborationService) {
    collaborationService = new AgentCollaborationService();
  }
  return collaborationService;
}