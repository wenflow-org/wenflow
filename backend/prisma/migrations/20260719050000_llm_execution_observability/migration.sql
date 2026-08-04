ALTER TABLE "agent_call_logs" ADD COLUMN "executionLayer" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "actorType" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "actorId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "parentExecutionId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "rootExecutionId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "promptCallId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "providerId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "providerType" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "routeSource" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "model" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "statusCode" INTEGER;
ALTER TABLE "agent_call_logs" ADD COLUMN "attemptCount" INTEGER;
ALTER TABLE "agent_call_logs" ADD COLUMN "maxAttempts" INTEGER;
ALTER TABLE "agent_call_logs" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "agent_call_logs" ADD COLUMN "completionTokens" INTEGER;
ALTER TABLE "agent_call_logs" ADD COLUMN "finishReason" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "completionId" TEXT;
ALTER TABLE "agent_call_logs" ADD COLUMN "errorCategory" TEXT;

CREATE INDEX "agent_call_logs_parentExecutionId_calledAt_idx"
ON "agent_call_logs"("parentExecutionId", "calledAt");
CREATE INDEX "agent_call_logs_promptCallId_calledAt_idx"
ON "agent_call_logs"("promptCallId", "calledAt");
CREATE INDEX "agent_call_logs_executionLayer_calledAt_idx"
ON "agent_call_logs"("executionLayer", "calledAt");
CREATE INDEX "agent_call_logs_providerId_calledAt_idx"
ON "agent_call_logs"("providerId", "calledAt");

ALTER TABLE "prompt_call_logs" ADD COLUMN "promptAttemptCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "prompt_call_logs" ADD COLUMN "llmRequestCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prompt_call_logs" ADD COLUMN "finalLlmRequestId" TEXT;
ALTER TABLE "prompt_call_logs" ADD COLUMN "failureStage" TEXT;
ALTER TABLE "prompt_call_logs" ADD COLUMN "attemptTrace" TEXT;
ALTER TABLE "prompt_call_logs" ADD COLUMN "providerId" TEXT;
ALTER TABLE "prompt_call_logs" ADD COLUMN "model" TEXT;

CREATE INDEX "prompt_call_logs_finalLlmRequestId_idx"
ON "prompt_call_logs"("finalLlmRequestId");

CREATE TABLE "llm_execution_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "llmRequestId" TEXT NOT NULL,
    "parentExecutionId" TEXT,
    "promptCallId" TEXT,
    "rootExecutionId" TEXT,
    "traceId" TEXT,
    "userId" TEXT,
    "sourceEntry" TEXT NOT NULL DEFAULT 'platform',
    "promptAttemptNo" INTEGER NOT NULL DEFAULT 1,
    "transportAttemptNo" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "providerId" TEXT,
    "providerType" TEXT,
    "routeSource" TEXT,
    "requestedModel" TEXT,
    "resolvedModel" TEXT,
    "responseModel" TEXT,
    "endpointHost" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "retryable" BOOLEAN,
    "willRetry" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "errorCategory" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "backoffMs" INTEGER,
    "retryAfterMs" INTEGER,
    "configuredTimeoutMs" INTEGER,
    "effectiveTimeoutMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "finishReason" TEXT,
    "completionId" TEXT,
    "providerRequestId" TEXT,
    "messageCount" INTEGER,
    "requestBytes" INTEGER,
    "responseBytes" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "llm_execution_attempts_llmRequestId_transportAttemptNo_key"
ON "llm_execution_attempts"("llmRequestId", "transportAttemptNo");
CREATE INDEX "llm_execution_attempts_startedAt_id_idx"
ON "llm_execution_attempts"("startedAt", "id");
CREATE INDEX "llm_execution_attempts_traceId_startedAt_idx"
ON "llm_execution_attempts"("traceId", "startedAt");
CREATE INDEX "llm_execution_attempts_parentExecutionId_startedAt_idx"
ON "llm_execution_attempts"("parentExecutionId", "startedAt");
CREATE INDEX "llm_execution_attempts_promptCallId_promptAttemptNo_transportAttemptNo_idx"
ON "llm_execution_attempts"("promptCallId", "promptAttemptNo", "transportAttemptNo");
CREATE INDEX "llm_execution_attempts_providerId_resolvedModel_startedAt_idx"
ON "llm_execution_attempts"("providerId", "resolvedModel", "startedAt");
CREATE INDEX "llm_execution_attempts_rootExecutionId_startedAt_idx"
ON "llm_execution_attempts"("rootExecutionId", "startedAt");
CREATE INDEX "llm_execution_attempts_userId_startedAt_idx"
ON "llm_execution_attempts"("userId", "startedAt");
CREATE INDEX "llm_execution_attempts_errorCategory_startedAt_idx"
ON "llm_execution_attempts"("errorCategory", "startedAt");
