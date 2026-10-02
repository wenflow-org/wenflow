#!/usr/bin/env ts-node
/**
 * copy-skill-key.ts — 把源技能行的 apiKey 密文（同加密上下文）连同 endpoint/model 复制到目标技能行。
 * 明文零暴露：不做加解密落库，只搬密文（同 context 可解密），搬完解密复核。
 *
 * 用法：npx ts-node --transpile-only -O '{"module":"commonjs"}' scripts/copy-skill-key.ts <源skillId> <目标skillId> [--dry]
 * 场景：2026-09-30 用户拍板「goal-conversation 也走好池」——从 stage-designer（已绑 path ds）复制。
 * 路由按请求解析，改库热生效，无需重启后端。
 */
import * as fs from 'node:fs';
import path from 'node:path';

// ts-node 直跑没有 bootstrap 的 dotenv——手工把 .env 灌进 process.env（密钥环需要）
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decryptSecret } = require('../src/utils/secret-crypto');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
const [src, dst] = args;
if (!src || !dst) { console.error('用法: copy-skill-key.ts <源skillId> <目标skillId> [--dry]'); process.exit(1); }

const KEY_CONTEXT = 'system.skill_model_configs.apiKey';
const db = new DatabaseSync(path.resolve(__dirname, '../prisma/system.db'));
db.exec('PRAGMA busy_timeout=30000;');

const s: any = db.prepare('SELECT apiKey, endpoint, model FROM skill_model_configs WHERE skillId = ?').get(src);
if (!s?.apiKey) { console.error('源行不存在或无密文:', src); process.exit(1); }
const plain = decryptSecret(s.apiKey, KEY_CONTEXT) || '';
if (!plain) { console.error('源密文解密失败（密钥环或 context 不符）'); process.exit(1); }
const d: any = db.prepare('SELECT endpoint, model FROM skill_model_configs WHERE skillId = ?').get(dst);
if (!d) { console.error('目标行不存在:', dst); process.exit(1); }

console.log(`[plan] ${dst}: endpoint ${(d.endpoint || '-').toString().slice(0, 40)} → ${(s.endpoint || '-').toString().slice(0, 40)} | model ${d.model || '-'} → ${s.model || '-'} | key尾 …${plain.slice(-4)}`);
if (DRY) { db.close(); console.log('dry-run 完成'); process.exit(0); }

db.prepare('UPDATE skill_model_configs SET apiKey = ?, endpoint = ?, model = ?, updatedAt = ? WHERE skillId = ?')
  .run(s.apiKey, s.endpoint, s.model, Date.now(), dst);
const after = decryptSecret((db.prepare('SELECT apiKey FROM skill_model_configs WHERE skillId = ?').get(dst) as any).apiKey, KEY_CONTEXT) || '';
if (after !== plain) { console.error('复核失败：写回后解密不一致'); process.exit(1); }
db.close();
console.log(`${dst}: 已与 ${src} 同 key/endpoint/model（自校验通过，热生效——下一条调用即走新分组）`);
