import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';
import {
  loadCoreAgentPromptSeeds,
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
  const missingBefore = await findMissingCorePromptSeeds(systemPrisma);
  const result = await ensureCoreAgentPrompts(systemPrisma, mode);

  console.log(JSON.stringify({
    mode,
    totalSeeds: loadCoreAgentPromptSeeds().length,
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
    await systemPrisma.$disconnect();
  });
