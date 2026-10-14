// 只读：打 /api/admin/overview/stats，取管理台实际展示的用户口径数。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function api(urlPath, timeoutMs = 120000) {
  const url = new URL(BASE + urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: 'GET',
      headers: { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: text.slice(0, 300) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const r = await api('/api/admin/overview/stats?fresh=1');
console.log('http', r.status);
const d = r.json?.data ?? r.json;
if (!d) { console.log('raw', r.raw); process.exit(0); }
const pick = (o) => JSON.stringify(o).slice(0, 600);
console.log('top keys:', Object.keys(d).join(', '));
for (const k of ['users', 'userStats', 'stats', 'overview', 'kpis']) if (d[k]) console.log(k + ':', pick(d[k]));
// 深挖所有含 user 的数值字段
const flat = [];
(function walk(o, p = '') { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) { if (typeof v === 'number' && /user/i.test(k)) flat.push(p + k + ' = ' + v); else if (typeof v === 'object') walk(v, p + k + '.'); } } })(d);
console.log('\n-- 命中 user 的数值字段');
for (const l of flat) console.log('  ', l);
