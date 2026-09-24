/* 临时排查/清理脚本（走查用）：清理本次前端走查创建的临时账号
 * 用法：npx ts-node --transpile-only scripts/cleanup-uicheck-user.ts [--apply]
 * 默认 dry-run，只统计不删除；--apply 时按应用自身的软删除口径置 deletedAt。
 */
import sqlite3 from 'sqlite3';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));
const all = (sql: string, params: any[] = []): Promise<any[]> =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r as any[]))));
const run = (sql: string, params: any[] = []): Promise<void> =>
  new Promise((res, rej) => db.run(sql, params, (e) => (e ? rej(e) : res())));

(async () => {
  const users = await all(
    `SELECT id, email, name, role, isVirtualLearner, deletedAt, createdAt FROM users WHERE name LIKE '%uicheck%' OR email LIKE '%uicheck%'`,
  );
  if (!users.length) { console.log('未找到 uicheck 账号'); db.close(); return; }
  for (const u of users) {
    console.log(`用户: id=${u.id} name=${u.name} role=${u.role} deletedAt=${u.deletedAt ?? '-'} createdAt=${u.createdAt}`);
    const counts: Record<string, number> = {};
    for (const [label, sql] of [
      ['learning_paths', `SELECT COUNT(*) c FROM learning_paths WHERE userId = ?`],
      ['teaching_sessions', `SELECT COUNT(*) c FROM teaching_sessions WHERE userId = ?`],
      ['prompt_call_logs', `SELECT COUNT(*) c FROM prompt_call_logs WHERE userId = ?`],
      ['user_sessions', `SELECT COUNT(*) c FROM user_sessions WHERE userId = ?`],
    ] as const) {
      try { counts[label] = (await all(sql, [u.id]))[0].c; } catch (e: any) { counts[label] = -1; }
    }
    console.log('  关联行数:', JSON.stringify(counts));

    if (APPLY) {
      await run(`UPDATE users SET deletedAt = ?, deletedBy = ? WHERE id = ?`, [new Date().toISOString(), 'uicheck-walkthrough-cleanup', u.id]);
      const after = await all(`SELECT deletedAt, deletedBy FROM users WHERE id = ?`, [u.id]);
      console.log('  已软删除:', JSON.stringify(after[0]));
    }
  }
  console.log(APPLY ? '== 已应用 ==' : '== dry-run（未改动；加 --apply 执行）==');
  db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
