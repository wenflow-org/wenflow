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
  extractHiddenConclusion,
  boardFigureForRender,
  type BoardState,
  type BoardConcealMode,
} from '../src/services/ai-teaching/board-state';
import { decideBoardOp, applyBoardOp, describeBoardOp, hasNewNumbers } from '../src/services/ai-teaching/board-controller';
import { decideBoardIntent, numbersOnBoard, describeIntentForTeacher, type BoardIntent } from '../src/services/ai-teaching/board-intent';
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
          // temperature=0 下同一条消息会稳定复现同一种错误（例如模型改画 ASCII 表格）：
          // 重试必须换一条纠偏消息并稍微升温，否则 4 次重试等于只跑 1 次。
          temperature: i === 0 ? 0 : 0.35,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
            ...(i === 0
              ? []
              : [{
                  role: 'user',
                  content:
                    '你上一条回复不是可解析的 JSON。不要画 ASCII 图、不要 Markdown 表格、不要解释。' +
                    '只输出一个 JSON 对象：{"figure":{"kind":"...","spec":{...}}}，与上面要求的图型契约一致。',
                }]),
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

/**
 * 方案 A（2026-10-27 复盘后）：老师先说，系统再按老师这一轮的话刷新板。
 *
 * 旧的「先画板、后说话」在换题轮必然错位：第 t 轮的板用的是第 t-1 轮老师的话，
 * 而第 t 轮老师已经在问新现场（b2 实拍：t3 板是酒精，老师问水银）。
 * 首轮仍保持板先行（开局 0 指空）；第 2 轮起改成同轮刷新，板与老师这一轮的话对齐。
 */
const POST_TEACHER_REFRESH = MODE !== 'full';

async function refreshBoardForTurn(args: {
  c: any;
  board: BoardState | null;
  studentText: string;
  teacherReply: string;
}): Promise<{ board: BoardState | null; opType: string; intent: BoardIntent }> {
  const { c, board, studentText, teacherReply } = args;
  const intent = decideBoardIntent({
    taskType: c.taskType,
    kind: board?.figure?.kind ?? null,
    studentText,
    lastTeacherText: teacherReply,
    boardNumbers: numbersOnBoard(board?.figure?.maskedSpec),
  });
  if (!board || intent.exampleChange === 'none') return { board, opType: 'none', intent };

  const baseInstruction =
    (intent.exampleChange === 'scene'
      ? '老师这一轮换了对象/条件。把同一结构的板换成**当前这个情境**（对象、液体、条件标签全换）。'
      : '老师这一轮换了例子/条件。把同一结构的板换成**老师这一轮给的例子**（该换的词、数值、单位全换，旧例子不要留）。') +
    '结构、图型、副标注写法不变。' + intent.instruction;
  let nextOut: any = null;
  let nextFig: any = null;
  let reason = 'no-attempt';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    nextOut = await callModel(BOARD_SYSTEM(MODE), {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      studentSays: studentText,
      kindHint: board.figure?.kind ?? null,
      questionIntent: intent,
      lastTeacherReply: teacherReply,
      instruction:
        attempt === 0
          ? baseInstruction
          : `${baseInstruction}\n【重试】上一版没有通过图型校验（${reason}）。只输出一个符合该图型契约的 JSON 对象，不要 Markdown 表格。`,
    });
    const n = nextOut?.figure ? normalizeTeachingFigureForProbe(nextOut.figure) : { figure: null, reason: 'no-figure' };
    nextFig = (n as any).figure;
    reason = String((n as any).reason ?? 'unknown');
    if (nextFig) break;
  }
  if (!nextFig) {
    console.warn(
      `[${c.id}] 换板绘图被拒（已重试）：kind=${String(nextOut?.figure?.kind ?? '∅')} reason=${reason}` +
        ` intent=${intent.askAbout}/${intent.exampleChange}`,
    );
    return { board, opType: 'none', intent };
  }
  const next = applyBoardOp(board, { type: 'update', reason: 'new-example' }, nextFig) ?? board;
  return { board: next, opType: 'update', intent };
}

