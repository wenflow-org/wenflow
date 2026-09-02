-- 误解台账（G-R-R Phase 2）：跨会话追踪结构化误解的生命周期
-- suspected → confirmed → addressed；hypothesisHash 作为跨会话 upsert 锚点
CREATE TABLE "misconception_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "hypothesisHash" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "canonicalLabel" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suspected',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSessionId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "misconception_ledger_userId_conceptKey_hypothesisHash_key" ON "misconception_ledger"("userId", "conceptKey", "hypothesisHash");
CREATE INDEX "misconception_ledger_userId_status_idx" ON "misconception_ledger"("userId", "status");
CREATE INDEX "misconception_ledger_userId_lastSeenAt_idx" ON "misconception_ledger"("userId", "lastSeenAt");