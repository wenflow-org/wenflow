#!/usr/bin/env node
/**
 * 把虚拟学习者的课堂产物导出成本地 JSON（只读 DB，不改任何数据）。
 *
 * 课堂图不落库，只在本轮 teaching-turn 的响应/日志里出现；因此从 virtual_session_logs
 * 的 details.output 里捞 figure/diagram，并把同一 session 的消息按时间并起来。
 *
 * 用法：node outputs/e2e/export-classroom.mjs
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const backend = resolve(root, 'backend');
const outDir = resolve(here, 'classroom');
mkdirSync(outDir, { recursive: true });

const require = createRequire(join(backend, 'package.json'));
require('dotenv').config({ path: join(backend, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const figureKinds = new Set([
  'grid', 'matrix', 'compare', 'quadrant', 'bipartite', 'board', 'bins', 'balance', 'ladder',
  'cycle', 'tree', 'venn', 'bullseye', 'range-bar', 'cartesian-plot', 'concept-map',
  'split-compare', 'state-strip', 'position-line',
]);

/** 从日志输出里找「真正下发的图」：只认带 kind+spec 的对象，且避开 promptDebug。 */
function findFigures(node, path = '', acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (path.includes('promptDebug')) return acc;
  if (typeof node.kind === 'string' && figureKinds.has(node.kind) && (node.spec || node.axis || node.marks)) {
    acc.push({ path, kind: node.kind, spec: node.spec ?? { axis: node.axis, marks: node.marks, spans: node.spans, guides: node.guides } });
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'promptDebug') continue;
    findFigures(v, path ? `${path}.${k}` : k, acc);
  }
  return acc;
}

const stateDir = resolve(here, 'learners');
const statesAll = existsSync(stateDir)
  ? readdirSync(stateDir)
      .filter((f) => /^f\d+b?-state\.json$/.test(f))
      .map((f) => ({ file: f, ...JSON.parse(readFileSync(resolve(stateDir, f), 'utf8')) }))
      .filter((s) => s.userId && s.sessionId)
  : [];
// 同一 case 若同时有首跑与重跑，后者（b）优先
const states = [...statesAll]
  .sort((a, b) => a.file.localeCompare(b.file))
  .filter((s, i, arr) => !arr.slice(i + 1).some((t) => t.file.match(/^f\d+/)[0] === s.file.match(/^f\d+/)[0]));

const summary = [];
for (const st of states) {
  const caseId = st.file.match(/^f\d+/)[0];
  if (existsSync(resolve(outDir, `${caseId}.json`)) && process.argv.includes('--skip-existing')) continue;

  const logs = await prisma.virtual_session_logs.findMany({
    where: { sessionId: st.sessionId },
    orderBy: { id: 'asc' },
    select: { id: true, payload: true, createdAt: true },
  });
  const figures = [];
  const phases = [];
  for (const row of logs) {
    let parsed;
    try { parsed = JSON.parse(row.payload); } catch { continue; }
    const out = parsed?.details?.output ?? {};
    if (out?.aiResponse) {
      phases.push({
        at: parsed.timestamp || row.createdAt.toISOString(),
        phase: parsed.phase,
        reply: out.aiResponse,
        knowledgePoint: out.knowledgePoint || null,
      });
    }
    for (const fig of findFigures(out)) {
      figures.push({ at: parsed.timestamp || row.createdAt.toISOString(), ...fig });
    }
  }

  const sessions = await prisma.teaching_sessions.findMany({
    where: { userId: st.userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, topic: true, taskType: true, mode: true, status: true, createdAt: true, startTime: true },
  });
  const lessons = [];
  for (const s of sessions) {
    const msgs = await prisma.teaching_session_messages.findMany({
      where: { sessionId: s.id },
      orderBy: { id: 'asc' },
      select: { payload: true },
    });
    lessons.push({
      ...s,
      createdAt: s.createdAt.toISOString(),
      startTime: s.startTime.toISOString(),
      messages: msgs.map((m) => {
        try { const p = JSON.parse(m.payload); return { role: p.role, content: p.content, timestamp: p.timestamp }; }
        catch { return { role: '?', content: m.payload }; }
      }),
      figures: figures.filter((f) => f.at >= s.createdAt.toISOString()),
    });
  }

  const vs = await prisma.virtual_sessions.findUnique({
    where: { id: st.sessionId },
    select: { stageResults: true, status: true, currentStage: true },
  });

  const payload = {
    caseId,
    learnerName: st.learnerName,
    profileId: st.profileId,
    userId: st.userId,
    sessionId: st.sessionId,
    sessionStatus: vs?.status ?? null,
    stage: vs?.currentStage ?? null,
    lessonCount: lessons.length,
    figureCount: figures.length,
    phases,
    lessons,
  };
  writeFileSync(resolve(outDir, `${caseId}.json`), JSON.stringify(payload, null, 1));
  summary.push({ caseId, name: st.learnerName, lessons: lessons.length, figures: figures.length, phases: phases.length });
  console.log(`[${caseId}] lessons=${lessons.length} figures=${figures.length} turns=${phases.length}`);
}

writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
await prisma.$disconnect();
