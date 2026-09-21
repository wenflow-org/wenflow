/**
 * 学习者 A(虚拟学习者 周敏)深度驾驶器
 *
 * 用法: node scripts/deep-run/vl.mjs <stage> [--run=A1] [--story=<storyId|序号>] [--no-day]
 *   start      起新会话(选定故事),写 PROGRESS
 *   goal       逐轮推进 Goal 对话(每轮落日志,直到进入 path 阶段)
 *   path-watch 轮询路径生成,完成后输出结构审计(lessons/<run>-path.md)
 *   review     触发系统自身路径评审并落日志
 *   accept     接受路径(进入可学习状态)
 *   learn      逐课教学步进(taskCompleted 即课界:写课程报告 + 模拟日推进)
 *   wrap       生成结业 wrapup
 *   status     会话/路径/任务进度一览
 */
import {
  call, q, qa, log, arg, accounts, pathSnapshot,
  writeText, writeLessonReport, runState, setRunState, sleep, now,
} from './lib.mjs';

const RUN = arg('run', 'A1');
const stage = process.argv[2];
const acct = accounts().A;
const profileId = acct.profileId;

const VL = '/api/admin/virtual-learners';

async function getSession(sessionId) {
  const r = await call('admin', 'GET', `${VL}/sessions/${sessionId}`, undefined, { run: RUN, action: '读取会话', pace: false });
  return r?._failed ? null : (r.data || r);
}

async function resolveStory() {
  const detail = await call('admin', 'GET', `${VL}/${profileId}`, undefined, { run: RUN, action: '读取 profile' });
  const pool = detail?.data?.profile?.storyPool || [];
  const pick = arg('story');
  if (pick === undefined) return pool[0];
  const byIdx = pool[Number(pick) - 1];
  return byIdx && (byIdx.id === pick || pick === String(Number(pick))) ? byIdx : (pool.find(s => s.id === pick) || byIdx);
}

// ---------------- stages ----------------

async function start() {
  const story = await resolveStory();
  if (!story) throw new Error('故事池为空');
  log(`故事: ${story.title} (${story.id})`);
  const r = await call('admin', 'POST', `${VL}/${profileId}/start-session`, { storyId: story.id }, { run: RUN, action: '起会话' });
  const sessionId = r?.data?.id || r?.data?.sessionId;
  if (!sessionId) throw new Error('start-session 失败: ' + JSON.stringify(r).slice(0, 300));
  setRunState(RUN, { sessionId, storyId: story.id, storyTitle: story.title, startedAt: now(), phase: 'goal' });
  log(`会话已起: ${sessionId}`);
}

async function goal() {
  const { sessionId } = runState(RUN);
  if (!sessionId) throw new Error('先跑 start');
  const cap = Number(arg('rounds', 30));
  for (let i = 1; i <= cap; i++) {
    const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/step`, {}, { run: RUN, action: `goal-step#${i}`, timeoutMs: 420000 });
    if (r?._failed) { log(`step#${i} 失败,停止等待人工研判: ${r.error}`); setRunState(RUN, { phase: 'goal-stalled', lastError: r.error, round: i }); return; }
    const s = await getSession(sessionId);
    const stageNow = s?.currentStage;
    const status = s?.status;
    log(`step#${i}: stage=${stageNow} status=${status} err=${r?.data?.error || r?.error || '-'}`);
    if (stageNow && stageNow !== 'goal') { log('已离开 goal 阶段 → ' + stageNow); setRunState(RUN, { phase: 'path-generating', goalRounds: i }); return; }
    const NORMAL = ['running', 'active', 'in_progress'];
    if (status && !NORMAL.includes(status)) { log('会话状态异常: ' + status); setRunState(RUN, { phase: 'goal-stalled', sessionStatus: status }); return; }
  }
  log(`已达 ${cap} 轮上限,goal 未收敛 — 登记问题后人工研判`);
  setRunState(RUN, { phase: 'goal-stalled', goalRounds: cap });
}

async function pathWatch() {
  const { sessionId } = runState(RUN);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await call('admin', 'GET', `${VL}/sessions/${sessionId}/path-status`, undefined, { run: RUN, action: 'path-status', pace: false });
    const st = r?.data?.status;
    if (st === 'active' || st === 'ready' || st === 'completed') { log('path-status: ' + st + ' (就绪)'); break; }
    if (st === 'failed') { log('path-status: failed — 登记问题'); break; }
    await sleep(8000);
  }
  const snap = pathSnapshot(acct.userId, runState(RUN).startedAt);
  if (!snap) { log('未见生成路径'); return; }
  setRunState(RUN, { pathId: snap.pathId, phase: 'path-ready' });
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
  const f = writeText(`lessons/${RUN}-path.md`, md);
  log('结构审计已写: ' + f);
  console.log(md);
}

