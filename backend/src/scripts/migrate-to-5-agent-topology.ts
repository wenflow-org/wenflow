/**
 * Phase A.3 旧 ID → 新 canonical ID 迁移
 *
 * 映射表（与 agent-manifest.service.ts 的 aliases 对应）：
 *   - requirement-agent              -> goal-agent
 *   - goal-conversation-agent        -> skill:goal-conversation
 *   - ai-teaching-agent              -> teaching-agent
 *   - teaching-turn-agent            -> skill:teaching-turn
 *   - session-wrapup-agent           -> skill:session-wrapup
 *   - learner-model-agent            -> skill:learner-model
 *   - peer-agent                     -> skill:peer-reinforcement
 *   - virtual-learner-*              -> skill:virtual-learner-*  (5 个)
 *
 * 涉及表（system DB + dev DB）：
 *   system: agent_prompts / agent_model_configs / agent_contracts /
 *           agent_field_routings / agent_definitions / agent_registrations /
 *           prompt_eval_cases / prompt_eval_runs
 *   dev:    agent_call_logs / prompt_call_logs / content_feedback /
 *           user_agent_model_configs
 *
 * 策略：
 *   - 旧 ID 行直接 update agentId 为新 ID
 *   - 若新 ID 已存在（unique 冲突），保留新 ID 行，删除老行
 *   - 输出迁移报告
 */

import { PrismaClient } from '@prisma/client';
import systemPrisma from '../config/system-database';

const devPrisma = new PrismaClient();

const ID_MAP: Record<string, string> = {
  'requirement-agent': 'goal-agent',
  'goal-conversation-agent': 'skill:goal-conversation',
  'ai-teaching-agent': 'teaching-agent',
  'teaching-turn-agent': 'skill:teaching-turn',
  'session-wrapup-agent': 'skill:session-wrapup',
  'learner-model-agent': 'skill:learner-model',
  'peer-agent': 'skill:peer-reinforcement',
  'virtual-learner-goal-dialogue-simulator': 'skill:virtual-learner-goal-dialogue-simulator',
  'virtual-learner-learn-turn-simulator': 'skill:virtual-learner-learn-turn-simulator',
  'virtual-learner-path-evaluator': 'skill:virtual-learner-path-evaluator',
  'virtual-learner-persona-designer': 'skill:virtual-learner-persona-designer',
  'virtual-learner-scenario-designer': 'skill:virtual-learner-scenario-designer',
};

interface MigrationResult {
  table: string;
  oldId: string;
  newId: string;
  matched: number;
  updated: number;
  conflicts: number;
}

const results: MigrationResult[] = [];

async function migrateSimple(
  table: string,
  count: (oldId: string) => Promise<number>,
  update: (oldId: string, newId: string) => Promise<{ count: number }>
) {
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const matched = await count(oldId);
    if (matched === 0) continue;
    const r = await update(oldId, newId);
    results.push({ table, oldId, newId, matched, updated: r.count, conflicts: 0 });
    console.log(`  ${table}: ${oldId} -> ${newId}  matched=${matched} updated=${r.count}`);
  }
}

async function migrateUniqueAgentId(
  table: string,
  findAll: () => Promise<Array<{ id: string; agentId: string }>>,
  findByAgentId: (agentId: string) => Promise<{ id: string } | null>,
  updateById: (id: string, newAgentId: string) => Promise<unknown>,
  deleteById: (id: string) => Promise<unknown>
) {
  const all = await findAll();
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const old = all.find(r => r.agentId === oldId);
    if (!old) continue;
    const conflict = await findByAgentId(newId);
    if (conflict) {
      // 删除老行（保留 newId 的行）
      await deleteById(old.id);
      results.push({ table, oldId, newId, matched: 1, updated: 0, conflicts: 1 });
      console.log(`  ${table}: ${oldId} -> ${newId}  CONFLICT (deleted old row, kept new)`);
    } else {
      await updateById(old.id, newId);
      results.push({ table, oldId, newId, matched: 1, updated: 1, conflicts: 0 });
      console.log(`  ${table}: ${oldId} -> ${newId}  updated`);
    }
  }
}

