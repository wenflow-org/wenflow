-- 二级编译退役的收尾（2026-09-26 16c3cabd 摘代码，本迁移摘列）：6 列历史编译产物
-- 零读写方（读侧 getActivePrompt 只读 systemPrompt，见 agentConfig.service.ts），SQLite
-- DROP COLUMN 直接可执行（列无索引/无约束约束引用）。历史数据随列删除——此前「列保留
-- 防丢失」的过渡拍板由本批收束，归档依赖 git 历史与 16c3cabd 前的备份。
ALTER TABLE "agent_prompts" DROP COLUMN "compiledSystemPrompt";
ALTER TABLE "agent_prompts" DROP COLUMN "compileStatus";
ALTER TABLE "agent_prompts" DROP COLUMN "compileError";
ALTER TABLE "agent_prompts" DROP COLUMN "sourceHash";
ALTER TABLE "agent_prompts" DROP COLUMN "compileContextHash";
ALTER TABLE "agent_prompts" DROP COLUMN "compiledAt";
