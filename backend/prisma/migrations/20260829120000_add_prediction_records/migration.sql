-- 学习表现预测校准记录（learning-predictor 校准闭环）：
-- 每次任务前预测一行，任务完成后回写实际结果，据此统计「实证命中率」替代 LLM 自报置信度。
CREATE TABLE "prediction_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pathId" TEXT,
    "taskId" TEXT,
    "milestoneId" TEXT,
    "sessionId" TEXT,
    "stallRisk" REAL NOT NULL,
    "predictedTone" TEXT NOT NULL,
    "suggestedDepth" TEXT NOT NULL,
    "focusConcepts" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "outcome" TEXT,
    "outcomeAt" DATETIME,
    "summaryEcho" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "prediction_records_userId_taskId_idx" ON "prediction_records"("userId", "taskId");
CREATE INDEX "prediction_records_userId_createdAt_idx" ON "prediction_records"("userId", "createdAt");
CREATE INDEX "prediction_records_outcome_idx" ON "prediction_records"("outcome");
