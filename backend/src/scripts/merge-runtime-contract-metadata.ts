/**
 * 将 prompt-lab/manifests 中的 runtimeContract 合并进 ACTIVE agent_prompts.metadata
 *
 * 用法（backend 目录）:
 *   npx ts-node src/scripts/merge-runtime-contract-metadata.ts
 *   npx ts-node src/scripts/merge-runtime-contract-metadata.ts --dry-run
 */
import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';
import { resolveRuntimeContract } from '../services/prompt-lab/resolve-runtime-contract';

dotenv.config();

const CORE_AGENT_IDS = [
  'skill:goal-conversation',
  'skill:learning-turn',
  'skill:session-wrapup',
  'skill:peer-reinforcement',
  'skill:path-planning',
  'skill:path-scene-framing',
  'skill:stage-designer',
  'skill:virtual-learner-goal-dialogue-simulator',
  'skill:virtual-learner-learn-turn-simulator',
  'skill:virtual-learner-path-evaluator',
  'skill:virtual-learner-persona-designer',
  'skill:virtual-learner-scenario-designer',
  'skill:virtual-learner-actor-auditor',
  'skill:virtual-learner-referee',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results: Array<Record<string, unknown>> = [];

  for (const agentId of CORE_AGENT_IDS) {
    const resolved = await resolveRuntimeContract(agentId);
    const active = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });

    if (!active) {
      results.push({ agentId, status: 'missing-active-prompt', source: resolved.source });
      continue;
    }

    let meta: Record<string, any> = {};
    try {
      meta = active.metadata ? JSON.parse(active.metadata) : {};
    } catch {
      meta = {};
    }

    const nextMeta = {
      ...meta,
      promptLab: {
        ...(meta.promptLab || {}),
        runtimeContract: resolved.contract,
        runtimeContractSource: resolved.source,
        runtimeContractMergedAt: new Date().toISOString(),
      },
    };

    if (!dryRun) {
      await systemPrisma.agent_prompts.update({
        where: { id: active.id },
        data: { metadata: JSON.stringify(nextMeta) },
      });
    }

    results.push({
      agentId,
      status: dryRun ? 'would-update' : 'updated',
      promptId: active.id,
      version: active.version,
      source: resolved.source,
      contextMode: resolved.contract.contextMode,
      domain: resolved.contract.businessState.domain,
    });
  }

  console.log(JSON.stringify({ dryRun, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
