-- 断链修复 P0-6：memory_traces 增加 dueAt 物化列 + 索引
-- 目的：复习调度（FSRS 化）按到期时间 SQL 直查，消灭「全表扫 + 内存计算到期」；
--       dueAt 为 null 的行走旧惰性 isReviewDue 兜底（老数据兼容）。
ALTER TABLE "memory_traces" ADD COLUMN "dueAt" DATETIME;
CREATE INDEX "memory_traces_userId_dueAt_idx" ON "memory_traces"("userId", "dueAt");
