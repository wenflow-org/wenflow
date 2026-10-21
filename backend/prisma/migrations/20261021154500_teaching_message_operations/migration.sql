-- 2026-10-21 补齐：20261021120000_observability_session_scope 漏建幂等账本表。
-- schema.prisma 已声明 teaching_message_operations，但原迁移只建了 session_events；
-- 真实 HTTP 首条教学消息在占位时因此 500（no such table）。
CREATE TABLE "teaching_message_operations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "resultJson" TEXT,
    "revision" INTEGER,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_message_operations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "teaching_message_operations_status_updatedAt_idx" ON "teaching_message_operations"("status", "updatedAt");

CREATE UNIQUE INDEX "teaching_message_operations_sessionId_idempotencyKey_key" ON "teaching_message_operations"("sessionId", "idempotencyKey");
