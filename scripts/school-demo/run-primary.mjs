#!/usr/bin/env node
/**
 * 学段课程 Demo 驱动器（小学·苏芮）
 * 链路：建 VL（含自定义 story）→ 上传课程语料 → start-session → run-full(goal→path→learn)
 * 用法:
 *   node scripts/school-demo/run-primary.mjs --phase=create
 *   node scripts/school-demo/run-primary.mjs --phase=upload
 *   node scripts/school-demo/run-primary.mjs --phase=goal
 *   node scripts/school-demo/run-primary.mjs --phase=learn [--maxMilestones=10] [--maxRounds=24]
 *   node scripts/school-demo/run-primary.mjs --phase=status
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:3010';
const OUT = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');
const JOURNAL = path.join(OUT, 'journal');
fs.mkdirSync(JOURNAL, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true];
}));
const PHASE = String(args.phase || 'status');
const MAX_MILESTONES = Number(args.maxMilestones || 10);
const MAX_ROUNDS = Number(args.maxRounds || 24);
const RUN = String(args.run || 'P1');

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const g = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
const ADMIN = { name: g('INIT_ADMIN_NAME'), password: g('INIT_ADMIN_PASSWORD') };
const STATE_FILE = path.join(OUT, `${RUN}-state.json`);
const loadState = () => fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...s }, null, 2));

let adminCookie = null;
let projectionToken = null;
const jlog = (o) => fs.appendFileSync(path.join(JOURNAL, `${RUN}.jsonl`), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ ...ADMIN, remember: true })
  });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/wenflow_admin_token=[^;]+/);
  if (!m) throw new Error('login failed: ' + r.status);
  adminCookie = m[0];
  console.log('✅ admin 登录成功');
}

async function call(method, urlPath, body, opts = {}) {
  const { noPace = false, retries = 4, timeout = 600000 } = opts;
  if (!noPace) await sleep(4500);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(`${BASE}${urlPath}`, {
        method, headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: 'http://localhost:5173' },
        body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal
      });
      clearTimeout(to);
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      jlog({ method, urlPath, status: r.status, ok: r.ok, resp: text.slice(0, 400) });
      if ((r.status === 429 || r.status === 409 || r.status >= 500) && attempt < retries) {
        const wait = 20000 * attempt;
        console.log(`   ⏳ ${r.status}，${wait / 1000}s 后重试（${attempt}/${retries}）`);
        await sleep(wait); continue;
      }
      return { status: r.status, ok: r.ok, json, text };
    } catch (e) {
      clearTimeout(to);
      if (attempt < retries) { console.log(`   ⚠ ${e.message}，重试 ${attempt}/${retries}`); await sleep(15000); continue; }
      return { status: 0, ok: false, error: String(e.message) };
    }
  }
}

const PRIMARY_STORY = {
  id: 'story_primary-su-rui-course',
  title: '想把行程问题这一块学会',
  sourceType: 'study',
  storyTriggerEvent: '奥数课上一道行程题完全不会做，妈妈说别人家孩子，回家做卷子做到一半哭了',
  storyOutline: '苏芮六年级，奥数班一道行程问题盯着十分钟一个字没写；妈妈接她时老师说"她基础不差就是不敢动笔"。她想把行程问题这一块系统学明白。',
  visibleOpening: '我六年级了，数学里行程问题这一块我一直搞不明白，从最基础的公式到相遇追及这些题，一遇到新题就不知道从哪下手，我想把这一块从头到尾系统学会，能一步一步自己做出来，你能帮我弄一个完整的学习计划吗？',
  pressurePoints: ['被比较', '被要求马上答出来'],
  problemKnowledge: {
    domainFamiliarity: 'medium',
    knownConcepts: ['四则运算', '分数', '平面图形面积'],
    struggleConcepts: ['应用题建模', '行程问题', '找规律'],
    selfAssessment: '自认"我就数学不好"',
    hiddenGaps: ['不知道应用题要先画图/找关系再列式']
  }
};

const PRIMARY_PROFILE = {
  personaSeed: {
    nameHint: '苏芮', age: 11, occupation: '小学六年级学生', education: '城区重点小学在读',
    knownConcepts: PRIMARY_STORY.problemKnowledge.knownConcepts,
    struggleConcepts: PRIMARY_STORY.problemKnowledge.struggleConcepts,
    learningStyle: 'watching', motivationType: 'social', availableTime: 'moderate',
    cognitiveLoadTolerance: '低——一次只能接收一小步',
    behavioralProfileSummary: '一个乖巧敏感、被鸡娃推着走、一难就退缩的小学生。'
  },
  storyPool: [PRIMARY_STORY]
};

async function getProfileId() {
  const s = loadState();
  if (s.profileId) return s.profileId;
  const list = await call('GET', '/api/admin/virtual-learners?limit=200', null, { noPace: true });
  const items = list.json?.data?.profiles || [];
  const p = items.find(i => {
    try { const pr = typeof i.profile === 'string' ? JSON.parse(i.profile) : i.profile;
      return pr?.personaSeed?.nameHint === '苏芮' && (i.tags || []).includes('school-demo'); } catch { return false; }
  });
  if (p) { saveState({ profileId: p.id, userId: p.userId }); return p.id; }
  return null;
}

async function ensureProjection() {
  const pid = await getProfileId();
  if (!pid) throw new Error('VL 不存在，先 --phase=create');
  const r = await fetch(`${BASE}/api/admin/virtual-learners/${pid}/projection-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: 'http://localhost:5173' },
    body: JSON.stringify({ scope: 'full' })
  });
  const j = await r.json();
  if (!j.data?.token) throw new Error('projection token 失败: ' + JSON.stringify(j).slice(0, 200));
  projectionToken = j.data.token;
  return j.data;
}

async function phaseCreate() {
  await login();
  let pid = await getProfileId();
  if (pid) { console.log('ℹ️ 已存在 VL', pid); return pid; }
  const r = await call('POST', '/api/admin/virtual-learners', {
    name: '苏芮-小学demo',
    profile: PRIMARY_PROFILE,
    learningGoal: '把小学数学行程问题这一块系统学会',
    knowledgeLevel: 'beginner',
    knownConcepts: PRIMARY_STORY.problemKnowledge.knownConcepts,
    struggleConcepts: PRIMARY_STORY.problemKnowledge.struggleConcepts,
    personalityTraits: { verbosity: 'terse', enthusiasm: 'low', patience: 'normal' },
    tags: ['school-demo', 'primary', 'math'],
    notes: '学段课程 demo：小学六年级·行程问题（2026-09-22）'
  });
  const vl = r.json?.data;
  console.log('建 VL:', r.status, vl?.id);
  if (vl) saveState({ profileId: vl.id, userId: vl.userId, name: vl.name });
  return vl?.id;
}

async function phaseUpload() {
  await login();
  const info = await ensureProjection();
  const corpus = process.argv.find(a => a.startsWith('--file='))?.slice(7)
    || path.join(OUT, 'corpus', '小学·行程问题-智慧山.md');
  const buf = fs.readFileSync(corpus);
  const name = path.basename(corpus);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  const r = await fetch(`${BASE}/api/materials`, {
    method: 'POST', headers: { 'x-projection-token': projectionToken, Origin: 'http://localhost:5173' }, body: fd
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  jlog({ method: 'POST', urlPath: '/api/materials(upload)', status: r.status, file: name, resp: text.slice(0, 500) });
  console.log('上传', name, '→', r.status, j?.success ? `OK id=${j.data?.id} 字数=${j.data?.charCount} 锚点=${j.data?.anchors?.length}` : text.slice(0, 300));
  if (j?.data) saveState({ materialId: j.data.id, materialChars: j.data.charCount, materialAnchors: j.data.anchors?.length });
  return j?.data;
}

async function phaseStart() {
  await login();
  const pid = await getProfileId();
  const r = await call('POST', `/api/admin/virtual-learners/${pid}/start-session`, { storyId: PRIMARY_STORY.id });
  const sid = r.json?.data?.session?.id || r.json?.data?.id || r.json?.data?.sessionId;
  console.log('start-session:', r.status, 'sessionId=', sid, r.ok ? '' : r.text?.slice(0, 300));
  if (sid) saveState({ sessionId: sid });
  return sid;
}

async function phaseStep(maxSteps = 12) {
  await login();
  const sid = loadState().sessionId;
  if (!sid) throw new Error('无 sessionId，先 --phase=start');
  for (let i = 0; i < maxSteps; i++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/step`, {}, { timeout: 420000 });
    const d = r.json?.data || {};
    console.log(`step ${i + 1}:`, r.status, 'stage=', d.currentStage || d.stage || '?', '| converged=', d.converged ?? d.goalConverged ?? '?');
    if (d.currentStage && d.currentStage !== 'goal') { console.log('✅ goal 阶段完成，进入', d.currentStage); break; }
    if (d.converged || d.stage === 'ready' || d.stage === 'completed') { console.log('✅ goal 收敛'); break; }
  }
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ stage: st.json?.data?.currentStage, pathStatus: st.json?.data?.stageResults?.path_review });
}

async function phaseRunFull() {
  await login();
  const sid = loadState().sessionId;
  if (!sid) throw new Error('无 sessionId，先 --phase=start');
  console.log(`▶ run-full: maxRounds=${MAX_ROUNDS} maxMilestones=${MAX_MILESTONES}`);
  const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/run-full`, {
    maxRounds: MAX_ROUNDS, maxMilestones: MAX_MILESTONES,
    continueOnTaskComplete: true, autoAdvanceToPath: true, autoAdvanceToLearning: true
  }, { timeout: 3000000, retries: 2 });
  const d = r.json?.data || {};
  console.log('run-full:', r.status, 'success=', r.json?.success);
  console.log(JSON.stringify(d).slice(0, 600));
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ runFullResult: d, stage: st.json?.data?.currentStage, learningPathId: st.json?.data?.learningPathId });
}

async function phaseStatus() {
  await login();
  const s = loadState();
  const sid = s.sessionId;
  if (!sid) { console.log('state:', JSON.stringify(s, null, 2)); return; }
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  const d = st.json?.data || {};
  console.log('session:', JSON.stringify({ stage: d.currentStage, status: d.status, learningPathId: d.learningPathId, completedTasks: d.completedTasks, totalTasks: d.totalTasks }, null, 2));
  const ps = await call('GET', `/api/admin/virtual-learners/sessions/${sid}/path-status`, null, { noPace: true });
  console.log('path-status:', JSON.stringify(ps.json?.data || {}).slice(0, 400));
}

async function phaseReviewAccept() {
  await login();
  const sid = loadState().sessionId;
  const rv = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/review-path`, {});
  console.log('review-path:', rv.status, (rv.text || '').slice(0, 200));
  const ac = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/accept-path`, { force: true });
  console.log('accept-path:', ac.status, (ac.text || '').slice(0, 200));
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ stage: st.json?.data?.currentStage });
  console.log('stage now:', st.json?.data?.currentStage);
}

async function phaseLearn() {
  await login();
  const sid = loadState().sessionId;
  const sl = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/start-learning`, {});
  console.log('start-learning:', sl.status, (sl.text || '').slice(0, 200));
  // 逐课推进：teaching-step until no more tasks
  for (let i = 0; i < 200; i++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/teaching-step`, {}, { timeout: 600000 });
    const d = r.json?.data || {};
    const cur = loadState();
    if (i % 5 === 0 || d.taskCompleted) console.log(`learn-step ${i + 1}:`, r.status, '| taskCompleted=', d.taskCompleted ?? '?', '| stage=', d.currentStage ?? '?');
    if (d.currentStage === 'completed' || d.sessionCompleted || d.allTasksCompleted) { console.log('✅ 全部课程完成'); break; }
    if (d.error && /无.*任务|已完成|no.*task/i.test(String(d.error))) { console.log('ℹ️', d.error); break; }
  }
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  const d = st.json?.data || {};
  console.log('final:', JSON.stringify({ stage: d.currentStage, status: d.status, tasks: (d.completedTasks || 0) + '/' + (d.totalTasks || 0) }));
  saveState({ finalStage: d.currentStage, completedTasks: d.completedTasks, totalTasks: d.totalTasks });
}

switch (PHASE) {
  case 'create': await phaseCreate(); break;
  case 'upload': await phaseUpload(); break;
  case 'start': await phaseStart(); break;
  case 'step': await phaseStep(Number(args.steps || 12)); break;
  case 'run-full': await phaseRunFull(); break;
  case 'review': await phaseReviewAccept(); break;
  case 'learn': await phaseLearn(); break;
  case 'status': await phaseStatus(); break;
  default: console.log('unknown phase', PHASE);
}
