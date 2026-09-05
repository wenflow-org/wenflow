// 确认三人教学会话消息增长
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const rows = q(`SELECT id, topic, status, taskType, length(messages) AS L, updatedAt FROM teaching_sessions WHERE createdAt > ? ORDER BY createdAt DESC LIMIT 8`, Date.now() - 40 * 60 * 1000);
for (const r of rows) console.log(`${r.id.slice(0, 34)} | ${String(r.topic).slice(0, 26)} | ${r.status} ${r.taskType} | L=${r.L} | ${new Date(r.updatedAt).toISOString().slice(11, 19)}`);
db.close();
