/**
 * 一次性：把 skill 级模型配置从 agnes-3.0-flash 切到 deepseek-v4-flash（只读-改配置，可回滚）
 * 用法：node scripts/switch-model-dsv4.mjs [--to=deepseek-v4-flash] [--from=agnes-3.0-flash] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:3001';
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const TO = String(arg('to', 'deepseek-v4-flash'));
const FROM = String(arg('from', 'agnes-3.0-flash'));
const DRY = process.argv.includes('--dry-run');

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

const res0 = await fetch(BASE + '/api/admin-auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
});
const cookie = (res0.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) throw new Error('admin 登录失败');
const H = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };

const list = await (await fetch(BASE + '/api/admin/skill-model-configs', { headers: H })).json();
const items = list?.data?.configs || list?.data?.items || list?.data || [];
const targets = items.filter((c) => String(c?.model || '') === FROM);
console.log(`skill 配置共 ${items.length} 条｜当前为 ${FROM} 的：${targets.length} 条`);
for (const c of targets) console.log('  -', c.skillId);

if (DRY) { console.log('DRY RUN，未改动'); process.exit(0); }

let ok = 0;
for (const c of targets) {
  const r = await fetch(BASE + `/api/admin/skill-model-configs/${encodeURIComponent(c.skillId)}`, {
    method: 'PUT', headers: H, body: JSON.stringify({ model: TO }),
  });
  const j = await r.json().catch(() => ({}));
  const after = j?.data?.model ?? j?.data?.config?.model ?? '?';
  if (r.ok && j?.success !== false) { ok += 1; console.log(`  ✓ ${c.skillId} → ${after}`); }
  else console.log(`  ✗ ${c.skillId} → HTTP ${r.status} ${String(j?.error?.message || j?.error || '').slice(0, 120)}`);
}
console.log(`完成：${ok}/${targets.length} 条已切到 ${TO}`);
