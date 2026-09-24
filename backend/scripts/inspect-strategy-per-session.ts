/* 临时排查脚本：伴学策略（调用方选定）分布 + 单节课内的教学策略序列 */
import sqlite3 from 'sqlite3';
import path from 'path';

const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));
const all = (sql: string, p: any[] = []): Promise<any[]> => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r as any[]))));

(async () => {
  // 1) 伴学：策略在输入载荷的【策略】行（调用方按认知层级选定）
  const peer = await all(
    `SELECT userPayload FROM prompt_call_logs WHERE agentId = 'skill:peer-reinforcement' AND success = 1 ORDER BY createdAt DESC LIMIT 200`,
  );
  const pd = new Map<string, number>();
  const pLevel = new Map<string, number>();
  for (const r of peer) {
    const p = String(r.userPayload || '');
    const s = p.match(/【策略】\s*([a-z-]+)/);
    const lv = p.match(/【学生认知层级】\s*([a-zA-Z]+)/);
    if (s) pd.set(s[1], (pd.get(s[1]) || 0) + 1);
    if (lv) pLevel.set(lv[1], (pLevel.get(lv[1]) || 0) + 1);
  }
  console.log(`伴学样本 ${peer.length} 次`);
  console.log('  策略分布：', JSON.stringify(Object.fromEntries([...pd.entries()].sort((a, b) => b[1] - a[1]))));
  console.log('  认知层级分布：', JSON.stringify(Object.fromEntries([...pLevel.entries()].sort((a, b) => b[1] - a[1]))));

  // 2) 教学：找最近一节消息数最多的会话，按顺序列出每回合策略
  const sess = await all(
    `SELECT sessionId, COUNT(*) c FROM teaching_session_messages GROUP BY sessionId ORDER BY c DESC LIMIT 3`,
  );
  for (const s of sess) {
    const msgs = await all(
      `SELECT id, payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY id ASC`,
      [s.sessionId],
    );
    const seq: string[] = [];
    for (const m of msgs) {
      let p: any;
      try { p = JSON.parse(String(m.payload)); } catch { continue; }
      const st = p?.pedagogy?.strategies ?? p?.meta?.pedagogy?.strategies ?? p?.strategies;
      if (Array.isArray(st) && st.length) seq.push(st.join('+'));
    }
    console.log(`\n会话 ${String(s.sessionId).slice(0, 40)}… 共 ${msgs.length} 条消息，含策略 ${seq.length} 条：`);
    console.log('  ' + seq.slice(0, 22).join('  →  '));
    if (!seq.length && msgs.length) {
      const first = JSON.parse(String(msgs[0].payload));
      console.log('  （未取到策略，首条 payload 顶层键：', Object.keys(first).join(','), '）');
    }
  }
  db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
