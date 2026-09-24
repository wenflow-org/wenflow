/* 临时排查脚本：真实任务上的 knowledgeType / cognitiveLevel / taskType 分布（决定教学策略预设） */
import sqlite3 from 'sqlite3';
import path from 'path';

const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));
const all = (sql: string): Promise<any[]> => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r as any[]))));

(async () => {
  const rows = await all(`SELECT knowledgeType, cognitiveLevel, taskType, icapLevel FROM subtasks`);
  const tally = (key: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r[key] ?? 'null'), (m.get(String(r[key] ?? 'null')) || 0) + 1);
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  };
  console.log(`真实任务样本 ${rows.length} 条`);
  console.log('knowledgeType：', JSON.stringify(tally('knowledgeType')));
  console.log('cognitiveLevel：', JSON.stringify(tally('cognitiveLevel')));
  console.log('taskType：', JSON.stringify(tally('taskType')));
  console.log('icapLevel：', JSON.stringify(tally('icapLevel')));
  const combo = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.knowledgeType ?? '-'}/${r.cognitiveLevel ?? '-'}`;
    combo.set(k, (combo.get(k) || 0) + 1);
  }
  console.log('知识类型/认知层级 组合数：', combo.size, '→', JSON.stringify(Object.fromEntries([...combo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))));
  db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
