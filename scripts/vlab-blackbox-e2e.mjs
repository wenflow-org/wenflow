/* 黑盒 E2E：从 goal 起跑，逐黑盒 step 推进，直到终态或达到步数上限 */
import http from 'node:http';

const BASE = { hostname: 'localhost', port: 3001 };
const MAX_STEPS = Number(process.argv[2] || 10);
const FRICTION = 'none';

let cookie = '';
function api(method, path, body, headers = {}, timeoutMs = 320_000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers };
    if (cookie) h.Cookie = cookie;
    const req = http.request({ ...BASE, path, method, headers: h, timeout: timeoutMs }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        cookie = setCookies.map((c) => c.split(';')[0]).join('; ') || cookie;
        let parsed = null;
        try { parsed = JSON.parse(b); } catch { parsed = { raw: b.slice(0, 500) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('HTTP_TIMEOUT')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 登录
  const login = await api('POST', '/api/admin-auth/login', { name: 'admin', password: 'ChangeMe_2026_Admin', remember: true });
  console.log('LOGIN', login.status, login.body?.success);
  if (!login.body?.success) throw new Error('登录失败: ' + JSON.stringify(login.body));

  // 2. 找一个有故事的虚拟学习者
  const list = await api('GET', '/api/admin/virtual-learners?limit=100');
  if (!list.body?.data?.profiles) throw new Error('虚拟学习者列表响应异常: ' + JSON.stringify(list.body).slice(0, 300));
  const profiles = list.body.data.profiles;
  console.log('PROFILES', profiles.length);
  let chosen = null;
  for (const p of profiles) {
    if (Number(p.storyCount) > 0) { chosen = p; break; }
  }
  if (!chosen) throw new Error('没有带故事的虚拟学习者');
  console.log('CHOSEN', chosen.id, chosen.name, 'stories=', chosen.storyCount, 'goal=', chosen.learningGoal);

  // 3. 获取故事列表，选第一条
  const stories = await api('GET', `/api/admin/virtual-learners/${chosen.id}/stories`);
  const sdata = stories.body?.data;
  if (!sdata?.stories?.length) throw new Error('故事列表为空');
  const story = sdata.stories[0];
  console.log('STORY', story.storyId || story.id, story.title);

  // 4. 启动黑盒会话
  const start = await api('POST', `/api/admin/virtual-learners/${chosen.id}/start-blackbox-session`, { storyId: story.storyId || story.id, frictionBudget: FRICTION });
  if (!start.body?.success || !(start.body?.data?.id || start.body?.data?.sessionId)) {
    console.log('START FAIL', start.status, JSON.stringify(start.body).slice(0, 400));
    process.exit(1);
  }
  const sessionId = start.body.data.id || start.body.data.sessionId;
  console.log('SESSION', sessionId, 'mode=blackbox friction=' + FRICTION);

  // 5. 逐步推进
  let traceCount = 0;
  const seen = [];
  for (let step = 1; step <= MAX_STEPS; step++) {
    // 获取当前快照（拿 publicTrace 长度 + 当前观察）
    const snap = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}`);
    const sr = snap.body?.data?.stageResults || {};
    const bb = sr.blackbox || {};
    const trace = bb.publicTrace || [];
    traceCount = trace.length;
    const latest = trace[trace.length - 1]?.observation;
    if (latest) {
      const stage = latest.stage;
      const task = latest.visibleTask?.title || latest.visibleTask?.id || '-';
      const acts = (latest.availableActions || []).join(',');
      const lastMsg = (latest.visibleMessages || []).slice(-1)[0]?.content?.slice(0, 80) || '';
      console.log(`  [snap] trace=${traceCount} stage=${stage} task="${task}" actions=[${acts}] last="${lastMsg}"`);
    }
    const control = bb.control || {};
    if (['completed', 'failed', 'abandoned'].includes(snap.body?.data?.status)) {
      console.log('TERMINAL status=', snap.body.data.status, 'stage=', snap.body.data.currentStage,
        'completedTasks=', snap.body.data.completedTasks, '/', snap.body.data.totalTasks,
        'terminalReason=', control.terminalReason, control.terminalCode || '');
      break;
    }

    // 黑盒单步（新 key）
    const key = `e2e-step-${step}-${Date.now()}`;
    const t0 = Date.now();
    const stepRes = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/blackbox-step`,
      {}, { 'Idempotency-Key': key, 'X-Expected-Trace-Count': String(traceCount) });
    const cost = ((Date.now() - t0) / 1000).toFixed(1);
    const d = stepRes.body;
    if (!stepRes.body?.success) {
      console.log(`STEP ${step} FAILED [${cost}s] status=${stepRes.status}`, JSON.stringify(d).slice(0, 600));
      seen.push({ step, ok: false, status: stepRes.status, detail: JSON.stringify(d).slice(0, 300) });
      // 用同一 key 重试一次（幂等对账语义）
      await sleep(1500);
      const retry = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/blackbox-step`,
        {}, { 'Idempotency-Key': key, 'X-Expected-Trace-Count': String(traceCount) });
      console.log(`  retry same key ->`, retry.status, JSON.stringify(retry.body).slice(0, 300));
      continue;
    }
    const obs = d.data?.observation || {};
    const traceAfter = d.data?.control ? null : null;
    const task = obs.visibleTask?.title || '-';
    console.log(`STEP ${step} OK [${cost}s] stage=${obs.stage} task="${task}" actions=[${(obs.availableActions || []).join(',')}]`);
    seen.push({ step, ok: true, stage: obs.stage, task: task.slice(0, 40) });
    if (obs.stage === 'completed' || obs.stage === 'error') {
      console.log('OBSERVATION TERMINAL stage=', obs.stage, JSON.stringify(d.data?.control || {}).slice(0, 400));
      break;
    }
  }
  console.log('\n=== STEP SUMMARY ===');
  for (const s of seen) console.log(JSON.stringify(s));
}

main().catch((e) => { console.error('E2E ERROR', e); process.exit(1); });