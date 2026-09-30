-- 覆盖索引（2026-09-30 性能批）：
-- 1) 总览 7d 趋势/失败归因/24h 脉搏按 calledAt 范围只取 success —— 索引即覆盖，免去 9 万行宽行回表
-- 2) 全量调用计数（agentStats）按 executionLayer 过滤分组只取 success —— 同理覆盖
-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_success_idx" ON "agent_call_logs"("calledAt", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_executionLayer_success_idx" ON "agent_call_logs"("executionLayer", "success");
