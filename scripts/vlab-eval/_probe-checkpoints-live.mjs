// 临时探针：确认运行中的后端是否已加载 commit c729fed9（session-console 是否吐出 teaching.checkpoints）。
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
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function api(urlPath, timeoutMs = 60000) {
  const url = new URL(BASE + urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: 'GET',
      headers: { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: text.slice(0, 200) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const db = new DatabaseSync(DB, { readOnly: true });
const uid = db.prepare("select userId from virtual_sessions where id='a3043a5e-8e09-4a56-9999-e63c5cdbefdd'").get().userId;
const s = db.prepare("select id, status from teaching_sessions where userId=? and status='completed' order by createdAt desc limit 1").get(uid);
db.close();
console.log('probe session', s.id, s.status);
const r = await api(`/api/admin/session-console/${encodeURIComponent(s.id)}`);
console.log('http', r.status);
const teaching = r.json?.data?.teaching ?? r.json?.teaching;
if (!teaching) { console.log('NO teaching block; raw=', r.raw); }
else {
  console.log('teaching keys:', Object.keys(teaching).join(', '));
  console.log('has checkpoints:', Array.isArray(teaching.checkpoints), 'len=', Array.isArray(teaching.checkpoints) ? teaching.checkpoints.length : 'n/a');
  if (Array.isArray(teaching.checkpoints) && teaching.checkpoints[0]) console.log('first:', JSON.stringify(teaching.checkpoints[0]).slice(0, 260));
}
