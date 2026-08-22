/* 黑盒持续推进器：node scripts/vlab-blackbox-drive.mjs <sessionId> <maxSteps> */
import http from 'node:http';
import { createWriteStream } from 'node:fs';

const sessionId = process.argv[2];
const MAX_STEPS = Number(process.argv[3] || 40);
if (!sessionId) { console.error('usage: node scripts/vlab-blackbox-drive.mjs <sessionId> <maxSteps>'); process.exit(1); }

const LOG = createWriteStream('logs/vlab-e2e-drive.log', { flags: 'a' });
const out = (msg) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`; console.log(line); LOG.write(line + '\n'); };

let cookie = '';
function api(method, path, body, headers = {}, timeoutMs = 320_000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers };
    if (cookie) h.Cookie = cookie;
    const req = http.request({ hostname: 'localhost', port: 3001, path, method, headers: h, timeout: timeoutMs }, (res) => {
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
  const login = await api('POST', '/api/admin-auth/login', { name: 'admin', password: 'ChangeMe_2026_Admin', remember: true });
  if (!login.body?.success) throw new Error('登录失败');

  let lastStage = '';
  let lastTasks = '';
  for (let step = 1; step <= MAX_STEPS; step++) {
    const snap = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}`);
    const data = snap.body?.data || {};
    const sr = typeof data.stageResults === 'string' ? JSON.parse(data.stageResults || '{}') : (data.stageResults || {});
    const bb = sr.blackbox || {};
    const trace = bb.publicTrace || [];
    const traceCount = trace.length;
    const latest = trace[trace.length - 1]?.observation;
    const control = bb.control || {};
    const stage = latest?.stage || '?';
    const taskLabel = latest?.visibleTask?.title || latest?.visibleTask?.id || '';
    const tasks = `${data.completedTasks}/${data.totalTasks}`;
    if (stage !== lastStage || tasks !== lastTasks) {
      out(`snap: trace=${traceCount} stage=${stage} tasks=${tasks} task="${String(taskLabel).slice(0, 40)}" status=${data.status} actions=[${(latest?.availableActions || []).join(',')}]`);
      lastStage = stage; lastTasks = tasks;
    }
    if (['completed', 'failed', 'abandoned'].includes(data.status)) {
      out(`TERMINAL status=${data.status} stage=${data.currentStage} tasks=${tasks} reason=${control.terminalReason || ''} code=${control.terminalCode || ''} detail=${String(control.terminalDetail || '').slice(0, 160)}`);
      break;
    }
    if (lastStage === 'error') { out('OBSERVATION ERROR — stop'); break; }

    const key = `drive-step-${step}-${Date.now()}`;
    const t0 = Date.now();
    let stepRes;
    try {
      stepRes = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/blackbox-step`,
        {}, { 'Idempotency-Key': key, 'X-Expected-Trace-Count': String(traceCount) });
    } catch (e) {
      out(`step ${step} HTTP error: ${e.message}`);
      await sleep(5000);
      continue;
    }
    const cost = ((Date.now() - t0) / 1000).toFixed(1);
    if (stepRes.body?.success) {
      const obs = stepRes.body.data?.observation || {};
      out(`step ${step} ok [${cost}s] stage=${obs.stage} actions=[${(obs.availableActions || []).join(',')}]`);
    } else {
      out(`step ${step} FAIL [${cost}s] status=${stepRes.status} ${JSON.stringify(stepRes.body).slice(0, 400)}`);
      await sleep(3000);
      // 同 key 幂等重试一次
      try {
        const retry = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/blackbox-step`,
          {}, { 'Idempotency-Key': key, 'X-Expected-Trace-Count': String(traceCount) });
        out(`  retry same key -> status=${retry.status} ${JSON.stringify(retry.body).slice(0, 300)}`);
      } catch (e2) { out(`  retry http error ${e2.message}`); }
    }
    if (stepRes.body?.data?.observation?.stage === 'completed' || stepRes.body?.data?.observation?.stage === 'error') break;
    await sleep(800);
  }
  out('DRIVE END');
  LOG.end();
}

main().catch((e) => { out('DRIVE ERROR ' + e.message); LOG.end(); process.exit(1); });