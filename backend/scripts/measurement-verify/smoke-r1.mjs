// measurement-verify 第一轮预检冒烟：注册全新账号 -> 登录拿 cookie -> goal-conversation/start SSE
// 用法：node backend/scripts/measurement-verify/smoke-r1.mjs [baseUrl=http://127.0.0.1:3011]
// 说明：注册名不能用 mv-smoke-r1@test.local —— auth.ts:147 USERNAME_PATTERN=/^[\p{L}\p{N}_-]+$/u
//       不允许 @ 和 .，故用 mv-smoke-r1（时间戳后缀防重）。
const BASE = process.argv[2] || 'http://127.0.0.1:3011';
const NAME = `mv-smoke-r1-${Date.now().toString(36).slice(-4)}`;
const PASSWORD = 'MvSmoke2026x';
const GOAL_TEXT = '我是初中二年级学生，想在两个月内系统掌握初中生物的「光合作用与呼吸作用」这部分，每天能学 30 分钟。请按这个目标帮我规划。';
const ORIGIN = 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const setCookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, setCookie };
}

// ---- 1. 注册（429/5xx 退避 30s，至多 3 次） ----
let reg;
for (let attempt = 0; attempt <= 3; attempt++) {
  reg = await postJson('/api/auth/register', { name: NAME, password: PASSWORD, remember: true });
  console.log(`[register] ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
  if (reg.status < 400 || (reg.status !== 429 && reg.status < 500)) break;
  if (attempt < 3) { console.log(`backoff 30s (attempt ${attempt + 1}/3)`); await sleep(30000); }
}
if (reg.status >= 400) { console.log('SMOKE-FAIL: register'); process.exit(1); }

// ---- 2. 登录 ----
const login = await postJson('/api/auth/login', { name: NAME, password: PASSWORD, remember: true });
console.log(`[login] ${login.status} success=${login.json?.success} setCookie=${login.setCookie ? 'yes(' + login.setCookie.split('=')[0] + ')' : 'NO'}`);
if (login.status >= 400 || !login.setCookie) { console.log('SMOKE-FAIL: login'); process.exit(1); }
const cookie = login.setCookie;

// ---- 3. goal-conversation/start（SSE） ----
const t0 = Date.now();
const res = await fetch(BASE + '/api/goal-conversation/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN, Accept: 'text/event-stream' },
  body: JSON.stringify({ input: { text: GOAL_TEXT } }),
  signal: AbortSignal.timeout(300000),
});
console.log(`[goal-start] status=${res.status} content-type=${res.headers.get('content-type')}`);
if (res.status !== 200) { console.log('SMOKE-FAIL: goal-start ' + await res.text().then(t => t.slice(0, 300))); process.exit(1); }

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '', events = [], sseOk = false, firstDeltaAt = null, doneAt = null;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (line.startsWith('event:')) { events.push(line.slice(6).trim()); sseOk = true; if (!firstDeltaAt) firstDeltaAt = Date.now() - t0; }
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (d && d !== '[DONE]') {
        try { const j = JSON.parse(d); if (j.conversationId || j.data?.conversationId) { var convId = j.conversationId || j.data?.conversationId; } } catch {}
      }
    }
  }
  if (events.length > 40) break; // 已证明 SSE 正常即可，不烧多余 token
}
doneAt = Date.now() - t0;
console.log(`[goal-start] sseEvents=${events.slice(0, 12).join(',')}${events.length > 12 ? '...' : ''} firstEventAt=${firstDeltaAt}ms streamEndedAfter=${doneAt}ms conversationId=${convId || 'n/a'}`);
// 判定必须看事件语义：上游 DS 池会抖动 403 AUTH_INVALID（表现为单个 event:error 后断流），
// 只见到 event: 行不算通过——final/done 才是完成。
const completed = events.includes('final') || events.includes('done');
if (!completed && events.includes('error')) {
  console.log('SMOKE-FAIL: upstream error event (常见=DS 池 403 "No active subscription found for this group"，退避 30s 重试，池抖动时重试可过)');
  process.exit(1);
}
console.log(completed ? 'SMOKE-OK' : 'SMOKE-FAIL: no final/done events');
