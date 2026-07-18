import 'dotenv/config';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createDatabaseBackup, verifyDatabaseBackup } from './database-backup';

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

async function main() {
  const command = process.argv[2];
  const { backendRoot, projectRoot } = resolveRoots();
  if (command === 'create') {
    const result = await createDatabaseBackup({
      backendRoot,
      projectRoot,
      databaseUrl: process.env.DATABASE_URL,
      systemDatabaseUrl: process.env.SYSTEM_DATABASE_URL,
      outputRoot: argumentValue('--output'),
      confirmQuiesced: process.argv.includes('--confirm-quiesced')
    });
    console.log(JSON.stringify({ success: true, backupDirectory: result.backupDirectory, manifest: result.manifest }));
    return;
  }
  if (command === 'verify') {
    const backupDirectory = process.argv[3];
    if (!backupDirectory) throw new Error('请提供备份目录');
    const manifest = await verifyDatabaseBackup(backupDirectory, backendRoot);
    console.log(JSON.stringify({ success: true, backupDirectory: resolve(backupDirectory), manifest }));
    return;
  }
  throw new Error('用法: database-backup.cli create --confirm-quiesced [--output ABSOLUTE_DIR] | verify BACKUP_DIR');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
