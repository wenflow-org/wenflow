-- CreateTable
CREATE TABLE "batch_experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdBy" TEXT NOT NULL,
    "learnersConfig" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "batch_experiment_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "profileId" TEXT,
    "sessionId" TEXT,
    "learnerName" TEXT NOT NULL,
    "frictionBudget" TEXT NOT NULL DEFAULT 'normal',
    "phase" TEXT NOT NULL DEFAULT 'setup',
    "status" TEXT NOT NULL DEFAULT 'active',
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER,
    "currentTask" TEXT,
    "stallCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "advanceCalled" BOOLEAN NOT NULL DEFAULT false,
    "learningStarted" BOOLEAN NOT NULL DEFAULT false,
    "checkpoints" TEXT,
    "decaySims" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "batch_experiment_runs_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "batch_experiments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "batch_experiments_status_createdAt_idx" ON "batch_experiments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "batch_experiment_runs_experimentId_idx" ON "batch_experiment_runs"("experimentId");

-- CreateIndex
CREATE INDEX "batch_experiment_runs_status_idx" ON "batch_experiment_runs"("status");

