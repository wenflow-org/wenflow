import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import {
  isEncryptedSecret,
  isSecretFieldName,
  needsSecretMigration,
  reencryptSecret,
  reencryptSecretTree,
  validateSecretEncryptionConfig
} from '../utils/secret-crypto';

const apply = process.argv.includes('--apply');

interface MigrationStats {
  scanned: number;
  pending: number;
  migrated: number;
  failed: number;
}

const stats: MigrationStats = { scanned: 0, pending: 0, migrated: 0, failed: 0 };

async function migrateScalarRows(
  label: string,
  context: string,
  rows: Array<{ id: string; apiKey: string | null }>,
  update: (id: string, apiKey: string) => Promise<unknown>
) {
  for (const row of rows) {
    if (!row.apiKey) continue;
    stats.scanned++;
    try {
      if (!needsSecretMigration(row.apiKey)) continue;
      stats.pending++;
      if (apply) {
        await update(row.id, reencryptSecret(row.apiKey, context)!);
        stats.migrated++;
      }
    } catch (error) {
      stats.failed++;
      console.error(`[secret-migration] ${label} id=${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function hasPendingSecretTree(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPendingSecretTree);
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (typeof item === 'string' && isSecretFieldName(key)) {
      return Boolean(item) && (!isEncryptedSecret(item) || needsSecretMigration(item));
    }
    return hasPendingSecretTree(item);
  });
}

async function migrateJsonColumn(
  label: string,
  context: string,
  rows: Array<{ id: string; value: string | null }>,
  update: (id: string, value: string) => Promise<unknown>
) {
  for (const row of rows) {
    if (!row.value) continue;
    stats.scanned++;
    try {
      const parsed = JSON.parse(row.value);
      if (!hasPendingSecretTree(parsed)) continue;
      stats.pending++;
      if (apply) {
        await update(row.id, JSON.stringify(reencryptSecretTree(parsed, context)));
        stats.migrated++;
      }
    } catch (error) {
      stats.failed++;
      console.error(`[secret-migration] ${label} id=${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  validateSecretEncryptionConfig(true);

  const [platform, agents, skills, lab, userApis, userAgents, userMcp] = await Promise.all([
    systemPrisma.platform_api_configs.findMany({ select: { id: true, apiKey: true } }),
    systemPrisma.agent_model_configs.findMany({ select: { id: true, apiKey: true } }),
    systemPrisma.skill_model_configs.findMany({ select: { id: true, apiKey: true } }),
    systemPrisma.agent_lab_configs.findMany({ select: { id: true, apiKey: true } }),
    prisma.user_api_configs.findMany({ select: { id: true, apiKey: true } }),
    prisma.user_agent_model_configs.findMany({ select: { id: true, apiKey: true } }),
    prisma.user_mcp_configs.findMany({ select: { id: true, servers: true, tools: true, healthCheck: true } })
  ]);

  await migrateScalarRows('platform_api_configs.apiKey', 'system.platform_api_configs.apiKey', platform,
    (id, apiKey) => systemPrisma.platform_api_configs.update({ where: { id }, data: { apiKey } }));
  await migrateScalarRows('agent_model_configs.apiKey', 'system.agent_model_configs.apiKey', agents,
    (id, apiKey) => systemPrisma.agent_model_configs.update({ where: { id }, data: { apiKey } }));
  await migrateScalarRows('skill_model_configs.apiKey', 'system.skill_model_configs.apiKey', skills,
    (id, apiKey) => systemPrisma.skill_model_configs.update({ where: { id }, data: { apiKey } }));
  await migrateScalarRows('agent_lab_configs.apiKey', 'system.agent_lab_configs.apiKey', lab,
    (id, apiKey) => systemPrisma.agent_lab_configs.update({ where: { id }, data: { apiKey } }));
  await migrateScalarRows('user_api_configs.apiKey', 'main.user_api_configs.apiKey', userApis,
    (id, apiKey) => prisma.user_api_configs.update({ where: { id }, data: { apiKey } }));
  await migrateScalarRows('user_agent_model_configs.apiKey', 'main.user_agent_model_configs.apiKey', userAgents,
    (id, apiKey) => prisma.user_agent_model_configs.update({ where: { id }, data: { apiKey } }));

  for (const column of ['servers', 'tools', 'healthCheck'] as const) {
    await migrateJsonColumn(
      `user_mcp_configs.${column}`,
      `main.user_mcp_configs.${column}`,
      userMcp.map(row => ({ id: row.id, value: row[column] })),
      (id, value) => prisma.user_mcp_configs.update({ where: { id }, data: { [column]: value } })
    );
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit', ...stats }));
  if (stats.failed > 0) process.exitCode = 1;
} 

main()
  .catch(error => {
    console.error(`[secret-migration] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), systemPrisma.$disconnect()]);
  });
