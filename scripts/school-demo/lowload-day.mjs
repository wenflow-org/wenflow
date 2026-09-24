#!/usr/bin/env node
/**
 * 低耐受 VL（正确顶层 profile 形状）+ 跨日模拟 探针
 * 目的：验证 (1) 负荷收紧是否生效；(2) 跨日模拟下负担曲线/降载档是否出现。
 * 用法: node scripts/school-demo/lowload-day.mjs --phase=create|upload|goal|accept|days|status
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:3010';
const OUT = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');
const KEY = 'L1';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; }));
const PHASE = String(args.phase || 'status');
const STATE = path.join(OUT, `${KEY}-state.json`);
const loadState = () => fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify({ ...loadState(), ...s }, null, 2));

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const g = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
let cookie = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function login() {
  const r = await fetch(`${BASE}/api/admin-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: g('INIT_ADMIN_NAME'), password: g('INIT_ADMIN_PASSWORD'), remember: true }) });
  cookie = (r.headers.get('set-cookie') || '').match(/wenflow_admin_token=[^;]+/)[0];
}
async function call(method, p, body, opts = {}) {
  const { noPace = false, retries = 4, timeout = 600000 } = opts;
  if (!noPace) await sleep(4500);
  for (let a = 1; a <= retries; a++) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      clearTimeout(to); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      if ((r.status === 429 || r.status === 409 || r.status >= 500) && a < retries) { await sleep(20000 * a); continue; }
      return { status: r.status, ok: r.ok, json: j, text: t };
    } catch (e) { clearTimeout(to); if (a < retries) { await sleep(15000); continue; } return { status: 0, ok: false, error: String(e.message) }; }
  }
}

// 关键：persona 字段全部放**顶层**（对齐内置 preset 形状）
const profile = {
  nameHint: '周小雨', age: 12, occupation: '小学六年级学生', education: '城区小学在读',
  // 顶层负荷画像（path-phase 从这里读）
  availableTime: 'minimal',                    // 时间极少 → 紧预算
  cognitiveLoadTolerance: 'low',               // 低耐受 → 资源收紧
  overloadReaction: '一做长题就走神，坐不住',
  knownConcepts: ['四则运算', '分数'],
  struggleConcepts: ['应用题建模', '行程问题'],
  learningStyle: 'watching', motivationType: 'necessity',
  behavioralProfileSummary: '时间极少、认知负荷耐受低的小学生',
  storyPool: [{
    id: 'story_L1-lowload',
    title: '想学会行程问题但时间很少',
    sourceType: 'study',
    storyTriggerEvent: '每天只有十几分钟能学，父母忙没人辅导',
    storyOutline: '周小雨六年级，每天只有零碎十几分钟可支配，一遇到长题就坐不住。想用这点时间把行程问题学会。',
    visibleOpening: '我六年级，平时作业多，每天只有十几分钟能学，一遇到长题就走神坐不住。我想用这点时间把行程问题这一块学会，你能帮我弄一个每次时间短一点、能坚持下来的学习计划吗？',
    pressurePoints: ['时间少', '坐不住'],
    problemKnowledge: { domainFamiliarity: 'medium', knownConcepts: ['四则运算', '分数'], struggleConcepts: ['应用题建模', '行程问题'], selfAssessment: '自认"我坐不住"', hiddenGaps: ['不知道要先画图找关系'] }
  }]
};

async function phaseCreate() {
  await login();
  const list = await call('GET', '/api/admin/virtual-learners?limit=300', null, { noPace: true });
  const items = list.json?.data?.profiles || [];
  const found = items.find(i => { try { const pr = typeof i.profile === 'string' ? JSON.parse(i.profile) : i.profile; return pr?.nameHint === '周小雨' && (i.tags || []).includes('lowload-demo'); } catch { return false; } });
  if (found) { console.log('已存在', found.id); saveState({ profileId: found.id, userId: found.userId }); return; }
  const r = await call('POST', '/api/admin/virtual-learners', {
    name: '周小雨-低耐受demo', profile, learningGoal: '用碎片时间学会行程问题', knowledgeLevel: 'beginner',
    knownConcepts: ['四则运算', '分数'], struggleConcepts: ['应用题建模', '行程问题'],
    tags: ['lowload-demo'], notes: '跨日模拟+低耐受探针 2026-09-23'
  });
  const vl = r.json?.data;
  console.log('建 VL:', r.status, vl?.id);
  if (vl) saveState({ profileId: vl.id, userId: vl.userId });
}
async function ensureProj() {
  const pid = loadState().profileId;
  const r = await fetch(`${BASE}/api/admin/virtual-learners/${pid}/projection-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' }, body: JSON.stringify({ scope: 'full' }) });
  return (await r.json()).data.token;
}
async function phaseUpload() {
  await login();
  const tok = await ensureProj();
  const f = path.join(OUT, 'corpus', '小学·行程问题-智慧山.md');
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
  const r = await fetch(`${BASE}/api/materials`, { method: 'POST', headers: { 'x-projection-token': tok, Origin: 'http://localhost:5173' }, body: fd });
  const j = await r.json(); console.log('上传:', r.status, j?.data?.charCount);
}
async function phaseGoal() {
  await login();
  const pid = loadState().profileId;
  const sr = await call('POST', `/api/admin/virtual-learners/${pid}/start-session`, { storyId: 'story_L1-lowload' });
  const sid = sr.json?.data?.session?.id || sr.json?.data?.id || sr.json?.data?.sessionId;
  saveState({ sessionId: sid }); console.log('start-session:', sid);
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/step`, {}, { timeout: 420000 });
    const d = r.json?.data || {};
    console.log(`step ${i + 1}:`, d.currentStage || '?');
    if (d.currentStage && d.currentStage !== 'goal') break;
  }
  await call('POST', `/api/admin/virtual-learners/sessions/${sid}/review-path`, {});
  await call('POST', `/api/admin/virtual-learners/sessions/${sid}/accept-path`, { force: true });
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ pathId: st.json?.data?.learningPathId });
  console.log('pathId:', st.json?.data?.learningPathId);
}
async function phaseDays() {
  await login();
  const sid = loadState().sessionId;
  const days = Number(args.days || 6);
  // 会话级开启模拟时钟（不动全局设置）
  const base = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cfg = await call('PUT', `/api/admin/virtual-learners/sessions/${sid}/simulation-config`, { simulationClock: { enabled: true, baseDate: base, autoAdvance: false } });
  console.log('开时钟:', cfg.status, JSON.stringify(cfg.json?.data?.simulationClock || cfg.json?.data || {}).slice(0, 160));
  for (let d = 0; d < days; d++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/advance-day`, { days: 1, runTasks: true }, { timeout: 1800000, retries: 2 });
    const j = r.json?.data || {};
    console.log(`day ${d + 1}:`, r.status, '| started:', j.learning?.started, '| stage:', j.currentStage, '| err:', (j.error || r.json?.error?.message || '').slice(0, 80));
    if (r.status === 409) { console.log('   (跳过)', r.json?.error?.message); }
  }
}
async function phaseStatus() {
  await login();
  const sid = loadState().sessionId; const pid = loadState().pathId;
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  console.log('session:', JSON.stringify({ stage: st.json?.data?.currentStage, status: st.json?.data?.status, tasks: (st.json?.data?.completedTasks || 0) + '/' + (st.json?.data?.totalTasks || 0) }));
  const cl = await call('GET', `/api/admin/virtual-learners/sessions/${sid}/simulation-clock`, null, { noPace: true });
  console.log('clock:', JSON.stringify(cl.json?.data || {}).slice(0, 260));
}
switch (PHASE) {
  case 'create': await phaseCreate(); break;
  case 'upload': await phaseUpload(); break;
  case 'goal': await phaseGoal(); break;
  case 'days': await phaseDays(); break;
  case 'status': await phaseStatus(); break;
}
