// 列出该用户全部教学会话，找 completed 的监督课
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const rows = q(`SELECT id, topic, status, taskType, length(messages) AS L, (wrapup IS NOT NULL) AS w, createdAt FROM teaching_sessions WHERE id LIKE 'teaching_202f0609%' ORDER BY createdAt DESC LIMIT 8`);
for (const r of rows) console.log(r.id, '|', r.topic, '|', r.status, r.taskType, '| L=' + r.L, 'w=' + r.w);
db.close();
