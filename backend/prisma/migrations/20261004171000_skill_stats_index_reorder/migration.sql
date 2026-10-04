-- 页面加载性能批（2026-10-04）修正：上一迁移的 prompt_call_logs 覆盖索引列序（agentId, success, durationMs, createdAt）
-- 无法承载窗口查询——`agentId IN (…) AND createdAt >= ?` 的计划仍选旧 (agentId, createdAt) 索引走范围，
-- 再回表取 durationMs（宽行散落根页随机读，7d 窗口实测 25-27s）。改序为 (agentId, createdAt, success, durationMs)：
-- 范围前缀 = agentId+createdAt（窗口过滤索引内完成），success/durationMs 尾列覆盖 AVG/COUNT——
-- 全窗与窗口两种形态均为索引即覆盖（全窗形态分组多一次索引内 b-tree，实测毫秒级）。
-- DropIndex
DROP INDEX IF EXISTS "prompt_call_logs_agentId_success_durationMs_createdAt_idx";
-- CreateIndex
CREATE INDEX "prompt_call_logs_agentId_createdAt_success_durationMs_idx" ON "prompt_call_logs"("agentId", "createdAt", "success", "durationMs");
