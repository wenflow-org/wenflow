-- CreateTable
CREATE TABLE "virtual_quick_learn_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fixtureOfPathId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'fast_forward',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "maxTurns" INTEGER NOT NULL DEFAULT 25,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "teachingSessionId" TEXT,
    "progress" TEXT,
    "transcript" TEXT,
    "report" TEXT,
    "error" TEXT,
    "abortRequestedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_profileId_createdAt_idx" ON "virtual_quick_learn_runs"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_status_idx" ON "virtual_quick_learn_runs"("status");

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_userId_idx" ON "virtual_quick_learn_runs"("userId");
