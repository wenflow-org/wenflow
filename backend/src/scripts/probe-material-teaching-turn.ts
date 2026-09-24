/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/* eslint-disable no-console -- 一次性验收 CLI：面向人读的输出 */
/**
 * 「资料 → 真实课堂」验收探针：在**带资料的已生成路径**上真起一节课，看
 *   ① teaching-turn 的真实 payload 里是否带 `scenario.materials`；
 *   ② 老师的回复是否真的**引用资料**（命中资料章节标题或引文片段）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-material-teaching-turn.ts [pathId]
 *   npx ts-node --transpile-only src/scripts/probe-material-teaching-turn.ts --path=lp_xxx --turns=2
 */
import 'dotenv/config';

function arg(name: string): string | null {
  const exactly = process.argv.find((item) => item === `--${name}`);
  if (exactly) return 'true';
  const prefixed = process.argv.find((item) => item.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : null;
}

const TURNS = Math.max(1, Math.min(3, Number(arg('turns') || 1) || 1));
/** 学生发言按轮次给（第 1 轮就说"我读了但不会用"，引导老师引资料）；`--msg=` 可整段覆盖（验收用） */
const STUDENT_MESSAGES = [
  arg('msg') || '我看了资料，但不太清楚该怎么用它来判断',
  arg('msg') || '那我具体该看哪一部分？能给我指一下吗',
  arg('msg') || '我试着做一次，你帮我看看对不对',
];

/**
 * 回复是否引用了资料（**可核对**）：
 *   ① 章节标题直接出现（中文资料常见）；
 *   ② **资料专有词汇**出现在回复里（英文资料 + 中文讲解时的主要形态：BFS/DFS/6.006/Graph…）；
 *   ③ 与某条引文有 ≥6 字连续片段重合。
 */
function matchMaterialReferences(reply: string, sections: string[], cites: string[]) {
  const text = String(reply || '');
  const lower = text.toLowerCase();
  const sectionHits = sections.filter((title) => title && title.length >= 2 && text.includes(title));
  const citeHits = cites.filter((cite) => String(cite)
    .split(/\s+/)
    .some((piece) => piece.length >= 6 && text.includes(piece)));
  // 资料专有词汇：来自章节标题与引文的拉丁/数字 token（长度 ≥3，排除纯停用词）
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'not', 'you', 'can', 'use', 'one', 'two', 'set', 'all', 'its', 'from', 'have']);
  const vocabulary = new Set<string>();
  for (const source of [...sections, ...cites]) {
    for (const token of String(source).split(/[^A-Za-z0-9.-]+/)) {
      const clean = token.replace(/^[.-]+|[.-]+$/g, '');
      if (clean.length >= 3 && /[A-Za-z]/.test(clean) && !stop.has(clean.toLowerCase())) {
        vocabulary.add(clean);
      }
    }
  }
  const vocabHits = Array.from(vocabulary).filter((token) => lower.includes(token.toLowerCase()));
  return { sectionHits, citeHits, vocabHits };
}

async function readLastAssistantMessage(sessionId: string): Promise<string> {
  const { default: sqlite3 } = await import('sqlite3');
  return new Promise((resolve) => {
    const db = new sqlite3.Database('prisma/dev.db', sqlite3.OPEN_READONLY);
    db.all(
      'SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY createdAt DESC LIMIT 4',
      [sessionId],
      (error: any, rows: any[]) => {
        db.close();
        if (error || !Array.isArray(rows)) return resolve('');
        for (const row of rows) {
          try {
            const payload = JSON.parse(String(row.payload || '{}'));
            if (payload?.role === 'assistant') {
              return resolve(String(payload.content || payload.text || payload.reply || ''));
            }
          } catch {
            // 跳过损坏行
          }
        }
        resolve('');
      }
    );
  });
}

