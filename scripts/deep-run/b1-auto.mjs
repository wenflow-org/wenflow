/**
 * B1 全程自动驱动 — 学习者端 API,按 B 行为章程跑完路径全部任务
 * 用法: node scripts/deep-run/b1-auto.mjs [--run=B1] [--max-turns-per-task=24]
 *
 * 章程:
 *  - checkpoint:约 30% 故意答错(末选项),其余首选
 *  - 应答优先用老师给的 quickReplies(真实用户动作);无则用回复池
 *  - 每隔 ~5 轮说一次"没跟上,换个说法"(触发干预/换讲法)
 *  - understanding≥0.75 或轮数超限 → 主动请求收尾;ready_to_close → end+finalize(ISSUE-10 配方)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getCookie, BASE, JOURNAL_DIR, LESSONS_DIR, log, arg, accounts,
  pathSnapshot, runState, setRunState, sleep, now, qa,
} from './lib.mjs';

const RUN = arg('run', 'B1');
const acct = accounts().B;
const MAX_TURNS = Number(arg('max-turns-per-task', 24));

function journal(rec) {
  fs.appendFileSync(path.join(JOURNAL_DIR, `${RUN}.jsonl`), JSON.stringify(rec) + '\n');
}
const AI_PACE = 4500;
let lastAt = 0;

async function api(method, urlPath, body, opts = {}) {
  const wait = lastAt + AI_PACE - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
  const t0 = Date.now();
  const headers = { Cookie: await getCookie('user'), Origin: 'http://localhost:5173', ...(opts.idem ? { 'Idempotency-Key': opts.idem } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 420000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  journal({ ts: now(), action: opts.action || `${method} ${urlPath}`, method, path: urlPath, req: body ?? null, status: res.status, durMs: Date.now() - t0, res: json });
  if (!res.ok || json?.success === false) {
    const err = String(json?.error?.message || json?.error || json?.raw || '').slice(0, 250);
    log(`! ${opts.action || urlPath} → ${res.status}: ${err}`);
    return { _failed: true, status: res.status, error: err, json };
  }
  return json;
}

const LP = '/api/learning';
const AT = '/api/ai-teaching';

const POOL = [
  '我大概懂了,那这一步在表里具体怎么操作?',
  '让我拿我那份明细对一下……好像是这样。',
  '这里我有点模糊,能举个更贴近我周报的例子吗?',
  '懂了,就是先分清"谁的"和"这笔单的"。',
  '我试着按你说的做了,结果对不上,哪里错了?',
];
const CONFUSED = '这里我没跟上,能换一种讲法吗?慢一点的那种。';
const WRAP_REQ = '我觉得这节清楚了,我们收尾吧,我想自己动手试试。';

function lastTeacherMsg(detail) {
  const arr = detail.messages || [];
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].role === 'assistant') return arr[i];
  return null;
}
function quickRepliesOf(msg) {
  const q = msg?.analysis?.quickReplies || msg?.quickReplies;
  return Array.isArray(q) ? q.map(x => (typeof x === 'string' ? x : x.text)).filter(Boolean) : [];
}

async function detail(sessionId) {
  const r = await api('GET', `${AT}/sessions/${sessionId}/detail`, undefined, { action: 'detail', timeoutMs: 60000 });
  return r._failed ? null : (r.data || {});
}

async function submitCheckpoint(sessionId, cp, revision, turnNo) {
  const options = cp.options || cp.choices || cp.answerOptions || [];
  const wrong = Math.random() < 0.3;
  const pick = wrong && options.length ? options.length - 1 : 0;
  const body = options.length
    ? { selectedOptionIds: [options[pick].id || options[pick].optionId || String(pick)], revision }
    : { answerText: wrong ? '不太确定,可能是描述信息?' : '应该是归属字段', revision };
  const r = await api('POST', `${AT}/sessions/${sessionId}/checkpoints/${cp.checkpointId || cp.id}/submit`,
    body, { action: `checkpoint#${turnNo}(wrong=${wrong})`, timeoutMs: 420000 });
  return r;
}

async function finishTask(sessionId) {
  const d0 = await detail(sessionId);
  await api('POST', `${AT}/sessions/${sessionId}/end`, { revision: d0.revision }, { action: 'end', timeoutMs: 420000 });
  const d1 = await detail(sessionId);
  await api('POST', `${AT}/sessions/${sessionId}/finalize`,
    { action: 'complete_task', revision: d1.revision },
    { action: 'finalize', idem: `b1-auto-${sessionId.slice(-8)}-${Date.now()}`, timeoutMs: 420000 });
}

async function runTask(taskId, taskTitle, taskIdx) {
  // 复用活跃会话,否则开新课
  let act = await api('GET', `${AT}/sessions/active`, undefined, { action: 'active', timeoutMs: 60000 });
  let rows = act?.data || [];
  if (!Array.isArray(rows)) rows = [];
  let sid = rows.find(x => x.taskId === taskId)?.sessionId;
  if (!sid) {
    const opened = await api('POST', `${AT}/tasks/${taskId}/session`, {}, { action: `open T${taskIdx}`, timeoutMs: 420000 });
    if (opened._failed) return { ok: false, reason: 'open failed: ' + opened.error };
    sid = opened?.data?.id || opened?.data?.sessionId || opened?.data?.session?.id;
  }
  setRunState(RUN, { currentTaskId: taskId, classSessionId: sid });
  log(`T${taskIdx} 课堂 ${sid.slice(-8)} · ${taskTitle}`);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    await sleep(2500);
    const d = await detail(sid);
    if (!d) { log('detail 失败,跳过本轮'); continue; }
    if (d.status && d.status !== 'active') { log(`T${taskIdx} 会话态 ${d.status},进入结算`); break; }
    if (d.pendingCheckpoint) {
      await submitCheckpoint(sid, d.pendingCheckpoint, d.revision, turn);
      continue;
    }
    const ls = d.state?.learnerStateContext || {};
    const understanding = ls.currentUnderstanding ?? 0;
    const last = lastTeacherMsg(d);
    const qs = last ? quickRepliesOf(last) : [];

    // 收尾判定:理解够/超限/老师已给收尾态
    const stage = d.state?.classroomContext?.stage?.current;
    if (stage === 'ready_to_close' || understanding >= 0.78 || turn === MAX_TURNS) {
      if (stage === 'ready_to_close') break;
      await api('POST', `${AT}/sessions/${sid}/messages`, { message: WRAP_REQ, revision: d.revision }, { action: `wrap-req#${turn}`, timeoutMs: 420000 });
      continue;
    }
    let text;
    if (qs.length) text = qs[turn % Math.min(qs.length, 2)];
    else if (turn % 5 === 0) text = CONFUSED;
    else text = POOL[turn % POOL.length];
    const sent = await api('POST', `${AT}/sessions/${sid}/messages`, { message: text, revision: d.revision }, { action: `say#${turn}`, timeoutMs: 420000 });
    if (sent._failed && sent.status === 409) { log(`say#${turn} 409 乐观锁,下轮重取 revision`); continue; }
  }
  await finishTask(sid);
  return { ok: true };
}

// ---------------- main ----------------
const st = runState(RUN);
const snap = pathSnapshot(acct.userId, st.startedAt);
if (!snap) { log('未找到 B 的新路径'); process.exit(1); }
log(`路径: ${snap.title} · ${snap.taskCount} 任务`);
const todo = snap.tasks.filter(t => t.status !== 'completed');
log(`待完成 ${todo.length}/${snap.taskCount}`);

for (let i = 0; i < todo.length; i++) {
  const t = todo[i];
  const r = await runTask(t.id, t.title, (runState(RUN).lessonsDone || 0) + 1);
  if (!r.ok) { log('任务失败停机: ' + r.reason); setRunState(RUN, { phase: 'stalled', lastError: r.reason }); process.exit(1); }
  const done = (runState(RUN).lessonsDone || 0) + 1;
  setRunState(RUN, { lessonsDone: done, phase: 'learning' });
  log(`已完成 ${done}/${snap.taskCount}`);
}
setRunState(RUN, { phase: 'learn-done' });
log('B1 全部任务完成!');
