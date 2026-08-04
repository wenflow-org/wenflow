ALTER TABLE "agent_prompts" ADD COLUMN "compiledSystemPrompt" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "compileStatus" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "compileError" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "sourceHash" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "compileContextHash" TEXT;
ALTER TABLE "agent_prompts" ADD COLUMN "compiledAt" DATETIME;
