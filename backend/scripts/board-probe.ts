/**
 * 白板模式探针（2026-10-27）：验证两种定位下白板的表现。
 *
 * 两种定位（第 4 个参数 `mode`）：
 *   full      做题区：绘图员画完整板 → 系统挖空成提问态 → 学生答对后揭晓
 *   takeaway  减负区：材料与副标注完整上板，只把结论句留给对话（推荐默认）
 *   none      纯参考板：连结论句也上板
 *
 * 减负口径下的动作序列是「上板 → 换板 → 不动」：老师换了新数据就用新 figure 换板，
 * 白板要永远替学生记住「现在讨论的现场」。做题区口径保留 reveal。
 *
 * 与 versioned-probe 的区别：那边一次调用里既写话术又凑 spec（图教合一）；
 * 这边每轮拆成两次调用，顺序固定：
 *   ① board-designer：只画板
 *   ② 归一化 + 图闸 → 得到「板上真实可见」的 verified board
 *   ③ teaching-turn：拿 describeBoardForTeacher() 的文本，看着真板说话（不再画图）
 *
 * 用法：npx ts-node --transpile-only scripts/board-probe.ts <cases.json> <out.json> [concurrency=2] [mode=full|takeaway|none]
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
  type BoardConcealMode,
} from '../src/services/ai-teaching/board-state';
import { decideBoardOp, applyBoardOp, describeBoardOp, hasNewNumbers } from '../src/services/ai-teaching/board-controller';
import { FIGURE_KIND_GUIDE, buildVisualOpportunity } from '../src/services/ai-teaching/teaching-visual.service';

const [casesPath, outPath, concRaw, modeRaw] = process.argv.slice(2);
if (!casesPath || !outPath) throw new Error('用法: board-probe <cases.json> <out.json> [concurrency=2] [mode=full|takeaway|none]');
const CONCURRENCY = Math.max(1, Number(concRaw) || 2);
const MODE = (['full', 'takeaway', 'none'].includes(String(modeRaw)) ? modeRaw : 'full') as BoardConcealMode;
const CONCEAL = { conceal: MODE };
const MASKED = MODE === 'full';

const KEY = readFileSync(process.env.WF_VISION_KEY_FILE || join(tmpdir(), 'wf-vis-key'), 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_PROBE_MODEL || 'deepseek-v4.1-flash';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const teachingMd = readFileSync(join(__dirname, '..', '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
const teachingSystem = teachingMd.replace(/^---[\s\S]*?---\s*/, '');

/**
 * 板书提示词从 prompts/skill.board-designer.md 取（与 teaching-turn 同一套约定）：
 * 文件里用 `<!-- mode:load -->` / `<!-- mode:full -->` 标记两套口径的补充段，
 * 这里按当前口径挑一段拼上图型指南。提示词只有一份，改提示词不用改脚本。
 */
