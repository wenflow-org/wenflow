/**
 * 白板模式探针（2026-10-27）：验证「先定板书 → 老师看着真板说话」能否根治 V8 的三大死结。
 *
 * 与 versioned-probe 的区别：那边一次调用里既写话术又凑 spec（图教合一）；
 * 这边每轮拆成两次调用，顺序固定：
 *   ① board-designer：只画板（提问态：骨架 + 留白，不写结论）
 *   ② 归一化 + 图闸 → 得到「板上真实可见」的 verified board
 *   ③ teaching-turn：拿 describeBoardForTeacher() 的文本，看着真板说话（不再画图）
 * 第 2 轮学生答对 → 代码判定 filledSlot → reveal（同一块板切完整态）→ 老师看着完整板反馈。
 *
 * 用法：npx ts-node --transpile-only scripts/board-probe.ts <cases.json> <out.json> [concurrency=2]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeTeachingFigureForProbe } from '../src/skills/teaching-turn';
import {
  openBoard,
  describeBoardForTeacher,
  diffBoardStages,
  boardFigureForRender,
  type BoardState,
} from '../src/services/ai-teaching/board-state';
import { decideBoardOp, applyBoardOp, describeBoardOp } from '../src/services/ai-teaching/board-controller';
import { FIGURE_KIND_GUIDE, buildVisualOpportunity } from '../src/services/ai-teaching/teaching-visual.service';

const [casesPath, outPath, concRaw] = process.argv.slice(2);
if (!casesPath || !outPath) throw new Error('用法: board-probe <cases.json> <out.json> [concurrency=2]');
const CONCURRENCY = Math.max(1, Number(concRaw) || 2);

const KEY = readFileSync(process.env.WF_VISION_KEY_FILE || join(tmpdir(), 'wf-vis-key'), 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_PROBE_MODEL || 'deepseek-v4.1-flash';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const teachingMd = readFileSync(join(__dirname, '..', '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
const teachingSystem = teachingMd.replace(/^---[\s\S]*?---\s*/, '');

const BOARD_SYSTEM = `你是一位课堂板书的绘图员。你只负责画一张白板，不负责讲课。

任务：根据给定的课堂上下文，产出这一块白板的 figure JSON。白板会一直留在学生眼前，随着教学推进揭晓。

硬约束：
1. 只输出 JSON：{"figure":{"kind":"...","spec":{...}}}，不要任何解释。
2. 画的是**完整形态**：骨架 + 正确答案 + 结论都要写全（系统会自动派生出「提问态」：
   把答案位挖成 ?、把结论藏起来，学生答对后再揭晓）。**不要**自己留 ?，也不要为了留白而写半截。
3. 图里每个标签必须是学科实体（数值/单位/术语/公式），不要写"第一步/自查/待填"这类元话术。
4. 图型必须承载关系（位置/数值/区间/指向/包含/并排对照/分帧推进）；只是把句子装进框的，不要画。
5. 标签 ≤18 字（英文句子可到 26 字），化学式用 Unicode 下标（H₂O）。
6. **板上必须包含学生当前问题所涉及的对象**：学生问「立木为信」，板上就必须有这一格；
   缺了这一格，老师只能含糊地说「变法前」，学生的问题在板上无处安放。
7. **否定的关系也要有形状**：概念图里「深度不影响浮力」「重力不影响浮力」这类无关关系，
   用 tone:"neutral" + dash:true 明确画出来（虚线灰线），并与「决定」的实线分开——
   否则学生只看到四个因素都连向浮力，读出来的就是反的。
8. 同一句结论不要写两遍：行里已经写了具体数值/结论，就不要再在最后一行重复一遍。

${FIGURE_KIND_GUIDE}`;

async function callModel(system: string, payload: unknown, attempts = 4): Promise<any> {
  let lastErr = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const json: any = await res.json();
      const raw = String(json?.choices?.[0]?.message?.content ?? '').trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced ? fenced[1] : raw;
      const start = candidate.indexOf('{');
      if (start < 0) throw new Error(`no json: ${candidate.slice(0, 100)}`);
      let depth = 0;
      let end = -1;
      let inStr = false;
      let esc = false;
      for (let k = start; k < candidate.length; k += 1) {
        const ch = candidate[k];
        if (esc) { esc = false; continue; }
        if (ch === String.fromCharCode(92)) { esc = true; continue; }
        if (ch === '"') inStr = !inStr;
        if (inStr) continue;
        if (ch === '{') depth += 1;
        if (ch === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
      }
      return JSON.parse(candidate.slice(start, end > start ? end + 1 : undefined));
    } catch (err) {
      lastErr = String((err as Error)?.message || err);
      // 504/429 都是上游池压力：退避拉长（5s/10s/20s），最后一轮不再等
      if (i < attempts - 1) await sleep(5000 * (i + 1) + i * 2000);
    }
  }
  throw new Error(lastErr || 'call failed');
}

