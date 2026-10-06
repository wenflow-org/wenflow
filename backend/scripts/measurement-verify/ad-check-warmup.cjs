// 快查：6 VL 全部教学会话的 memoryWarmup 注入与 settled outcome（只读）——校准对原料盘点
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const VL = {
  'VL-1': 'ee52b287-29b4-4d0b-9995-303f13322f8c',
  'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
  'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
};
let totalItems = 0, totalOutcome = 0;
for (const [key, uid] of Object.entries(VL)) {
  const rows = db.prepare('SELECT id, status, startTime, endTime, teachingState FROM teaching_sessions WHERE userId = ? ORDER BY startTime').all(uid);
  console.log(`-- ${key} ${uid.slice(0, 8)}: ${rows.length} session(s)`);
  for (const r of rows) {
    let plan = null;
    try { plan = JSON.parse(r.teachingState || '{}')?.sessionArtifacts?.memoryWarmup || null; } catch {}
    if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) continue;
    const items = plan.items.map((it) => ({ conceptKey: it.conceptKey, askedAt: it.askedAt || null, outcome: it.outcome ? { status: it.outcome.status, progress: it.outcome.progress, reviewedAt: it.outcome.reviewedAt || null } : null }));
    const oc = items.filter((i) => i.outcome).length;
    totalItems += items.length; totalOutcome += oc;
    console.log(`   ${r.id.slice(-12)} ${r.status} start=${new Date(r.startTime).toISOString()} end=${r.endTime ? new Date(r.endTime).toISOString() : null} warmupItems=${items.length} settled=${oc}`);
    for (const i of items) console.log('     ' + JSON.stringify(i));
  }
}
console.log(`TOTAL warmupItems=${totalItems} settled=${totalOutcome}`);
db.close();