async function review() {
  const { sessionId } = runState(RUN);
  const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/review-path`, {}, { run: RUN, action: '路径评审', timeoutMs: 420000 });
  if (r?._failed) { log('评审失败: ' + r.error); return; }
  const d = r.data || {};
  log('评审结论: ' + JSON.stringify(d.decision || d.verdict || Object.keys(d)).slice(0, 300));
}

async function accept() {
  const { sessionId } = runState(RUN);
  const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/accept-path`, {}, { run: RUN, action: '接受路径' });
  if (r?._failed) { log('接受失败: ' + r.error); return; }
  setRunState(RUN, { phase: 'accepted' });
  log('路径已接受');
}

function taskDigest(messages) {
  // 从 teaching_sessions.messages(JSON)产出对话梗概
  try {
    const arr = typeof messages === 'string' ? JSON.parse(messages) : messages;
    if (!Array.isArray(arr)) return { turns: 0, lines: [] };
    const lines = arr.map(m => {
      const who = m.role === 'assistant' ? 'AI' : (m.role === 'user' ? '周敏' : (m.role || '?'));
      const kind = m.type && m.type !== 'text' ? `<${m.type}>` : '';
      const text = String(m.content?.text || m.content || '').replace(/\s+/g, ' ').slice(0, 140);
      return `- ${who}${kind}: ${text}`;
    });
    return { turns: arr.length, lines };
  } catch { return { turns: -1, lines: ['<messages 解析失败>'] }; }
}

