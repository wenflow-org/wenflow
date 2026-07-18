/**
 * 事件总线 - EduClaw Gateway
 * 
 * Agent 之间的通信机制，解耦调用
 * 支持发布/订阅模式，事件持久化
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// 事件类型定义
export type LearningEventType =
  // 学习进度事件
  | 'learning:started'          // 开始学习
  | 'learning:completed'        // 完成学习
  | 'learning:paused'           // 暂停学习
  | 'learning:resumed'          // 恢复学习
  
  // 学习信号事件
  | 'learning:speed:change'     // 学习速度变化
  | 'learning:focus:shift'      // 学习重点转移（变道）
  | 'learning:fatigue:high'     // 疲劳度高
  | 'learning:struggle'         // 学习困难
  | 'learning:mastery'          // 掌握知识
  | 'learning:signal:detected'  // 信号检测完成
  
  // 课程事件
  | 'lesson:started'            // 一节课开始
  | 'lesson:completed'          // 一节课完成
  
  // 路径事件
  | 'path:created'              // 路径创建
  | 'path:generated'            // 路径生成（v3.0）
  | 'path:adjusted'             // 路径调整
  | 'path:completed'            // 路径完成
  | 'path:adjustment:request'   // 路径调整请求
  
  // 任务事件
  | 'task:started'              // 任务开始
  | 'task:completed'            // 任务完成
  | 'task:skipped'              // 任务跳过
  | 'task:struggled'            // 任务困难
  
  // 内容事件
  | 'content:generated'         // 内容生成
  | 'content:adjusted'          // 内容调整
  | 'content:adjustment:request' // 内容调整请求
  
  // 画像事件
  | 'profile:updated'           // 用户画像更新
  | 'personalization:request'   // 个性化请求
  | 'personalization:ready'     // 个性化参数就绪
  | 'goal:understanding:updated' // 目标理解更新
  
  // Agent 事件
  | 'agent:called'              // Agent 被调用
  | 'agent:completed'           // Agent 完成
  | 'agent:error'               // Agent 错误
  
  // Skill 事件 (v3.1)
  | 'skill:annotated'           // Skill 注释完成
  | 'clarification:request'     // 澄清请求
  | 'annotation:corrected'      // 注释修正

// 事件数据结构
export interface LearningEvent {
  id?: string;
  type: LearningEventType;
  timestamp?: string; // 可选，emit时会自动添加
  source: string; // Agent ID 或 'user' 或 'system'
  userId?: string;
  sessionId?: string;
  data: Record<string, any>;
  metadata?: {
    correlationId?: string;
    causationId?: string;
    [key: string]: any;
  };
}

// 事件处理器
export type EventHandler = (event: LearningEvent) => Promise<void> | void;

// 事件总线配置
export interface EventBusConfig {
  persistEvents: boolean;
  maxListeners: number;
  eventTTL: number; // 事件保留时间（毫秒）
}

// 默认配置
const DEFAULT_CONFIG: EventBusConfig = {
  persistEvents: true,
  maxListeners: 100,
  eventTTL: 7 * 24 * 60 * 60 * 1000 // 7天
};

/**
 * 事件总线实现
 */
export class EventBus {
  private emitter: EventEmitter;
  private prisma: PrismaClient;
  private config: EventBusConfig;
  private eventBuffer: LearningEvent[] = [];
  private eventStore: Map<string, LearningEvent> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private handlerWrappers = new Map<EventHandler, Map<string, EventHandler[]>>();
  private inFlightHandlers = new Set<Promise<void>>();
  private closing = false;
  private closed = false;

  constructor(prisma: PrismaClient, config: Partial<EventBusConfig> = {}) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(this.config.maxListeners);
    
