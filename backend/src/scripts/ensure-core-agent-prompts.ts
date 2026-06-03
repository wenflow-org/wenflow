import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  CORE_AGENT_PROMPT_SEEDS,
  ensureCoreAgentPrompts,
  findMissingCorePromptSeeds,
  type CoreAgentPromptEnsureMode,
} from './seed-core-agent-prompts';

dotenv.config();

function parseMode(argv: string[]): CoreAgentPromptEnsureMode {
  const normalizedArgs = argv.map((item) => item.trim().toLowerCase());
  if (normalizedArgs.includes('--sync') || normalizedArgs.includes('sync')) {
    return 'sync';
  }
  if (normalizedArgs.includes('--backfill') || normalizedArgs.includes('backfill')) {
    return 'backfill';
  }
  return 'bootstrap';
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const missingBefore = await findMissingCorePromptSeeds(prisma);
  const result = await ensureCoreAgentPrompts(prisma, mode);

  console.log(JSON.stringify({
    mode,
    totalSeeds: CORE_AGENT_PROMPT_SEEDS.length,
    missingBefore: missingBefore.map((seed) => seed.agentId),
    result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
