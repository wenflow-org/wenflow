/**
 * V3.7 重命名迁移：把 5 个老 agentId 全部更新为 skill: 前缀
 *
 * - goal-conversation-agent  -> skill:goal-conversation
 * - path-agent               -> skill:path-planning
 * - teaching-turn-agent      -> skill:teaching-turn
 * - session-wrapup-agent     -> skill:session-wrapup
 * - peer-agent               -> skill:peer-reinforcement
 *
 * 涉及表：
 *   dev DB:    agent_call_logs / prompt_call_logs / content_feedback / user_agent_model_configs
 *   system DB: agent_model_configs / agent_prompts / prompt_eval_cases / prompt_eval_runs
 */

import { PrismaClient } from '@prisma/client';
import systemPrisma from '../config/system-database';

const devPrisma = new PrismaClient();

const ID_MAP: Record<string, string> = {
  'goal-conversation-agent': 'skill:goal-conversation',
  'path-agent': 'skill:path-planning',
  'teaching-turn-agent': 'skill:teaching-turn',
  'session-wrapup-agent': 'skill:session-wrapup',
  'peer-agent': 'skill:peer-reinforcement',
};

interface MigrationResult {
  table: string;
  oldId: string;
  newId: string;
  matched: number;
  updated: number;
  conflicts: number;
  conflictDetails?: any[];
}

const results: MigrationResult[] = [];

async function migrateSimple(
  table: string,
  prismaModel: any,
  countByOld: (oldId: string) => Promise<number>,
  updateByOld: (oldId: string, newId: string) => Promise<{ count: number }>
) {
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const matched = await countByOld(oldId);
    if (matched === 0) {
      continue;
    }
    const r = await updateByOld(oldId, newId);
    results.push({ table, oldId, newId, matched, updated: r.count, conflicts: 0 });
    console.log(`  ${table}: ${oldId} -> ${newId}  matched=${matched} updated=${r.count}`);
  }
}

async function migrateUniquePair(
  table: string,
  uniqueField: string,  // e.g. 'caseId' for prompt_eval_cases
  prismaModel: any
) {
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const oldRows: any[] = await prismaModel.findMany({ where: { agentId: oldId } });
    if (oldRows.length === 0) continue;

    const newRows: any[] = await prismaModel.findMany({ where: { agentId: newId } });
    const newKeys = new Set(newRows.map((r) => r[uniqueField]));
    const conflicts = oldRows.filter((r) => newKeys.has(r[uniqueField]));
    const ok = oldRows.filter((r) => !newKeys.has(r[uniqueField]));

    let updated = 0;
    for (const row of ok) {
      await prismaModel.update({
        where: { id: row.id },
        data: { agentId: newId },
      });
      updated++;
    }

    results.push({
      table,
      oldId,
      newId,
      matched: oldRows.length,
      updated,
      conflicts: conflicts.length,
      conflictDetails: conflicts.map((c) => ({ id: c.id, [uniqueField]: c[uniqueField] })),
    });
    console.log(
      `  ${table}: ${oldId} -> ${newId}  matched=${oldRows.length} updated=${updated} conflicts=${conflicts.length}`
    );
  }
}

