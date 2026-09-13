-- 漂移对账迁移（reconcile main drift，2026-09-13）
-- 修正三处「schema 已变、迁移缺失」的历史漂移（由 prisma migrate diff 生成后落盘）：
--   1) virtual_batch_jobs：模型已进 schema，但没有建表迁移
--   2) memory_traces：schema 已移除无人引用的 lastRetention（f791133），补重建
--   3) misconception_ledger：confidence 默认值变更未落迁移，补重建
-- 重建均用 INSERT..SELECT 保留数据；lastRetention 为死列，其历史值有意丢弃。

-- CreateTable
CREATE TABLE "virtual_batch_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'create-learners',
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "totalStories" INTEGER NOT NULL DEFAULT 0,
    "storiesDone" INTEGER NOT NULL DEFAULT 0,
    "personaLeft" INTEGER NOT NULL DEFAULT 0,
    "queue" TEXT,
    "failed" TEXT,
    "error" TEXT,
    "cohort" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_memory_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "label" TEXT,
    "masteryScore" REAL NOT NULL DEFAULT 0.5,
    "stability" TEXT NOT NULL DEFAULT 'developing',
    "lastSeenAt" DATETIME,
    "extractionCount" INTEGER NOT NULL DEFAULT 0,
    "decayFactor" REAL NOT NULL DEFAULT 0.5,
    "intervalFactor" REAL NOT NULL DEFAULT 1,
    "source" TEXT,
    "dueAt" DATETIME,
    "fsrsStability" REAL,
    "fsrsDifficulty" REAL,
    "ktMasteryEma" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_memory_traces" ("conceptKey", "createdAt", "decayFactor", "dueAt", "extractionCount", "fsrsDifficulty", "fsrsStability", "id", "intervalFactor", "ktMasteryEma", "label", "lastSeenAt", "masteryScore", "source", "stability", "updatedAt", "userId") SELECT "conceptKey", "createdAt", "decayFactor", "dueAt", "extractionCount", "fsrsDifficulty", "fsrsStability", "id", "intervalFactor", "ktMasteryEma", "label", "lastSeenAt", "masteryScore", "source", "stability", "updatedAt", "userId" FROM "memory_traces";
DROP TABLE "memory_traces";
ALTER TABLE "new_memory_traces" RENAME TO "memory_traces";
CREATE INDEX "memory_traces_userId_lastSeenAt_idx" ON "memory_traces"("userId", "lastSeenAt");
CREATE INDEX "memory_traces_userId_stability_idx" ON "memory_traces"("userId", "stability");
CREATE INDEX "memory_traces_userId_dueAt_idx" ON "memory_traces"("userId", "dueAt");
CREATE UNIQUE INDEX "memory_traces_userId_conceptKey_key" ON "memory_traces"("userId", "conceptKey");
CREATE TABLE "new_misconception_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "hypothesisHash" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "canonicalLabel" TEXT,
    "confidence" INTEGER NOT NULL,
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
INSERT INTO "new_misconception_ledger" ("canonicalLabel", "conceptKey", "confidence", "createdAt", "evidence", "firstSeenAt", "hypothesis", "hypothesisHash", "id", "lastSeenAt", "lastSessionId", "occurrenceCount", "resolvedAt", "status", "updatedAt", "userId") SELECT "canonicalLabel", "conceptKey", "confidence", "createdAt", "evidence", "firstSeenAt", "hypothesis", "hypothesisHash", "id", "lastSeenAt", "lastSessionId", "occurrenceCount", "resolvedAt", "status", "updatedAt", "userId" FROM "misconception_ledger";
DROP TABLE "misconception_ledger";
ALTER TABLE "new_misconception_ledger" RENAME TO "misconception_ledger";
CREATE INDEX "misconception_ledger_userId_status_idx" ON "misconception_ledger"("userId", "status");
CREATE INDEX "misconception_ledger_userId_lastSeenAt_idx" ON "misconception_ledger"("userId", "lastSeenAt");
CREATE UNIQUE INDEX "misconception_ledger_userId_conceptKey_hypothesisHash_key" ON "misconception_ledger"("userId", "conceptKey", "hypothesisHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "virtual_batch_jobs_status_idx" ON "virtual_batch_jobs"("status");

-- CreateIndex
CREATE INDEX "virtual_batch_jobs_createdAt_idx" ON "virtual_batch_jobs"("createdAt");

