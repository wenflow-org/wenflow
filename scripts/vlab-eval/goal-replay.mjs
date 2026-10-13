// Goal 提问回测：重放一段目标对话（opening + 用户各轮回答），打印 Agent 每轮问句，
// 观察它是否「一问一收」、是否漏问决定性维度（如应试的题型）。
// 用法：
//   node scripts/vlab-eval/goal-replay.mjs --case=guide-exam --base=http://127.0.0.1:3011
//   node scripts/vlab-eval/goal-replay.mjs --file=path/to/case.json
// 只读 DB，所有变更走 HTTP；每轮打印 [stage] + ai 文本，并标注是否命中「题型/范围/时长」等关键词。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const PASSWORD = 'GoalReplay2026';

const CASES = {
  'guide-exam': {
    name: '幼师·园内考《3-6岁指南》·碎片时间·没给范围/题型',
    opening: '我想学3-6岁儿童发展指南，最近要考试了，我要过一下',
    followUps: [
      '幼儿园内考试',
      '时间很紧，之前完全没接触过',
      '一个月左右',
      '只能利用碎片时间，说不准',
      '没给范围，就说考指南',
    ],
  },
};

const caseId = arg('case', 'guide-exam');
const fileCase = arg('file', '');
const CASE = fileCase ? JSON.parse(fs.readFileSync(fileCase, 'utf8')) : CASES[caseId];
if (!CASE) { console.error('未知 case:', caseId); process.exit(1); }

let cookie = '';
async function req(method, urlPath, body) {
  const headers = { Origin: 'http://localhost:5173' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
  const sc = res.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const KEY = /题型|范围|选择|填空|简答|判断|多大|多久|多长时间|几次|每次|形态/;
function log(line) { console.log(line); }

(async () => {
  const uname = 'greplay-' + (fileCase ? path.basename(fileCase, '.json') : caseId);
  const reg = await req('POST', '/api/auth/register', { name: uname, password: PASSWORD, remember: true });
  log(`register ${uname} -> ${reg.status}`);
  const lg = await req('POST', '/api/auth/login', { name: uname, password: PASSWORD, remember: true });
  if (!cookie) { console.error('登录失败', lg.status, JSON.stringify(lg.json).slice(0, 200)); process.exit(1); }
  log(`login ok`);

  const s = await req('POST', '/api/goal-conversation/start', { input: { text: CASE.opening } });
  const d = s.json?.data || {};
  let core = d.internal?.core || {};
  const cid = core.conversationId;
  log(`\n=== 回测：${CASE.name} ===`);
  log(`会话 ${cid} stage=${core.stage}`);
  log(`\n[用户] ${CASE.opening}`);
  log(`\n[AI] ${d.userVisible || ''}`);
  log(`   → 命中关键维度词: ${KEY.test(d.userVisible || '') ? 'YES' : 'no'}`);

  const fus = [...(CASE.followUps || [])];
  let guard = 10;
  while (fus.length && guard-- > 0) {
    const snap = await req('GET', '/api/goal-conversation/' + cid);
    core = snap.json?.data?.internal?.core || {};
    if (core.stage === 'completed' || core.learningPath?.id) { log(`\n[stage=${core.stage}] 已生成路径 ${core.learningPath?.id || ''} → 停止`); break; }
    if (core.stage === 'proposing') { log(`\n[stage=proposing] 进入提案，停止重放（不再注入后续回答）`); break; }
    const text = fus.shift();
    const r = await req('POST', `/api/goal-conversation/${cid}/reply`, { input: { text } });
    const rd = r.json?.data || {};
    log(`\n[用户] ${text}`);
    log(`\n[AI] ${rd.userVisible || ''}`);
    log(`   → 命中关键维度词: ${KEY.test(rd.userVisible || '') ? 'YES' : 'no'} | stage=${rd.internal?.core?.stage || '?'}`);
    if (r.status === 422) { log(`   (422 恢复信封)`); }
  }
  log('\n=== 重放结束 ===');
})().catch((e) => { console.error(e); process.exit(1); });
