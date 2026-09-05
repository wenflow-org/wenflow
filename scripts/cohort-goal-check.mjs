// 检查 cohort 三人的 goal 推进
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const vs = q(`SELECT id, currentStage, goalConversationId, status, updatedAt FROM virtual_sessions WHERE id IN ('77bb0785-3f87-41af-a292-3eec0c02923e','dabea423-2b1c-4abd-bea6-f6353d0945fa','c2cb9af9-aec0-47a3-ac16-7a4f161b7c2c')`);
for (const v of vs) {
  const gc = v.goalConversationId ? q('SELECT stage, length(messages) L FROM goal_conversations WHERE id=?', v.goalConversationId)[0] : null;
  console.log(`${v.id.slice(0, 12)} | ${v.status} | stage=${v.currentStage} | gc=${gc ? gc.stage + ' L=' + gc.L : 'none'} | updated=${v.updatedAt}`);
}
db.close();
