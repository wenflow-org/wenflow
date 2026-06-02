/**
 * Agent API 路由
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { getGateway } from '../gateway';
import { agentHandlers, allAgentDefinitions } from '../agents';
import { AgentExecutionRequest, AgentContext } from '../agents/protocol';
import { normalizeAgentOutput } from '../agents/output-normalizer';
import { getRequestContext } from '../gateway/api-gateway/context';
import { logger } from '../utils/logger';

const router = Router();

function parseJsonSafe(raw?: string | null): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 获取所有 Agent 列表
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const agents = gateway.matchAgents({});
    
    res.json({
      success: true,
      data: agents.map(a => ({
        id: a.definition.id,
        name: a.definition.name,
        version: a.definition.version,
        type: a.definition.type,
        category: a.definition.category,
        description: a.definition.description,
        capabilities: a.definition.capabilities,
        stats: a.definition.stats
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取 Agent 详情
 */
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const gateway = getGateway();
    const agent = gateway.getAgent(agentId);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: agent.definition.id,
        name: agent.definition.name,
        version: agent.definition.version,
        type: agent.definition.type,
        category: agent.definition.category,
        description: agent.definition.description,
        capabilities: agent.definition.capabilities,
        subscribes: agent.definition.subscribes,
        publishes: agent.definition.publishes,
        inputSchema: agent.definition.inputSchema,
        outputSchema: agent.definition.outputSchema,
        stats: agent.definition.stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 执行 Agent（带持久化日志）
 */
router.post('/execute/:agentId', authMiddleware, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { agentId } = req.params;
  const { input, context } = req.body;
  
  const requestContext = getRequestContext();
  const sourceEntry = requestContext.sourceEntry || 'user';
  
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }
  
  let result: any;
  let errorInfo: { code: string; message: string } | null = null;
  
  try {
    const gateway = getGateway();
    
    const executionRequest: AgentExecutionRequest = {
      agentId,
      input,
      context: {
        userId,
        sessionId: context?.sessionId,
        sourceEntry,
        conversationHistory: context?.conversationHistory,
        userProfile: context?.userProfile,
        currentState: context?.currentState
      }
    };
    
    // 执行 Agent
    result = await gateway.executeAgent(executionRequest);
    const normalizedOutput = result?.output
      ? normalizeAgentOutput(agentId, result.output)
      : null;
    
    // 准备响应
    const response = {
      success: result.success,
      data: normalizedOutput || result.error,
      metadata: {
        duration: result.duration,
        tokensUsed: result.tokensUsed,
        outputSchema: normalizedOutput
          ? {
              schemaVersion: normalizedOutput.schemaVersion,
              hasUserVisible: !!normalizedOutput.userVisible,
              internalKeys: Object.keys(normalizedOutput.internal || {})
            }
          : null
      }
    };
    
    // 如果执行失败，记录错误信息
    if (!result.success) {
      errorInfo = {
        code: result.error?.code || 'UNKNOWN_ERROR',
        message: result.error?.message || 'Unknown error'
      };
    }
    
    res.json(response);
  } catch (error) {
    errorInfo = {
      code: 'EXECUTION_EXCEPTION',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    
    res.status(500).json({
      success: false,
      error: errorInfo.message
    });
  } finally {
    try {
      const durationMs = Date.now() - startTime;
      const normalizedOutputForLog = result?.output
        ? normalizeAgentOutput(agentId, result.output)
        : null;
      
      await prisma.agent_call_logs.create({
        data: {
          id: uuidv4(),
          agentId,
          userId,
          sourceEntry,
          traceId: requestContext.traceId,
          input: input ? JSON.stringify(input) : null,
          output: normalizedOutputForLog ? JSON.stringify(normalizedOutputForLog) : null,
          success: result?.success ?? false,
          durationMs,
          tokensUsed: result?.tokensUsed,
          error: errorInfo?.message,
          errorCode: errorInfo?.code,
          calledAt: new Date(),
          metadata: JSON.stringify({
            requestContext: context,
            responseMetadata: result
              ? {
                  duration: result.duration,
                  outputSchema: result.output
                    ? {
                        schemaVersion: normalizedOutputForLog?.schemaVersion || 'agent-output-v1',
                        hasUserVisible: !!normalizedOutputForLog?.userVisible,
                        hasInternal: !!normalizedOutputForLog?.internal,
                        legacyFieldsPresent: {
                          goalConversation: !!(result.output as any).goalConversation,
                          path: !!(result.output as any).path,
                          progress: !!(result.output as any).progress,
                          output: !!(result.output as any).output
                        }
                      }
                    : null
                }
              : null
          })
        }
      });
    } catch (logError) {
      logger.error('[agents-route] failed to persist agent call log', {
        agentId,
        userId,
        traceId: requestContext.traceId,
        error: logError,
      });
    }
  }
});

/**
 * 匹配 Agent
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { types, categories, capabilities, minSuccessRate } = req.body;
    
    const gateway = getGateway();
    const agents = gateway.matchAgents({
      types,
      categories,
      capabilities,
      minSuccessRate
    });
    
    res.json({
      success: true,
      data: agents.map(a => ({
        id: a.definition.id,
        name: a.definition.name,
        type: a.definition.type,
        capabilities: a.definition.capabilities,
        successRate: a.definition.stats.successRate
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 注册 Agent（仅管理员可调用）
 */
router.post('/register', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const definition = req.body;
    
    const gateway = getGateway();
    const agentId = await gateway.registerAgent(definition);
    
    res.json({
      success: true,
      data: { agentId }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取 Agent 调用历史
 */
router.get('/:agentId/history', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const logs = await prisma.agent_call_logs.findMany({
      where: { agentId },
      orderBy: { calledAt: 'desc' },
      take: limit
    });
    
    res.json({
      success: true,
      data: logs.map(log => {
        const rawOutput = parseJsonSafe(log.output);
        const normalizedOutput = rawOutput ? normalizeAgentOutput(log.agentId, rawOutput) : null;

        return {
          id: log.id,
          userId: log.userId,
          success: log.success,
          durationMs: log.durationMs,
          tokensUsed: log.tokensUsed,
          calledAt: log.calledAt,
          output: normalizedOutput
            ? {
                schemaVersion: normalizedOutput.schemaVersion,
                userVisible: normalizedOutput.userVisible,
                internal: normalizedOutput.internal,
                renderHints: normalizedOutput.renderHints
              }
            : null
        };
      })
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