async function learn() {
  const { sessionId } = runState(RUN);
  if (!sessionId) throw new Error('先跑 start/accept');
  let st = runState(RUN);
  if (!st.learningStarted) {
    const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/start-learning`, {}, { run: RUN, action: 'start-learning', timeoutMs: 420000 });
    if (r?._failed) { log('start-learning 失败: ' + r.error); setRunState(RUN, { phase: 'learn-stalled', lastError: r.error }); return; }
    setRunState(RUN, { learningStarted: true, phase: 'learning', lessonsDone: 0 });
    st = runState(RUN);
  }
  const advanceDay = !arg('no-day', false);
  const cap = Number(arg('steps', 90));
  let steps = 0, stuck = 0, lastMsgCount = -1;
  const digests = [];

  while (steps < cap) {
    steps++;
    const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/teaching-step`, {}, { run: RUN, action: `teach-step#${steps}`, timeoutMs: 600000 });
    if (r?._failed) {
      log(`teach-step#${steps} 失败,停机研判: ${r.error}`);
      setRunState(RUN, { phase: 'learn-stalled', lastError: r.error, steps });
      return;
    }
    const d = r.data || {};
    const s = await getSession(sessionId);
    const taskId = s?.currentTaskId;
    // 净进展信号 = 当前任务课堂消息数增长(任务完成数只在课界变化,不能当步进信号)
    const msgCount = taskId
      ? (q(`SELECT COUNT(*) c FROM teaching_session_messages WHERE sessionId=(SELECT id FROM teaching_sessions WHERE taskId=? ORDER BY createdAt DESC LIMIT 1)`, [taskId])?.c ?? 0)
      : 0;
    if (d.userMessage || d.aiResponse) {
      digests.push({
        n: steps,
        user: String(d.userMessage || '').replace(/\s+/g, ' ').slice(0, 120),
        ai: String(d.aiResponse || '').replace(/[*#]+/g, '').replace(/\s+/g, ' ').slice(0, 200),
      });
    }
    if (msgCount === lastMsgCount && !d.taskCompleted && !d.isPathCompleted) stuck++; else stuck = 0;
    lastMsgCount = msgCount;
    log(`teach-step#${steps}: task=${(taskId || '').slice(-6)} msgs=${msgCount} done=${s?.completedTasks ?? '?'}/${s?.totalTasks ?? '?'} taskCompleted=${!!d.taskCompleted} pathCompleted=${!!d.isPathCompleted} stuck=${stuck} err=${d.error || '-'}`);

    if (d.taskCompleted) {
      const idx = (runState(RUN).lessonsDone || 0) + 1;
      await lessonBoundary(sessionId, taskId, idx, digests.splice(0));
      setRunState(RUN, { lessonsDone: idx });
      if (advanceDay) {
        // retries=1:课界推进在 UTC 日窗内是预期内 409(未来日护栏),不值得退避重试
        const day = await call('admin', 'POST', `${VL}/sessions/${sessionId}/advance-day`, {}, { run: RUN, action: `advance-day(L${idx})`, retries: 1, timeoutMs: 600000 });
        log(`advance-day: ${day?._failed ? 'FAIL ' + day.error : 'ok'}`);
      }
    }
    if (d.isPathCompleted) { log('全路径任务完成!'); setRunState(RUN, { phase: 'learn-done' }); return; }
    if (d.currentTaskStopped) { log('当前任务被中止(见日志)'); }
    if (stuck >= 6) { log(`连续 ${stuck} 步课堂消息无增长,暂停防卡死 — 研判后可续跑`); setRunState(RUN, { phase: 'learn-stuck', steps }); return; }
  }
  log('步数上限,未完成 — 可用 --steps 加大续跑');
}

async function lessonBoundary(sessionId, taskId, idx, digests = []) {
  const task = taskId ? q('SELECT id,title,estimatedMinutes,taskType,acceptanceCriteria,status,cognitiveLevel FROM subtasks WHERE id=?', [taskId]) : null;
  const tsRow = taskId ? q('SELECT * FROM teaching_sessions WHERE taskId=? ORDER BY createdAt DESC LIMIT 1', [taskId]) : null;
  const dg = tsRow ? taskDigest(tsRow.messages) : { turns: 0, lines: [] };
  let wrapup = '';
  try { wrapup = tsRow?.wrapup ? JSON.stringify(JSON.parse(tsRow.wrapup)).slice(0, 600) : (tsRow?.wrapup || ''); } catch { wrapup = String(tsRow?.wrapup || '').slice(0, 600); }
  const timeline = digests.length
    ? digests.map(g => `- [步${g.n}] 周: ${g.user} / AI: ${g.ai}`)
    : dg.lines;
  const md = [
    `# ${RUN} · 第 ${idx} 课报告(${now()})`,
    '',
    `- 任务: ${task?.title || taskId} | 类型 ${task?.taskType || '?'} | 计划 ${task?.estimatedMinutes ?? '?'} 分钟`,
    `- 验收标准: ${task?.acceptanceCriteria || '-'}`,
    `- 课堂回合数: ${dg.turns} | 驾驶步数: ${digests.length ? digests[digests.length - 1].n : '-'}`,
    `- 结算状态: ${task?.status} | 认知层级: ${task?.cognitiveLevel ?? '-'}`,
    `- wrapup 摘要: ${wrapup || '(无)'}`,
    '',
    '## 课堂时间线(步级摘要)',
    ...timeline,
    '',
    '## 系统反应待填(人工研判后补)',
    '- checkpoint 出题与判卷:',
    '- 知识点掌握度变化:',
    '- 干预/伴学触发:',
    '- 异常与问题引用(ISSUE-xx):',
  ].join('\n');
  const f = writeLessonReport(RUN, idx, md);
  log(`第 ${idx} 课报告已写: ${f}`);
}

async function wrap() {
  const { sessionId } = runState(RUN);
  const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/wrapup`, {}, { run: RUN, action: 'wrapup', timeoutMs: 420000 });
  log(r?._failed ? 'wrapup 失败: ' + r.error : 'wrapup 完成: ' + JSON.stringify(r.data || {}).slice(0, 400));
}

async function status() {
  const st = runState(RUN);
  console.log('RUN 状态:', JSON.stringify(st, null, 2));
  if (st.sessionId) {
    const s = await getSession(st.sessionId);
    console.log('会话:', JSON.stringify({ currentStage: s?.currentStage, status: s?.status, currentTaskId: s?.currentTaskId, completedTasks: s?.completedTasks, totalTasks: s?.totalTasks }));
  }
  const snap = pathSnapshot(acct.userId, runState(RUN).startedAt);
  if (snap) {
    console.log(`路径: ${snap.title} | ${snap.milestoneCount} 里程碑 / ${snap.taskCount} 任务 / ${snap.totalMinutes}min`);
    snap.tasks.forEach((t, i) => console.log(`  T${i + 1} ${t.status === 'completed' ? '[x]' : '[ ]'} ${t.title} (${t.estimatedMinutes}min, ${t.status})`));
  }
}

async function replan() {
  const { sessionId } = runState(RUN);
  const r = await call('admin', 'POST', `${VL}/sessions/${sessionId}/replan-path`, {}, { run: RUN, action: '按评审重规划', timeoutMs: 600000 });
  if (r?._failed) { log('重规划失败: ' + r.error); return; }
  setRunState(RUN, { phase: 'path-generating', replannedAt: now(), replanCount: (runState(RUN).replanCount || 0) + 1 });
  log('重规划已触发,跑 path-watch 等新结构');
}

const stages = { start, goal, 'path-watch': pathWatch, review, replan, accept, learn, wrap, status };
if (!stages[stage]) { console.error('未知 stage:', stage, '| 可用:', Object.keys(stages).join(' ')); process.exit(1); }
stages[stage]().catch(e => { console.error('FATAL', e); process.exit(1); });
