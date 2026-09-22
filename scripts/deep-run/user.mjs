/**
 * 学习者 B(模拟真实学习者)驱动器 — 用户端 API,交互式逐轮
 *
 * 用法: node scripts/deep-run/user.mjs <cmd> [args] [--run=B1]
 *   goal --text "..."        开启目标对话(无会话时)或追加一轮学习者发言
 *   goal --confirm           确认方案,触发路径生成
 *   goal --show              查看当前对话
 *   path-watch               轮询路径生成并输出结构审计
 *   tasks                    列出路径任务与状态
 *   open <taskId>            开课堂
 *   state                    课堂状态(阶段/待答 checkpoint)
 *   say "..."                课堂发言(SSE 响应自动聚合)
 *   checkpoint <id> --choice=<idx|text>  提交测验答案
 *   end [--action=complete_task|end_only] 课堂结算(end+finalize)
 *   status                   全局状态
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getCookie, BASE, JOURNAL_DIR, log, arg, accounts, pathSnapshot,
  writeText, runState, setRunState, sleep, now,
} from './lib.mjs';

const RUN = arg('run', 'B1');
const acct = accounts().B;

function journal(rec) {
  fs.appendFileSync(path.join(JOURNAL_DIR, `${RUN}.jsonl`), JSON.stringify(rec) + '\n');
}

const AI_PACE = 4500;
let lastAt = 0;

async function api(method, urlPath, body, opts = {}) {
  if (opts.pace ?? method !== 'GET') {
    const wait = lastAt + AI_PACE - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  }
  const t0 = Date.now();
  const headers = { Cookie: await getCookie('user'), Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  const res = await fetch(BASE + urlPath, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 300000),
  });
  const ctype = res.headers.get('content-type') || '';
  let out;
  if (ctype.includes('text/event-stream')) {
    const text = await res.text();
    out = {
      _sse: true,
      events: text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean)
        .map(e => { try { return JSON.parse(e); } catch { return e; } }),
    };
  } else {
    const text = await res.text();
    try { out = JSON.parse(text); } catch { out = { raw: text.slice(0, 500) }; }
  }
  journal({ ts: now(), action: opts.action || `${method} ${urlPath}`, method, path: urlPath, req: body ?? null, status: res.status, durMs: Date.now() - t0, res: out });
  const ok = res.ok && out?.success !== false;
  if (!ok) {
    const err = String(out?.error?.message || out?.error || out?.raw || JSON.stringify(out).slice(0, 200)).slice(0, 300);
    log(`! ${opts.action || urlPath} → ${res.status}: ${err}`);
    return { _failed: true, status: res.status, error: err, json: out };
  }
  return out;
}

const GC = '/api/goal-conversation';
const LP = '/api/learning';
const AT = '/api/ai-teaching';

// ---------------- goal ----------------
async function goal(text) {
  const st = runState(RUN);
  const confirm = arg('confirm', false);
  const show = arg('show', false);
  if (show || (!text && !confirm)) {
    if (!st.conversationId) { log('尚无对话,用 goal --text "<开场>" 开启'); return; }
    const r = await api('GET', `${GC}/${st.conversationId}`, undefined, { action: 'goal-show' });
    console.log(JSON.stringify(r.data ?? r, null, 2).slice(0, 3000));
    return;
  }
  if (!st.conversationId) {
    const r = await api('POST', `${GC}/start`, { input: { text } }, { action: 'goal-start', timeoutMs: 420000 });
    if (r._failed) return;
    const id = r?.data?.conversationId || r?.data?.id || r?.data?.conversation?.id || r?.data?.internal?.core?.conversationId;
    if (!id) { log('未取到 conversationId: ' + JSON.stringify(r.data).slice(0, 300)); return; }
    setRunState(RUN, { conversationId: id, startedAt: now(), phase: 'goal' });
    log('对话已开启: ' + id);
    console.log(JSON.stringify(r.data, null, 2).slice(0, 2500));
    return;
  }
  // API 要求确认时必须附带非空学习者发言(空文本 400:回复内容不能为空)
  const body = confirm ? { input: { text: text || '好的,按这个方案来,开始吧。' }, confirmProposal: true } : { input: { text } };
  const r = await api('POST', `${GC}/${st.conversationId}/reply`, body, { action: confirm ? 'goal-confirm' : 'goal-reply', timeoutMs: 420000 });
  if (r._failed) return;
  console.log(JSON.stringify(r.data ?? r, null, 2).slice(0, 3000));
  if (confirm) setRunState(RUN, { phase: 'path-generating' });
}

// ---------------- path ----------------
async function pathWatch() {
  const st = runState(RUN);
  let pathId = st.pathId;
  if (!pathId) {
    const list = await api('GET', `${LP}/paths`, undefined, { action: 'list-paths' });
    const rows = list?.data?.paths || (Array.isArray(list?.data) ? list.data : []);
    pathId = rows[0]?.id;
    if (!pathId) { log('列表中无路径'); return; }
    log('取最新路径: ' + pathId);
  }
  let genStatus = '';
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await api('GET', `${LP}/paths/${pathId}/generation-status`, undefined, { action: 'gen-status' });
    genStatus = r?.data?.status || r?.data?.phase || JSON.stringify(r?.data || {}).slice(0, 120);
    log('generation-status: ' + genStatus);
    if (['completed', 'ready', 'failed', 'success'].includes(String(genStatus).toLowerCase())) break;
    await sleep(8000);
  }
  setRunState(RUN, { pathId, phase: String(genStatus).toLowerCase() === 'failed' ? 'path-failed' : 'path-ready' });
  const snap = pathSnapshot(acct.userId, st.startedAt);
  if (!snap || snap.pathId !== pathId) { log('结构快照与 pathId 不一致,人工核对'); return; }
  const md = [
    `# ${RUN} 路径结构审计(${now()})`,
    `- 标题: ${snap.title || snap.name} | subject: ${snap.subject} | status: ${snap.status} | difficulty: ${snap.difficulty}`,
    `- 体量: 里程碑 ${snap.milestoneCount} · 任务 ${snap.taskCount} · 总计 ${snap.totalMinutes} 分钟(${(snap.totalMinutes / 60).toFixed(1)}h)`,
    '',
    '## 里程碑',
    ...snap.milestones.map(m => `- M${m.stageNumber}: ${m.title}(预估 ${m.estimatedHours ?? '?'}h,状态 ${m.status})`),
    '',
    '## 任务明细',
    ...snap.tasks.map((t, i) => {
      const mm = snap.milestones.find(x => x.id === t.milestoneId);
      return `- T${i + 1}[M${mm?.stageNumber}] ${t.title} | ${t.estimatedMinutes}min | ${t.taskType} | 认知 ${t.cognitiveLevel ?? '-'} | ${t.status}`;
    }),
  ].join('\n');
  log('审计已写: ' + writeText(`lessons/${RUN}-path.md`, md));
  console.log(md);
}

// ---------------- learn ----------------
async function tasksCmd() {
  const st = runState(RUN);
  const snap = pathSnapshot(acct.userId, st.startedAt);
  if (!snap) { log('无路径'); return; }
  snap.tasks.forEach((t, i) => {
    const mm = snap.milestones.find(x => x.id === t.milestoneId);
    console.log(`T${i + 1} id=${t.id} [${t.status}] M${mm?.stageNumber} ${t.title} (${t.estimatedMinutes}min)`);
  });
}

async function open(taskIdArg) {
  const taskId = taskIdArg || runState(RUN).currentTaskId;
  if (!taskId) { log('缺 taskId — 先跑 tasks'); return; }
  const r = await api('POST', `${AT}/tasks/${taskId}/session`, {}, { action: 'open-class', timeoutMs: 420000 });
  if (r._failed) return;
  const d = r.data || {};
  const sessionId = d.id || d.sessionId || d.session?.id;
  setRunState(RUN, { currentTaskId: taskId, classSessionId: sessionId, phase: 'in-class' });
  log('课堂已开: ' + sessionId);
  console.log(JSON.stringify(d, null, 2).slice(0, 2200));
}

async function state() {
  const { classSessionId } = runState(RUN);
  if (!classSessionId) { log('课堂未开'); return; }
  const r = await api('GET', `${AT}/sessions/${classSessionId}/detail`, undefined, { action: 'class-detail' });
  if (r._failed) return;
  const d = r.data || {};
  console.log(JSON.stringify({
    stage: d.stage || d.teachingState?.stage,
    pendingCheckpoint: d.pendingCheckpoint || d.checkpoint?.pending || null,
    load: d.load || d.loadState,
    knowledge: d.knowledgeState,
  }, null, 2).slice(0, 2500));
}

async function say(text) {
  const { classSessionId } = runState(RUN);
  if (!classSessionId) { log('课堂未开'); return; }
  if (!text) { log('用法: say "<发言>"'); return; }
  // 契约:{message, revision}(旧 {content} 报 400 缺少消息内容);revision 取自 detail 乐观锁
  const d0 = await api('GET', `${AT}/sessions/${classSessionId}/detail`, undefined, { action: 'say-rev', pace: false });
  if (d0._failed) return;
  const r = await api('POST', `${AT}/sessions/${classSessionId}/messages`, { message: text, revision: d0.data?.revision }, { action: 'say', timeoutMs: 420000 });
  if (r._failed) return;
  console.log(JSON.stringify(r.data ?? r, null, 2).slice(0, 3000));
}

async function checkpoint(cpId) {
  const { classSessionId } = runState(RUN);
  const choice = arg('choice');
  if (!classSessionId || !cpId || choice === undefined) { log('用法: checkpoint <checkpointId> --choice=<idx|text>'); return; }
  const body = { answer: choice, answerIndex: /^\d+$/.test(String(choice)) ? Number(choice) : undefined };
  const r = await api('POST', `${AT}/sessions/${classSessionId}/checkpoints/${cpId}/submit`, body, { action: 'checkpoint-submit', timeoutMs: 420000 });
  if (r._failed) return;
  console.log(JSON.stringify(r.data ?? r, null, 2).slice(0, 2200));
}

async function end() {
  const { classSessionId } = runState(RUN);
  if (!classSessionId) { log('课堂未开'); return; }
  const action = arg('action', 'complete_task');
  // ISSUE-10 配方:end(带 revision)→ 重取 revision → finalize(rev' + Idempotency-Key)
  const d0 = await api('GET', `${AT}/sessions/${classSessionId}/detail`, undefined, { action: 'end-rev', pace: false });
  let r = await api('POST', `${AT}/sessions/${classSessionId}/end`, { revision: d0.data?.revision }, { action: 'class-end', timeoutMs: 420000 });
  if (r._failed) log('end 失败,仍尝试 finalize(幂等)');
  const d1 = await api('GET', `${AT}/sessions/${classSessionId}/detail`, undefined, { action: 'finalize-rev', pace: false });
  r = await api('POST', `${AT}/sessions/${classSessionId}/finalize`,
    { action, revision: d1.data?.revision },
    { action: 'finalize', idem: `user-${classSessionId.slice(-8)}-${Date.now()}`, timeoutMs: 420000 });
  if (!r._failed) {
    setRunState(RUN, { classSessionId: null, phase: 'between-tasks', lessonsDone: (runState(RUN).lessonsDone || 0) + 1 });
    log(`已结算(action=${action})`);
  }
  console.log(JSON.stringify(r.data ?? r, null, 2).slice(0, 2500));
}

async function status() {
  const st = runState(RUN);
  console.log('RUN 状态:', JSON.stringify(st, null, 2));
  const snap = pathSnapshot(acct.userId, st.startedAt);
  if (snap) {
    console.log(`路径: ${snap.title || snap.name} | ${snap.milestoneCount} 里程碑 / ${snap.taskCount} 任务 / ${snap.totalMinutes}min`);
    snap.tasks.forEach((t, i) => console.log(`  T${i + 1} ${t.status === 'completed' ? '[x]' : '[ ]'} ${t.title} (${t.estimatedMinutes}min)`));
  }
}

const cmd = process.argv[2];
const map = { goal, 'path-watch': pathWatch, tasks: tasksCmd, open, state, say, checkpoint, end, status };
if (!map[cmd]) { console.error('未知命令:', cmd, '| 可用:', Object.keys(map).join(' ')); process.exit(1); }
const posArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
const arg0 = (cmd === 'say' || cmd === 'goal') ? (posArg ?? arg('text')) : posArg;
map[cmd](arg0).catch(e => { console.error('FATAL', e); process.exit(1); });