/** 确定性检查：老师这轮的话有没有「指着空气说话」或「替学生说答案」 */
function auditTeacherReply(reply: string, board: BoardState, hiddenBefore: string[]): {
  leakHits: string[];
  phantomRefs: string[];
  restateRatio: number;
} {
  const spec = board.figure ? board.figure.maskedSpec : {};
  // 1) 泄题：回复里出现了提问态被藏起来的答案
  const leakHits = hiddenBefore.filter((h) => h.length >= 3 && reply.includes(h)).slice(0, 5);
  // 2) 指着空气：提到「第 n 行/栏/帧」但板上没有那么多
  const phantomRefs: string[] = [];
  const rows = Array.isArray((spec as any).left?.rows)
    ? (spec as any).left.rows.length
    : Array.isArray((spec as any).frames)
      ? (spec as any).frames.length
      : null;
  for (const m of reply.matchAll(/第\s*([0-9一二三四五]+)\s*(行|栏|帧|步|格)/g)) {
    const n = Number(m[1].replace(/[一二三四五]/, (c) => String('一二三四五'.indexOf(c) + 1)));
    if (rows !== null && Number.isFinite(n) && n > rows) phantomRefs.push(m[0]);
  }
  // 3) 复述率：回复与板上可见文字的二阶重合度（越高越像在把图念一遍）
  const visible = JSON.stringify(board.figure?.maskedSpec ?? '')
    .replace(/[{}[\]",:]/g, ' ')
    .replace(/\s+/g, ' ');
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
    return out;
  };
  const vb = bigrams(visible.replace(/["]/g, ''));
  const rb = bigrams(reply);
  let hit = 0;
  rb.forEach((g) => { if (vb.has(g)) hit += 1; });
  return { leakHits, phantomRefs, restateRatio: rb.size ? Math.round((hit / rb.size) * 100) / 100 : 0 };
}

async function runCase(c: any): Promise<any> {
  const history: Array<{ role: string; content: string }> = [];
  const turns: any[] = [];
  let board: BoardState | null = null;

  // ---- 第 1 轮：建板（提问态）+ 老师看着板提问 ----
  const opp = buildVisualOpportunity(
    [{ role: 'user', content: c.turns[0].student, timestamp: '2026-10-27T00:00:00.000Z' }] as any,
    c.taskTitle,
  );
  const boardOut = await callModel(BOARD_SYSTEM, {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    studentSays: c.turns[0].student,
    kindHint: opp?.kindHint ?? c.expectKind ?? null,
    instruction: '画出这张白板的完整形态：骨架、正确答案、结论都写全（系统会自动挖空成提问态）。',
  });
  const normalized = boardOut?.figure ? normalizeTeachingFigureForProbe(boardOut.figure) : { figure: null };
  const figure = (normalized as any).figure;
  const op1 = decideBoardOp({ board: null, firstTurnOfTask: true, taskChanged: false, wantsNewBoard: !!figure });
  if (figure && op1.type === 'setup') board = openBoard(c.id, figure);

  const hiddenBefore = board?.figure ? diffBoardStages(board.figure).map((d) => d.after) : [];
  const boardContext1 = board
    ? describeBoardForTeacher(board)
    : '【白板】本任务暂无板书（图未通过校验）。请纯用语言推进，不要提及或假设任何图。';
  const t1 = await callModel(teachingSystem, {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [{ role: 'user', content: c.turns[0].student }],
    boardContext: boardContext1,
    boardAction: describeBoardOp(op1),
    instruction: '白板已经在你和学生眼前。**看图说话**：只指板上真实存在的那一处（用板上写着的标签原文，不要用「第几行」这类序号），提出一个能推动学生作答的问题。不要描述图怎么画，不要复述板上的内容，不要把空槽的答案说出来。',
  });
  turns.push({
    n: 1, stage: board?.figure?.stage ?? null, studentIn: c.turns[0].student,
    teacher: String(t1?.reply ?? ''), boardContext: boardContext1,
    audit: auditTeacherReply(String(t1?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, hiddenBefore),
  });

  // ---- 第 2 轮：学生答对 → 代码判定 filledSlot → 揭晓 → 老师看着完整板反馈 ----
  const op2 = decideBoardOp({
    board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, filledSlot: true,
  });
  if (board) board = applyBoardOp(board, op2);
  const revealedHidden = board?.figure ? diffBoardStages(board.figure).map((d) => d.after) : [];
  const boardContext2 = board ? describeBoardForTeacher(board) : '【白板】暂无板书。';
  history.push({ role: 'assistant', content: turns[0].teacher });
  const t2 = await callModel(teachingSystem, {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [...history, { role: 'user', content: c.turns[1].student }],
    boardContext: boardContext2,
    boardAction: describeBoardOp(op2),
    instruction: '学生刚才答到了关键处，白板已经揭晓（空槽补上、结论上板）。用一句话确认板上的变化，然后只问一个问题，且必须是**换条件 / 反事实 / 新数据**这三种之一——板上已经写出结论的内容一律不许再问（包括刚揭晓的那条结论），否则等于把答案又念一遍。',
  });
  turns.push({
    n: 2, stage: board?.figure?.stage ?? null, studentIn: c.turns[1].student,
    teacher: String(t2?.reply ?? ''), boardContext: boardContext2,
    // 揭晓轮之后老师引用板上答案是合法教学行为，不计泄题（只统计提问态的轮次）
    audit: { ...auditTeacherReply(String(t2?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
  });

  // ---- 第 3 轮：迁移检查（板已完整，只指板，不重画） ----
  history.push({ role: 'assistant', content: turns[1].teacher });
  const op3 = decideBoardOp({ board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false });
  if (board) board = applyBoardOp(board, op3);
  const boardContext3 = board ? describeBoardForTeacher(board) : '【白板】暂无板书。';
  const t3 = await callModel(teachingSystem, {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [...history, { role: 'user', content: c.turns[2].student }],
    boardContext: boardContext3,
    boardAction: describeBoardOp(op3),
    instruction: '白板已经完整。让学生用板上的结论做一次迁移判断：问题必须是板上**没有直接答案**的（换数据/换情境），不要重画、不要复述板面。',
  });
  turns.push({
    n: 3, stage: board?.figure?.stage ?? null, studentIn: c.turns[2].student,
    teacher: String(t3?.reply ?? ''), boardContext: boardContext3,
    audit: { ...auditTeacherReply(String(t3?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
  });

  const rendered = board ? boardFigureForRender(board) : null;
  return {
    id: c.id,
    course: c.course,
    subject: c.subject,
    topic: c.topic,
    taskTitle: c.taskTitle,
    kind: figure?.kind ?? null,
    expectKind: c.expectKind ?? null,
    routedKind: opp?.kindHint ?? null,
    boardOps: [op1.type, op2.type, op3.type],
    slots: board?.figure?.slots ?? 0,
    hiddenTakeaway: board?.figure?.hiddenTakeaway ?? null,
    maskedSpec: board?.figure?.maskedSpec ?? null,
    fullSpec: board?.figure?.fullSpec ?? null,
    finalSpec: rendered?.spec ?? null,
    turns,
    // 汇总：泄题 / 指着空气 / 复述率
    leakTotal: turns.reduce((n, t) => n + t.audit.leakHits.length, 0),
    phantomTotal: turns.reduce((n, t) => n + t.audit.phantomRefs.length, 0),
    restateMax: Math.max(...turns.map((t) => t.audit.restateRatio)),
  };
}

async function pool<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      for (;;) {
        const i = next; next += 1;
        if (i >= tasks.length) return;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

(async () => {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
  const started = Date.now();
  const rows = await pool(
    cases.map((c: any) => async () => {
      try {
        return await runCase(c);
      } catch (err) {
        const message = String((err as Error)?.message || err);
        console.log(`[${c.id}] 失败：${message.slice(0, 120)}`);
        return {
          id: c.id, course: c.course, subject: c.subject, topic: c.topic, taskTitle: c.taskTitle,
          kind: null, expectKind: c.expectKind ?? null, routedKind: null, boardOps: [],
          slots: 0, hiddenTakeaway: null, maskedSpec: null, fullSpec: null, finalSpec: null,
          turns: [], leakTotal: 0, phantomTotal: 0, restateMax: 0, error: message,
        };
      }
    }),
  );
  writeFileSync(outPath, JSON.stringify(rows, null, 1), 'utf8');
  const withBoard = rows.filter((r) => r.kind).length;
  const leak = rows.reduce((n, r) => n + r.leakTotal, 0);
  const phantom = rows.reduce((n, r) => n + r.phantomTotal, 0);
  const restate = rows.map((r) => r.restateMax);
  console.log(`\n${rows.length} 例｜建板 ${withBoard}｜泄题命中 ${leak} 处｜指着空气 ${phantom} 处｜复述率最高 ${Math.max(...restate)}`);
  console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s → ${outPath}`);
  rows.forEach((r) => console.log(`  [${r.id}] ${r.kind}｜ops=${r.boardOps.join('→')}｜slots=${r.slots}｜leak=${r.leakTotal}｜phantom=${r.phantomTotal}｜restate=${r.restateMax}`));
})();
