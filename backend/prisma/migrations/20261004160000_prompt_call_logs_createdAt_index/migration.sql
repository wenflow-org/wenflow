-- 页面加载性能批（2026-10-04）：日志保留清理按 createdAt 范围取批
-- （WHERE createdAt < ? ORDER BY createdAt ASC LIMIT ? OFFSET ?），原表仅有 (agentId, createdAt)
-- 复合索引、无纯 createdAt 索引 → 112k 宽行（userPayload/rawModelOutput）全表扫描+排序实测 47.8s，
-- 清理期间与用户请求争 IO，打慢所有管理端页面。本索引使该查询退化为索引范围探测。
-- CreateIndex
CREATE INDEX "prompt_call_logs_createdAt_idx" ON "prompt_call_logs"("createdAt");
