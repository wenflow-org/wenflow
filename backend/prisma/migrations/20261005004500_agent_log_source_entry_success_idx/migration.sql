-- 覆盖索引（2026-10-05 执行日志 stats 冷缓存首击治理）：
-- groupBy(sourceEntry, success) 在「全部」窗口（无 calledAt 条件）用不上既有 calledAt
-- 前导覆盖索引，回落全表 SCAN + TEMP B-TREE（本地实测 2.6s，跑批冲刷页缓存后更长）。
-- (sourceEntry, success) 索引序与分组键一致：索引扫描免回表、免 TEMP B-TREE。
-- CreateIndex
CREATE INDEX "agent_call_logs_sourceEntry_success_idx" ON "agent_call_logs"("sourceEntry", "success");
