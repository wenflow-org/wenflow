import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3011';
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
let cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));

async function post(p, body) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; }
  return { status: res.status, j };
}

const skillId = process.argv[2] || 'goal-conversation';
const doPublish = process.argv.includes('--publish');

const cl = await fetch(BASE + '/api/admin/prompt-lab/core-list', { headers: { Origin: 'http://localhost:5173', Cookie: cookie } });
const clj = await cl.json().catch(() => ({}));
const items = clj?.items || clj?.data || clj?.files || [];
console.log('core-list:', cl.status, 'n=', Array.isArray(items) ? items.length : Object.keys(clj || {}).length, JSON.stringify(Array.isArray(items) ? items.slice(0, 4) : clj).slice(0, 300));

const c = await post('/api/admin/prompt-lab/compile-core', { skillId, semanticJudge: false });
console.log('compile-core:', c.status, 'gatePassed=', c.j?.gatePassed);
console.log('  structure issues:', JSON.stringify(c.j?.gates?.structure || []).slice(0, 300));
console.log('  fieldFreeze issues:', JSON.stringify(c.j?.gates?.fieldFreeze || []).slice(0, 300));
if (!c.j?.gatePassed) { console.log('  (未过门，不发布)'); process.exit(0); }

if (doPublish) {
  const p = await post('/api/admin/prompt-lab/publish-core', { skillId });
  console.log('publish-core:', p.status, JSON.stringify(p.j).slice(0, 500));
} else {
  console.log('(dry: 加 --publish 才写库)');
}