async function main(): Promise<void> {
  const { default: prisma } = await import('../config/database');
  const { aiTeachingOrchestrator } = await import('../services/ai-teaching/AITeachingCoordinator');
  const { resolvePathMaterialsForTeaching } = await import('../services/ai-teaching/TeachingContextBuilder');

  // 选路径：命令行指定，否则取"最近一条带资料的路径"
  let pathId = arg('path');
  if (!pathId) {
    const rows: any[] = await (prisma as any).learning_paths.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, name: true, userId: true, aiPromptTemplate: true },
    });
    const withMaterials = rows.find((row) => resolvePathMaterialsForTeaching(row.aiPromptTemplate));
    if (!withMaterials) {
      console.error('最近 20 条路径里没有带资料的，先跑 probe-material-path-e2e.ts --generate');
      process.exitCode = 1;
      return;
    }
    pathId = withMaterials.id;
  }

  const loadPath = async () => (prisma as any).learning_paths.findUnique({
    where: { id: String(pathId) },
    include: {
      milestones: { orderBy: { stageNumber: 'asc' }, include: { subtasks: { orderBy: { order: 'asc' } } } },
    },
  });
  let path: any = await loadPath();
  if (!path) {
    console.error(`路径不存在：${pathId}`);
    process.exitCode = 1;
    return;
  }
  // stage-design 是核心路径落库后的后台任务：这里等它把任务写出来（最多 150s）
  const waitMs = Number(arg('waitMs') || 150000);
  const deadline = Date.now() + waitMs;
  while (!path.milestones?.[0]?.subtasks?.[0] && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    path = await loadPath();
  }
  const materials = resolvePathMaterialsForTeaching(path.aiPromptTemplate) || [];
  const sections = materials.flatMap((material: any) => (material.sections || []).map((s: any) => String(s.title || '')));
  const cites = materials.flatMap((material: any) => (material.keyPoints || []).map((p: any) => String(p.cite || '')));
  console.log(`[课堂] path=${path.id}｜${path.name}`);
  console.log(`[课堂] 资料：${materials.length} 包｜章节 ${sections.length}｜要点 ${cites.length}`);
  console.log(`[课堂] 章节示例：${sections.slice(0, 6).join(' / ')}`);

  const firstTask = path.milestones?.[0]?.subtasks?.[0];
  if (!firstTask) {
    console.error('该路径还没有任务（stage-design 可能仍在跑），稍后重试');
    process.exitCode = 1;
    return;
  }  console.log(`[课堂] 任务：${firstTask.title}`);

  const started: any = await aiTeachingOrchestrator.startSession({ userId: path.userId, taskId: firstTask.id } as any);
  const sessionId = started?.sessionId || started?.id;
  console.log(`[课堂] 会话 ${sessionId}｜返回字段：${Object.keys(started || {}).join(',')}`);
  console.log(`[课堂] 开场：${String(started?.opening?.reply || started?.opening?.content || started?.reply || '').slice(0, 240)}`);

  // 课堂写入需要 revision（乐观并发）：每轮前重新读取
  const readRevision = async (): Promise<number | undefined> => {
    const detail: any = await aiTeachingOrchestrator.getSessionDetail(sessionId, path.userId);
    return detail?.revision ?? detail?.session?.revision;
  };
  let revision: number | undefined = started?.revision ?? (await readRevision());

  for (let turn = 0; turn < TURNS; turn += 1) {
    const message = STUDENT_MESSAGES[Math.min(turn, STUDENT_MESSAGES.length - 1)];
    const result: any = await aiTeachingOrchestrator.processStudentMessage(sessionId, message, { expectedRevision: revision } as any);
    revision = (await readRevision()) ?? revision;
    // 返回形状随实现变动：以**库里的真实消息**为准（老师实际说了什么）
    const reply = (await readLastAssistantMessage(sessionId))
      || String(result?.reply || result?.message || result?.userVisible || '');
    console.log(`\n[课堂] 学生(${turn + 1})：${message}`);
    console.log(`[课堂] 老师(${turn + 1})：${reply.slice(0, 320)}`);
    const hit = matchMaterialReferences(reply, sections, cites);
    console.log(`   ⇢ 引用资料：章节命中 ${hit.sectionHits.length}｜原文片段命中 ${hit.citeHits.length}｜资料词汇命中 ${hit.vocabHits.length}${hit.vocabHits.length ? `（${hit.vocabHits.slice(0, 8).join('、')}）` : ''}`);
    // 教学配图（owner 口径 2026-09-23：图片是一种特殊的文字）：老师临场请求 → 代码闸门 → 内联一张图
    const images = Array.isArray(result?.images) ? result.images : [];
    if (images.length) {
      console.log(`   ⇢ 教学配图：${images.length} 张｜kind=${images.map((i: any) => String(i.kind || '-')).join('、')}｜caption=${String(images[0]?.caption || '-')}`);
      console.log(`     生图 prompt（图 = 这段文字的渲染）：${String(images[0]?.prompt || '').slice(0, 160)}`);
      console.log(`     url：${String(images[0]?.url || '').slice(0, 120)}`);
    } else {
      console.log('   ⇢ 教学配图：0 张（本轮老师没请求，或未过闸门）');
    }
  }

  // 真实 payload 是否带 scenario.materials
  const call: any = await new Promise((resolve) => {
    import('sqlite3').then(({ default: sqlite3 }) => {
      const db = new sqlite3.Database('prisma/dev.db', sqlite3.OPEN_READONLY);
      db.get(
        "SELECT success, LENGTH(userPayload) AS len, userPayload FROM prompt_call_logs WHERE agentId='skill:teaching-turn' ORDER BY createdAt DESC LIMIT 1",
        (error: any, row: any) => {
          db.close();
          resolve(error ? null : row);
        }
      );
    });
  });
  if (call) {
    const payload = String(call.userPayload || '');
    const idx = payload.indexOf('"materials"');
    console.log(`\n[课堂] 最近一次 teaching-turn payload：success=${call.success} len=${call.len}｜含 materials：${idx > 0}`);
    if (idx > 0) console.log(`   片段：${payload.slice(idx, idx + 200).replace(/\s+/g, ' ')}`);
  }

  await (prisma as any).$disconnect();
}

void main().catch((error) => {
  console.error('[课堂] 失败', error);
  process.exitCode = 1;
});
