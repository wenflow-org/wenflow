-- 2026-10-21 可观测性：日志补会话归因 + 会话统一事件时间线
-- 1) prompt_call_logs / llm_execution_attempts 补 sessionId 真列（此前只能经
--    conversationId / metadata.cacheAffinityKey 间接反推）
-- 2) 新增 session_events：开课/回合/暂停/完成/检查点/工具/错误 的可查询时间线

ALTER TABLE "prompt_call_logs" ADD COLUMN "sessionId" TEXT;
CREATE INDEX "prompt_call_logs_sessionId_createdAt_idx" ON "prompt_call_logs"("sessionId", "createdAt");

ALTER TABLE "llm_execution_attempts" ADD COLUMN "sessionId" TEXT;
CREATE INDEX "llm_execution_attempts_sessionId_startedAt_idx" ON "llm_execution_attempts"("sessionId", "startedAt");

CREATE TABLE "session_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT,
    "status" TEXT,
    "revision" INTEGER,
    "payload" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "session_events_eventId_key" ON "session_events"("eventId");
CREATE INDEX "session_events_sessionId_id_idx" ON "session_events"("sessionId", "id");
CREATE INDEX "session_events_kind_occurredAt_idx" ON "session_events"("kind", "occurredAt");
