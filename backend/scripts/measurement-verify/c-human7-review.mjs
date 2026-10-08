// c-human7-review.mjs —— 复习链端到端验证（人形账号 c-human7-01）
// 前置：epoch-2 首课后 memory_traces 已有（本脚本前由外部把 dueAt 前移以造到期；
//       这是对测试账号的显式测试性操纵，真实用户流程中 dueAt 自然到期）。
// 用法：node c-human7-review.mjs
// 纪律：只打 3011；学生模型走 backend/.env 网关（不回显密钥）；DB 只读（验证另跑）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE = 'http://127.0.0.1:3011';
const NAME = 'c-human7-01';
const PASSWORD = 'HumanJourney2026';
const STATE_FILE = path.join(__dirname, 'out', 'c-human7-state.json');
const OUT_FILE = path.join(__dirname, 'out', 'c-human7-review.json');

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const AI_URL = envGet('AI_API_URL').replace(/\/+$/, '');
const AI_KEY = envGet('AI_API_KEY');
const AI_MODEL = 'deepseek-v4.1-flash';

async function gatewayChat(messages, { maxTokens = 800, temperature = 0.7 } = {}) {
  const res = await fetch(AI_URL + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(240000),
  });
  const j = await res.json().catch(() => ({}));
  return String(j?.choices?.[0]?.message?.content || '').trim();
}

let cookie = '';
async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: NAME, password: PASSWORD, remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('登录失败');
}
async function api(method, urlPath, body, { timeoutMs = 300000 } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { Cookie: cookie, Origin: 'http://localhost:5173', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok && json?.success !== false, json };
}

const STUDENT_SYSTEM = '你是一个正在上复习课的学生（吉他零基础，目标婚礼弹唱《平凡之路》）。只说你作为学生要说的话，口语、一到两句，不做元讨论。老师让你回忆/回答，就照实凭记忆答，记不清就说记不清。';

async function main() {
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const taskId = st.pathSnapshot.stages.flatMap((s) => s.subtasks)[0]?.id;
  if (!taskId) throw new Error('state 里没有 task');
  await login();

  const rec = { at: new Date().toISOString(), taskId, turns: [] };

  // 1) due 清单
  const due = await api('GET', '/api/ai-teaching/review/due');
  rec.dueBefore = { status: due.status, n: (due.json?.data?.items || due.json?.data || []).length, raw: JSON.stringify(due.json?.data || {}).slice(0, 300) };
  log(`due before: status=${due.status} n=${rec.dueBefore.n}`);

  // 2) 开始复习课
  const start = await api('POST', '/api/ai-teaching/review/sessions', { taskId }, { timeoutMs: 300000 });
  const d0 = start.json?.data || {};
  rec.sessionStart = { status: start.status, sessionId: d0.sessionId, mode: d0.mode, welcome: String(d0.welcomeMessage || '').slice(0, 200) };
  log(`review session: status=${start.status} session=${d0.sessionId} mode=${d0.mode}`);
  if (!d0.sessionId) { fs.writeFileSync(OUT_FILE, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec, null, 1)); return; }

  let revision = d0.revision;
  let lastTeacher = String(d0.welcomeMessage || '');

  // 3) 4 轮真实对话（含可能的课内温故应答）
  for (let i = 0; i < 4; i++) {
    const msgs = [
      { role: 'system', content: STUDENT_SYSTEM },
      { role: 'assistant', content: String(lastTeacher).slice(0, 1000) },
      { role: 'user', content: '（轮到你说下一句了）' },
    ];
    const say = (await gatewayChat(msgs)).slice(0, 300);
    const r = await api('POST', `/api/ai-teaching/sessions/${d0.sessionId}/messages`, { message: say, revision });
    const d = r.json?.data || {};
    revision = d.revision ?? revision;
    const pending = d.checkpoint || d.pendingCheckpoint || null;
    rec.turns.push({
      n: i + 1, student: say, status: r.status,
      teacher: String(d.aiResponse || '').slice(0, 400),
      checkpoint: pending ? { id: pending.id, options: (pending.options || []).map((o) => o.id) } : null,
      shouldConfirmEnd: !!d.shouldConfirmEnd, isCompletion: !!d.isCompletion,
    });
    lastTeacher = String(d.aiResponse || lastTeacher);
    log(`  turn${i + 1} status=${r.status} ckpt=${pending ? 'Y' : 'N'} end=${d.isCompletion ? 'C' : d.shouldConfirmEnd ? 's' : '-'}`);
    if (pending?.id) {
      // 复习课若出检查点，选第一个选项（真实学生行为近似）
      const optId = (pending.options || [])[0]?.id;
      if (optId) {
        const sub = await api('POST', `/api/ai-teaching/sessions/${d0.sessionId}/checkpoints/${pending.id}/submit`, { selectedOptionIds: [optId], revision });
        rec.turns[rec.turns.length - 1].checkpointSubmit = { status: sub.status, correct: sub.json?.data?.correct ?? null };
        if (sub.json?.data?.revision) revision = sub.json.data.revision;
        log(`  ckpt submit status=${sub.status}`);
      }
    }
    if (d.isCompletion || d.shouldConfirmEnd) break;
    await sleep(1500);
  }

  // 4) 收束
  const fin = await api('POST', `/api/ai-teaching/sessions/${d0.sessionId}/finalize`, { action: 'end_only', revision }, { timeoutMs: 300000 });
  const fd = fin.json?.data || {};
  rec.finalize = { status: fin.status, wrapup: fd.wrapup?.status || null };
  log(`finalize status=${fin.status} wrapup=${rec.finalize.wrapup}`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(rec, null, 1));
  console.log(JSON.stringify({ ok: true, sessionId: d0.sessionId, dueBefore: rec.dueBefore.n, finalize: rec.finalize }, null, 1));
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
