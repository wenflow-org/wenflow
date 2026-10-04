-- 覆盖索引（2026-10-04 页面加载性能批）：总览「全量累计调用」真实用户口径
-- （WHERE userId IN (...) 且 executionLayer 非 api-gateway，GROUP BY success）
-- 原谓词 (executionLayer IS NULL OR executionLayer != 'api-gateway') 让计划走 success 索引
-- 后对每行回表取 executionLayer，8.5GB 表 24 万次随机读实测 23.7s；
-- 本索引（userId 等值 + success + executionLayer 全在索引内）使该查询索引即覆盖。
-- CreateIndex
CREATE INDEX "agent_call_logs_userId_success_executionLayer_idx" ON "agent_call_logs"("userId", "success", "executionLayer");
