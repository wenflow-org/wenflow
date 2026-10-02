-- A/B 实验变体：agent_prompts 增加变体标签与流量权重
-- 不变量更新：「唯一 ACTIVE」细化为「唯一基线（variant IS NULL）+ 若干 ACTIVE 变体行」
ALTER TABLE "agent_prompts" ADD COLUMN "variant" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "trafficWeight" INTEGER;
