#!/usr/bin/env node
/**
 * 收尾：把驱动脚本早期（shell 拆分）截断的学习者名称补全，并删掉首跑残留的 f1。
 * 只操作本次评测创建的 profileId（来自 learners/*-state.json），不动其他学习者。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const backend = resolve(root, 'backend');
const require = createRequire(join(backend, 'package.json'));
require('dotenv').config({ path: join(backend, '.env') });

const base = 'http://127.0.0.1:3011';
const personas = JSON.parse(readFileSync(resolve(here, 'learner-cases-10.json'), 'utf8')).cases;
const byId = new Map(personas.map((c) => [c.id, c]));
const readState = (f) => {
  const p = resolve(here, 'learners', f);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

const login = await fetch(`${base}/api/admin-auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({
    name: process.env.E2E_ADMIN_NAME || process.env.INIT_ADMIN_NAME || 'admin',
    password: process.env.E2E_ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD,
    remember: true,
  }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) throw new Error(`登录失败 http=${login.status}`);

const staleF1 = readState('f1-state.json');
const canonical = { f1: 'f1b-state.json', f2: 'f2-state.json', f3: 'f3-state.json' };
for (const c of personas) {
  const file = canonical[c.id] || `${c.id}-state.json`;
  const st = readState(file);
  if (!st?.profileId) continue;
  const r = await fetch(`${base}/api/admin/virtual-learners/${st.profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, Origin: 'http://localhost:5173' },
    body: JSON.stringify({
      name: c.public.learnerName,
      profile: { role: c.public.profileRole, scenario: c.public.profileScenario },
    }),
  });
  console.log(c.id, 'rename', r.status, c.public.learnerName);
  if (st.learnerName !== c.public.learnerName) {
    st.learnerName = c.public.learnerName;
    // 只改本地状态里的显示名，不动 session/profileId
    const fs = await import('node:fs');
    fs.writeFileSync(resolve(here, 'learners', file), JSON.stringify(st, null, 1));
  }
}

if (staleF1?.profileId) {
  const r = await fetch(`${base}/api/admin/virtual-learners/${staleF1.profileId}`, {
    method: 'DELETE',
    headers: { cookie, Origin: 'http://localhost:5173' },
  });
  console.log('f1-stale delete', r.status, staleF1.profileId);
}
