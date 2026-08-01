import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';

const router = Router();

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

router.get('/agents', async (_req: Request, res: Response) => {
  const rows = await systemPrisma.agent_definitions.findMany({
    orderBy: [
      { category: 'asc' },
      { displayName: 'asc' },
    ],
  });

  const agentIds = rows.map((row) => row.id);
  const activePrompts = await systemPrisma.agent_prompts.findMany({
    where: {
      agentId: { in: agentIds },
      status: 'ACTIVE',
    },
    select: {
      agentId: true,
      id: true,
      version: true,
      name: true,
      updatedAt: true,
      publishedAt: true,
      temperature: true,
      maxTokens: true,
      model: true,
    },
  });

  const promptMap = new Map(activePrompts.map((item) => [item.agentId, item]));

  res.json({
    success: true,
    data: rows.map((row) => ({
      activePrompt: promptMap.get(row.id) || null,
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      category: row.category,
      inputSchema: parseJson(row.inputSchema),
      outputSchema: parseJson(row.outputSchema),
      variableBindings: parseJson(row.variableBindings),
      capabilities: parseJson(row.capabilities) || [],
      defaultMaxTokens: row.defaultMaxTokens,
      defaultTemperature: row.defaultTemperature,
      schemaVersion: row.schemaVersion,
      source: row.source,
      managedByCode: row.managedByCode,
      updatedAt: row.updatedAt,
    })),
  });
});

router.get('/agents/:id', async (req: Request, res: Response) => {
  const row = await systemPrisma.agent_definitions.findUnique({
    where: { id: req.params.id },
  });

  if (!row) {
    return res.status(404).json({ success: false, error: { message: 'Definition 不存在' } });
  }

  const activePrompt = await systemPrisma.agent_prompts.findFirst({
    where: {
      agentId: row.id,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      version: true,
      name: true,
      description: true,
      systemPrompt: true,
      temperature: true,
      maxTokens: true,
      model: true,
      updatedAt: true,
      publishedAt: true,
    },
  });

  const recentPromptCalls = await prisma.prompt_call_logs.findMany({
    where: { agentId: row.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return res.json({
    success: true,
    data: {
      activePrompt,
      recentPromptCalls: recentPromptCalls.map((item) => ({
        id: item.id,
        success: item.success,
        durationMs: item.durationMs,
        promptDrift: item.promptDrift,
        pathId: item.pathId,
        pipelineRunId: item.pipelineRunId,
        pipelineStepIndex: item.pipelineStepIndex,
        createdAt: item.createdAt,
        userPayload: item.userPayload,
        extractedJson: item.extractedJson,
        normalizedOutput: parseJson(item.normalizedOutput),
      })),
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      category: row.category,
      inputSchema: parseJson(row.inputSchema),
      outputSchema: parseJson(row.outputSchema),
      variableBindings: parseJson(row.variableBindings),
      capabilities: parseJson(row.capabilities) || [],
      defaultMaxTokens: row.defaultMaxTokens,
      defaultTemperature: row.defaultTemperature,
      schemaVersion: row.schemaVersion,
      source: row.source,
      managedByCode: row.managedByCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });
});

router.get('/orchestrators', async (_req: Request, res: Response) => {
  const rows = await systemPrisma.orchestrator_definitions.findMany({
    orderBy: { displayName: 'asc' },
  });

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      category: row.category,
      steps: parseJson(row.steps) || [],
      variableGraph: parseJson(row.variableGraph),
      source: row.source,
      managedByCode: row.managedByCode,
      updatedAt: row.updatedAt,
    })),
  });
});

router.get('/orchestrators/:id', async (req: Request, res: Response) => {
  const row = await systemPrisma.orchestrator_definitions.findUnique({
    where: { id: req.params.id },
  });

  if (!row) {
    return res.status(404).json({ success: false, error: { message: 'Orchestrator definition 不存在' } });
  }

  return res.json({
    success: true,
    data: {
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      category: row.category,
      steps: parseJson(row.steps) || [],
      variableGraph: parseJson(row.variableGraph),
      source: row.source,
      managedByCode: row.managedByCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });
});

router.get('/prompt-call-logs', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
  const agentId = typeof req.query.agentId === 'string' && req.query.agentId.trim() ? req.query.agentId.trim() : null;
  const pathId = typeof req.query.pathId === 'string' && req.query.pathId.trim() ? req.query.pathId.trim() : null;
  const pipelineRunId = typeof req.query.pipelineRunId === 'string' && req.query.pipelineRunId.trim() ? req.query.pipelineRunId.trim() : null;
  const traceId = typeof req.query.traceId === 'string' && req.query.traceId.trim() ? req.query.traceId.trim() : null;
  const parentExecutionId = typeof req.query.parentExecutionId === 'string' && req.query.parentExecutionId.trim()
    ? req.query.parentExecutionId.trim()
    : null;
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

  const rows = await prisma.prompt_call_logs.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      ...(pathId ? { pathId } : {}),
      ...(pipelineRunId ? { pipelineRunId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(parentExecutionId ? { parentExecutionId } : {}),
      ...(status === 'success' ? { success: true } : {}),
      ...(status === 'error' ? { success: false } : {}),
      ...(status === 'drift' ? { promptDrift: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      systemPromptVersion: row.systemPromptVersion,
      systemPromptHash: row.systemPromptHash,
      userPayload: row.userPayload,
      rawModelOutput: row.rawModelOutput,
      extractedJson: row.extractedJson,
      normalizedOutput: parseJson(row.normalizedOutput),
      success: row.success,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      promptDrift: row.promptDrift,
      durationMs: row.durationMs,
      tokenUsage: parseJson(row.tokenUsage),
      pathId: row.pathId,
      userId: row.userId,
      conversationId: row.conversationId,
      pipelineRunId: row.pipelineRunId,
      pipelineStepIndex: row.pipelineStepIndex,
      traceId: (row as any).traceId,
      parentExecutionId: (row as any).parentExecutionId,
      promptAttemptCount: row.promptAttemptCount,
      llmRequestCount: row.llmRequestCount,
      finalLlmRequestId: row.finalLlmRequestId,
      failureStage: row.failureStage,
      attempts: parseJson(row.attemptTrace) || [],
      providerId: row.providerId,
      model: row.model,
      createdAt: row.createdAt,
    })),
  });
});

export default router;