const boardMd = readFileSync(join(__dirname, '..', '..', 'prompts', 'skill.board-designer.md'), 'utf8');
const boardShared = boardMd.replace(/^---[\s\S]*?---\s*/, '');
// 用 indexOf 切段而不是正则：标记两侧是 HTML 注释，正则里 `[\s\S]` 在多层转义下容易写坏
const sectionOf = (tag: string): string => {
  const open = `<!-- mode:${tag} -->`;
  const close = `<!-- /mode:${tag} -->`;
  const a = boardMd.indexOf(open);
  const b = boardMd.indexOf(close);
  return a >= 0 && b > a ? boardMd.slice(a + open.length, b) : '';
};
const BOARD_SYSTEM = (mode: BoardConcealMode) =>
  `${boardShared.replace(/<!--\s*\/?mode:[a-z]+\s*-->/g, '')}\n${sectionOf(mode === 'full' ? 'full' : 'load')}\n\n${FIGURE_KIND_GUIDE}`;

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
  const boardOut = await callModel(BOARD_SYSTEM(MODE), {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    studentSays: c.turns[0].student,
    kindHint: opp?.kindHint ?? c.expectKind ?? null,
    instruction: MASKED
      ? '画出这张白板的完整形态：骨架、正确答案、结论都写全（系统会自动挖空成提问态）。'
      : '画出这张白板的完整形态：骨架、步骤、数值、单位、副标注都写全，一个 ? 都不要留。标题只点题，不写结论。',
  });
  const normalized = boardOut?.figure ? normalizeTeachingFigureForProbe(boardOut.figure) : { figure: null };
  const figure = (normalized as any).figure;
  const op1 = decideBoardOp({ board: null, firstTurnOfTask: true, taskChanged: false, wantsNewBoard: !!figure });
  if (figure && op1.type === 'setup') board = openBoard(c.id, figure, CONCEAL);

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
    instruction: MASKED
      ? '白板已经在你和学生眼前。**看图说话**：只指板上真实存在的那一处（用板上写着的标签原文，不要用「第几行」这类序号），提出一个能推动学生作答的问题。不要描述图怎么画，不要复述板上的内容，不要把空槽的答案说出来。'
      : '白板已经在你和学生眼前，板面信息是完整的，学生不需要你再用语言交代一遍。**不要复述板面**（不要念行、念步骤、念数值），只指板上真实存在的那一处（用板上写着的标签原文），用 2~3 句话提出一个需要学生推理的问题。不要描述图怎么画，也不要把板面结论替学生说出来。',
  });
  turns.push({
    n: 1, stage: board?.figure?.stage ?? null, studentIn: c.turns[0].student,
    teacher: String(t1?.reply ?? ''), boardContext: boardContext1,
    boardOp: op1.type,
    // 每轮把「当时下发给学生的那块板」存下来：减负模式下板会随例子刷新，
    // 只看最终态会丢掉「老师换题 → 板跟着换」这一段的证据
    boardSpec: board?.figure?.maskedSpec ?? null,
    audit: auditTeacherReply(String(t1?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, hiddenBefore),
  });

  // ---- 第 2 轮：学生答到了关键处 ----
  // 做题区：答对 → 揭晓同一块板。
  // 减负区：板面本来就完整，没有揭晓；只判断老师是不是换了现场（学生带来新数值）→ 换板。
  const newEx2 = !!board?.figure && hasNewNumbers(board.figure.maskedSpec, c.turns[1].student);
  const op2 = decideBoardOp({
    board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, filledSlot: true, newExample: newEx2,
  });
  if (board && op2.type === 'update') {
    const nextOut = await callModel(BOARD_SYSTEM(MODE), {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      studentSays: c.turns[1].student,
      kindHint: board.figure?.kind ?? null,
      instruction:
        '学生带来了新数据/新条件。把同一结构的板换成**当前这组条件**（新数值、新单位），' +
        '结构和图型都不变；材料、步骤、副标注照样写全，标题只点题。',
    });
    const nextFig = nextOut?.figure ? (normalizeTeachingFigureForProbe(nextOut.figure) as any).figure : null;
    board = applyBoardOp(board, op2, nextFig ?? undefined) ?? board;
  } else if (board) {
    board = applyBoardOp(board, op2) ?? board;
  }
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
    instruction: MASKED
      ? '学生刚才答到了关键处，白板已经揭晓（空槽补上、结论上板）。用一句话确认板上的变化，然后只问一个问题，且必须是**换条件 / 反事实 / 新数据**这三种之一——板上已经写出结论的内容一律不许再问（包括刚揭晓的那条结论），否则等于把答案又念一遍。'
      : '学生刚才答到了关键处。板面本来就是完整的，**不要再补充或复述板面**；只问一个问题，且必须是**换条件 / 反事实 / 新数据**这三种之一。如果这组新数据已经上板（boardAction 说「换成了当前这组条件」），就让学生直接用板上的新数据往下推。',
  });
  turns.push({
    n: 2, stage: board?.figure?.stage ?? null, studentIn: c.turns[1].student,
    teacher: String(t2?.reply ?? ''), boardContext: boardContext2,
    boardOp: op2.type,
    newExample: newEx2,
    boardSpec: board?.figure?.maskedSpec ?? null,
    // 揭晓/换板轮老师引用板上答案是合法教学行为，不计泄题（只统计提问态的轮次）
    audit: { ...auditTeacherReply(String(t2?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
  });

  // ---- 第 3 轮：迁移检查（板已完整，只指板；若又换了现场则再换一次板） ----
  history.push({ role: 'assistant', content: turns[1].teacher });
  const newEx3 = !!board?.figure && hasNewNumbers(board.figure.maskedSpec, c.turns[2].student);
  const op3 = decideBoardOp({
    board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, newExample: newEx3,
  });
  if (board && op3.type === 'update') {
    const nextOut = await callModel(BOARD_SYSTEM(MODE), {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      studentSays: c.turns[2].student,
      kindHint: board.figure?.kind ?? null,
      instruction:
        '学生把问题挪到了新情境。把同一结构的板换成**当前这组条件**（新对象/新液体/新数值），' +
        '结构和图型都不变；材料、步骤、副标注照样写全，标题只点题。',
    });
    const nextFig = nextOut?.figure ? (normalizeTeachingFigureForProbe(nextOut.figure) as any).figure : null;
    board = applyBoardOp(board, op3, nextFig ?? undefined) ?? board;
  } else if (board) {
    board = applyBoardOp(board, op3) ?? board;
  }
  const boardContext3 = board ? describeBoardForTeacher(board) : '【白板】暂无板书。';
  const t3 = await callModel(teachingSystem, {
    task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [...history, { role: 'user', content: c.turns[2].student }],
    boardContext: boardContext3,
    boardAction: describeBoardOp(op3),
    instruction: '白板已经完整（必要时已换成当前情境）。让学生用板上的结论做一次迁移判断：问题必须是板上**没有直接答案**的，不要重画、不要复述板面。',
  });
  turns.push({
    n: 3, stage: board?.figure?.stage ?? null, studentIn: c.turns[2].student,
    teacher: String(t3?.reply ?? ''), boardContext: boardContext3,
    boardOp: op3.type,
    newExample: newEx3,
    boardSpec: board?.figure?.maskedSpec ?? null,
    audit: { ...auditTeacherReply(String(t3?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
  });

  const rendered = board ? boardFigureForRender(board) : null;
  return {
    id: c.id,
    course: c.course,
    subject: c.subject,
    topic: c.topic,
    taskTitle: c.taskTitle,
    mode: MODE,
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
          mode: MODE, kind: null, expectKind: c.expectKind ?? null, routedKind: null, boardOps: [],
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
  console.log(`\n[${MODE}] ${rows.length} 例｜建板 ${withBoard}｜泄题命中 ${leak} 处｜指着空气 ${phantom} 处｜复述率最高 ${Math.max(...restate)}`);
  console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s → ${outPath}`);
  rows.forEach((r) => console.log(`  [${r.id}] ${r.kind}｜ops=${r.boardOps.join('→')}｜slots=${r.slots}｜leak=${r.leakTotal}｜phantom=${r.phantomTotal}｜restate=${r.restateMax}`));
})();
