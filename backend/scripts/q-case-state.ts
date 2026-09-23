/* eslint-disable no-console */
/** 只读：打印某 case 学习者的 session / 任务 / 痕迹状态 */
import 'dotenv/config';
import prisma from '../src/config/database';

const SESSION = process.argv.find((a) => a.startsWith('--session='))?.slice('--session='.length)
  || '4ad73905-8a0b-48e4-84a5-09c218c2ffff';

async function main() {
  const p = prisma as any;
  const s = await p.virtual_sessions.findUnique({ where: { id: SESSION } });
  console.log('session:', JSON.stringify({ id: s?.id, status: s?.status, stage: s?.currentStage, path: s?.learningPathId, task: s?.currentTaskId }));
  if (!s) return;
  const path = await p.learning_paths.findUnique({ where: { id: s.learningPathId }, select: { id: true, userId: true, title: true, status: true } });
  console.log('path:', JSON.stringify(path));

  const tasks = await p.subtasks.findMany({ where: { userId: path.userId }, orderBy: { order: 'asc' }, select: { id: true, title: true, status: true, cognitiveLoad: true } });
  console.log('\nsubtasks:', tasks.length);
  for (const t of tasks) console.log(`  [${t.status}] ${String(t.title).slice(0, 40)}`);

  const traces = await p.memory_traces.findMany({ where: { userId: path.userId }, select: { label: true, conceptId: true, stability: true, masteryScore: true, extractionCount: true } });
  console.log('\ntraces:', traces.length);
  for (const t of traces) console.log(`   ${t.label} | cid=${t.conceptId ?? '—'} | stab=${t.stability} | mastery=${t.masteryScore} | n=${t.extractionCount}`);

  const mc = await p.misconception_ledger.findMany({ where: { userId: path.userId }, select: { canonicalLabel: true, occurrenceCount: true, resolvedAt: true } });
  console.log('\nmisconceptions:', mc.length);
  for (const m of mc) console.log(`   ${m.canonicalLabel} | x${m.occurrenceCount} | resolved=${m.resolvedAt ? 'y' : 'n'}`);

  const sessions = await p.virtual_sessions.findMany({ where: { virtualProfileId: s.virtualProfileId }, select: { id: true, status: true, currentStage: true, createdAt: true } });
  console.log('\nsessions of profile:', sessions.length);
  for (const x of sessions) console.log(`   ${x.id.slice(0, 8)} ${x.status} ${x.currentStage} ${x.createdAt?.toISOString?.()}`);
}
main().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
