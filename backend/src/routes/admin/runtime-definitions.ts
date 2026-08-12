import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import {
  listAgentManifest,
  getAgentManifest,
} from '../../services/agent-manifest.service';
import {
  SKILL_RUNTIME_DEFINITIONS,
  ORCHESTRATOR_RUNTIME_DEFINITIONS,
} from '../../coordinators/definitions-registry';

const router = Router();

/**
 * prompt-call-logs 大文本列裁剪上限（ADMIN_PERFORMANCE_AUDIT P7）：
 * userPayload/rawModelOutput/extractedJson/normalizedOutput 可能数 MB，
 * 200 行列表响应可达数 MB。前端展示侧本就按 6000 字符截断（live.ts capText），
 * 服务端先裁一次，响应体从数 MB 降到有界，展示语义不变。
 */
const PROMPT_CALL_LOG_TEXT_CAP = 6000;

function capPayloadText(value: string | null | undefined): string | null | undefined {
  if (value == null || value === '') return value;
  return value.length > PROMPT_CALL_LOG_TEXT_CAP ? value.slice(0, PROMPT_CALL_LOG_TEXT_CAP) : value;
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const skillDefMap = new Map(SKILL_RUNTIME_DEFINITIONS.map((def) => [def.id, def]));

/**
 * 实时编译：编排 steps 的 agentId → manifest 解析（displayName/kind）
 * 服务节点（kind: 'service'）不在 manifest，保留原 id 并标注 service
 */
function resolveStepAgent(agentId: string, step?: { kind?: string }) {
  const entry = getAgentManifest(agentId);
  if (entry) {
    return {
      agentId: entry.id,
      displayName: entry.name,
      kind: entry.kind,
      nodeKind: step?.kind || entry.kind,
    };
  }
  return {
    agentId,
    displayName: agentId,
    kind: step?.kind || 'unknown',
    nodeKind: step?.kind || 'unknown',
    unresolved: true,
  };
}

function compileOrchestrator(def: (typeof ORCHESTRATOR_RUNTIME_DEFINITIONS)[number]) {
  return {
    id: def.id,
    displayName: def.displayName,
    description: def.description,
    category: def.category,
    steps: (def.steps || []).map((step: any) => ({
      ...step,
      resolved: resolveStepAgent(step.agentId, step),
    })),
    variableGraph: def.variableGraph || null,
    source: def.source || 'code',
    managedByCode: def.managedByCode ?? true,
  };
}

router.get('/agents', async (_req: Request, res: Response) => {
  const manifest = listAgentManifest();
  const skillEntries = manifest.filter((entry) => entry.kind === 'skill');

  const agentIds = skillEntries.map((entry) => entry.id);
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
    data: skillEntries.map((entry) => {
      const def = skillDefMap.get(entry.id);
      return {
        activePrompt: promptMap.get(entry.id) || null,
        id: entry.id,
        displayName: def?.displayName || entry.name,
        description: def?.description || entry.description,
        category: entry.category,
        inputSchema: def?.inputSchema || null,
        outputSchema: def?.outputSchema || null,
        variableBindings: def?.variableBindings || null,
        capabilities: def?.capabilities || [],
        defaultMaxTokens: def?.defaultMaxTokens ?? entry.defaultModelConfig?.maxTokens ?? null,
        defaultTemperature: def?.defaultTemperature ?? entry.defaultModelConfig?.temperature ?? null,
        schemaVersion: (def as any)?.schemaVersion ?? 1,
        source: def?.source || 'code',
        managedByCode: def?.managedByCode ?? true,
        parentAgentId: entry.agentMembers ? undefined : undefined,
      };
    }),
  });
});

router.get('/orchestrators', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: ORCHESTRATOR_RUNTIME_DEFINITIONS.map(compileOrchestrator),
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
    data: rows.map((row) => {
      // 大文本列服务端截断（超长时仅返回前 N 字符；normalizedOutput 截断后
      // parseJson 失败 → 回退返回截断文本预览，保证可展示）
      const userPayload = capPayloadText(row.userPayload);
      const rawModelOutput = capPayloadText(row.rawModelOutput);
      const extractedJson = capPayloadText(row.extractedJson);
      const normalizedRaw = capPayloadText(row.normalizedOutput);
      return {
        id: row.id,
        agentId: row.agentId,
        systemPromptVersion: row.systemPromptVersion,
        systemPromptHash: row.systemPromptHash,
        userPayload,
        rawModelOutput,
        extractedJson,
        normalizedOutput: parseJson(normalizedRaw) ?? normalizedRaw,
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
      };
    }),
  });
});

export default router;
