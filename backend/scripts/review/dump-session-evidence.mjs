#!/usr/bin/env node
/**
 * 课堂取证据脚本（评审用，**只读**）：
 * 给定 taskId，导出该课最近一次教学会话的客观状态，供走查结论做机器核对——
 * 不做主观判断，只回答"机器能确定的事实"。
 *
 * 用法（cwd = 仓库根）：
 *   node backend/scripts/review/dump-session-evidence.mjs --task <taskId> [--user <userId>]
 *   node backend/scripts/review/dump-session-evidence.mjs --session <sessionId>
 *
 * 输出（JSON + 人读摘要）：
 *   - 会话状态/revision/时长
 *   - 消息条数与"带图"消息数（figures/diagrams/images）
 *   - 白板（sessionArtifacts.board）是否存在
 *   - checkpointHistory 摘要（同一 cpId 是否重复下发）
 *   - 悬空视觉指代检测：正文出现"看图/图上/板上/这张…图"却全程无图 → 列出命中句
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BACKEND = resolve(process.cwd(), 'backend');

function loadEnv() {
  const p = resolve(BACKEND, '.env');
  if (!existsSync(p)) throw new Error(`缺少 ${p}`);
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
function argOf(flag, dflt) { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; }
loadEnv();

const { PrismaClient } = require(resolve(BACKEND, 'node_modules/@prisma/client'));
const prisma = new PrismaClient();

// 与 teaching-visual.service.ts 同源的悬空指代判据（此处独立实现，避免耦合运行时模块）
const DEIXIS = /(?:看|对|照|盯|按|比|顺着|沿着)(?:着|下|一下)?(?:上面|下面|左边|右边|刚才)?(?:图|箭头)|图(?:上|里|中)|(?:这|那)(?:张|幅|个|块)[^，。；！？\n]{0,4}?图|(?:左右|两)(?:栏)(?:并排)?(?:摆|放)着|白板|板上|(?:摆成|画成|做成|整理成)(?:了)?[^，。；！？\n]{0,6}图/;

const taskId = argOf('--task', '');
const sessionId = argOf('--session', '');
const userId = argOf('--user', '');

const sessions = sessionId
  ? await prisma.teaching_sessions.findMany({ where: { id: sessionId } })
  : await prisma.teaching_sessions.findMany({ where: { taskId, ...(userId ? { userId } : {}) }, orderBy: { createdAt: 'desc' }, take: 1 });
if (!sessions.length) { console.log(JSON.stringify({ ok: false, reason: 'no_session', taskId, sessionId })); await prisma.$disconnect(); process.exit(0); }
const s = sessions[0];

const rows = await prisma.teaching_session_messages.findMany({ where: { sessionId: s.id }, orderBy: { id: 'asc' } });
const msgs = rows.map((r) => { try { return JSON.parse(r.payload); } catch { return { role: '?', content: '' }; } });
const withVisual = msgs.filter((m) => (m.figures?.length || 0) + (m.diagrams?.length || 0) + (m.images?.length || 0) > 0).length;
const board = s.teachingState ? (JSON.parse(s.teachingState).sessionArtifacts?.board ?? null) : null;
const hist = s.teachingState ? (JSON.parse(s.teachingState).checkpointHistory ?? []) : [];
const histIds = hist.map((c) => `${c.checkpointId}:${c.passed ? 'pass' : 'fail'}#${c.attempts}`);
const dupIds = [...new Set(histIds.map((x) => x.split(':')[0]))].filter((id) => histIds.filter((y) => y.startsWith(id + ':')).length > 1);

const dangling = [];
if (withVisual === 0 && !board) {
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    const hit = DEIXIS.exec(String(m.content || ''));
    if (hit) dangling.push({ hit: hit[0], snippet: String(m.content).replace(/\s+/g, ' ').slice(Math.max(0, hit.index - 40), hit.index + 60) });
  }
}

const out = {
  ok: true,
  session: { id: s.id, taskId: s.taskId, status: s.status, revision: s.revision, durationMinutes: s.duration },
  messages: { total: msgs.length, assistant: msgs.filter((m) => m.role === 'assistant').length, user: msgs.filter((m) => m.role === 'user').length, withVisual },
  board,
  checkpoints: { count: hist.length, ids: histIds, repeatedCheckpointIds: dupIds },
  danglingVisualReference: { detected: dangling.length > 0, samples: dangling.slice(0, 5) },
};
console.log(JSON.stringify(out, null, 2));

await prisma.$disconnect();
