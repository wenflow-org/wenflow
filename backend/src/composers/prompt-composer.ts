import prisma from '../config/database';
import { getAPIGateway } from '../gateway/api-gateway';
import { agentConfigService } from '../services/agentConfig.service';
import { detectPromptDrift } from './drift-detector';
import { extractJsonObject } from './json-extractor';
import {
  PromptCallContext,
  PromptCallResult,
  PromptCallSpec,
  PromptAttemptTrace,
} from './types';

function stringifyPayload(payload: string | object): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function normalizeTokenUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    prompt: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : undefined,
    completion: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : undefined,
    total: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : undefined,
  };
}

export async function callPrompt<TInput, TOutput>(
  spec: PromptCallSpec<TInput, TOutput>,
  input: TInput,
  context: PromptCallContext = {}
): Promise<PromptCallResult<TOutput>> {
  const promptConfig = await agentConfigService.getActivePrompt(spec.agentId);
  if (spec.requireActivePrompt && !promptConfig?.systemPrompt?.trim()) {
    return {
      success: false,
      error: {
        code: `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PROMPT_MISSING`,
        message: `Missing active prompt for ${spec.agentId}`,
      },
      debug: {
        agentId: spec.agentId,
        systemPrompt: '',
        systemPromptVersion: null,
        userPayload: stringifyPayload(spec.buildUserPayload(input)),
        rawModelOutput: '',
        extractedJson: null,
        normalizedOutput: null,
        promptDrift: null,
        attempts: [],
        durationMs: 0,
        tokenUsage: null,
      },
    };
  }
  const systemPrompt = promptConfig?.systemPrompt || spec.defaultSystemPrompt;
  const userPayload = stringifyPayload(spec.buildUserPayload(input));
  const promptDrift = detectPromptDrift(spec.defaultSystemPrompt, promptConfig?.systemPrompt || null);
  const attempts: PromptAttemptTrace[] = [];
  const gateway = getAPIGateway();
  const maxAttempts = Math.max(1, spec.retryStrategy?.maxAttempts || 1);
  const startTime = Date.now();

  let lastRaw = '';
  let lastExtractedJson: string | null = null;
  let lastFailureReason = 'Unknown failure';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const retryNotice = attempt > 1 && spec.retryStrategy?.onValidationFail
      ? spec.retryStrategy.onValidationFail({
          input,
          attempt,
          rawOutput: lastRaw,
          extractedJson: lastExtractedJson,
          failureReason: lastFailureReason,
        })
      : null;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: retryNotice ? `${userPayload}\n\n${retryNotice}` : userPayload },
    ];

    const response = await gateway.execute({
      messages,
      max_tokens: promptConfig?.maxTokens || spec.modelDefaults?.maxTokens,
      temperature: promptConfig?.temperature ?? spec.modelDefaults?.temperature,
    }, spec.caller, { userId: context.userId });

    const rawModelOutput = response.choices[0]?.message.content || '';
    const extracted = extractJsonObject(rawModelOutput);
    lastRaw = rawModelOutput;
    lastExtractedJson = extracted.extractedJson;

    if (!extracted.extractedJson || extracted.parsed === null) {
      lastFailureReason = 'response does not contain valid JSON object';
      attempts.push({ attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason });
      continue;
    }

    const validation = spec.validateParsedOutput
      ? spec.validateParsedOutput(extracted.parsed, input)
      : { valid: true as const };

    if (!validation.valid) {
      lastFailureReason = validation.failureReason || 'parsed output validation failed';
      attempts.push({ attempt, rawOutput: rawModelOutput, failureReason: lastFailureReason });
      continue;
    }

    const normalizedOutput = spec.normalizeOutput(extracted.parsed, input);
    const durationMs = Date.now() - startTime;
    const tokenUsage = normalizeTokenUsage(response.usage);

    await prisma.prompt_call_logs.create({
      data: {
        id: `pcl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        agentId: spec.agentId,
        systemPromptVersion: promptConfig?.version || null,
        systemPromptHash: promptDrift?.dbHash || promptDrift?.codeHash || '',
        userPayload,
        rawModelOutput,
        extractedJson: extracted.extractedJson,
        normalizedOutput: JSON.stringify(normalizedOutput),
        success: true,
        promptDrift: !!promptDrift?.driftDetected,
        durationMs,
        tokenUsage: JSON.stringify(tokenUsage),
        pathId: context.pathId || null,
        userId: context.userId || null,
        conversationId: context.conversationId || null,
        pipelineRunId: context.pipelineRunId || null,
        pipelineStepIndex: context.pipelineStepIndex ?? null,
      }
    });

    return {
      success: true,
      output: normalizedOutput,
      debug: {
        agentId: spec.agentId,
        systemPrompt,
        systemPromptVersion: promptConfig?.version || null,
        userPayload,
        rawModelOutput,
        extractedJson: extracted.extractedJson,
        normalizedOutput,
        promptDrift,
        attempts,
        durationMs,
        tokenUsage,
      },
    };
  }

  const durationMs = Date.now() - startTime;
  await prisma.prompt_call_logs.create({
    data: {
      id: `pcl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId: spec.agentId,
      systemPromptVersion: promptConfig?.version || null,
      systemPromptHash: promptDrift?.dbHash || promptDrift?.codeHash || '',
      userPayload,
      rawModelOutput: lastRaw || null,
      extractedJson: lastExtractedJson,
      normalizedOutput: null,
      success: false,
      errorCode: `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_FAILED`,
      errorMessage: lastFailureReason,
      promptDrift: !!promptDrift?.driftDetected,
      durationMs,
      pathId: context.pathId || null,
      userId: context.userId || null,
      conversationId: context.conversationId || null,
      pipelineRunId: context.pipelineRunId || null,
      pipelineStepIndex: context.pipelineStepIndex ?? null,
    }
  });

  return {
    success: false,
    error: {
      code: `${spec.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_FAILED`,
      message: lastFailureReason,
    },
    debug: {
      agentId: spec.agentId,
      systemPrompt,
      systemPromptVersion: promptConfig?.version || null,
      userPayload,
      rawModelOutput: lastRaw,
      extractedJson: lastExtractedJson,
      normalizedOutput: null,
      promptDrift,
      attempts,
      durationMs,
      tokenUsage: null,
    },
  };
}