async function main() {
  console.log('=== V3.7 agentId rename migration ===\n');

  console.log('[dev DB] agent_call_logs:');
  await migrateSimple(
    'agent_call_logs',
    devPrisma.agent_call_logs,
    (oldId) => devPrisma.agent_call_logs.count({ where: { agentId: oldId } }),
    (oldId, newId) =>
      devPrisma.agent_call_logs.updateMany({
        where: { agentId: oldId },
        data: { agentId: newId },
      })
  );

  console.log('\n[dev DB] prompt_call_logs:');
  await migrateSimple(
    'prompt_call_logs',
    devPrisma.prompt_call_logs,
    (oldId) => devPrisma.prompt_call_logs.count({ where: { agentId: oldId } }),
    (oldId, newId) =>
      devPrisma.prompt_call_logs.updateMany({
        where: { agentId: oldId },
        data: { agentId: newId },
      })
  );

  console.log('\n[dev DB] content_feedback:');
  await migrateSimple(
    'content_feedback',
    devPrisma.content_feedback,
    (oldId) => devPrisma.content_feedback.count({ where: { agentId: oldId } }),
    (oldId, newId) =>
      devPrisma.content_feedback.updateMany({
        where: { agentId: oldId },
        data: { agentId: newId },
      })
  );

  console.log('\n[dev DB] user_agent_model_configs (unique [userId, agentId]):');
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const oldRows = await devPrisma.user_agent_model_configs.findMany({ where: { agentId: oldId } });
    if (oldRows.length === 0) continue;
    let updated = 0;
    let conflicts = 0;
    for (const row of oldRows) {
      const exists = await devPrisma.user_agent_model_configs.findUnique({
        where: { userId_agentId: { userId: row.userId, agentId: newId } },
      });
      if (exists) { conflicts++; continue; }
      await devPrisma.user_agent_model_configs.update({
        where: { id: row.id },
        data: { agentId: newId },
      });
      updated++;
    }
    results.push({ table: 'user_agent_model_configs', oldId, newId, matched: oldRows.length, updated, conflicts });
    console.log(`  user_agent_model_configs: ${oldId} -> ${newId}  matched=${oldRows.length} updated=${updated} conflicts=${conflicts}`);
  }

  console.log('\n[system DB] agent_model_configs (unique agentId):');
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const old = await systemPrisma.agent_model_configs.findUnique({ where: { agentId: oldId } });
    if (!old) continue;
    const conflict = await systemPrisma.agent_model_configs.findUnique({ where: { agentId: newId } });
    if (conflict) {
      results.push({ table: 'agent_model_configs', oldId, newId, matched: 1, updated: 0, conflicts: 1 });
      console.log(`  agent_model_configs: ${oldId} -> ${newId}  CONFLICT (new id already exists)`);
      continue;
    }
    await systemPrisma.agent_model_configs.update({
      where: { agentId: oldId },
      data: { agentId: newId },
    });
    results.push({ table: 'agent_model_configs', oldId, newId, matched: 1, updated: 1, conflicts: 0 });
    console.log(`  agent_model_configs: ${oldId} -> ${newId}  updated`);
  }

  console.log('\n[system DB] agent_prompts (unique [agentId, version]):');
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const oldRows = await systemPrisma.agent_prompts.findMany({ where: { agentId: oldId } });
    if (oldRows.length === 0) continue;
    let updated = 0;
    let conflicts = 0;
    for (const row of oldRows) {
      const exists = await systemPrisma.agent_prompts.findUnique({
        where: { agentId_version: { agentId: newId, version: row.version } },
      });
      if (exists) { conflicts++; continue; }
      await systemPrisma.agent_prompts.update({
        where: { id: row.id },
        data: { agentId: newId },
      });
      updated++;
    }
    results.push({ table: 'agent_prompts', oldId, newId, matched: oldRows.length, updated, conflicts });
    console.log(`  agent_prompts: ${oldId} -> ${newId}  matched=${oldRows.length} updated=${updated} conflicts=${conflicts}`);
  }

  console.log('\n[system DB] prompt_eval_cases (unique [agentId, caseId]):');
  await migrateUniquePair('prompt_eval_cases', 'caseId', systemPrisma.prompt_eval_cases);

  console.log('\n[system DB] prompt_eval_runs:');
  await migrateSimple(
    'prompt_eval_runs',
    systemPrisma.prompt_eval_runs,
    (oldId) => systemPrisma.prompt_eval_runs.count({ where: { agentId: oldId } }),
    (oldId, newId) =>
      systemPrisma.prompt_eval_runs.updateMany({
        where: { agentId: oldId },
        data: { agentId: newId },
      })
  );

  console.log('\n=== Summary ===');
  const total = results.reduce((s, r) => s + r.updated, 0);
  const totalConflicts = results.reduce((s, r) => s + r.conflicts, 0);
  console.log(`Tables touched: ${new Set(results.map((r) => r.table)).size}`);
  console.log(`Total rows updated: ${total}`);
  console.log(`Total conflicts:    ${totalConflicts}`);
  if (totalConflicts > 0) {
    console.log('\nConflict details:');
    for (const r of results.filter((x) => x.conflicts > 0)) {
      console.log(`  ${r.table} [${r.oldId} -> ${r.newId}] conflicts=${r.conflicts}`);
      if (r.conflictDetails) {
        for (const d of r.conflictDetails.slice(0, 5)) {
          console.log(`    - ${JSON.stringify(d)}`);
        }
      }
    }
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await devPrisma.$disconnect();
    await systemPrisma.$disconnect();
  });
