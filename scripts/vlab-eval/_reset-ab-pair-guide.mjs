#!/usr/bin/env node
/** 一次性：清空幼儿园五大领域 AB 对照实验（删两个实验 VL，级联会话/课堂/路径/记忆），跑前核对、跑后验残留。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { adminLoginOnce, getAdminCookie } from './admin-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASE = 'http://127.0.0.1:3011';
const MANIFEST = path.join(ROOT, 'doc/local/runs/20261014/ab-pair-guide/manifest.json');
const DB_PATH = path.join(ROOT, 'backend/prisma/dev.db');

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

async function api(method, urlPath, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(BASE + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json', Origin: 'http://localhost:5173',
        Cookie: cookie || '',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(text); } catch { /* 保留原文 */ }
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode} ${text.slice(0, 300)}`));
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let cookie = '';
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
cookie = await getAdminCookie(BASE, envGet) || await adminLoginOnce(BASE, envGet);
if (!cookie) throw new Error('admin 登录失败');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 15000');

for (const p of manifest.pair) {
  // 跑前核对：确认要删的确实是本次实验产物（名字对上 + 路径是复刻件）
  const profRow = db.prepare('SELECT id, profile, userId FROM virtual_learner_profiles WHERE id = ?').get(p.vlId);
  let profName = ''; try { profName = JSON.parse(profRow?.profile || '{}').nameHint || ''; } catch { /* 空 */ }
  const pathRow = db.prepare('SELECT id, title, userId, sourcePathId FROM learning_paths WHERE id = ?').get(p.pathId);
  if (!profRow || profName !== p.name) throw new Error(`档案不匹配，拒绝删除：${p.name} vlId=${p.vlId} 查到=${JSON.stringify({ id: profRow?.id, nameHint: profName })}`);
  if (!pathRow || pathRow.userId !== p.userId || !String(pathRow.id).startsWith('lp_')) {
    throw new Error(`路径不匹配，拒绝删除：${p.name} pathId=${p.pathId} 查到=${JSON.stringify(pathRow)}`);
  }
  const c = db.prepare(`SELECT COUNT(*) n FROM agent_call_logs WHERE calledAt > ? AND userId = ?`).get(Date.now() - 2 * 3600 * 1000, p.userId).n;
  console.log(`删除 ${p.name}: vl=${p.vlId} path=${p.pathId} session=${p.sessionId}（近 2h 调用 ${c} 条）`);
  const r = await api('DELETE', `/api/admin/virtual-learners/${p.vlId}`);
  console.log(`  → ${r?.message || 'ok'} cleanup=${JSON.stringify(r?.data?.cleanup || {}).slice(0, 400)}`);
}

// 验残留：路径/里程碑/子任务/会话/课堂应全为 0
const left = {};
for (const [k, sql] of Object.entries({
  paths: `SELECT COUNT(*) n FROM learning_paths WHERE id IN ('${manifest.pair.map((p) => p.pathId).join("','")}')`,
  sessions: `SELECT COUNT(*) n FROM virtual_sessions WHERE id IN ('${manifest.pair.map((p) => p.sessionId).join("','")}')`,
  profiles: `SELECT COUNT(*) n FROM virtual_learner_profiles WHERE id IN ('${manifest.pair.map((p) => p.vlId).join("','")}')`,
  users: `SELECT COUNT(*) n FROM users WHERE id IN ('${manifest.pair.map((p) => p.userId).join("','")}')`,
  teaching: `SELECT COUNT(*) n FROM teaching_sessions WHERE userId IN ('${manifest.pair.map((p) => p.userId).join("','")}')`,
})) {
  left[k] = db.prepare(sql).get().n;
}
db.close();
console.log('残留核对：', JSON.stringify(left));
if (Object.values(left).some((n) => n !== 0)) { console.error('仍有残留，停止'); process.exitCode = 1; }
