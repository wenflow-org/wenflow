/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * judge-minibatch-classrooms.ts —— 课堂级独立 LLM 评审跑数器（2026-11-13 mini-batch 第 2 步）。
 *
 * 为什么要有它：simulation-referee 只看 publicTrace——板书/图文载荷、逐轮脚手架、
 * 收束产出这些课堂内部证据它拿不到（u07/u17 的 TEACHING_BOARD_UNVERifiable 误报根源）。
 * 本脚本对黑盒 mini-batch 的**每一节课**调 skill:teaching-classroom-judge，产出与 referee
 * 同构的病历单（code/severity/evidenceIds），并做跨样本归一聚类（≥2 例或 critical 才进修复）。
 *
 * 输入：mini-batch run 目录里的 result.json（拿 caseId/userId/sessionId）；
 * 证据：teaching_session_messages（含学习者真实可见的 figures/板书载荷）+ teaching_sessions.wrapup。
 * 输出：<run-dir>/classrooms/<caseId>/<teachingSessionId>.json + classrooms-summary.json + classroom-report.md
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/judge-minibatch-classrooms.ts --run-dir=.runtime/referee-minibatch/2026-11-13
 *   npx ts-node --transpile-only scripts/judge-minibatch-classrooms.ts --run-dir=... --cases=u01-labor-contract,u17-http-cache-concurrency
 * 断点续跑：已存在的 classrooms/<caseId>/<sessionId>.json 直接跳过。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { runWithContext } from '../gateway/api-gateway/context';
import { executeClassroomQualityJudge, type ClassroomJudgeTranscriptTurn } from '../skills/teaching-classroom-judge';

