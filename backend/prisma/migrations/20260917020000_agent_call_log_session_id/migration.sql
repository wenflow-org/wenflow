-- AddColumn: agent_call_logs.sessionId（按会话核算 token/成本）
-- 目的（审计 §5.2 P2）：此前 `sessionId` 只存在于 `metadata` JSON 里（`executor.ts` 的日志负载），
-- 既不能索引也不能聚合 ⇒ "这节课花了多少 token / 哪个 skill 最贵"无法回答。
--
-- 本次：① 升为真列 + `(sessionId, calledAt)` 索引；② 写入侧补列；③ 历史行**尽力回填**（从 metadata JSON 取）。
-- 回填是 best-effort：metadata 缺失/非法 JSON 的行保持 NULL（不影响新数据）。
ALTER TABLE "agent_call_logs" ADD COLUMN "sessionId" TEXT;

CREATE INDEX "agent_call_logs_sessionId_calledAt_idx" ON "agent_call_logs"("sessionId", "calledAt");

UPDATE "agent_call_logs"
SET "sessionId" = json_extract("metadata", '$.sessionId')
WHERE "sessionId" IS NULL
  AND "metadata" IS NOT NULL
  AND json_valid("metadata")
  AND json_extract("metadata", '$.sessionId') IS NOT NULL;