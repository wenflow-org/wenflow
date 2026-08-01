-- AlterTable: 标记虚拟学习者账号，用于统计隔离
ALTER TABLE "users" ADD COLUMN "isVirtualLearner" BOOLEAN NOT NULL DEFAULT false;

-- 回填存量虚拟账号
UPDATE "users"
SET "isVirtualLearner" = true
WHERE "id" IN (SELECT "userId" FROM "virtual_learner_profiles");

-- CreateTable: 实验矩阵批量运行记录
CREATE TABLE "virtual_experiment_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'blackbox-api',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "entriesJson" TEXT NOT NULL,
    "resultsJson" TEXT NOT NULL DEFAULT '[]',
    "progressJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "abortRequestedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "virtual_experiment_runs_status_idx" ON "virtual_experiment_runs"("status");

-- CreateIndex
CREATE INDEX "virtual_experiment_runs_createdAt_idx" ON "virtual_experiment_runs"("createdAt");
