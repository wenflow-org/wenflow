#!/usr/bin/env node
/**
 * rebaseline-migrations.mjs — 迁移压平后给「已有数据库」重新打基线（一次性运维工具）
 *
 * 背景：2026-10-18 把主库 62 个、system 库 15 个历史迁移压成各 1 条 baseline
 * （`20260717000000_main_baseline` / `20260717000000_system_baseline`）。已有库
 * （本机 dev.db、demo 服务器）的 `_prisma_migrations` 里还记着旧迁移名，prisma 会报
 * 「migration applied to the database but missing from the local migrations directory」。
 *
 * 做法：清空两个库的迁移记录 → 用官方 `prisma migrate resolve --applied <baseline>`
 * 记入当前基线（checksum 由 prisma 自己算，不手写）。
 *
 * 用法（cd backend）：
 *   node scripts/rebaseline-migrations.mjs           # dry-run：只报告现状与将执行的动作
 *   node scripts/rebaseline-migrations.mjs --apply    # 执行
 *
 * 只动 `_prisma_migrations` 表，不碰业务数据；执行前建议先备份库文件（本机可用
 * `npm run database:backup:create`）。
 */
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const APPLY = process.argv.includes('--apply');

const TARGETS = [
  { name: 'main', schema: 'prisma/schema.prisma', urlEnv: 'DATABASE_URL', dir: 'prisma/migrations' },
  { name: 'system', schema: 'prisma/system/schema.prisma', urlEnv: 'SYSTEM_DATABASE_URL', dir: 'prisma/system/migrations' },
];

function readEnv(key, fallback) {
  try {
    const raw = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const hit = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\s]+)"?\\s*$`).exec(line);
      if (hit) return hit[1];
    }
  } catch {
    /* 无 .env 时用调用方传入的环境变量 */
  }
  return process.env[key] ?? fallback;
}

/** `file:./dev.db` 这类相对 URL 按 schema 所在目录解析（与 prisma 一致）。 */
function resolveDbFile(url, schemaPath) {
  if (!url.startsWith('file:')) return null;
  const raw = url.slice('file:'.length);
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(BACKEND, path.dirname(schemaPath), raw);
}

function listMigrationDirs(dir) {
  const abs = path.join(BACKEND, dir);
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function baselineName(dirs) {
  return dirs.find((name) => name.endsWith('_main_baseline') || name.endsWith('_system_baseline')) ?? dirs[0];
}

let failures = 0;
for (const target of TARGETS) {
  const dirs = listMigrationDirs(target.dir);
  const expected = baselineName(dirs);
  const dbFile = resolveDbFile(readEnv(target.urlEnv, ''), target.schema);
  console.log(`\n== ${target.name} ==`);
  console.log(`  迁移目录: ${target.dir}（${dirs.length} 条：${dirs.join(', ')}）`);
  console.log(`  库文件:   ${dbFile}`);
  if (!dbFile || !fs.existsSync(dbFile)) {
    console.log('  ✗ 库文件不存在，跳过（新环境直接 migrate deploy 即可）');
    continue;
  }
  const db = new DatabaseSync(dbFile);
  const hasTable = db.prepare("select name from sqlite_master where type='table' and name='_prisma_migrations'").get();
  if (!hasTable) {
    console.log('  ✗ 库里没有 _prisma_migrations（可能是全新库或 db push 生成的），跳过');
    db.close();
    continue;
  }
  const rows = db.prepare('select migration_name from _prisma_migrations order by finished_at').all().map((r) => r.migration_name);
  const missing = dirs.filter((name) => !rows.includes(name));
  const extra = rows.filter((name) => !dirs.includes(name));
  console.log(`  已记录 ${rows.length} 条；目录缺失记录 ${missing.length} 条；库中多余记录 ${extra.length} 条`);
  if (missing.length === 0 && extra.length === 0) {
    console.log('  ✓ 已是最新基线，无需处理');
    db.close();
    continue;
  }
  if (!APPLY) {
    console.log(`  [dry-run] 将：清空 ${rows.length} 条记录 → resolve --applied ${expected}`);
    db.close();
    continue;
  }
  db.exec('delete from _prisma_migrations');
  db.close();
  try {
    execFileSync(process.execPath, [path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'resolve', '--applied', expected, '--schema', target.schema], {
      cwd: BACKEND,
      stdio: 'inherit',
    });
    console.log(`  ✓ 已把 ${expected} 记为已应用（原 ${rows.length} 条记录已清空）`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ resolve 失败：${error?.message || error}`);
  }
}

console.log(APPLY ? '\n[rebaseline] 完成，建议接着跑 prisma migrate status 复核。' : '\n[rebaseline] 这是 dry-run；确认后加 --apply 执行。');
process.exit(failures ? 1 : 0);
