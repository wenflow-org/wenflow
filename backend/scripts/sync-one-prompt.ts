/**
 * 作用域受限的 prompt 同步（dev scratch 工具，不入库）
 *
 * 为什么需要它：`npm run prompts:sync` 是全量 drift 同步——工作树里他人 WIP 的
 * `prompts/skill.{path-planning,stage-designer,session-wrapup}.md` 一旦与 DB ACTIVE 不同，
 * 会被一并写进共享的 system.db，等于替别人发布了他们没做完的提示词。
 * 本工具只对显式指定的 agentId 做与 syncCoreAgentPrompts 相同的 archive+create。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/sync-one-prompt.ts --dry                     # 只报告谁会被改（只读）
 *   npx ts-node --transpile-only scripts/sync-one-prompt.ts --agentId=skill:peer-reinforcement --write
 */
import dotenv from 'dotenv';
import systemPrisma from '../src/config/system-database';
import {
  loadCoreAgentPromptSeeds,
  matchesSeedConfig,
} from '../src/services/prompt-manifest/seed-core-agent-prompts';
import { runWithTransaction } from '../src/utils/with-transaction';

dotenv.config();

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function resolveDefaultModel(): Promise<string> {
  const config = await systemPrisma.platform_api_configs.findUnique({
    where: { id: 'platform' },
    select: { defaultModel: true },
  });
  return String(config?.defaultModel || process.env.AI_MODEL || '').trim();
}

function buildPromptName(name: string, version: number): string {
  return /^v\d+-/.test(name) ? name.replace(/^v\d+-/, `v${version}-`) : `v${version}-${name}`;
}

async function main() {
  const dry = !process.argv.includes('--write');
  const agentIdFilter = arg('agentId');
  const seeds = loadCoreAgentPromptSeeds();

  const drifted: string[] = [];
  const inSync: string[] = [];
  const applied: string[] = [];

  for (const seed of seeds) {
    const activePrompt = await systemPrisma.agent_prompts.findFirst({
      where: { agentId: seed.agentId, status: 'ACTIVE' },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }, { version: 'desc' }],
      select: {
        id: true, agentId: true, version: true, systemPrompt: true,
        temperature: true, maxTokens: true, model: true, metadata: true,
      },
    });

    if (!activePrompt || matchesSeedConfig(activePrompt, seed)) {
      inSync.push(seed.agentId);
      continue;
    }
    drifted.push(seed.agentId);

    if (dry || (agentIdFilter && seed.agentId !== agentIdFilter)) continue;

    const latest = await systemPrisma.agent_prompts.findFirst({
      where: { agentId: seed.agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = Math.max((latest?.version || 0) + 1, (activePrompt.version || 0) + 1);

    await runWithTransaction(systemPrisma, async (tx) => {
      await tx.agent_prompts.updateMany({
        where: { agentId: seed.agentId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED', updatedAt: new Date() },
      });
      await tx.agent_prompts.create({
        data: {
          id: `ap_seed_${seed.agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          agentId: seed.agentId,
          version: nextVersion,
          name: buildPromptName(seed.name, nextVersion),
          description: seed.description,
          systemPrompt: seed.systemPrompt,
          temperature: seed.temperature,
          maxTokens: seed.maxTokens,
          model: null,
          status: 'ACTIVE',
          createdBy: 'sync-one-prompt',
          publishedAt: new Date(),
          ...(seed.metadata === undefined ? {} : { metadata: seed.metadata }),
          ...(seed.coreHash === undefined ? {} : { coreHash: seed.coreHash }),
          ...(seed.coreVersion === undefined ? {} : { coreVersion: seed.coreVersion }),
        },
      });
    }, { label: `sync-one-prompt.${seed.agentId}` });

    applied.push(`${seed.agentId}@v${nextVersion}`);
  }

  console.log(JSON.stringify({
    mode: dry ? 'dry' : 'write',
    agentIdFilter: agentIdFilter || null,
    totalSeeds: seeds.length,
    wouldDrift: drifted,
    inSyncCount: inSync.length,
    applied,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await systemPrisma.$disconnect(); });
