/**
 * Agent 日志工具类
 * 用于记录 ContentAgent v3.0 的详细运行日志
 */

import { logger } from './logger';

export interface StrategySelectionLog {
  userId: string;
  sessionId: string;
  studentState: {
    frustration?: number;
    problemClarity?: number;
    strategy?: string;
    [key: string]: any;
  };
  selectedStrategy: string;
  strategyReason: string;
}

export interface ContentGenerationLog {
  userId: string;
  sessionId: string;
  strategy: string;
  uiType: string;
  difficulty: number;
  duration: number;
  qualityScore: number;
  tokensUsed?: number;
}

export interface ErrorLog {
  userId: string;
  sessionId: string;
  error: string;
  stack?: string;
  errorCode?: string;
}

export interface PerformanceLog {
  agentId: string;
  action: string;
  duration: number;
  tokensUsed: number;
  success: boolean;
  promptVersion?: number;
}

export interface AgentCallMetrics {
  agentId: string;
  userId: string;
  promptVersion: number;
  duration: number;
  tokensUsed: number;
  success: boolean;
  error?: string;
  input?: any;
  output?: any;
  studentState?: {
    frustration: number;
    problemClarity: number;
    strategy: string;
    [key: string]: any;
  };
  quality?: {
    score: number;
    latency: number;
    userSatisfaction?: number;
  };
}

export class AgentLogger {
  /**
   * 记录策略选择日志
   */
  static logStrategySelection(data: StrategySelectionLog): void {
    logger.info('[ContentAgent] 策略选择', {
      timestamp: new Date().toISOString(),
      userId: data.userId,
      sessionId: data.sessionId,
      studentState: data.studentState,
      selectedStrategy: data.selectedStrategy,
      strategyReason: data.strategyReason
    });
  }

  /**
   * 记录内容生成日志
   */
  static logContentGeneration(data: ContentGenerationLog): void {
    logger.info('[ContentAgent] 内容生成', {
      timestamp: new Date().toISOString(),
      userId: data.userId,
      sessionId: data.sessionId,
      strategy: data.strategy,
      uiType: data.uiType,
      difficulty: data.difficulty,
      duration: data.duration,
      qualityScore: data.qualityScore,
      tokensUsed: data.tokensUsed || 0
    });
  }

  /**
   * 记录错误日志
   */
  static logError(data: ErrorLog): void {
    logger.error('[ContentAgent] 错误', {
      timestamp: new Date().toISOString(),
      userId: data.userId,
      sessionId: data.sessionId,
      error: data.error,
      stack: data.stack,
      errorCode: data.errorCode
    });
  }

  /**
   * 记录性能指标
   */
  static logPerformance(data: PerformanceLog): void {
    const logLevel = data.success ? 'info' : 'warn';
    logger[logLevel]('[Agent] 性能指标', {
      timestamp: new Date().toISOString(),
      agentId: data.agentId,
      action: data.action,
      duration: data.duration,
      tokensUsed: data.tokensUsed,
      success: data.success,
      promptVersion: data.promptVersion
    });
  }

  /**
   * 记录 Agent 调用开始
   */
  static logCallStart(agentId: string, userId: string, action: string): void {
    logger.debug('[Agent] 调用开始', {
      timestamp: new Date().toISOString(),
      agentId,
      userId,
      action
    });
  }

  /**
   * 记录 Agent 调用结束
   */
  static logCallEnd(
    agentId: string,
    userId: string,
    action: string,
    duration: number,
    success: boolean,
    tokensUsed?: number
  ): void {
    const logLevel = success ? 'debug' : 'error';
    logger[logLevel]('[Agent] 调用结束', {
      timestamp: new Date().toISOString(),
      agentId,
      userId,
      action,
      duration,
      success,
      tokensUsed: tokensUsed || 0
    });
  }

  /**
   * 记录学生状态变化
   */
  static logStudentStateChange(
    userId: string,
    sessionId: string,
    previousState: any,
    newState: any
  ): void {
    logger.info('[ContentAgent] 学生状态变化', {
      timestamp: new Date().toISOString(),
      userId,
      sessionId,
      previousState,
      newState
    });
  }

  /**
   * 记录 UI 组件渲染
   */
  static logUiRender(
    userId: string,
    sessionId: string,
    uiType: string,
    renderTime: number
  ): void {
    logger.debug('[ContentAgent] UI 组件渲染', {
      timestamp: new Date().toISOString(),
      userId,
      sessionId,
      uiType,
      renderTime
    });
  }
}

export default AgentLogger;
