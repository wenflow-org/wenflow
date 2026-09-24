#!/usr/bin/env node
/**
 * 学段课程 Demo 驱动器（四学段通用）
 * 用法:
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=create
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=upload
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=goal
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=review
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=learn
 *   node scripts/school-demo/run-band.mjs --band=primary --phase=status
 * bands: primary(小学) junior(初中) senior(高中) college(大学)
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
const BAND = String(args.band || 'primary');
const PHASE = String(args.phase || 'status');
const MAX_MILESTONES = Number(args.maxMilestones || 10);
const MAX_ROUNDS = Number(args.maxRounds || 24);

const BANDS = {
  primary: {
    label: '小学', run: 'P1', name: '苏芮-小学demo', nameHint: '苏芮', age: 11,
    occupation: '小学六年级学生', education: '城区重点小学在读', knowledgeLevel: 'beginner',
    goal: '把小学数学行程问题这一块系统学会',
    corpus: '小学·行程问题-智慧山.md',
    known: ['四则运算', '分数', '平面图形面积'], struggle: ['应用题建模', '行程问题', '找规律'],
    story: {
      title: '想把行程问题这一块学会',
      triggerEvent: '奥数课上一道行程题完全不会做，妈妈说别人家孩子，回家做卷子做到一半哭了',
      outline: '苏芮六年级，奥数班一道行程问题盯着十分钟一个字没写；老师说她基础不差就是不敢动笔。她想把行程问题这一块系统学明白。',
      opening: '我六年级了，数学里行程问题这一块我一直搞不明白，从最基础的公式到相遇追及这些题，一遇到新题就不知道从哪下手，我想把这一块从头到尾系统学会，能一步一步自己做出来，你能帮我弄一个完整的学习计划吗？',
      pressure: ['被比较', '被要求马上答出来'], selfAssessment: '自认"我就数学不好"',
      hiddenGaps: ['不知道应用题要先画图/找关系再列式'], domainFamiliarity: 'medium'
    }
  },
  junior: {
    label: '初中', run: 'J1', name: '李昊-初中demo', nameHint: '李昊', age: 15,
    occupation: '初三学生', education: '普通初中在读', knowledgeLevel: 'beginner',
    goal: '把一元二次方程这一章从头到尾学明白',
    corpus: '初中·一元二次方程-百度百科.md',
    known: ['一元二次方程', '基本函数', '一般现在时'], struggle: ['几何证明', '英语语法体系', '压轴题步骤分'],
    story: {
      title: '想把一元二次方程这一章学明白',
      triggerEvent: '一模低于普高线，老师谈话、爸爸施压',
      outline: '李昊初三，数学英语拖后腿，一模离普高线差 15 分，老师说他这样只能考虑职高。他心里不服，想先把一元二次方程这一章彻底学会。',
      opening: '我初三，数学里一元二次方程这一章我一直学得糊里糊涂，配方法、公式法、因式分解法老是混，判别式也不太会，考试就因为这块丢分，我想把这一章从头到尾系统学明白，你能帮我弄一个完整的学习计划吗？',
      pressure: ['被贴差生标签', '被拿排名比较'], selfAssessment: '自认"数学天生不行"',
      hiddenGaps: ['不知道失分来自基础断层而非智商'], domainFamiliarity: 'medium'
    }
  },
  senior: {
    label: '高中', run: 'S1', name: '孙浩-高中demo', nameHint: '孙浩', age: 18,
    occupation: '高三理科生', education: '省重点高中在读', knowledgeLevel: 'intermediate',
    goal: '把高中物理电磁感应这一块系统学透',
    corpus: '高中·法拉第电磁感应定律-高考圈.md',
    known: ['力学', '电磁感应', '化学方程式'], struggle: ['理综时间分配', '化学实验题', '生物遗传计算'],
    story: {
      title: '想把电磁感应这一块学透',
      triggerEvent: '二模理综时间不够，被老师点破不会考试',
      outline: '孙浩高三，物理想再往上提，电磁感应这块公式多、综合题难。他想把这一块系统学透，而不是零散刷题。',
      opening: '我高三，物理里电磁感应这一块我一直没真正学透，法拉第定律、楞次定律、感应电动势这些公式多、综合题一多就乱，我想把这一块从头到尾系统学明白，你能帮我弄一个完整的学习计划吗？',
      pressure: ['努力未被认可', '时间焦虑'], selfAssessment: '自认"知识点没问题，就是做不完"',
      hiddenGaps: ['不知道理综考的是取舍与节奏，不是全会'], domainFamiliarity: 'high'
    }
  },
  college: {
    label: '大学', run: 'C1', name: '陈嘉-大学demo', nameHint: '陈嘉', age: 20,
    occupation: '普通一本大二学生', education: '普通一本在读（高等数学）', knowledgeLevel: 'intermediate',
    goal: '把定积分这一章学完整',
    corpus: '大学·定积分换元与分部积分-博客园.md',
    known: ['极限', '导数', '不定积分'], struggle: ['换元积分法', '分部积分法', '定积分应用'],
    story: {
      title: '想把定积分这一章学完整',
      triggerEvent: '高数期中定积分换元题大面积失分，期末临近',
      outline: '陈嘉大二，高数期末快到了，定积分的换元法和分部积分法一直绕不过来。他想把这一章从头到尾学完整。',
      opening: '我大二，高等数学里定积分这一章我一直没学明白，换元积分法和分部积分法这两种方法老是绕不过来，一到综合题就不知道用哪个，期末快到了，我想把这一章从头到尾系统学完整，你能帮我弄一个完整的学习计划吗？',
      pressure: ['期末压力', '挂科焦虑'], selfAssessment: '自认"高数就是学不好"',
      hiddenGaps: ['不知道换元的关键是先看被积函数结构'], domainFamiliarity: 'medium'
    }
  }
};

if (!BANDS[BAND]) { console.error('unknown band', BAND); process.exit(2); }
const B = BANDS[BAND];
const RUN = B.run;
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const g = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
const ADMIN = { name: g('INIT_ADMIN_NAME'), password: g('INIT_ADMIN_PASSWORD') };
const STATE_FILE = path.join(OUT, `${RUN}-state.json`);
const loadState = () => fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...s }, null, 2));

let adminCookie = null, projectionToken = null;
const jlog = (o) => fs.appendFileSync(path.join(JOURNAL, `${RUN}.jsonl`), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ ...ADMIN, remember: true })
  });
  const m = (r.headers.get('set-cookie') || '').match(/wenflow_admin_token=[^;]+/);
  if (!m) throw new Error('login failed: ' + r.status);
  adminCookie = m[0];
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
      jlog({ band: BAND, method, urlPath, status: r.status, ok: r.ok, resp: text.slice(0, 400) });
      if ((r.status === 429 || r.status === 409 || r.status >= 500) && attempt < retries) {
        const wait = 20000 * attempt; console.log(`   ⏳ ${r.status}, retry in ${wait / 1000}s`); await sleep(wait); continue;
      }
      return { status: r.status, ok: r.ok, json, text };
    } catch (e) {
      clearTimeout(to);
      if (attempt < retries) { console.log(`   ⚠ ${e.message}, retry ${attempt}`); await sleep(15000); continue; }
      return { status: 0, ok: false, error: String(e.message) };
    }
  }
}

const story = {
  id: `story_${BAND}-${B.nameHint}-course`,
  title: B.story.title, sourceType: 'study',
  storyTriggerEvent: B.story.triggerEvent, storyOutline: B.story.outline,
  visibleOpening: B.story.opening, pressurePoints: B.story.pressure,
  problemKnowledge: {
    domainFamiliarity: B.story.domainFamiliarity, knownConcepts: B.known, struggleConcepts: B.struggle,
    selfAssessment: B.story.selfAssessment, hiddenGaps: B.story.hiddenGaps
  }
};
const profile = {
  personaSeed: {
    nameHint: B.nameHint, age: B.age, occupation: B.occupation, education: B.education,
    knownConcepts: B.known, struggleConcepts: B.struggle,
    behavioralProfileSummary: `${B.label}学段课程 demo 学习者`
  },
  storyPool: [story]
};

async function getProfileId() {
  const s = loadState();
  if (s.profileId) return s.profileId;
  const list = await call('GET', '/api/admin/virtual-learners?limit=200', null, { noPace: true });
  const items = list.json?.data?.profiles || [];
  const p = items.find(i => {
    try { const pr = typeof i.profile === 'string' ? JSON.parse(i.profile) : i.profile;
      return pr?.personaSeed?.nameHint === B.nameHint && (i.tags || []).includes('school-demo'); } catch { return false; }
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
  if (!j.data?.token) throw new Error('projection failed');
  projectionToken = j.data.token;
}

async function phaseCreate() {
  await login();
  let pid = await getProfileId();
  if (pid) { console.log(`ℹ️ ${B.name} 已存在`, pid); return pid; }
  const r = await call('POST', '/api/admin/virtual-learners', {
    name: B.name, profile, learningGoal: B.goal, knowledgeLevel: B.knowledgeLevel,
    knownConcepts: B.known, struggleConcepts: B.struggle,
    tags: ['school-demo', BAND], notes: `学段课程 demo：${B.label}（2026-09-22）`
  });
  const vl = r.json?.data;
  console.log(`建 ${B.label} VL:`, r.status, vl?.id);
  if (vl) saveState({ profileId: vl.id, userId: vl.userId, name: vl.name });
  return vl?.id;
}

async function phaseUpload() {
  await login(); await ensureProjection();
  const corpus = path.join(OUT, 'corpus', B.corpus);
  const buf = fs.readFileSync(corpus);
  const name = path.basename(corpus);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  const r = await fetch(`${BASE}/api/materials`, { method: 'POST', headers: { 'x-projection-token': projectionToken, Origin: 'http://localhost:5173' }, body: fd });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  jlog({ band: BAND, method: 'POST', urlPath: '/api/materials', status: r.status, file: name, resp: text.slice(0, 400) });
  console.log('上传', name, '→', r.status, j?.success ? `OK 字数=${j.data?.charCount} 锚点=${j.data?.anchors?.length}` : text.slice(0, 200));
  if (j?.data) saveState({ materialId: j.data.id, materialChars: j.data.charCount });
}

async function phaseStart() {
  await login();
  const pid = await getProfileId();
  const r = await call('POST', `/api/admin/virtual-learners/${pid}/start-session`, { storyId: story.id });
  const sid = r.json?.data?.session?.id || r.json?.data?.id || r.json?.data?.sessionId;
  console.log('start-session:', r.status, 'sid=', sid);
  if (sid) saveState({ sessionId: sid });
}

async function phaseGoal(maxSteps = 12) {
  await login();
  const sid = loadState().sessionId;
  for (let i = 0; i < maxSteps; i++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/step`, {}, { timeout: 420000 });
    const d = r.json?.data || {};
    console.log(`step ${i + 1}:`, r.status, 'stage=', d.currentStage || '?');
    if (d.currentStage && d.currentStage !== 'goal') { console.log('✅ goal→', d.currentStage); break; }
  }
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ stage: st.json?.data?.currentStage, learningPathId: st.json?.data?.learningPathId });
}

async function phaseReview() {
  await login();
  const sid = loadState().sessionId;
  await call('POST', `/api/admin/virtual-learners/sessions/${sid}/review-path`, {});
  const ac = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/accept-path`, { force: true });
  console.log('accept-path:', ac.status);
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${sid}`, null, { noPace: true });
  saveState({ learningPathId: st.json?.data?.learningPathId });
}

async function phaseLearn() {
  await login();
  const sid = loadState().sessionId;
  await call('POST', `/api/admin/virtual-learners/sessions/${sid}/start-learning`, {});
  for (let i = 0; i < 400; i++) {
    const r = await call('POST', `/api/admin/virtual-learners/sessions/${sid}/teaching-step`, {}, { timeout: 600000 });
    const d = r.json?.data || {};
    if (i % 5 === 0 || d.taskCompleted) console.log(`learn ${i + 1}:`, r.status, 'taskCompleted=', d.taskCompleted ?? '?');
    if (d.currentStage === 'completed' || d.sessionCompleted || d.allTasksCompleted) { console.log('✅ 全部完成'); break; }
  }
}

async function phaseStatus() {
  await login();
  const st = await call('GET', `/api/admin/virtual-learners/sessions/${loadState().sessionId}`, null, { noPace: true });
  console.log(JSON.stringify(st.json?.data ? { stage: st.json.data.currentStage, status: st.json.data.status, path: st.json.data.learningPathId } : loadState(), null, 2));
}

switch (PHASE) {
  case 'create': await phaseCreate(); break;
  case 'upload': await phaseUpload(); break;
  case 'start': await phaseStart(); break;
  case 'goal': await phaseGoal(Number(args.steps || 12)); break;
  case 'review': await phaseReview(); break;
  case 'learn': await phaseLearn(); break;
  case 'status': await phaseStatus(); break;
  default: console.log('unknown phase', PHASE);
}
