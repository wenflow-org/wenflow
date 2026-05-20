/**
 * Simulation Orchestrator Agent - 编排器代理
 *
 * 这个 Agent 是 SimulationOrchestrator 在 Agent Registry 中的代理。
 * 它让 SimulationOrchestrator 能够在 Admin "编排器管理" 页面中可见和可配置。
 *
 * 真正的编排逻辑在 orchestrators/simulation.orchestrator.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { AgentDefinition, AgentContext, AgentInput, AgentOutput } from '../protocol';
import simulationOrchestrator from '../../orchestrators/simulation.orchestrator';

export const simulationOrchestratorAgentDefinition: AgentDefinition = {
  id: 'simulation-orchestrator',
  name: '虚拟用户模拟编排器',
  version: '1.0.0',
  type: 'orchestrator',
  category: 'simulation',
  description: '编排虚拟用户模拟流程：Goal对话 → Path生成 → Learning阶段。用于测试和验证平台功能。',
  capabilities: [
    'goal-simulation',
    'path-simulation',
    'learning-simulation',
    'evaluation'
  ],
  subscribes: [],
  publishes: ['simulation:completed', 'simulation:failed'],
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['single-step', 'auto-loop', 'advance-path'] },
      goal: { type: 'string', description: '模拟目标' },
      metadata: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: '模拟会话ID' },
          userId: { type: 'string', description: '虚拟用户ID' },
          maxRounds: { type: 'number', description: '自动循环最大轮次' }
        }
      }
    },
    required: ['type']
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      userVisible: { type: 'string', description: '用户可见的执行结果' },
      internal: {
        type: 'object',
        properties: {
          stage: { type: 'string' },
          results: { type: 'array' }
        }
      }
    }
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export async function simulationOrchestratorAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const traceId = context.metadata?.traceId || uuidv4();

  try {
    const operationType = input.type as string;
    const sessionId = input.metadata?.sessionId as string;
    const userId = input.metadata?.userId || context.userId;

    logger.info('[simulation-orchestrator-agent] 开始执行', {
      traceId,
      operationType,
      sessionId,
      userId
    });

    if (!sessionId) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: '缺少 sessionId' },
        metadata: {
          agentId: 'simulation-orchestrator',
          agentName: '虚拟用户模拟编排器',
          agentType: 'orchestrator',
          confidence: 0,
          generatedAt: new Date().toISOString()
        }
      };
    }

    let result: any;

    if (operationType === 'single-step') {
      result = await simulationOrchestrator.executeSingleStep({
        sessionId,
        userId,
        mode: 'single-step'
      });
    } else if (operationType === 'auto-loop') {
      const maxRounds = input.metadata?.maxRounds || 20;
      result = await simulationOrchestrator.executeAutoLoop(
        { sessionId, userId, mode: 'auto-loop' },
        { maxRounds }
      );
      result = {
        success: true,
        totalRounds: result.length,
        lastResult: result[result.length - 1]
      };
    } else if (operationType === 'advance-path') {
      result = await simulationOrchestrator.advanceToPathGeneration(sessionId);
    } else {
      return {
        success: false,
        error: { code: 'INVALID_OPERATION', message: `未知的操作类型: ${operationType}` },
        metadata: {
          agentId: 'simulation-orchestrator',
          agentName: '虚拟用户模拟编排器',
          agentType: 'orchestrator',
          confidence: 0,
          generatedAt: new Date().toISOString()
        }
      };
    }

    const duration = Date.now() - startTime;
    logger.info('[simulation-orchestrator-agent] 执行完成', {
      traceId,
      operationType,
      duration,
      success: result?.success
    });

    return {
      success: result?.success ?? true,
      userVisible: result?.success
        ? `模拟操作 ${operationType} 执行成功`
        : `模拟操作 ${operationType} 执行失败: ${result?.error || '未知错误'}`,
      internal: {
        core: {
          stage: result?.currentStage || 'unknown',
          confidence: result?.success ? 0.9 : 0,
          isCompleted: operationType === 'advance-path' && result?.success
        },
        result
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'simulation-orchestrator',
        agentName: '虚拟用户模拟编排器',
        agentType: 'orchestrator',
        confidence: result?.success ? 0.9 : 0,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error('[simulation-orchestrator-agent] 执行失败', {
      traceId,
      error: error.message,
      duration
    });

    return {
      success: false,
      error: { code: 'ORCHESTRATOR_ERROR', message: error.message },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'simulation-orchestrator',
        agentName: '虚拟用户模拟编排器',
        agentType: 'orchestrator',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

export { simulationOrchestrator };