/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/* eslint-disable no-console -- 一次性验收 CLI：面向人读的输出 */
/**
 * 「教学配图时机」课程跑批：按**任务**逐节走一遍课堂，看老师会不会为「用文字讲不直观」的内容**主动**配图。
 *
 * 与"学生明确要图"的验收不同：这里的学生发言是**自然的**（不说"画个图"），
 * 用来观察**时机**——即"这类内容老师会不会自己想到给图"。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-teaching-visual-courses.ts --path=lp_xxx [--tasks=3] [--turns=2]
 *   npx ts-node --transpile-only src/scripts/probe-teaching-visual-courses.ts --all [--tasks=2]   # 扫最近带资料的路径
 *
 * 输出：每个任务一行（是否出图 / caption / 生图 prompt），末尾给汇总。
 */
import 'dotenv/config';

function arg(name: string): string | null {
  const exact = process.argv.find((item) => item === `--${name}`);
  if (exact) return 'true';
  const prefixed = process.argv.find((item) => item.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const TASKS = Math.max(1, Math.min(12, Number(arg('tasks') || 3) || 3));
const TURNS = Math.max(1, Math.min(3, Number(arg('turns') || 2) || 2));
const PATH_ARG = arg('path');
const SCAN_ALL = hasFlag('all');

/** 自然的学生发言（**不提"画图"**）：先"没概念"，再"脑子里乱"，最后"试着说" */
const STUDENT_MESSAGES = [
  arg('msg') || '这块我有点没概念，你能给我讲讲吗',
  arg('msg') || '我大概听懂了，但脑子里有点乱，理不太清',
  arg('msg') || '让我试着说一下，你看看对不对',
];

interface TaskImageRecord {
  task: string;
  turns: number;
  images: Array<{ url: string; caption: string | null; prompt: string; kind: string | null }>;
  replyExcerpts: string[];
}

async function runPath(pathId: string, prisma: any, orchestrator: any): Promise<{ path: any; records: TaskImageRecord[] }> {
  const path = await prisma.learning_paths.findUnique({
    where: { id: pathId },
    include: { milestones: { orderBy: { stageNumber: 'asc' }, include: { subtasks: { orderBy: { order: 'asc' } } } } },
  });
  if (!path) throw new Error(`路径不存在：${pathId}`);
  const tasks = (path.milestones || []).flatMap((m: any) => m.subtasks || []).slice(0, TASKS);
  const records: TaskImageRecord[] = [];

  console.log(`\n########## ${path.name}（${pathId}）｜任务 ${tasks.length}/${(path.milestones || []).flatMap((m: any) => m.subtasks || []).length} ##########`);
  for (const task of tasks) {
    const record: TaskImageRecord = { task: task.title, turns: 0, images: [], replyExcerpts: [] };
    try {
      const started: any = await orchestrator.startSession({ userId: path.userId, taskId: task.id } as any);
      const sessionId = started?.sessionId || started?.id;
      const readRevision = async (): Promise<number | undefined> => {
        const detail: any = await orchestrator.getSessionDetail(sessionId, path.userId);
        return detail?.revision ?? detail?.session?.revision;
      };
      let revision: number | undefined = started?.revision ?? (await readRevision());
      for (let turn = 0; turn < TURNS; turn += 1) {
        const message = STUDENT_MESSAGES[Math.min(turn, STUDENT_MESSAGES.length - 1)];
        const result: any = await orchestrator.processStudentMessage(sessionId, message, { expectedRevision: revision } as any);
        revision = (await readRevision()) ?? revision;
        record.turns += 1;
        record.replyExcerpts.push(String(result?.aiResponse || '').slice(0, 120));
        const images = Array.isArray(result?.images) ? result.images : [];
        for (const image of images) {
          record.images.push({ url: String(image.url || ''), caption: image.caption ?? null, prompt: String(image.prompt || ''), kind: image.kind ?? null });
        }
      }
    } catch (error) {
      record.replyExcerpts.push(`[跑批失败] ${error instanceof Error ? error.message : String(error)}`);
    }
    records.push(record);
    const flag = record.images.length ? `✅ ${record.images.length} 张` : '— 未出图';
    console.log(`  【${task.title}】${flag}`);
    for (const image of record.images) {
      console.log(`      caption: ${image.caption || '-'}`);
      console.log(`      prompt : ${image.prompt.slice(0, 150)}`);
      console.log(`      url    : ${image.url.slice(0, 110)}`);
    }
  }
  return { path, records };
}

async function main(): Promise<void> {
  const { default: prisma } = await import('../config/database');
  const { aiTeachingOrchestrator } = await import('../services/ai-teaching/AITeachingCoordinator');
  const { resolvePathMaterialsForTeaching } = await import('../services/ai-teaching/TeachingContextBuilder');

  let pathIds: string[] = [];
  if (PATH_ARG) {
    pathIds = [PATH_ARG];
  } else if (SCAN_ALL) {
    const rows: any[] = await (prisma as any).learning_paths.findMany({ orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, aiPromptTemplate: true } });
    pathIds = rows.filter((row) => resolvePathMaterialsForTeaching(row.aiPromptTemplate)).map((row) => row.id);
  } else {
    console.error('用法：--path=lp_xxx 或 --all');
    process.exitCode = 1;
    return;
  }

  const summary: Array<{ path: string; task: string; images: number }> = [];
  for (const pathId of pathIds) {
    try {
      const { path, records } = await runPath(pathId, prisma, aiTeachingOrchestrator);
      for (const record of records) summary.push({ path: path.name, task: record.task, images: record.images.length });
    } catch (error) {
      console.error(`[跑批失败] ${pathId}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n================ 汇总 ================');
  const total = summary.length;
  const withImage = summary.filter((item) => item.images > 0).length;
  console.log(`任务 ${total} 个｜出图任务 ${withImage} 个｜共出图 ${summary.reduce((sum, item) => sum + item.images, 0)} 张`);
  for (const item of summary) console.log(`  ${item.images > 0 ? '✅' : '  '} ${item.path} ｜ ${item.task} ｜ ${item.images} 张`);
}

void main().catch((error) => {
  console.error('[跑批] 失败', error);
  process.exitCode = 1;
});
