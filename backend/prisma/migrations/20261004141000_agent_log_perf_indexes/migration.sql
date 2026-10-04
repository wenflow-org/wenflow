-- 覆盖索引（2026-10-04 页面加载性能批，8.5GB 表随机 IO 治理）：
-- 1) 执行日志窗口聚合（groupBy(sourceEntry, success) + 失败行小拉取 + 金丝雀计数）
--    按 calledAt 范围过滤后只取 agentId/sourceEntry/success —— 索引即覆盖，免回表
-- 2) Token 成本窗口聚合（aggregateWindow：COUNT/失败/token 三合一扫描）
--    按 calledAt 范围只取 executionLayer/tokensUsed/success —— 同上
-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_agentId_sourceEntry_success_idx" ON "agent_call_logs"("calledAt", "agentId", "sourceEntry", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_executionLayer_tokensUsed_success_idx" ON "agent_call_logs"("calledAt", "executionLayer", "tokensUsed", "success");