    // 启动定时刷新
    this.startFlushInterval();
  }

  /**
   * 发布事件
   */
  async emit(event: LearningEvent): Promise<void> {
    if (this.closed) throw new Error('EventBus 已关闭，拒绝发布新事件');
    // 添加时间戳
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }

    // 生成事件 ID
    if (!event.id) {
      event.id = this.generateEventId();
    }

    // 存储到内存
    this.eventStore.set(event.id, event);

    // 持久化事件
    if (this.config.persistEvents) {
      await this.persistEvent(event);
    }

    // 发送到内存事件总线
    this.emitter.emit(event.type, event);
    
    // 同时发送通配符事件
    this.emitter.emit('*', event);
  }

  /**
   * 订阅事件
   */
  on(eventType: LearningEventType | '*', handler: EventHandler): void {
    this.assertOpenForSubscription();
    const wrapped = this.wrapHandler(eventType, handler, false);
    this.rememberWrapper(eventType, handler, wrapped);
    this.emitter.on(eventType, wrapped);
  }

  /**
   * 取消订阅
   */
  off(eventType: LearningEventType | '*', handler: EventHandler): void {
    const wrappers = this.handlerWrappers.get(handler)?.get(eventType);
    const wrapped = wrappers?.pop();
    if (!wrapped) return;
    this.emitter.off(eventType, wrapped);
    this.cleanupWrapperMap(eventType, handler, wrappers!);
  }

  /**
   * 一次性订阅
   */
  once(eventType: LearningEventType, handler: EventHandler): void {
    this.assertOpenForSubscription();
    const wrapped = this.wrapHandler(eventType, handler, true);
    this.rememberWrapper(eventType, handler, wrapped);
    this.emitter.once(eventType, wrapped);
  }

  /**
   * 订阅多个事件类型
   */
  onMultiple(eventTypes: LearningEventType[], handler: EventHandler): void {
    eventTypes.forEach(type => this.on(type, handler));
  }

  /**
   * 获取事件历史
   */
  async getHistory(options: {
    userId?: string;
    types?: LearningEventType[];
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<LearningEvent[]> {
    // 从内存存储中查询
    let events = Array.from(this.eventStore.values());
    
    // 应用过滤器
    if (options.userId) {
      events = events.filter(e => e.userId === options.userId);
    }
    
    if (options.types && options.types.length > 0) {
      events = events.filter(e => options.types!.includes(e.type));
    }
    
    if (options.from) {
      events = events.filter(e => new Date(e.timestamp) >= options.from!);
    }
    
    if (options.to) {
      events = events.filter(e => new Date(e.timestamp) <= options.to!);
    }
    
    // 按时间降序排序
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // 限制数量
    const limit = options.limit || 100;
    return events.slice(0, limit);
  }

  /**
   * 持久化事件到数据库
   */
  private async persistEvent(event: LearningEvent): Promise<void> {
    try {
      // 检查 eventLog 模型是否存在
      if (!(this.prisma as any).eventLog) {
        // 模型不存在，跳过持久化
        return;
      }
      await (this.prisma as any).eventLog.create({
        data: {
          id: event.id,
          eventType: event.type,
          eventData: JSON.stringify(event.data),
          source: event.source,
          userId: event.userId || null,
        }
      });
    } catch (error) {
      logger.error('[event-bus] failed to persist event', {
        eventId: event.id,
        eventType: event.type,
        source: event.source,
        userId: event.userId,
        error,
      });
      // 不抛出错误，允许事件继续传播
    }
  }

  /**
   * 生成事件 ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 启动定时刷新
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.cleanupOldEvents();
    }, 60 * 60 * 1000); // 每小时清理一次
    this.flushInterval.unref?.();
  }

  /**
   * 清理过期事件
   */
  private async cleanupOldEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.eventTTL);
    try {
      // 检查 eventLog 模型是否存在
      if (!(this.prisma as any).eventLog) {
        return;
      }
      await (this.prisma as any).eventLog.deleteMany({
        where: {
          createdAt: { lt: cutoff }
        }
      });
    } catch (error) {
      logger.error('[event-bus] failed to cleanup old events', { error });
    }
  }

  /**
   * 关闭事件总线
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushInterval = null;
    while (this.inFlightHandlers.size > 0) {
      await Promise.allSettled([...this.inFlightHandlers]);
    }
    this.emitter.removeAllListeners();
    this.handlerWrappers.clear();
    this.closed = true;
    this.closing = false;
  }

  private assertOpenForSubscription(): void {
    if (this.closing || this.closed) throw new Error('EventBus 正在关闭，拒绝新增订阅');
  }

  private wrapHandler(
    eventType: LearningEventType | '*',
    handler: EventHandler,
    once: boolean
  ): EventHandler {
    const wrapped: EventHandler = (event) => {
      if (once) this.removeWrapper(eventType, handler, wrapped);
      let operation: Promise<void>;
      try {
        operation = Promise.resolve(handler(event));
      } catch (error) {
        this.logHandlerError(eventType, event, error);
        return;
      }
      const tracked = operation.catch(error => {
        this.logHandlerError(eventType, event, error);
      }).finally(() => this.inFlightHandlers.delete(tracked));
      this.inFlightHandlers.add(tracked);
    };
    return wrapped;
  }

  private rememberWrapper(
    eventType: LearningEventType | '*',
    handler: EventHandler,
    wrapped: EventHandler
  ): void {
    let byType = this.handlerWrappers.get(handler);
    if (!byType) {
      byType = new Map();
      this.handlerWrappers.set(handler, byType);
    }
    const wrappers = byType.get(eventType) || [];
    wrappers.push(wrapped);
    byType.set(eventType, wrappers);
  }

  private removeWrapper(
    eventType: LearningEventType | '*',
    handler: EventHandler,
    wrapped: EventHandler
  ): void {
    const wrappers = this.handlerWrappers.get(handler)?.get(eventType);
    if (!wrappers) return;
    const index = wrappers.lastIndexOf(wrapped);
    if (index >= 0) wrappers.splice(index, 1);
    this.cleanupWrapperMap(eventType, handler, wrappers);
  }

  private cleanupWrapperMap(
    eventType: LearningEventType | '*',
    handler: EventHandler,
    wrappers: EventHandler[]
  ): void {
    if (wrappers.length > 0) return;
    const byType = this.handlerWrappers.get(handler);
    byType?.delete(eventType);
    if (byType?.size === 0) this.handlerWrappers.delete(handler);
  }

  private logHandlerError(
    eventType: LearningEventType | '*',
    event: LearningEvent,
    error: unknown
  ): void {
    logger.error('[event-bus] event handler failed', {
      subscribedType: eventType,
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// 导出单例创建函数
let eventBusInstance: EventBus | null = null;

export function createEventBus(prisma: PrismaClient, config?: Partial<EventBusConfig>): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus(prisma, config);
  }
  return eventBusInstance;
}

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    throw new Error('EventBus not initialized. Call createEventBus first.');
  }
  return eventBusInstance;
}
