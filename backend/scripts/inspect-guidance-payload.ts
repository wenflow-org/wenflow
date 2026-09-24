/** 只读：检查 adaptive-guidance-copy 真实载荷结构（供 D5 写准规则里的字段路径） */
import 'dotenv/config';
import prisma from '../src/config/database';

function shape(value: unknown, depth = 0): unknown {
  if (depth > 2) return typeof value;
  if (Array.isArray(value)) return [`[${value.length}]`, value.length ? shape(value[0], depth + 1) : null];
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shape(v, depth + 1);
    return out;
  }
  return typeof value;
}

async function main() {
  const row = await prisma.prompt_call_logs.findFirst({
    where: { agentId: 'skill:adaptive-guidance-copy', success: true },
    select: { userPayload: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const parsed = row?.userPayload ? JSON.parse(row.userPayload) : null;
  console.log('createdAt =', row?.createdAt?.toISOString());
  console.log('顶层键 =', parsed ? Object.keys(parsed).join(', ') : '(无载荷)');
  console.log('\n载荷结构（3 层）：');
  console.log(JSON.stringify(shape(parsed), null, 2));
  const learner = parsed?.learner;
  console.log('\nlearner 顶层键 =', learner && typeof learner === 'object' ? Object.keys(learner).join(', ') : '(无)');
  console.log('learningState 顶层键 =', parsed?.learningState && typeof parsed.learningState === 'object' ? Object.keys(parsed.learningState).join(', ') : '(无)');
  console.log('learner.knowledgeMemory 键 =', parsed?.learner?.knowledgeMemory ? Object.keys(parsed.learner.knowledgeMemory).join(', ') : '(无)');
  const cp = parsed?.learner?.knowledgeMemory?.currentPath;
  console.log('learner.knowledgeMemory.currentPath 键 =', cp ? Object.keys(cp).join(', ') : '(无)');
  console.log('currentPath.progress 键 =', cp?.progress ? Object.keys(cp.progress).join(', ') : '(无)');
  console.log('currentPath.progress.tasks =', JSON.stringify(cp?.progress?.tasks ?? null));
  console.log('learner.profile.narratives 键 =', parsed?.learner?.profile?.narratives ? Object.keys(parsed.learner.profile.narratives).join(', ') : '(无)');
  console.log('learningSignal 候选 =', JSON.stringify(parsed?.learner?.profile?.narratives?.learningSignal ?? parsed?.learner?.profile?.learningSignal ?? null));
  const findTasks = (obj: any, path = '', hits: string[] = [], depth = 0): string[] => {
    if (depth > 6 || !obj || typeof obj !== 'object') return hits;
    for (const [k, v] of Object.entries(obj)) {
      const np = path ? `${path}.${k}` : k;
      if (k === 'tasks') hits.push(np);
      findTasks(v, np, hits, depth + 1);
    }
    return hits;
  };
  console.log('载荷里所有 tasks 路径 =', findTasks(parsed).join(' | ') || '(无)');
  console.log('learningState.tasks =', JSON.stringify(parsed?.learningState?.tasks));
  const findKey = (obj: any, key: string, path = '', hits: string[] = [], depth = 0): string[] => {
    if (depth > 7 || !obj || typeof obj !== 'object') return hits;
    for (const [k, v] of Object.entries(obj)) {
      const np = path ? `${path}.${k}` : k;
      if (k === key) hits.push(`${np} = ${JSON.stringify(v)}`);
      findKey(v, key, np, hits, depth + 1);
    }
    return hits;
  };
  console.log('learningSignal 真实路径 =', findKey(parsed, 'learningSignal').join(' | ') || '(载荷中不存在)');
  console.log('advisory 键 =', parsed?.advisory ? Object.keys(parsed.advisory).join(', ') : '(无)');
  console.log('learner.profile.preferences =', JSON.stringify(parsed?.learner?.profile?.preferences));
  console.log('learner.profile.learning 键 =', parsed?.learner?.profile?.learning ? Object.keys(parsed.learner.profile.learning).join(', ') : '(无)');
  console.log('learner.profile.learning =', JSON.stringify(parsed?.learner?.profile?.learning));
  const findKeyLike = (obj: any, re: RegExp, path = '', hits: string[] = [], depth = 0): string[] => {
    if (depth > 7 || !obj || typeof obj !== 'object') return hits;
    for (const [k, v] of Object.entries(obj)) {
      const np = path ? `${path}.${k}` : k;
      if (re.test(k)) hits.push(`${np}=${JSON.stringify(v)?.slice(0, 80)}`);
      findKeyLike(v, re, np, hits, depth + 1);
    }
    return hits;
  };
  console.log('含 signal/prefer/交付 的键 =', findKeyLike(parsed, /signal|prefer|Prefer/i).join(' | ') || '(无)');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
