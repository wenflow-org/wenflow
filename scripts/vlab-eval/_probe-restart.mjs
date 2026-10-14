// 临时探针：验证 failed 会话经 restart-learning 后 teaching-step 真能推进。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const SID = arg('session', '');
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function api(method, urlPath, body, timeoutMs = 300000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: text.slice(0, 300) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function doneCount(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const vs = db.prepare('SELECT learningPathId,status FROM virtual_sessions WHERE id = ?').get(sessionId);
  let n = 0;
  if (vs?.learningPathId) n = db.prepare("SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?) AND status = 'completed'").get(vs.learningPathId).c;
  db.close();
  return { n, status: vs?.status };
}

const before = doneCount(SID);
console.log('before', JSON.stringify(before));
const rl = await api('POST', `/api/admin/virtual-learners/sessions/${SID}/restart-learning`, {});
console.log('restart-learning', rl.status, JSON.stringify(rl.json)?.slice(0, 400));
for (let i = 1; i <= 4; i++) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${SID}/teaching-step`, {});
  const d = r.json?.data || {};
  console.log(`step#${i}`, r.status, 'taskCompleted=' + d.taskCompleted, 'done=' + doneCount(SID).n, 'status=' + doneCount(SID).status,
    'reply=' + String(d.aiResponse || d.reply || '').slice(0, 60).replace(/\n/g, ' '));
}
console.log('after', JSON.stringify(doneCount(SID)));
