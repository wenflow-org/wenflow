CREATE TABLE "session_finalization_operations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "retryable" BOOLEAN,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "session_finalization_operations_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "session_finalization_operations_sessionId_idempotencyKey_key"
ON "session_finalization_operations"("sessionId", "idempotencyKey");

CREATE INDEX "session_finalization_operations_status_leaseExpiresAt_idx"
ON "session_finalization_operations"("status", "leaseExpiresAt");

CREATE INDEX "session_finalization_operations_sessionId_action_createdAt_idx"
ON "session_finalization_operations"("sessionId", "action", "createdAt");
