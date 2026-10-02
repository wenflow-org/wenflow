-- A/B 实验归因：prompt_call_logs 增加命中的变体标签列
ALTER TABLE "prompt_call_logs" ADD COLUMN "systemPromptVariant" TEXT;
