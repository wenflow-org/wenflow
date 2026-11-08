-- #251①：删除 prompt_call_logs 的「管道」维度（pipelineRunId / pipelineStepIndex）。
--
-- 这两列自建表（20260717000000_main_baseline）起就没有任何写入方：
--   - RequestContext（gateway/api-gateway/context.ts）没有 pipelineRunId 字段；
--   - PromptCallContext（composers/types.ts）虽声明了它，但全仓没有调用方传值，
--     composer 因此恒写 null（composer 五处 `context.pipelineRunId || null`）；
--   - 运行时也没有「管道 run」实体与 agent_call_logs/prompt_call_logs 的关联表。
-- 结果：管理台 /admin/runtime-definitions/prompt-call-logs 暴露了一个永远匹配不到行的
-- 筛选维度，响应体里也永远回 null。属于「暴露了不存在的契约」，故连同索引一起删除。
--
-- SQLite：DROP COLUMN 要求没有索引/约束依赖该列，先删索引再删列（SQLite 3.35+）。
DROP INDEX IF EXISTS "prompt_call_logs_pipelineRunId_idx";
ALTER TABLE "prompt_call_logs" DROP COLUMN "pipelineRunId";
ALTER TABLE "prompt_call_logs" DROP COLUMN "pipelineStepIndex";
