#!/usr/bin/env node
/** run-round1-vlbatch-setup.mjs — 测量验证第一轮 VL 批量对比组·建卡驱动。
 *
 * 步骤：batch-create 建 5 个 vl-r1b-*（storyCount=0，只产 LLM 身份）→ 轮询到终态（失败 retry 一次）
 *       → PUT /:id 写固定目标（storyPool[0].visibleOpening，story-demand.ts 优先级链第一位）
 *         + runtimePrefs.frictionBudget 档位（session-factory.ts:245-249 默认链）+ persona 档位文本（profile.background）
 *       → GET /:id 逐项回读验证 → 写 out/r1b-ids.txt（runner ids-file 用 tags[1]）。
 * 纪律：只打 3011 验证实例；admin 走 fleet 共享 cookie（admin-session.mjs）；DB 只读。
 * 用法：node backend/scripts/measurement-verify/run-round1-vlbatch-setup.mjs [--base=http://127.0.0.1:3011]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..'); // 仓库根
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const EVIDENCE = path.join(OUT, 'vl-batch-setup.log');
const IDS_FILE = path.join(OUT, 'r1b-ids.txt');
const PROFILES_FILE = path.join(OUT, 'r1b-profiles.json');

const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');

// 本地测量验证实例是任务指定目标（铁律 2：一切实跑只打 3011）；仅 http/https + 显式 host 校验
const u = new URL(BASE);
if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refused protocol: ${u.protocol}`);
if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`refused host: ${u.hostname}（本驱动只允许本机验证实例）`);

const ADMIN_SESSION_MOD = pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href;
const { getAdminCookie, refreshAdminCookie } = await import(ADMIN_SESSION_MOD);

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(EVIDENCE, line + '\n'); };

// ---- 固定目标（任务指定原文，一字不改）----
const FIXED_GOAL = '我是初中二年级学生，想在两个月内系统掌握初中生物的「光合作用与呼吸作用」这部分，每天能学 30 分钟。请按这个目标帮我规划。';

// ---- 能力档：2 强 + 2 弱 + 1 中。frictionBudget 可配（start-session body 与 runtimePrefs 双通道，
// 这里写 runtimePrefs 由 session-factory 默认链生效，runner 无需改动）；persona 档位文本写 profile.background。----
const TIERS = [
  { lesson: 'VL-B1', name: 'vl-r1b-01-strong', tier: 'strong', frictionBudget: 'low', persona: '学习能力强：新概念读一遍就能抓住要点，练习正确率高，遇到难题愿意多想几步再求助；注意力集中，很少分心。' },
  { lesson: 'VL-B2', name: 'vl-r1b-02-strong', tier: 'strong', frictionBudget: 'low', persona: '学习能力强：新概念读一遍就能抓住要点，练习正确率高，遇到难题愿意多想几步再求助；注意力集中，很少分心。' },
  { lesson: 'VL-B3', name: 'vl-r1b-03-weak', tier: 'weak', frictionBudget: 'high', persona: '基础薄弱：新概念要反复讲才能理解，容易走神，遇到难题容易想放弃，需要更多鼓励和小步引导。' },
  { lesson: 'VL-B4', name: 'vl-r1b-04-weak', tier: 'weak', frictionBudget: 'high', persona: '基础薄弱：新概念要反复讲才能理解，容易走神，遇到难题容易想放弃，需要更多鼓励和小步引导。' },
  { lesson: 'VL-B5', name: 'vl-r1b-05-mid', tier: 'mid', frictionBudget: 'normal', persona: '中等水平：常规讲解能跟上，稍难的概念需要提示，偶尔分心但能被拉回来。' },
];

let cookie = await getAdminCookie(BASE, envGet);
if (!cookie) throw new Error('admin cookie 获取失败');

function httpJson(method, urlPath, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: url.pathname + url.search, method, agent: false,
      headers: {
        Cookie: cookie, Origin: 'http://localhost:5173',
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; } resolve({ status: res.statusCode || 0, json }); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { const e = new Error('http request timeout'); e.name = 'TimeoutError'; req.destroy(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function api(method, urlPath, body, opts = {}) {
  const { retries = 3, timeout = 60000 } = opts;
  let backoff = 0;
  for (;;) {
    try {
      const { status, json } = await httpJson(method, urlPath, body, timeout);
      if (status === 401 || (status === 403 && /吊销|过期/.test(String(json?.error?.message || json?.error || '')))) {
        cookie = await refreshAdminCookie(BASE, envGet, cookie);
        if (!cookie) throw new Error('admin 重登失败');
        continue;
      }
      if (!status || status >= 400 || json?.success === false) {
        const msg = `${status} ${String(json?.error?.message || json?.error || json?.raw || '').slice(0, 160)}`;
        if (status === 409) { // 会话写锁等：退避 8s*n，至多 10 次
          if (++backoff > 10) throw new Error(msg);
          await sleep(8000 * backoff); continue;
        }
        if (status === 429 || status >= 500) { // 铁律 4：退避 30s 重试至多 3 次
          if (++backoff > retries) throw new Error(msg);
          log(`api ${method} ${urlPath} -> ${msg}；429/5xx 退避 30s 重试 ${backoff}/${retries}`);
          await sleep(30000); continue;
        }
        throw new Error(msg);
      }
      return json;
    } catch (e) {
      if (e?.name === 'TimeoutError') {
        if (++backoff > retries) throw e;
        await sleep(10000); continue;
      }
      throw e;
    }
  }
}

function dbRead(sql, ...params) {
  const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

// 已建档案定位：优先 tags[1]=行名 / notes 里 r1b=<行名>（patch 过的），兜底 notes 协作组标记 + 创建顺序
// （batch-job.service.ts:49-64 顺序 await 插入，行序=createdAt 序；身份生成会把 users.name 改写成人设名，
//  2026-10-06 实测「vl-r1b-01-strong」建卡后 users.name 变「老周」——行名不可作定位键）
function findR1bProfiles() {
  const byTag = dbRead(
    `SELECT p.id AS profileId, p.userId, u.name, p.tags, p.notes FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId WHERE p.tags LIKE '%vl-r1b-%' ORDER BY p.createdAt`
  );
  if (byTag.length >= TIERS.length) return byTag;
  return dbRead(
    `SELECT p.id AS profileId, p.userId, u.name, p.tags, p.notes FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId WHERE (p.notes LIKE '%测量验证第一轮%' OR u.name LIKE 'vl-r1b-%') ORDER BY p.createdAt`
  );
}

function mapToTiers(found) {
  const out = new Map(); // t.name -> profile
  const used = new Set();
  for (const t of TIERS) {
    const hit = found.find((f) => {
      const tags = String(f.tags || '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const inTags = tags.includes(t.name);
      const inNotes = String(f.notes || '').includes(`r1b=${t.name}`);
      return (inTags || inNotes) && !used.has(f.profileId);
    });
    if (hit) { out.set(t.name, hit); used.add(hit.profileId); }
  }
  // 未被显式标记的档案按创建顺序补齐（创建序=rows 序，见 batch-job.service.ts:49-64）
  const rest = found.filter((f) => !used.has(f.profileId));
  for (const t of TIERS) {
    if (!out.has(t.name) && rest.length) { out.set(t.name, rest.shift()); }
  }
  return out;
}

async function main() {
  log(`setup 开始 base=${BASE}`);
  // 1. 幂等检查：已存在的 vl-r1b-* 直接复用（不重复建）
  let found = findR1bProfiles();
  log(`DB 预检：已有 vl-r1b 协作组档案 ${found.length} 个（${found.map((f) => f.profileId.slice(0, 8)).join(',')}）`);

  let batchInfo = null;
  if (found.length < TIERS.length) {
    // 2. batch-create（storyCount=0：只产 LLM 身份，故事池由后续 PUT 写入固定目标）
    const rows = TIERS.map((t) => ({ name: t.name, storyCount: 0 }));
    const t0 = Date.now();
    const cr = await api('POST', '/api/admin/virtual-learners/batch-create', {
      rows, cohort: 'r1-measure-round1', note: '测量验证第一轮 VL 批量对比组（2强2弱1中）',
    }, { timeout: 120000 });
    batchInfo = cr.data;
    log(`batch-create 提交成功 batchId=${batchInfo.batchId} created=${batchInfo.created} totalStories=${batchInfo.totalStories}`);
    // 3. 轮询到终态（5 人 × 身份生成，15 分钟上限）
    let job = null;
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(5000);
      job = await api('GET', `/api/admin/virtual-learners/batch-create/${batchInfo.batchId}`);
      log(`batch 轮询 status=${job.data.status} personaLeft=${job.data.personaLeft} storiesDone=${job.data.storiesDone}/${job.data.totalStories} failed=${(job.data.failed || []).length}`);
      if (job.data.status === 'done' || job.data.status === 'error') break;
    }
    // 失败项 retry 一次（可用性清单证据）
    if (job.data.status === 'error' && (job.data.failed || []).length) {
      log(`batch 有 ${(job.data.failed).length} 项失败 → POST retry 一次`);
      await api('POST', `/api/admin/virtual-learners/batch-create/${batchInfo.batchId}/retry`, {});
      const dl2 = Date.now() + 10 * 60 * 1000;
      while (Date.now() < dl2) {
        await sleep(5000);
        job = await api('GET', `/api/admin/virtual-learners/batch-create/${batchInfo.batchId}`);
        log(`batch(retry) 轮询 status=${job.data.status} personaLeft=${job.data.personaLeft} failed=${(job.data.failed || []).length}`);
        if (job.data.status === 'done' || job.data.status === 'error') break;
      }
    }
    log(`batch-create 终态 status=${job.data.status} 耗时=${Math.round((Date.now() - t0) / 1000)}s failed=${(job.data.failed || []).map((f) => f.name).join(',') || '无'}`);
    found = findR1bProfiles();
    log(`DB 复查：vl-r1b 协作组档案 ${found.length} 个`);
  }

  if (found.length < TIERS.length) throw new Error(`vl-r1b-* 档案不足：${found.length}/${TIERS.length}，中止`);
  const byName = mapToTiers(found);
  log(`档案映射：${TIERS.map((t) => `${t.name}→${byName.get(t.name)?.profileId?.slice(0, 8) || 'MISSING'}(${byName.get(t.name)?.name || '?'})`).join(' ')}`);

  // 4. 逐 VL PUT 写固定目标 + frictionBudget + persona 档位文本 + tags
  const patched = [];
  for (const t of TIERS) {
    const prof = byName.get(t.name);
    if (!prof) { log(`${t.name} 无档案，跳过 patch`); continue; }
    const storyPool = [{
      id: `r1b-goal-${t.tier}`,
      title: '固定目标·光合作用与呼吸作用',
      sourceType: 'synthetic',
      outline: '',
      triggerEvent: '',
      visibleOpening: FIXED_GOAL, // story-demand.ts 候选链第一位 → conversation.description → Path 唯一输入
    }];
    const body = {
      learningGoal: FIXED_GOAL,
      knowledgeLevel: 'beginner',
      tags: ['r1b', t.name, `tier:${t.tier}`, 'measure-round1'],
      notes: `r1b=${t.name} · 测量验证第一轮对比组 · tier=${t.tier} · frictionBudget=${t.frictionBudget}（写 runtimePrefs，session-factory 默认链生效）· persona 档位文本写 profile.background · 固定目标写 storyPool[0].visibleOpening（story-demand 优先级第一位）`,
      profile: {
        background: t.persona,
        storyPool,
        runtimePrefs: { frictionBudget: t.frictionBudget },
        r1bMeasure: { lesson: t.lesson, tier: t.tier, frictionBudget: t.frictionBudget, goalSource: 'storyPool[0].visibleOpening', round: 1, date: '2026-10-06' },
      },
    };
    await api('PUT', `/api/admin/virtual-learners/${prof.profileId}`, body, { timeout: 60000 });
    // 5. 回读验证
    const back = await api('GET', `/api/admin/virtual-learners/${prof.profileId}`);
    const d = back.data || {};
    const rp = d.profile?.runtimePrefs || {};
    const sp = Array.isArray(d.profile?.storyPool) ? d.profile.storyPool : [];
    const ok = d.learningGoal === FIXED_GOAL && rp.frictionBudget === t.frictionBudget && sp.length === 1 && sp[0].visibleOpening === FIXED_GOAL;
    log(`patch ${t.name}(${t.lesson}, tier=${t.tier}, fb=${t.frictionBudget}) profileId=${prof.profileId} userId=${prof.userId} 回读验证=${ok ? 'PASS' : 'FAIL'} storyPool=${sp.length} visibleOpening 匹配=${sp[0]?.visibleOpening === FIXED_GOAL} runtimePrefs=${JSON.stringify(rp)}`);
    patched.push({ lesson: t.lesson, name: t.name, tier: t.tier, frictionBudget: t.frictionBudget, personaTag: t.name, profileId: prof.profileId, userId: prof.userId, patchVerified: ok });
  }

  // 6. ids 文件（runner findByPersona 用 tags 第 2 段）
  fs.writeFileSync(IDS_FILE, patched.map((p) => p.personaTag).join('\n') + '\n');
  fs.writeFileSync(PROFILES_FILE, JSON.stringify({ base: BASE, fixedGoal: FIXED_GOAL, patched, batch: batchInfo }, null, 1));
  log(`ids 文件写入 ${IDS_FILE}（${patched.length} 行）；档案清单写入 ${PROFILES_FILE}`);
  const bad = patched.filter((p) => !p.patchVerified);
  log(`setup 完成：patch 验证 ${patched.length - bad.length}/${patched.length} PASS${bad.length ? '；FAIL: ' + bad.map((b) => b.name).join(',') : ''}`);
  if (bad.length || patched.length !== TIERS.length) process.exitCode = 1;
}

main().catch((e) => { log(`setup FAIL: ${String(e.message || e)}`); process.exit(1); });
