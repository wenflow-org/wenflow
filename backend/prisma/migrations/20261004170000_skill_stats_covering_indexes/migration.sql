-- 页面加载性能批（2026-10-04）：Skill 统计两处聚合的覆盖索引。
-- 实测：skills 接口 range=all 冷 71.8s —— 拆解后真正的大头是
--   prompt_call_logs `AVG(durationMs) GROUP BY agentId`（单独 35-38s：宽行表 durationMs
--   不在任何索引内，112k 次散落根页随机读），agent_call_logs 侧聚合 (agentId IN 40 个
--   skill) 也要按 agentId 回表取 durationMs/calledAt（~1.4s 冷）。
-- 两索引使各自聚合索引即覆盖（分组/AVG/MAX/COUNT 全在索引内），并兼容窗口过滤（createdAt/calledAt 尾列）。
-- 注意：agent_call_logs 已有 (agentId, calledAt)（wrapup 抽样按 calledAt 排序用），保留不替换。
-- CreateIndex
CREATE INDEX "prompt_call_logs_agentId_success_durationMs_createdAt_idx" ON "prompt_call_logs"("agentId", "success", "durationMs", "createdAt");
-- CreateIndex
CREATE INDEX "agent_call_logs_agentId_success_durationMs_calledAt_idx" ON "agent_call_logs"("agentId", "success", "durationMs", "calledAt");
