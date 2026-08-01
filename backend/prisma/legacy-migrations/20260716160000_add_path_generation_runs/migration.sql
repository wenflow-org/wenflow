PRAGMA foreign_keys=OFF;

CREATE TABLE "path_generation_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningPathId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "retryType" TEXT,
    "retryAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "inputSnapshot" TEXT,
    "heartbeatAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "leaseOwner" TEXT,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "path_generation_runs_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "learning_paths" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "learning_paths" ADD COLUMN "activeGenerationRunId" TEXT REFERENCES "path_generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "path_generation_stage_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "stageNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "path_generation_stage_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "path_generation_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "learning_paths_activeGenerationRunId_key" ON "learning_paths"("activeGenerationRunId");
CREATE INDEX "path_generation_runs_learningPathId_createdAt_idx" ON "path_generation_runs"("learningPathId", "createdAt");
CREATE INDEX "path_generation_runs_status_leaseExpiresAt_idx" ON "path_generation_runs"("status", "leaseExpiresAt");
CREATE INDEX "path_generation_runs_phase_status_idx" ON "path_generation_runs"("phase", "status");
CREATE UNIQUE INDEX "path_generation_stage_items_runId_stageNumber_key" ON "path_generation_stage_items"("runId", "stageNumber");
CREATE INDEX "path_generation_stage_items_runId_status_idx" ON "path_generation_stage_items"("runId", "status");

PRAGMA foreign_keys=ON;
