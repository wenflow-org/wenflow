/**
 * 把课堂里真实下发过的教学图导出成图库数据（供 frontend/figure-gallery.html 用）。
 *
 * 只存规格不存像素：图本身是 `payload.figures[]` 里的 spec，这里额外带上「附近的一轮」——
 * 该图所在那条老师回复 + 紧邻它之前的学生发言，方便对照图是在回应什么。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/export-figures.ts [输出路径]
 *   FIGURE_DB=<path> 可指定库文件；默认取本 worktree 的 prisma/dev.db，
 *   本 worktree 没放库文件时指向主树共享的 dev.db 即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const OUT = path.resolve(
  process.argv[2] || path.join(__dirname, '../../frontend/figure-out/figures.json')
);
const DB = path.resolve(process.env.FIGURE_DB || path.join(__dirname, '../prisma/dev.db'));

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

interface FigureRow {
  rid: number;
  sessionId: string;
  payload: string;
  createdAt: string | number | null;
  topic: string | null;
  userName: string | null;
  userEmail: string | null;
}

interface ChatMessage {
  role?: string;
  content?: string;
  figures?: Array<Record<string, unknown>>;
  figureSource?: {
    trigger?: string;
    reason?: string | null;
    kindHint?: string | null;
  } | null;
}

function parsePayload(payload: string | undefined | null): ChatMessage {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as ChatMessage;
  } catch {
    return {};
  }
}

(async () => {
  const rows = await all<FigureRow>(`
    select m.rowid as rid, m.sessionId, m.payload, m.createdAt,
           t.topic, u.name as userName, u.email as userEmail
    from teaching_session_messages m
    left join teaching_sessions t on t.id = m.sessionId
    left join users u on u.id = t.userId
    where m.payload like '%"figures"%'
    order by m.sessionId, m.rowid
  `);

  const items: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const msg = parsePayload(row.payload);
    const figures = Array.isArray(msg.figures) ? msg.figures : [];
    if (!figures.length) continue;

    // 「附近的一轮」：紧邻的前一条学生发言 + 本条老师回复。只取相邻一条，不拼整段对话。
    const prev = await all<{ payload: string }>(
      `select payload from teaching_session_messages
       where sessionId = ? and rowid < ? and payload like '%"role":"user"%'
       order by rowid desc limit 1`,
      [row.sessionId, row.rid]
    );
    const studentText = String(parsePayload(prev[0]?.payload).content || '');

    for (const figure of figures) {
      items.push({
        sessionId: row.sessionId,
        topic: row.topic,
        user: row.userName || row.userEmail,
        at: row.createdAt,
        figure,
        source: msg.figureSource ?? null,
        context: {
          student: studentText.slice(0, 1200),
          teacher: String(msg.content || '').slice(0, 2000),
        },
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(items, null, 1));
  console.log('导出', items.length, '张 →', OUT);
  db.close();
})().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