const prisma = new PrismaClient();

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function readJson(p: string, fallback: any) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p: string, value: any) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
}
function clip(value: unknown, n: number): string {
  const s = String(value ?? '').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function log(caseId: string | null, line: string) {
  console.log(`[${new Date().toISOString()}]${caseId ? `[${caseId}]` : ''} ${line}`);
}

const backendRoot = path.resolve(__dirname, '../..');
const runRoot = path.resolve(backendRoot, arg('run-dir', path.join('.runtime', 'referee-minibatch', '2026-11-13')));
const casesFilter = arg('cases').split(',').map(s => s.trim()).filter(Boolean);
const force = process.argv.includes('--force');
const concurrency = Math.max(1, Number(arg('concurrency', '2')) || 2);
const CONTENT_CLIP = Math.max(200, Number(arg('content-clip', '900')) || 900);
const BOARD_CLIP = Math.max(100, Number(arg('board-clip', '700')) || 700);

/** 通用 spec 文本抽取：不依赖特定图型结构（split-compare/concept-map 的条目不在行列标签里） */
function collectSpecTexts(spec: any, limit = 24, itemClip = 60): string | null {
  if (!spec || typeof spec !== 'object') return null;
  const skipKeys = new Set(['tone', 'palette', 'engine', 'why', 'source', 'kind']);
  const out: string[] = [];
  const walk = (value: any, path: string, depth: number) => {
    if (depth > 6 || out.length >= limit) return;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t.length >= 2) out.push(`${path}:${clip(t, itemClip)}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          const t = item.text.trim();
          if (t.length >= 2) out.push(`${path}[${i}]${item.label ? `(${clip(String(item.label), 20)})` : ''}:${clip(t, itemClip)}`);
          return;
        }
        walk(item, `${path}[${i}]`, depth + 1);
      });
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (skipKeys.has(k)) continue;
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  walk(spec, '', 0);
  return out.length ? out.join('；') : null;
}

/** 图文载荷 → 评审可读的紧凑文本（保留行列标签/图例/高亮格，裁剪字节） */
function digestFigures(figures: any): string | null {
  if (!Array.isArray(figures) || !figures.length) return null;
  const parts = figures.slice(0, 3).map((fig: any, i: number) => {
    const spec = fig?.spec || {};
    const rows = Array.isArray(spec.rowLabels) ? spec.rowLabels.map((r: any) => String(r)) : [];
    const cols = Array.isArray(spec.colLabels) ? spec.colLabels.map((c: any) => String(c)) : [];
    const cells = Array.isArray(spec.cells)
      ? spec.cells.map((c: any) => `${c?.r ?? '?'},${c?.c ?? '?'}${c?.tone ? `(${c.tone})` : ''}`).join(' ')
      : '';
    // 露出状态（2026-11-26 阶段协议外审）：评审要能判断「老师是否讲了板上还没露出的行」，
    // 只给行列与标记格看不见骨架态；T/F 逐行标出，判官据此对正文做越界检查。
    const reveal = Array.isArray(spec.rowRevealed)
      ? spec.rowRevealed.map((v: any) => (v === false ? 'F' : 'T')).join(',')
      : Array.isArray(spec.frameRevealed)
        ? spec.frameRevealed.map((v: any) => (v === false ? 'F' : 'T')).join(',')
        : '';
    // legend 条目真实形状是 {text, fill}（teaching-board-design 产物，2026-11-13 实测 DB）：
    // 只认 .label 会把对象 String 成「[object Object]」，制造「图例未渲染」伪影 finding
    const legend = Array.isArray(spec.legend)
      ? spec.legend.map((l: any) => String(l?.label ?? l?.text ?? (typeof l === 'string' ? l : '')).trim()).filter(Boolean).join('；')
      : '';
    const generic = collectSpecTexts(spec);
    return [
      `图${i + 1}[${fig?.engine || '?'}/${fig?.kind || '?'}]`,
      typeof spec.title === 'string' && spec.title ? `标题:${spec.title}` : '',
      rows.length ? `行:${rows.join('｜')}` : '',
      cols.length ? `列:${cols.join('｜')}` : '',
      reveal ? `露出:${reveal}` : '',
      legend ? `图例:${legend}` : '',
      cells ? `标记格:${cells}` : '',
      generic ? `内容:${generic}` : '',
    ].filter(Boolean).join('；');
  });
  return clip(parts.join('\n'), BOARD_CLIP) || null;
}

/** 板书载荷 → 紧凑文本 */
function digestBoard(board: any): string | null {
  if (!board) return null;
  if (typeof board === 'string') return clip(board, BOARD_CLIP) || null;
  const items = Array.isArray(board.items) ? board.items : null;
  if (items) {
    const text = items.map((item: any, i: number) => `${i + 1}.${clip(item?.title || item?.text || item?.content || '', 120)}`).join('\n');
    return clip(text, BOARD_CLIP) || null;
  }
  return clip(JSON.stringify(board), BOARD_CLIP) || null;
}

/** 课堂病历单 code 归一（与 run-referee-minibatch.mjs 的 canonicalFindingCode 同口径；只影响聚类，不改评审输出） */
export function canonicalFindingCode(code: string): string {
  const c = String(code || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (/BOARD.*(DANGLING|MISSING)/.test(c)) return 'BOARD_DANGLING_TRACE';
  if (/BOARD.*MISMATCH|BOARD.*NOT_?FOUND/.test(c)) return 'BOARD_MISMATCH';
  if (/NOTATION/.test(c)) return 'NOTATION_LEAK';
  if (/SAME_?MOLD|REPEAT.*QUESTION|同构/.test(c)) return 'SAME_MOLD_STREAK';
  if (/SCAFFOLD/.test(c)) return 'SCAFFOLD_LATE';
  if (/CLOSURE|WRAPUP/.test(c)) return 'CLOSURE_MISSING';
  if (/OPENING.*(SPOILER|ANSWER)/.test(c)) return 'OPENING_SPOILER';
  if (/OPENING.*(ASSUME|EXPERIENCE|经历)/.test(c)) return 'OPENING_ASSUME_EXPERIENCE';
  if (/CHECKPOINT.*(RECALL|复述)/.test(c)) return 'CHECKPOINT_RECALL_ONLY';
  if (/ASSESSMENT.*(REPEAT|REPET|RECALL)/.test(c)) return 'ASSESSMENT_REPEAT_RECALL';
  if (/ANSWER.*WITHHOLD|REFUS/.test(c)) return 'TEACHING_ANSWER_WITHHOLD';
  if (/MENO/.test(c)) return 'MENO_GATE_VIOLATION';
  if (/TRUNCAT/.test(c)) return 'TRACE_TRUNCATED';
  return c;
}

interface ClassroomJob {
  caseId: string;
  domain: string;
  sessionId: string;
  userId: string;
}

async function judgeClassroom(job: ClassroomJob, ts: any, outDir: string): Promise<any> {
  const outFile = path.join(outDir, `${ts.id}.json`);
  if (!force && fs.existsSync(outFile)) {
    const existing = readJson(outFile, null);
    if (existing?.report) return existing;
  }

  const messages = await prisma.teaching_session_messages.findMany({
    where: { sessionId: ts.id },
    orderBy: { id: 'asc' },
  });
  // 任务级白板快照 + revision 历史（必须在 transcript 循环前解析）：BoardState 在
  // teachingState.sessionArtifacts.board（消息 payload 里只有逐轮 figures 附件与 boardState 指针）。
  // 2026-11-13 首评误报 BOARD_DANGLING TRACE ×7 的根因就是没喂这块证据；引擎补了 boardHistory
  // 后，可逐轮回放学习者当时看到的板面。
  let boardState: any = null;
  let boardHistory: Array<{ revision: number; kind: string; spec: any }> = [];
  let sessionEndReason: string | null = null;
  try {
    const teachingState = ts.teachingState ? JSON.parse(ts.teachingState) : null;
    sessionEndReason = (teachingState as any)?.endReason ?? null;
    boardState = teachingState?.sessionArtifacts?.board || null;
    const history = teachingState?.sessionArtifacts?.boardHistory;
    if (Array.isArray(history)) boardHistory = history;
  } catch { boardState = null; boardHistory = []; }
  const revisionToDigest = new Map<number, string>();
  for (const entry of boardHistory) {
    const digest = digestFigures([{ spec: entry.spec }] as any);
    if (digest && Number.isFinite(Number(entry.revision))) revisionToDigest.set(Number(entry.revision), digest);
  }
  const boardDigestParts: string[] = [];
  if (boardState?.figure) {
    const fig = boardState.figure;
    boardDigestParts.push(`kind=${fig.kind || '?'} revision=${boardState.revision ?? '?'} conceal=${fig.conceal || '?'}`);
    if (fig.focusId) boardDigestParts.push(`focusId=${fig.focusId}`);
    if (fig.hiddenTakeaway) boardDigestParts.push(`隐藏结论:${clip(fig.hiddenTakeaway, 200)}`);
    const masked = digestFigures([fig.maskedSpec && (Array.isArray(fig.maskedSpec) ? fig.maskedSpec : { spec: fig.maskedSpec })].filter(Boolean) as any);
    if (masked) boardDigestParts.push(`学习者可见面:${masked}`);
    const full = digestFigures([fig.fullSpec && (Array.isArray(fig.fullSpec) ? fig.fullSpec : { spec: fig.fullSpec })].filter(Boolean) as any);
    if (full) boardDigestParts.push(`完整面:${full}`);
  }
  const boardDigest = boardDigestParts.length ? clip(boardDigestParts.join('\n'), BOARD_CLIP * 2) : null;
  const board = { present: boardDigestParts.length > 0, digest: boardDigest };

  const transcript: ClassroomJudgeTranscriptTurn[] = [];
  let seq = 0;
  for (const m of messages) {
    let payload: any = {};
    try { payload = JSON.parse(m.payload || '{}'); } catch { payload = {}; }
    const role = payload.role === 'user' ? 'learner' : 'teacher';
    const content = clip(payload.content, CONTENT_CLIP);
    if (!content && !payload.analysis?.board && !payload.figures) continue;
    // 教师轮的白板证据定位顺序（与评审规则一致）：本轮 figures 附件 → boardState 指针指向的
    // boardHistory 快照（revision 回放）→ 无。学习者轮不挂板书面（板是老师指认的对象）。
    const boardRevision = Number(payload.boardState?.revision);
    const historyDigest = role === 'teacher' && Number.isFinite(boardRevision)
      ? revisionToDigest.get(boardRevision) || null
      : null;
    transcript.push({
      index: seq++,
      role,
      content,
      board: digestBoard(payload.analysis?.board) ?? (historyDigest ? `白板@rev${boardRevision} ${historyDigest}` : null),
      figure: digestFigures(payload.figures),
      checkpoint: payload.checkpoint?.question ? clip(payload.checkpoint.question, 400) : null,
    });
  }


  let wrapupRaw: any = null;
  try { wrapupRaw = ts.wrapup ? JSON.parse(ts.wrapup) : null; } catch { wrapupRaw = null; }
  const lss = Number(wrapupRaw?.metrics?.lss ?? wrapupRaw?.lss);
  const wrapupTakeaways = {
    key: Array.isArray(wrapupRaw?.summary?.keyTakeaways) ? wrapupRaw.summary.keyTakeaways.length : -1,
    plan: Array.isArray(wrapupRaw?.summary?.actionPlan) ? wrapupRaw.summary.actionPlan.length : -1,
  };
  const wrapup = {
    present: Boolean(wrapupRaw) && Object.keys(wrapupRaw || {}).length > 0,
    summary: wrapupRaw ? clip(JSON.stringify(wrapupRaw), 800) : null,
    lss: Number.isFinite(lss) ? lss : null,
  };

  const input = {
    classroom: {
      pathTitle: ts._path?.title ?? null,
      stageTitle: ts._stage?.title ?? null,
      taskTitle: ts._task?.title ?? ts.topic ?? null,
      taskDescription: ts._task?.description ?? null,
      mode: ts.mode,
      learnerGoal: ts._learner?.learningGoal ?? null,
      learnerOccupation: ts._learner?.occupation ?? null,
      turnCount: transcript.length,
      // 批 22-②：abandon 语义对齐——判官据 sessionTerminal 豁免弃跑课的收束判据
      sessionTerminal: { status: (ts as any).status ?? null, endReason: sessionEndReason },
    },
    transcript,
    board,
    wrapup,
  };

  const result = await runWithContext({
    userId: job.userId,
    sourceEntry: 'platform',
    callerAgent: 'classroom-judge',
  }, () => executeClassroomQualityJudge(input as any));

  const record = {
    caseId: job.caseId,
    domain: job.domain,
    teachingSessionId: ts.id,
    taskTitle: input.classroom.taskTitle,
    mode: ts.mode,
    turnCount: transcript.length,
    boardPayloadTurns: transcript.filter(t => t.board || t.figure).length,
    boardSnapshotPresent: board.present,
    wrapupPresent: wrapup.present,
    wrapupTakeaways,
    report: result.success ? result.output : null,
    error: result.success ? null : result.error?.message || 'CLASSROOM_JUDGE_FAILED',
    judgedAt: new Date().toISOString(),
  };
  writeJson(outFile, record);
  if (!result.success) {
    log(job.caseId, `课堂评审失败 ${ts.id}: ${record.error}`);
  } else {
    const f = record.report.findings || [];
    log(job.caseId, `课堂评审 ${ts.id}（${transcript.length} 轮，板书轮 ${record.boardPayloadTurns}）verdict=${record.report.verdict} findings=${f.length} [${f.map((x: any) => x.code).join(', ')}]`);
  }
  return record;
}

async function main() {
  const resultFiles: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === 'result.json') resultFiles.push(full);
    }
  };
  walk(runRoot);

  const jobs: ClassroomJob[] = [];
  for (const file of resultFiles.sort()) {
    const result = readJson(file, null);
    if (!result?.sessionId || !result?.userId) continue;
    if (casesFilter.length && !casesFilter.includes(result.caseId)) continue;
    jobs.push({ caseId: result.caseId, domain: result.domain || '', sessionId: result.sessionId, userId: result.userId });
  }
  if (!jobs.length) {
    console.error(`没有可用 case（run-dir=${runRoot}）`);
    process.exit(1);
  }
  log(null, `课堂评审：${jobs.map(j => j.caseId).join(', ')}｜concurrency=${concurrency}｜root=${runRoot}`);

  // 预取课堂（含路径/阶段/任务/学习者元信息），摊平成 job 列表
  const classroomJobs: Array<{ job: ClassroomJob; ts: any; outDir: string }> = [];
  for (const job of jobs) {
    const vs = await prisma.virtual_sessions.findUnique({ where: { id: job.sessionId } });
    if (!vs?.learningPathId) {
      log(job.caseId, '无 learningPathId，跳过');
      continue;
    }
    const lp = await prisma.learning_paths.findUnique({
      where: { id: vs.learningPathId },
      include: { milestones: { include: { subtasks: true } } },
    });
    const sessions = await prisma.teaching_sessions.findMany({
      where: { learningPathId: vs.learningPathId },
      orderBy: { startTime: 'asc' },
    });
    const profile = await prisma.virtual_learner_profiles.findFirst({ where: { userId: job.userId } });
    const profileData = profile ? (() => { try { return JSON.parse(profile.profile || '{}'); } catch { return {}; } })() : {};
    const outDir = path.join(runRoot, 'classrooms', job.caseId);
    for (const ts of sessions) {
      const stage = lp?.milestones.find(m => m.id === ts.milestoneId) || null;
      const task = lp?.milestones.flatMap(m => m.subtasks).find(t => t.id === ts.taskId) || null;
      (ts as any)._path = lp ? { title: lp.title } : null;
      (ts as any)._stage = stage ? { title: stage.title } : null;
      (ts as any)._task = task ? { title: task.title, description: task.description } : null;
      (ts as any)._learner = {
        learningGoal: profile?.learningGoal ?? null,
        occupation: profileData?.role ?? null,
      };
      classroomJobs.push({ job, ts, outDir });
    }
    log(job.caseId, `课堂 ${sessions.length} 节待评`);
  }

  // 并发评审
  let cursor = 0;
  const records: any[] = [];
  async function worker() {
    while (cursor < classroomJobs.length) {
      const item = classroomJobs[cursor++];
      try {
        records.push(await judgeClassroom(item.job, item.ts, item.outDir));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(item.job.caseId, `课堂评审异常 ${item.ts.id}: ${message}`);
        records.push({ caseId: item.job.caseId, teachingSessionId: item.ts.id, report: null, error: message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, classroomJobs.length) }, () => worker()));

  // 跨样本归一聚类（只统计非 info；≥2 例或 critical 进 actionable）
  // 采样残课伪影不进聚类（2026-11-13 批 A/B 实证）：--max-tasks 主动收口制造的 1-3 轮残课，
  // 评审只能输出「证据不足/记录太薄」这类硬降分 finding（insufficient_evidence major×2 批 A、
  // transcript_too_thin critical×1 批 B）——那是采样方法的属性，不是课堂的病。残课本身已按
  // inconclusive 存档在逐课表，聚类侧剔除避免假 critical 污染修复队列。
  const SAMPLING_ARTIFACT_CODES = new Set([
    'transcript_too_thin', 'insufficient_evidence', 'insufficient_turns',
    'insufficient_round_evidence', 'evidence_insufficient_turns', 'evidence_truncated_single_turn',
    'inconclusive_insufficient_transcript', 'insufficient_evidence_truncated', 'lesson_truncated',
  ]);
  const byCode = new Map<string, any>();
  for (const r of records) {
    // 残课结构排除（2026-11-14 批 G 实证）：1-2 轮残课上 closure_missing/criteria 等缺失类
    // finding 是结构性必然（课都没讲完当然没有收束）——按 turnCount 整课剔除，
    // 比逐个枚举伪影 code 更根本（批 D 的 closure critical×1 即 1 轮残课伪影）。
    if (Number(r.turnCount || 0) < 3) continue;
    const findings = Array.isArray(r.report?.findings) ? r.report.findings : [];
    for (const f of findings) {
      const severity = String(f.severity || 'unknown');
      if (severity === 'info') continue;
      const rawCode = String(f.code || 'UNKNOWN');
      if (SAMPLING_ARTIFACT_CODES.has(rawCode.toLowerCase())) continue;
      const code = canonicalFindingCode(rawCode);
      const entry = byCode.get(code) || { code, rawCodes: new Set<string>(), cases: new Set<string>(), severities: {} as Record<string, number>, titles: [] as string[], details: [] as string[] };
      entry.rawCodes.add(String(f.code));
      entry.cases.add(r.caseId);
      entry.severities[severity] = (entry.severities[severity] || 0) + 1;
      if (f.title) entry.titles.push(String(f.title).slice(0, 160));
      if (f.detail) entry.details.push(String(f.detail).slice(0, 280));
      // 判官漂移标注（修复批 16，agnes 时代教师/判官双端换模型的测量卫生）：
      // closure 族缺口与 wrapup 产物事实并排呈现——产物在案且口径非空=课内收束缺失或判官口径
      // 漂移（需人工复核）；产物不存在=残课/截断形态；产物在案但口径 0=空壳实锤。
      if (/closure/i.test(code)) {
        const t = (r as { wrapupTakeaways?: { key: number; plan: number } }).wrapupTakeaways;
        const present = (r as { wrapupPresent?: boolean }).wrapupPresent;
        if (!present) entry.details.push(`[仪器注记|${r.caseId}] wrapup 产物不存在——残课/截断形态`);
        else if (!t || t.key < 0) entry.details.push(`[仪器注记|${r.caseId}] wrapup 在案（旧记录无口径计数）`);
        else if (t.key === 0) entry.details.push(`[仪器注记|${r.caseId}] wrapup 在案但口径 0 条——空壳实锤`);
        else entry.details.push(`[仪器注记|${r.caseId}] wrapup 在案（口径${t.key}条/下一步${t.plan}条）——课内收束缺失或判官口径漂移，需人工复核`);
      }
      byCode.set(code, entry);
    }
  }
  // 回填旧记录的 wrapup 口径计数（判官漂移标注需要；批 16 前的记录无此字段）
  for (const r of records) {
    const rt = (r as { wrapupTakeaways?: { key: number; plan: number } }).wrapupTakeaways;
    if (rt && rt.key >= 0) continue;
    try {
      const ts = await prisma.teaching_sessions.findUnique({ where: { id: r.teachingSessionId } });
      const w = ts?.wrapup ? JSON.parse(ts.wrapup) : null;
      (r as { wrapupTakeaways?: { key: number; plan: number } }).wrapupTakeaways = {
        key: Array.isArray(w?.summary?.keyTakeaways) ? w.summary.keyTakeaways.length : -1,
        plan: Array.isArray(w?.summary?.actionPlan) ? w.summary.actionPlan.length : -1,
      };
    } catch { /* 单条回填失败不阻塞聚类 */ }
  }
  const clusters = [...byCode.values()]
    .map(e => ({
      code: e.code,
      rawCodes: [...e.rawCodes],
      count: e.cases.size,
      cases: [...e.cases].sort(),
      severities: e.severities,
      titles: e.titles,
      details: e.details,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const actionable = clusters.filter(e => e.count >= 2 || Object.keys(e.severities).includes('critical'));

  const summary = {
    generatedAt: new Date().toISOString(),
    runRoot,
    classrooms: records.map(r => ({
      caseId: r.caseId,
      teachingSessionId: r.teachingSessionId,
      taskTitle: r.taskTitle ?? null,
      turnCount: r.turnCount ?? null,
      boardPayloadTurns: r.boardPayloadTurns ?? null,
      boardSnapshotPresent: r.boardSnapshotPresent ?? null,
      wrapupPresent: r.wrapupPresent ?? null,
      verdict: r.report?.verdict ?? null,
      scores: r.report?.scores ?? null,
      findingCodes: (r.report?.findings || []).map((f: any) => f.code),
      error: r.error ?? null,
    })),
    clusters,
    actionable,
    note: '课堂病历单聚类与 referee 同规则：≥2 例或 critical 才进修复；info 是正面记录不进池。',
  };
  writeJson(path.join(runRoot, 'classrooms-summary.json'), summary);

  const md: string[] = [];
  md.push(`# 课堂级独立评审病历单（${path.basename(runRoot)}）`);
  md.push('');
  md.push(`生成：${summary.generatedAt}｜评审技能：skill:teaching-classroom-judge`);
  md.push('');
  md.push('## 逐课');
  md.push('');
  md.push('| case | 任务 | 轮数 | 板书轮 | wrapup | verdict | findings |');
  md.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of summary.classrooms) {
    md.push(`| ${c.caseId} | ${clip(c.taskTitle, 40) || '—'} | ${c.turnCount ?? '—'} | ${c.boardPayloadTurns ?? '—'} | ${c.wrapupPresent ?? '—'} | ${c.verdict || '—'} | ${(c.findingCodes || []).join('<br>') || '—'} |`);
  }
  md.push('');
  md.push('## 跨样本聚类（≥2 例或 critical）');
  md.push('');
  if (!actionable.length) md.push('（无）');
  for (const e of actionable) {
    md.push(`### ${e.code} × ${e.count}（${e.cases.join(', ')}）`);
    md.push(`- severity：${JSON.stringify(e.severities)}`);
    md.push(`- 原始 code：${e.rawCodes.join(' | ')}`);
    if (e.titles[0]) md.push(`- 代表标题：${e.titles[0]}`);
    if (e.details[0]) md.push(`- 代表 detail：${e.details[0]}`);
    md.push('');
  }
  md.push('## 全部聚类（含单例存档）');
  md.push('');
  for (const e of clusters) md.push(`- ${e.code} × ${e.count}｜${e.cases.join(', ')}｜${JSON.stringify(e.severities)}`);
  for (const e of actionable) {
    const notes = e.details.filter((d: string) => d.startsWith('[仪器注记'));
    if (notes.length > 0) md.push(...notes.map((d: string) => `  - ${d}`));
  }
  fs.writeFileSync(path.join(runRoot, 'classroom-report.md'), `${md.join('\n')}\n`);

  log(null, `完成：${records.length} 节课，actionable ${actionable.length} 类 → classroom-report.md`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
