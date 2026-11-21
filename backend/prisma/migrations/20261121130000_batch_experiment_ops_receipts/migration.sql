-- 2026-11-21 批量实验运营面补齐（approved virtual plan §2 最后一条）：
-- 1) 批量实验 run 持久化实验声明（learningGoal / sampleType / expectedNoPath）与运营进度
--    （setupStage/setupAttempts/outcome/finalSnapshot/decayBaseline*）；
-- 2) 批量推进的跨进程 durable busy 锁；
-- 3) 批量推进 + assisted advance-day 的持久化请求回执（同 key 回放、不同请求 409、
--    stale processing 先按阶段产物对账）。与 virtual_experiment_commands 同语义，
--    但不复用黑盒表（黑盒列强绑 experiment/run/session 外键）。

ALTER TABLE "batch_experiment_runs" ADD COLUMN "learningGoal" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "sampleType" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "expectedNoPath" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "setupStage" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "setupAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "outcome" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "outcomeMatched" BOOLEAN;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "finalSnapshot" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "decayBaselineAt" DATETIME;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "decayBaseline" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "advanceLockOwner" TEXT;
ALTER TABLE "batch_experiment_runs" ADD COLUMN "advanceLockAt" DATETIME;

CREATE TABLE "virtual_operation_receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "resultJson" TEXT,
    "errorJson" TEXT,
    "contextJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

CREATE UNIQUE INDEX "virtual_operation_receipts_scope_scopeId_kind_requestKey_key"
ON "virtual_operation_receipts"("scope", "scopeId", "kind", "requestKey");

CREATE INDEX "virtual_operation_receipts_scope_scopeId_kind_status_idx"
ON "virtual_operation_receipts"("scope", "scopeId", "kind", "status");

CREATE INDEX "virtual_operation_receipts_status_updatedAt_idx"
ON "virtual_operation_receipts"("status", "updatedAt");
