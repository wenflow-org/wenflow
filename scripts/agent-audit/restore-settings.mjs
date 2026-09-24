import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const res = await fetch('http://127.0.0.1:3001/api/admin-auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
});
const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
const r = await fetch('http://127.0.0.1:3001/api/admin/virtual-learners/settings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' },
  body: JSON.stringify({ dateSimulation: { enabled: false, lessonsPerDay: 2 } }),
});
const j = await r.json();
console.log('PUT', r.status, JSON.stringify(j?.data?.settings?.dateSimulation ?? j));
