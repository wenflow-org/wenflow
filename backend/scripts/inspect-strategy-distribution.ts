/* 临时排查脚本：统计真实课堂回合的策略分布 + 单节课内的策略变化 + 伴学策略 */
import sqlite3 from 'sqlite3';
import path from 'path';

const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));
const all = (sql: string): Promise<any[]> => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r as any[]))));

(async () => {
  const rows = await all(
    `SELECT normalizedOutput, createdAt, conversationId, success FROM prompt_call_logs
      WHERE agentId = 'skill:teaching-turn' ORDER BY createdAt DESC LIMIT 400`,
  );
  const strat = new Map<string, number>();
  const perTurn = new Map<number, number>();
  let parsed = 0;
  const bySession = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.success) continue;
    let out: any;
    try { out = JSON.parse(String(r.normalizedOutput || '')); } catch { continue; }
    const list = out?.pedagogy?.strategies;
    if (!Array.isArray(list) || !list.length) continue;
    parsed += 1;
    perTurn.set(list.length, (perTurn.get(list.length) || 0) + 1);
    for (const s of list) strat.set(s, (strat.get(s) || 0) + 1);
    const sid = String(r.conversationId || 'unknown');
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid)!.push(list.join('+'));
  }
  console.log(`teaching-turn 调用 ${rows.length} 次，含有效 strategies ${parsed} 次`);
  console.log('策略次数：', JSON.stringify(Object.fromEntries([...strat.entries()].sort((a, b) => b[1] - a[1]))));
  console.log('每回合策略数：', JSON.stringify(Object.fromEntries([...perTurn.entries()].sort())));
  const multi = [...bySession.entries()].filter(([, v]) => v.length >= 3);
  console.log(`含 ≥3 回合的会话数：${multi.length}`);
  for (const [sid, list] of multi.slice(0, 3)) {
    console.log(`  会话 ${sid.slice(0, 28)}… ${list.length} 回合，组合序列: ${list.slice().reverse().join(' | ')}`);
  }

  const peerRows = await all(
    `SELECT normalizedOutput FROM prompt_call_logs WHERE agentId = 'skill:peer-reinforcement' AND success = 1 ORDER BY createdAt DESC LIMIT 200`,
  );
  const p = new Map<string, number>();
  for (const r of peerRows) {
    try {
      const out = JSON.parse(String(r.normalizedOutput || ''));
      const s = out?.strategy ?? out?.pedagogy?.strategy;
      if (s) p.set(String(s), (p.get(String(s)) || 0) + 1);
    } catch { /* ignore */ }
  }
  console.log(`伴学样本 ${peerRows.length} 次，策略分布：`, JSON.stringify(Object.fromEntries([...p.entries()].sort((a, b) => b[1] - a[1]))));
  db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
