import 'dotenv/config';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { databaseSpaceStatus, VacuumScope, vacuumDatabases } from './database-vacuum';

if (process.platform !== 'win32') process.umask(0o077);

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveRoots() {
  const backendRoot = resolve(__dirname, '..', '..');
  const parent = resolve(backendRoot, '..');
  const projectRoot = existsSync(resolve(parent, 'frontend')) || existsSync(resolve(parent, '.git'))
    ? parent
    : undefined;
  return { backendRoot, projectRoot };
}

function parseScope(): VacuumScope {
  const value = argumentValue('--db');
  if (!value || value === 'both') return 'both';
  if (value === 'main' || value === 'system') return value;
  throw new Error(`--db 仅支持 main | system | both，收到: ${value}`);
}

async function main() {
  const command = process.argv[2];
  const { backendRoot } = resolveRoots();
  const urls = {
    databaseUrl: process.env.DATABASE_URL,
    systemDatabaseUrl: process.env.SYSTEM_DATABASE_URL
  };

  if (command === 'status') {
    const reports = await databaseSpaceStatus({ backendRoot, ...urls });
    console.log(JSON.stringify({ success: true, databases: reports }, null, 2));
    return;
  }
  if (command === 'vacuum') {
    const results = await vacuumDatabases({
      backendRoot,
      ...urls,
      confirmQuiesced: process.argv.includes('--confirm-quiesced'),
      scope: parseScope()
    });
    console.log(JSON.stringify({ success: true, results }, null, 2));
    return;
  }
  throw new Error('用法: database-vacuum.cli status | vacuum --confirm-quiesced [--db main|system|both]');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
