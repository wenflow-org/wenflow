/**
 * 离线重建 A1 课程报告 — 从 DB 全量对话重建(修正课界归属 bug 的产物)
 * 用法: node scripts/deep-run/rebuild-lessons.mjs --run=A1
 * 数据源: subtasks(任务) × teaching_sessions(status=completed,全量 messages/wrapup/knowledgeState)
 */
import {
  qa, q, log, arg, accounts, pathSnapshot, runState, now, writeLessonReport,
} from './lib.mjs';

const RUN = arg('run', 'A1');
const which = arg('user', 'A');
const acct = accounts()[which];
if (!acct) { log('accounts.json 无该用户: ' + which); process.exit(1); }
const sinceIso = runState(RUN).startedAt;

const snap = pathSnapshot(acct.userId, sinceIso);
if (!snap) { log('未找到本 run 的路径'); process.exit(1); }
log(`路径: ${snap.title} | 任务 ${snap.taskCount}`);

const done = snap.tasks.filter(t => t.status === 'completed');
log(`已完成 ${done.length}/${snap.taskCount}`);

for (let i = 0; i < done.length; i++) {
  const t = done[i];
  const ts = q('SELECT id, status, messages, wrapup, knowledgeState, startTime, endTime FROM teaching_sessions WHERE taskId=? ORDER BY createdAt DESC LIMIT 1', [t.id]);
  let turns = [], cps = [], source = 'messages-json';
  if (ts?.messages) {
    try {
      const arr = JSON.parse(ts.messages);
      if (Array.isArray(arr)) {
        turns = arr;
        cps = arr.filter(m => String(m.analysis?.checkpointId || m.checkpointId || m.analysis?.type || '').length > 0 && JSON.stringify(m).includes('checkpoint'));
      }
    } catch { /* 全量消息解析失败则退化为空 */ }
  }
  // 兜底(ISSUE-9):任务 completed 但会话未终态化时,全量 JSON 为空,从增量表恢复
  if (!turns.length && ts?.id) {
    const inc = qa('SELECT payload FROM teaching_session_messages WHERE sessionId=? ORDER BY createdAt', [ts.id]);
    turns = inc.map(r => { try { return JSON.parse(r.payload); } catch { return { role: '?', content: String(r.payload).slice(0, 200) }; } });
    if (turns.length) source = 'incremental-rows(会话未终态化,数据来自增量表)';
  }
  const userTurns = turns.filter(m => m.role === 'user');
  const aiTurns = turns.filter(m => m.role === 'assistant');
  const durMin = ts?.startTime && ts?.endTime ? Math.max(1, Math.round((new Date(ts.endTime) - new Date(ts.startTime)) / 60000)) : null;
  let knowledge = [];
  try { knowledge = JSON.parse(ts?.knowledgeState || '[]'); } catch { /* 忽略 */ }
  let wrapupTxt = '';
  try {
    const w = ts?.wrapup ? JSON.parse(ts.wrapup) : null;
    wrapupTxt = w ? String(w.summary || w.text || JSON.stringify(w)).slice(0, 500) : '';
  } catch { wrapupTxt = String(ts?.wrapup || '').slice(0, 500); }

  const timeline = [];
  for (let k = 0; k < turns.length; k++) {
    const m = turns[k];
    const who = m.role === 'assistant' ? 'AI' : '周敏';
    const text = String(m.content || '').replace(/\s+/g, ' ').slice(0, 150);
    timeline.push(`- [${k + 1}] ${who}: ${text}`);
  }
  const md = [
    `# ${RUN} · 第 ${i + 1} 课报告(离线重建 ${now()})`,
    '',
    `- 任务: ${t.title} | 类型 ${t.taskType} | 计划 ${t.estimatedMinutes} 分钟 | 认知 ${t.cognitiveLevel}`,
    `- 验收标准: ${t.acceptanceCriteria || '-'}`,
    `- 实况: 课堂回合 ${turns.length}(周敏 ${userTurns.length} / AI ${aiTurns.length}) | 课堂计时 ${durMin ?? '-'} 分钟 | 计划 ${t.estimatedMinutes} 分钟 | 数据源: ${source}`,
    `- 结算: ${t.status} | 完成时间 ${t.completedAt || '-'}`,
    '',
    '## 知识点掌握(会话末快照)',
    ...(knowledge.length ? knowledge.map(k => `- ${k.name}: ${k.status} ${k.progress}%`) : ['- (无记录)']),
    '',
    '## wrapup',
    wrapupTxt || '(无)',
    '',
    '## 课堂全时间线',
    ...timeline,
  ].join('\n');
  const f = writeLessonReport(RUN, i + 1, md);
  log(`L${String(i + 1).padStart(2, '0')} 重建: ${t.title.slice(0, 24)} | 回合 ${turns.length} | ${f}`);
}
log('重建完成');
