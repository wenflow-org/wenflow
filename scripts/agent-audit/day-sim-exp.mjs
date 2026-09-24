// 日期模拟实验：开启 dateSimulation → advance-day 跑课 → 观察下一课 lf/pacing/difficulty 反应
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const SESSION = process.argv[2] || '3559efad-df13-4a89-94ac-7a4f619ddfec';
const DAYS = Number(process.argv[3] || 1);

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

const login = async () => {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
};

const api = async (method, p, body) => {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(280000) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  return { status: res.status, j };
};

let cookie = '';
cookie = await login();
if (!cookie) { console.log('LOGIN FAILED'); process.exit(1); }

const r1 = await api('GET', '/api/admin/virtual-learners/settings');
const ds = r1.j?.data?.settings?.dateSimulation;
console.log('dateSimulation current:', JSON.stringify(ds));

if (!ds?.enabled) {
  const payload = { dateSimulation: { ...(ds || {}), enabled: true } };
  const r2 = await api('PUT', '/api/admin/virtual-learners/settings', payload);
  console.log('enable attempt:', r2.status, JSON.stringify(r2.j?.data?.settings?.dateSimulation ?? r2.j).slice(0, 300));
}

// advance-day 1 天并跑课
const r3 = await api('POST', `/api/admin/virtual-learners/sessions/${SESSION}/advance-day`, { days: DAYS, runTasks: true });
console.log('advance-day:', r3.status, JSON.stringify(r3.j?.data ?? r3.j).slice(0, 600));
