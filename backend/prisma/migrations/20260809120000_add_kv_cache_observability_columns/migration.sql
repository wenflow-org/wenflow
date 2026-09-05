-- AlterTable: llm_execution_attempts 增加 KV 前缀缓存可观测列（TTFT + DeepSeek cache tokens）
ALTER TABLE "llm_execution_attempts" ADD COLUMN "ttftMs" INTEGER;
ALTER TABLE "llm_execution_attempts" ADD COLUMN "promptCacheHitTokens" INTEGER;
ALTER TABLE "llm_execution_attempts" ADD COLUMN "promptCacheMissTokens" INTEGER;