async function migrateUniquePair(
  table: string,
  pairField: string,
  findManyByOld: (oldId: string) => Promise<any[]>,
  findByPair: (newId: string, pairValue: any) => Promise<any | null>,
  updateById: (id: string, newAgentId: string) => Promise<unknown>
) {
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const oldRows = await findManyByOld(oldId);
    if (oldRows.length === 0) continue;
    let updated = 0;
    let conflicts = 0;
    for (const row of oldRows) {
      const existing = await findByPair(newId, row[pairField]);
      if (existing) {
        conflicts++;
        continue;
      }
      await updateById(row.id, newId);
      updated++;
    }
    results.push({ table, oldId, newId, matched: oldRows.length, updated, conflicts });
    console.log(`  ${table}: ${oldId} -> ${newId}  matched=${oldRows.length} updated=${updated} conflicts=${conflicts}`);
  }
}

async function main() {
  console.log('=== Phase A.3 旧 ID → 新 canonical ID 迁移 ===\n');

  // ---------- system DB ----------
  console.log('[system DB] agent_prompts (unique [agentId, version]):');
  await migrateUniquePair(
    'agent_prompts',
    'version',
    (oldId) => systemPrisma.agent_prompts.findMany({ where: { agentId: oldId } }),
    (newId, version) => systemPrisma.agent_prompts.findUnique({
      where: { agentId_version: { agentId: newId, version } }
    }),
    (id, newAgentId) => systemPrisma.agent_prompts.update({
      where: { id }, data: { agentId: newAgentId }
    })
  );

  console.log('\n[system DB] agent_model_configs (unique agentId):');
  await migrateUniqueAgentId(
    'agent_model_configs',
    () => systemPrisma.agent_model_configs.findMany({ select: { id: true, agentId: true } }),
    (agentId) => systemPrisma.agent_model_configs.findUnique({ where: { agentId } }),
    (id, newAgentId) => systemPrisma.agent_model_configs.update({ where: { id }, data: { agentId: newAgentId } }),
    (id) => systemPrisma.agent_model_configs.delete({ where: { id } })
  );

  console.log('\n[system DB] agent_contracts (unique agentId):');
  await migrateUniqueAgentId(
    'agent_contracts',
    () => systemPrisma.agent_contracts.findMany({ select: { id: true, agentId: true } }),
    (agentId) => systemPrisma.agent_contracts.findUnique({ where: { agentId } }),
    (id, newAgentId) => systemPrisma.agent_contracts.update({ where: { id }, data: { agentId: newAgentId } }),
    (id) => systemPrisma.agent_contracts.delete({ where: { id } })
  );

  console.log('\n[system DB] agent_field_routings (unique [agentId, fieldId]):');
  await migrateUniquePair(
    'agent_field_routings',
    'fieldId',
    (oldId) => systemPrisma.agent_field_routings.findMany({ where: { agentId: oldId } }),
    (newId, fieldId) => systemPrisma.agent_field_routings.findUnique({
      where: { agentId_fieldId: { agentId: newId, fieldId } }
    }),
    (id, newAgentId) => systemPrisma.agent_field_routings.update({
      where: { id }, data: { agentId: newAgentId }
    })
  );

  console.log('\n[system DB] agent_definitions (unique id):');
  for (const [oldId, newId] of Object.entries(ID_MAP)) {
    const old = await systemPrisma.agent_definitions.findUnique({ where: { id: oldId } });
    if (!old) continue;
    const conflict = await systemPrisma.agent_definitions.findUnique({ where: { id: newId } });
    if (conflict) {
      await systemPrisma.agent_definitions.delete({ where: { id: oldId } });
      results.push({ table: 'agent_definitions', oldId, newId, matched: 1, updated: 0, conflicts: 1 });
      console.log(`  agent_definitions: ${oldId} -> ${newId}  CONFLICT (deleted old)`);
    } else {
      await systemPrisma.agent_definitions.update({ where: { id: oldId }, data: { id: newId } });
      results.push({ table: 'agent_definitions', oldId, newId, matched: 1, updated: 1, conflicts: 0 });
      console.log(`  agent_definitions: ${oldId} -> ${newId}  updated`);
    }
  }

  console.log('\n[system DB] agent_registrations (cleared on every startup, just delete old):');
  for (const oldId of Object.keys(ID_MAP)) {
    const r = await systemPrisma.agent_registrations.deleteMany({ where: { id: oldId } });
    if (r.count > 0) {
      results.push({ table: 'agent_registrations', oldId, newId: '(deleted)', matched: r.count, updated: 0, conflicts: 0 });
      console.log(`  agent_registrations: ${oldId} deleted (will re-register with new id at startup)`);
    }
  }

  console.log('\n[system DB] prompt_eval_cases (unique [agentId, caseId]):');
  await migrateUniquePair(
    'prompt_eval_cases',
    'caseId',
    (oldId) => systemPrisma.prompt_eval_cases.findMany({ where: { agentId: oldId } }),
    (newId, caseId) => systemPrisma.prompt_eval_cases.findFirst({
      where: { agentId: newId, caseId }
    }),
    (id, newAgentId) => systemPrisma.prompt_eval_cases.update({
      where: { id }, data: { agentId: newAgentId }
    })
  );

  console.log('\n[system DB] prompt_eval_runs:');
  await migrateSimple(
    'prompt_eval_runs',
    (oldId) => systemPrisma.prompt_eval_runs.count({ where: { agentId: oldId } }),
    (oldId, newId) => systemPrisma.prompt_eval_runs.updateMany({
      where: { agentId: oldId }, data: { agentId: newId }
    })
  );

  // ---------- dev DB ----------
  console.log('\n[dev DB] agent_call_logs:');
  await migrateSimple(
    'agent_call_logs',
    (oldId) => devPrisma.agent_call_logs.count({ where: { agentId: oldId } }),
    (oldId, newId) => devPrisma.agent_call_logs.updateMany({
      where: { agentId: oldId }, data: { agentId: newId }
    })
  );

  console.log('\n[dev DB] prompt_call_logs:');
  await migrateSimple(
    'prompt_call_logs',
    (oldId) => devPrisma.prompt_call_logs.count({ where: { agentId: oldId } }),
    (oldId, newId) => devPrisma.prompt_call_logs.updateMany({
      where: { agentId: oldId }, data: { agentId: newId }
    })
  );

  console.log('\n[dev DB] content_feedback:');
  await migrateSimple(
    'content_feedback',
    (oldId) => devPrisma.content_feedback.count({ where: { agentId: oldId } }),
    (oldId, newId) => devPrisma.content_feedback.updateMany({
      where: { agentId: oldId }, data: { agentId: newId }
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
        where: { id: row.id }, data: { agentId: newId },
      });
      updated++;
    }
    results.push({ table: 'user_agent_model_configs', oldId, newId, matched: oldRows.length, updated, conflicts });
    console.log(`  user_agent_model_configs: ${oldId} -> ${newId}  matched=${oldRows.length} updated=${updated} conflicts=${conflicts}`);
  }

  // ---------- Summary ----------
  console.log('\n=== Migration Summary ===');
  const tables = new Set(results.map(r => r.table));
  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);
  const totalConflicts = results.reduce((s, r) => s + r.conflicts, 0);
  console.log(`Tables touched:     ${tables.size}`);
  console.log(`Total rows updated: ${totalUpdated}`);
  console.log(`Total conflicts:    ${totalConflicts}`);
  if (results.length === 0) {
    console.log('No legacy id rows found — already on canonical ids.');
  }
}

main()
  .catch(e => { console.error('Migration failed:', e); process.exit(1); })
  .finally(async () => {
    await devPrisma.$disconnect();
    await systemPrisma.$disconnect();
  });
