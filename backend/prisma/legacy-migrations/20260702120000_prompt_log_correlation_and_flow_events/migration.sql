ALTER TABLE "prompt_call_logs" ADD COLUMN "traceId" TEXT;
ALTER TABLE "prompt_call_logs" ADD COLUMN "parentExecutionId" TEXT;

CREATE INDEX "prompt_call_logs_traceId_idx" ON "prompt_call_logs"("traceId");
CREATE INDEX "prompt_call_logs_parentExecutionId_idx" ON "prompt_call_logs"("parentExecutionId");
