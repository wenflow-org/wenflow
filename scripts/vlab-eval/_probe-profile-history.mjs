// 真机验证：重算 123 的画像快照，确认互动历史真实计数 + narrativeSource 出处落地。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://127.0.0.1:3011';
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '').split('=')[1] || '123@123.com';
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function req(method, urlPath, body, timeoutMs = 180000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: timeoutMs }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: t.slice(0, 300) }); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const db = new DatabaseSync(DB, { readOnly: true });
const u = db.prepare('select id from users where email = ?').get(EMAIL);
db.close();
if (!u) { console.error('用户不存在:', EMAIL); process.exit(1); }
console.log('userId =', u.id, `(${EMAIL})`);

const rec = await req('POST', `/api/admin/learner-models/${u.id}/recompute`, {});
console.log('recompute http =', rec.status, 'success =', rec.json?.success);
const got = await req('GET', `/api/admin/learner-models/${u.id}`);
console.log('get http =', got.status);
const d = got.json?.data ?? got.json;
const profile = d?.profile ?? d;
if (!profile) { console.log('raw =', got.raw); process.exit(0); }

console.log('\n-- history');
console.log(JSON.stringify(profile.history, null, 1));
console.log('\n-- narrativeSource');
console.log(JSON.stringify(profile.narrativeSource, null, 1));
console.log('\n-- narrativeInsights 片段');
const n = profile.narrativeInsights || {};
for (const k of ['goalNarrative', 'backgroundContextNote', 'timeConstraintNote']) {
  console.log('  ' + k + ':', String(n[k] ?? '').slice(0, 160));
}
console.log('\n-- derivedInsights 优势/风险');
console.log('  strengths:', JSON.stringify((profile.derivedInsights || {}).strengths));
console.log('  riskFactors:', JSON.stringify((profile.derivedInsights || {}).riskFactors));
