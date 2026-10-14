// 只读：确认 API 把 wrapup.stateUpdate（长期四维来源）透传到前端——否则完课卡那张卡不渲染，改口径也看不见。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://127.0.0.1:3011';
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function get(urlPath) {
  const url = new URL(BASE + urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: 'GET',
      headers: { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, timeout: 60000 }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: t.slice(0, 200) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const db = new DatabaseSync(DB, { readOnly: true });
const row = db.prepare("select id from teaching_sessions where wrapup like '%stateUpdate%' order by createdAt desc limit 1").get();
db.close();
if (!row) { console.log('库里没有含 stateUpdate 的会话'); process.exit(0); }
console.log('探测会话:', row.id);

const r = await get(`/api/admin/session-console/${encodeURIComponent(row.id)}`);
const teaching = r.json?.data?.teaching ?? r.json?.teaching;
const w = teaching?.wrapup;
console.log('http', r.status, '| wrapup 存在:', !!w, '| keys:', w ? Object.keys(w).join(',') : '(无)');
console.log('wrapup.stateUpdate =', JSON.stringify(w?.stateUpdate ?? null));
