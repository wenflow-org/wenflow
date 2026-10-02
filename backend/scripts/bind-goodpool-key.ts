#!/usr/bin/env env ts-node
/**
 * bind-goodpool-key.mjs — 把 path 生成链路（design 技能）的 LLM key 换成「专走好池」的 key。
 *
 * 背景：网关双池，病池间歇上游 502，path 长生成在 stage_design 阶段集中撞空回复失败。
 * 本脚本只改 skill_model_configs.apiKey（endpoint 不动、model 不动），路由按请求解析，
 * 改库即时生效，无需重启后端、不打断跑批。
 *
 * 用法（key 只从环境变量进，脚本零字面量）：
 *   POOL_KEY='sk-xxx' npx ts-node --transpile-only scripts/bind-goodpool-key.ts [--dry]
 *
 * 【2026-09-30 13:40 范围收窄（用户拍板）】只换「长生成」那一个技能——stage-designer
 * （每 path 5 次调用 ≈175s，今早空回复失败全部落在 stage_design 阶段）；其余三个
 * （goal-conversation/path-planning/kc-mapper）留在默认 key，不动。
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { encryptSecret, decryptSecret } from '../src/utils/secret-crypto';

const DRY = process.argv.includes('--dry');
const KEY_CONTEXT = 'system.skill_model_configs.apiKey';
const SKILLS = ['stage-designer'];

const key = (process.env.POOL_KEY || '').trim();
if (!key) { console.error('缺少环境变量 POOL_KEY'); process.exit(1); }

const dbPath = path.resolve(__dirname, '../prisma/system.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout=30000;');

const enc = encryptSecret(key, KEY_CONTEXT) as string;
if (!enc || enc === key) { console.error('加密失败（密钥环未配置？）'); process.exit(1); }
// 自校验：能解密回原文才落库（否则路由会静默回退旧 key）
const round = decryptSecret(enc, KEY_CONTEXT);
if (round !== key) { console.error('自校验失败：解密结果与输入不一致'); process.exit(1); }

for (const skillId of SKILLS) {
  const row = db.prepare('SELECT apiKey FROM skill_model_configs WHERE skillId = ?').get(skillId);
  if (!row) { console.error(`无此行：${skillId}`); process.exit(1); }
  const old = decryptSecret(row.apiKey as string, KEY_CONTEXT) || '';
  if (DRY) {
    console.log(`[dry] ${skillId}: 旧key尾部 …${old.slice(-4)} → 新key尾部 …${key.slice(-4)}`);
    continue;
  }
  db.prepare('UPDATE skill_model_configs SET apiKey = ?, updatedAt = ? WHERE skillId = ?')
    .run(enc, Date.now(), skillId);
  console.log(`${skillId}: key 已换（长度 ${enc.length}，自校验通过）`);
}
db.close();
console.log(DRY ? 'dry-run 完成' : '全部更新完成——路由按请求解析，下一条 design 调用即走好池');
