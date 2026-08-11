-- 数据层审计：补齐缺失索引（S3/M1/M2/M3/M4/M5 + S4 顺带）
-- 附：announcements 重建表以添加 status/severity CHECK 约束（S4；
--     SQLite 的 ALTER TABLE 不支持 ADD CONSTRAINT，故采用 RedefineTables 重建）
-- 注意：重建表会连带删除原表索引，故 announcements 的两个索引须在重建之后重新创建。

-- RedefineTables: announcements + CHECK(status/severity)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_announcements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info' CHECK ("severity" IN ('info','warning','critical')),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','published','archived')),
    "publishedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_announcements" ("body", "createdAt", "createdBy", "expiresAt", "id", "publishedAt", "severity", "status", "title", "updatedAt") SELECT "body", "createdAt", "createdBy", "expiresAt", "id", "publishedAt", "severity", "status", "title", "updatedAt" FROM "announcements";
DROP TABLE "announcements";
ALTER TABLE "new_announcements" RENAME TO "announcements";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "achievements_userId_idx" ON "achievements"("userId");

-- CreateIndex
CREATE INDEX "achievements_type_completed_idx" ON "achievements"("type", "completed");

-- CreateIndex
CREATE INDEX "goal_conversations_userId_status_idx" ON "goal_conversations"("userId", "status");

-- CreateIndex
CREATE INDEX "goal_conversations_status_updatedAt_idx" ON "goal_conversations"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "goal_conversations_learningPathId_idx" ON "goal_conversations"("learningPathId");

-- CreateIndex
CREATE INDEX "learning_metrics_userId_calculatedAt_idx" ON "learning_metrics"("userId", "calculatedAt");

-- CreateIndex
CREATE INDEX "learning_paths_userId_status_idx" ON "learning_paths"("userId", "status");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_success_errorCategory_startedAt_idx" ON "llm_execution_attempts"("success", "errorCategory", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_userId_startedAt_success_idx" ON "llm_execution_attempts"("userId", "startedAt", "success");

-- CreateIndex
CREATE INDEX "subtasks_status_completedAt_idx" ON "subtasks"("status", "completedAt");

-- CreateIndex
CREATE INDEX "teaching_sessions_userId_createdAt_idx" ON "teaching_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "teaching_sessions_startTime_idx" ON "teaching_sessions"("startTime");

-- CreateIndex (announcements 重建后重新创建：原 status_publishedAt + 新 status_expiresAt)
CREATE INDEX "announcements_status_publishedAt_idx" ON "announcements"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "announcements_status_expiresAt_idx" ON "announcements"("status", "expiresAt");
