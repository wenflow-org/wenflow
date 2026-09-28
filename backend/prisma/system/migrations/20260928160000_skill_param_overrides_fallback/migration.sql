-- skill 级参数覆盖与兜底链（2026-09-28 配置体系优化）
-- paramOverrides: JSON {"temperature":0.6,"topP":0.9,"maxTokens":32000}，null=继承 ACTIVE prompt
-- fallbackChain:  JSON string[] 最多 2 跳，null=registry 默认链，[]=显式无链
ALTER TABLE "skill_model_configs" ADD COLUMN "paramOverrides" TEXT;
ALTER TABLE "skill_model_configs" ADD COLUMN "fallbackChain" TEXT;