async function runCase(c: any): Promise<any> {
  const history: Array<{ role: string; content: string }> = [];
  const turns: any[] = [];
  let board: BoardState | null = null;
  let lastTeacherReply: string | null = null;

  // ---- 第 1 轮：定问法 → 建板 → 老师看着板提问 ----
  const opp = buildVisualOpportunity(
    [{ role: 'user', content: c.turns[0].student, timestamp: '2026-10-27T00:00:00.000Z' }] as any,
    c.taskTitle,
  );
  const intent1 = decideBoardIntent({
    taskType: c.taskType,
    kind: opp?.kindHint ?? c.expectKind ?? null,
    studentText: c.turns[0].student,
    lastTeacherText: null,
    boardNumbers: [],
  });
  const baseInstruction = MASKED
    ? '画出这张白板的完整形态：骨架、正确答案、结论都写全（系统会自动挖空成提问态）。'
    : `画出这张白板的完整形态：骨架、步骤、数值、单位、副标注都写全，一个 ? 都不要留。标题只点题，不写结论。${intent1.instruction}`;
  let boardOut: any = null;
  let normalized: any = { figure: null, reason: 'no-attempt' };
  let figure: any = null;
  // 归一化被拒重试一次（2026-10-28）：绘图员偶尔给出合法 JSON 但 spec 不合图型契约，
  // 直接空板会把整节课的板书丢掉；带拒绝原因再要一版，成本远低于重跑整节。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    boardOut = await callModel(BOARD_SYSTEM(MODE), {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      studentSays: c.turns[0].student,
      kindHint: opp?.kindHint ?? c.expectKind ?? null,
      questionIntent: intent1,
      lastTeacherReply: null,
      instruction:
        attempt === 0
          ? baseInstruction
          : `${baseInstruction}\n【重试】上一次输出没有通过图型校验（${String(normalized?.reason ?? 'unknown')}）。` +
            '只输出一个符合该图型契约的 JSON 对象：kind 与 spec 必须匹配，两栏对照用 left/right.head + rows[].label，不要 Markdown 表格。',
    });
    normalized = boardOut?.figure ? normalizeTeachingFigureForProbe(boardOut.figure) : { figure: null };
    figure = normalized.figure;
    if (figure) break;
  }
  if (!figure) {
    // 归一化拒绝后要能从产物里看出「模型给了什么、为什么被拒」，否则只剩一个 null
    const rawFigure = boardOut?.figure ?? null;
    console.warn(
      `[${c.id}] 首轮绘图被拒（已重试）：kind=${String(rawFigure?.kind ?? '∅')}` +
        ` reason=${String(normalized?.reason ?? '∅')}` +
        ` spec=${JSON.stringify(rawFigure?.spec ?? null).slice(0, 600)}`,
    );
  }
  const op1 = decideBoardOp({ board: null, firstTurnOfTask: true, taskChanged: false, wantsNewBoard: !!figure });
  if (figure && op1.type === 'setup') board = openBoard(c.id, figure, { ...CONCEAL, intent: intent1 });

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
    intent: intent1,
    // 每轮把「当时下发给学生的那块板」存下来：减负模式下板会随例子刷新，
    // 只看最终态会丢掉「老师换题 → 板跟着换」这一段的证据
    boardSpec: board?.figure?.maskedSpec ?? null,
    conclusionOnBoard: board?.figure ? extractHiddenConclusion({ kind: board.figure.kind, spec: board.figure.maskedSpec }) !== null : false,
    audit: auditTeacherReply(String(t1?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, hiddenBefore),
  });
  lastTeacherReply = String(t1?.reply ?? '');

  // ---- 第 2 轮：学生答到了关键处 ----
  // 做题区：答对 → 揭晓同一块板。
  // 减负区：板面本来就完整，没有揭晓；只判断「现场变没变」→ 换板。
  // 方案 A：老师先说，说完再按老师这句刷新板（同轮同步）；full 口径仍先揭晓再说话。
  const boardBefore2 = board;
  history.push({ role: 'assistant', content: turns[0].teacher });
  const boardContext2 = boardBefore2 ? describeBoardForTeacher(boardBefore2) : '【白板】暂无板书。';
  let intent2: BoardIntent;
  let op2Type: string;
  if (POST_TEACHER_REFRESH) {
    const t2 = await callModel(teachingSystem, {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      knowledge: { currentPoint: c.topic },
      messages: [...history, { role: 'user', content: c.turns[1].student }],
      boardContext: boardContext2,
      boardAction: '本轮白板暂时保持上一轮的板面；你可以在回复里直接引入新条件/新数据，说完后系统会按你说的现场刷新白板。因此不要引用旧板上的具体数字或行号。',
      instruction:
        '学生刚才答到了关键处。**不要复述板面**；只问一个问题，且必须是**换条件 / 反事实 / 新数据**这三种之一。' +
        '你可以在这一轮直接引入新现场；说完后系统会刷新白板，所以不要引用旧板上的具体行号或数字。',
    });
    const refreshed = await refreshBoardForTurn({
      c, board: boardBefore2, studentText: c.turns[1].student, teacherReply: String(t2?.reply ?? ''),
    });
    board = refreshed.board;
    intent2 = refreshed.intent;
    op2Type = refreshed.opType;
    turns.push({
      n: 2, stage: board?.figure?.stage ?? null, studentIn: c.turns[1].student,
      teacher: String(t2?.reply ?? ''), boardContext: boardContext2,
      boardOp: refreshed.opType,
      intent: intent2,
      newExample: refreshed.intent.exampleChange !== 'none',
      // boardSpec = 学生这一轮最终看到的板；teacherBoardSpec = 老师说话时看到的板（审计指空用它）
      boardSpec: board?.figure?.maskedSpec ?? null,
      teacherBoardSpec: boardBefore2?.figure?.maskedSpec ?? null,
      conclusionOnBoard: board?.figure ? extractHiddenConclusion({ kind: board.figure.kind, spec: board.figure.maskedSpec }) !== null : false,
      audit: { ...auditTeacherReply(String(t2?.reply ?? ''), boardBefore2 ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
    });
    lastTeacherReply = String(t2?.reply ?? '');
  } else {
    intent2 = decideBoardIntent({
      taskType: c.taskType,
      kind: board?.figure?.kind ?? null,
      studentText: c.turns[1].student,
      lastTeacherText: lastTeacherReply,
      boardNumbers: numbersOnBoard(board?.figure?.maskedSpec),
    });
    const newEx2 = intent2.exampleChange !== 'none';
    const op2 = decideBoardOp({
      board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, filledSlot: true, newExample: newEx2,
    });
    op2Type = op2.type;
    if (board && op2.type === 'update') {
      const nextOut = await callModel(BOARD_SYSTEM(MODE), {
        task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
        scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
        studentSays: c.turns[1].student,
        kindHint: board.figure?.kind ?? null,
        questionIntent: intent2,
        lastTeacherReply,
        instruction:
          (intent2.exampleChange === 'scene'
            ? '老师换了对象/条件。把同一结构的板换成**当前这个情境**（对象、液体、条件标签全换）。'
            : '老师换了例子/条件。把同一结构的板换成**当前这个例子**（该换的词、数值、单位全换，旧例子不要留）。') +
          '结构、图型、副标注写法不变。' + intent2.instruction,
      });
      const nextFig = nextOut?.figure ? (normalizeTeachingFigureForProbe(nextOut.figure) as any).figure : null;
      board = applyBoardOp(board, op2, nextFig ?? undefined) ?? board;
    } else if (board) {
      board = applyBoardOp(board, op2) ?? board;
    }
    const revealedHidden = board?.figure ? diffBoardStages(board.figure).map((d) => d.after) : [];
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
      intent: intent2,
      newExample: newEx2,
      boardSpec: board?.figure?.maskedSpec ?? null,
      conclusionOnBoard: board?.figure ? extractHiddenConclusion({ kind: board.figure.kind, spec: board.figure.maskedSpec }) !== null : false,
      // 揭晓/换板轮老师引用板上答案是合法教学行为，不计泄题（只统计提问态的轮次）
      audit: { ...auditTeacherReply(String(t2?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
    });
    lastTeacherReply = String(t2?.reply ?? '');
  }

  // ---- 第 3 轮：迁移检查；方案 A 下同样是「老师先说 → 按这一句刷新板」 ----
  const boardBefore3 = board;
  history.push({ role: 'assistant', content: turns[1].teacher });
  const boardContext3 = boardBefore3 ? describeBoardForTeacher(boardBefore3) : '【白板】暂无板书。';
  let intent3: BoardIntent;
  let op3Type: string;
  if (POST_TEACHER_REFRESH) {
    const t3 = await callModel(teachingSystem, {
      task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType, acceptanceCriteria: c.acceptance },
      scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
      knowledge: { currentPoint: c.topic },
      messages: [...history, { role: 'user', content: c.turns[2].student }],
      boardContext: boardContext3,
      boardAction: '本轮白板暂时保持上一轮的板面；你可以在回复里直接引入新条件/新数据，说完后系统会按你说的现场刷新白板。因此不要引用旧板上的具体数字或行号。',
      instruction: '让学生用板上的结论做一次迁移判断：问题必须是板上**没有直接答案**的；可以引入新数据或新现场，但不要引用旧板的具体行号/数字（说完后板会刷新）。不要重画、不要复述板面。',
    });
    const refreshed = await refreshBoardForTurn({
      c, board: boardBefore3, studentText: c.turns[2].student, teacherReply: String(t3?.reply ?? ''),
    });
    board = refreshed.board;
    intent3 = refreshed.intent;
    op3Type = refreshed.opType;
    turns.push({
      n: 3, stage: board?.figure?.stage ?? null, studentIn: c.turns[2].student,
      teacher: String(t3?.reply ?? ''), boardContext: boardContext3,
      boardOp: refreshed.opType,
      intent: intent3,
      newExample: refreshed.intent.exampleChange !== 'none',
      boardSpec: board?.figure?.maskedSpec ?? null,
      teacherBoardSpec: boardBefore3?.figure?.maskedSpec ?? null,
      conclusionOnBoard: board?.figure ? extractHiddenConclusion({ kind: board.figure.kind, spec: board.figure.maskedSpec }) !== null : false,
      audit: { ...auditTeacherReply(String(t3?.reply ?? ''), boardBefore3 ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
    });
  } else {
    intent3 = decideBoardIntent({
      taskType: c.taskType,
      kind: board?.figure?.kind ?? null,
      studentText: c.turns[2].student,
      lastTeacherText: lastTeacherReply,
      boardNumbers: numbersOnBoard(board?.figure?.maskedSpec),
    });
    const newEx3 = intent3.exampleChange !== 'none';
    const op3 = decideBoardOp({
      board, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, newExample: newEx3,
    });
    op3Type = op3.type;
    if (board && op3.type === 'update') {
      const nextOut = await callModel(BOARD_SYSTEM(MODE), {
        task: { title: c.taskTitle, description: c.taskDescription, taskType: c.taskType },
        scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
        studentSays: c.turns[2].student,
        kindHint: board.figure?.kind ?? null,
        questionIntent: intent3,
        lastTeacherReply,
        instruction:
          (intent3.exampleChange === 'scene'
            ? '问题挪到了新情境。把同一结构的板换成**当前这个情境**（新对象/新液体/新条件标签）。'
            : '老师换了例子/条件。把同一结构的板换成**当前这个例子**（该换的词、数值、单位全换，旧例子不要留）。') +
          '结构、图型、副标注写法不变。' + intent3.instruction,
      });
      const nextFig = nextOut?.figure ? (normalizeTeachingFigureForProbe(nextOut.figure) as any).figure : null;
      board = applyBoardOp(board, op3, nextFig ?? undefined) ?? board;
    } else if (board) {
      board = applyBoardOp(board, op3) ?? board;
    }
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
      intent: intent3,
      newExample: newEx3,
      boardSpec: board?.figure?.maskedSpec ?? null,
      conclusionOnBoard: board?.figure ? extractHiddenConclusion({ kind: board.figure.kind, spec: board.figure.maskedSpec }) !== null : false,
      audit: { ...auditTeacherReply(String(t3?.reply ?? ''), board ?? { taskId: c.id, figure: null, revision: 0 }, []), leakHits: [] },
    });
  }

  // 换题是否跟上：老师上一轮宣布过、但**上一块板和当前板都没有**的数字。
  // 旧口径只看当前板，会把「板正确地跟到了更新的现场」误判成滞后；要求两块板都没有才算真丢了。
  const staleNumbers = turns
    .flatMap((t: any, i: number) => {
      const prev = i === 0 ? null : turns[i - 1].teacher;
      if (!prev) return [];
      const onBoard = new Set(numbersOnBoard(t.boardSpec));
      const onPrevBoard = new Set(numbersOnBoard(turns[i - 1]?.boardSpec));
      return numbersOnBoard({ text: prev }).filter((n) => !onBoard.has(n) && !onPrevBoard.has(n));
    })
    .filter((n: string) => !/^\d{1,2}$/.test(n) || Number(n) > 31); // 页码/序号类小整数不算

  const rendered = board ? boardFigureForRender(board) : null;
  return {
    id: c.id,
    pipeline: POST_TEACHER_REFRESH ? 'post-teacher-refresh' : 'board-first',
    course: c.course,
    subject: c.subject,
    topic: c.topic,
    taskTitle: c.taskTitle,
    mode: MODE,
    kind: figure?.kind ?? null,
    expectKind: c.expectKind ?? null,
    routedKind: opp?.kindHint ?? null,
    boardOps: [op1.type, op2Type, op3Type],
    intents: [intent1, intent2, intent3],
    staleNumbers: [...new Set(staleNumbers)],
    conclusionOnBoardTotal: turns.filter((t: any) => t.conclusionOnBoard).length,
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
