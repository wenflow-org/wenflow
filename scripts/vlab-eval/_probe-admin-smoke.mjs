// 只读冒烟：清理后管理端 users 列表 / 总览 是否仍 200（buildRealUserWhere 过滤改动后曾出过 P2029）。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://127.0.0.1:3011';
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

function get(urlPath, timeoutMs = 120000) {
  const url = new URL(BASE + urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: 'GET',
      headers: { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, timeout: timeoutMs }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: t.slice(0, 160) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

for (const u of ['/api/admin/users?page=1&pageSize=10', '/api/admin/users/stats', '/api/admin/overview/stats?fresh=1', '/api/admin/agents/logs?page=1&pageSize=5']) {
  const r = await get(u);
  const d = r.json?.data;
  const n = Array.isArray(d) ? d.length : (d?.users?.length ?? d?.items?.length ?? (d?.total ?? ''));
  console.log(String(r.status).padEnd(5), u.padEnd(42), 'success=' + r.json?.success, n !== '' ? 'n/total=' + n : '', r.status !== 200 ? 'raw=' + r.raw : '');
}
