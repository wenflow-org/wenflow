#!/usr/bin/env node
/** import-personas.mjs — 把 paradigm-eval 人设卡批量导入平台 Virtual Lab（VL 原生重跑 Phase 1）。
 * 每卡：POST 创建（卡映射 profile+story）→ draft-profile 富化 → PUT 合并回写。
 * 幂等：name=personaId，已存在即跳过。
 * 用法：node scripts/vlab-eval/import-personas.mjs [--file=...] [--filter=rw-school6] [--limit=10] [--concurrency=4] [--no-enrich] [--base=http://127.0.0.1:3010]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };
const BASE = arg('base', 'http://127.0.0.1:3010');
const FILE = arg('file', 'scripts/paradigm-eval/real-goals-cases.json');
const FILTER = arg('filter', '');
const LIMIT = Number(arg('limit', '0'));
const CONC = Math.max(1, Number(arg('concurrency', '4')));
const ENRICH = !process.argv.includes('--no-enrich');
const RUN_DATE = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
const OUT = path.join(ROOT, 'doc/local/runs', RUN_DATE, 'vl-import-summary.jsonl');

// admin 登录（INIT_ADMIN_* 与 run-vl-one.js 同源）
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
let cookie = '';
async function adminLogin() {
  const res = await fetch(BASE + '/api/admin-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: envGet('INIT_ADMIN_NAME'), password: envGet('INIT_ADMIN_PASSWORD'), remember: true }) });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const j = await res.json().catch(() => ({}));
  if (!cookie || j.success === false) throw new Error('admin 登录失败: ' + JSON.stringify(j).slice(0, 120));
}
async function api(method, urlPath, body, { retries = 4, timeout = 300000 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(BASE + urlPath, { method, headers: { Cookie: cookie, Origin: 'http://localhost:5173', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
      if (res.status === 401 && i < retries) { await adminLogin(); continue; }
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      if (!res.ok || json?.success === false) {
        last = `${res.status} ${String(json?.error?.message || json?.error || text).slice(0, 140)}`;
        if (res.status === 409 || res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 8000 * (i + 1))); continue; }
        throw new Error(last);
      }
      return json;
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') { last = 'timeout'; await new Promise((r) => setTimeout(r, 8000 * (i + 1))); continue; }
      last = e.message || String(e);
      if (i === retries) throw new Error(last);
      await new Promise((r) => setTimeout(r, 8000 * (i + 1)));
    }
  }
  throw new Error(last || 'failed');
}

function cardToVl(card) {
  const b = card.budget || {};
  const wave = (card.personaId.match(/^rw-[a-z]+?(\d+)-/) || [])[1] || '0';
  return {
    name: card.personaId,
    learningGoal: `${card.domain}（${b.horizon || '自定义期限'}）`,
    knowledgeLevel: ['exam', 'review', 'mastery', 'advance'].includes(card.intentType) ? 'intermediate' : 'beginner',
    profile: {
      personaSeed: {
        nameHint: card.personaId,
        background: card.domain,
        availableTime: (b.dailyMinutes ? b.dailyMinutes + '分钟/天' : '碎片时间'),
        learningGoal: card.domain,
        intentType: card.intentType,
      },
      storyPool: [{
        id: 'story-1',
        title: card.domain,
        visibleOpening: card.opening,
        behaviorHooks: card.followUps || [],
        goalSeed: {
          domain: card.domain,
          intentType: card.intentType,
          budget: b,
          schoolAnchor: card.schoolAnchor || null,
          sourceRef: card.source?.ref || null,
          horizonDays: b.horizonDays || null,
          dailyMinutes: b.dailyMinutes || null,
          expectedHours: b.expectedHours || null,
        },
        budget: b,
      }],
      intentType: card.intentType,
      domain: card.domain,
      budget: b,
      followUps: card.followUps || [],
      schoolAnchor: card.schoolAnchor || null,
      sourceRef: card.source?.ref || null,
      scenarioOrigin: 'paradigm-eval-wave' + wave,
    },
    tags: [wave === '6' ? 'w6' : 'w' + wave, card.personaId, card.domain, card.intentType],
    notes: `source: ${card.source?.ref || 'n/a'}`,
  };
}

const cards = JSON.parse(fs.readFileSync(path.resolve(ROOT, FILE), 'utf8')).cases.filter((c) => !FILTER || c.personaId.startsWith(FILTER));
const selected = LIMIT > 0 ? cards.slice(0, LIMIT) : cards;
if (!selected.length) { console.error('无人设命中过滤条件'); process.exit(1); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const record = (o) => fs.appendFileSync(OUT, JSON.stringify(o) + '\n');

// 幂等：翻页直到空页（列表接口忽略 pageSize，步长假设会漏页——2026-10-01 踩坑），tags 分段精确匹配
await adminLogin();
const tagStrings = [];
try {
  let page = 1;
  for (; page < 200; page++) {
    const list = await api('GET', `/api/admin/virtual-learners?page=${page}&pageSize=100`);
    const d = list.data || {};
    const items = d.profiles || d.items || [];
    for (const p of items) tagStrings.push(String(p.tags || ''));
    if (!items.length) break;
  }
  console.log('现有 VL tags 条数:', tagStrings.length, '（翻页', page, '）');
} catch (e) { console.log('列表拉取失败（继续，逐卡查重兜底）:', String(e.message).slice(0, 80)); }
const already = (personaId) => tagStrings.some((t) => t.split(',').map((s) => s.trim()).includes(personaId));

let done = 0, skip = 0, fail = 0;
const failed = [];
async function importCard(card) {
  const b = card.budget || {};
  if (already(card.personaId)) { skip++; record({ id: card.personaId, ok: true, skipped: 'exists' }); return; }
  const payload = cardToVl(card);
  try {
    const created = await api('POST', '/api/admin/virtual-learners', payload);
    const id = created.data?.id;
    if (!id) throw new Error('创建无返回 id');
    if (ENRICH) {
      // 富化走 generate-persona；candidate 必须是字符串提示且写明"以此为本"（2026-10-01 实证：传对象会被自由生成成泛化学生）
      const isStudent = /^rw-school/.test(card.personaId);
      const scenarioHint = `【务必以下面这个真实情景为本生成画像，身份/学段/学科/卡点必须与之一致，不得自由采样】\n情景：${card.domain}\n开场原话：${card.opening}\n追问细节：${(card.followUps || []).join('；')}\n预算：${b.dailyMinutes || '?'}分钟/天 × ${b.horizonDays || '?'}天（期望 ${b.expectedHours || '?'} 小时）\n${card.schoolAnchor ? '校内锚：' + JSON.stringify(card.schoolAnchor) : ''}`;
      const enrich = await api('POST', '/api/admin/virtual-learners/generate-persona', {
        candidatePersonas: [scenarioHint],
        preferredLevels: [payload.knowledgeLevel],
        sampleType: isStudent ? 'student' : undefined,
        existingPersonaSeed: { nameHint: card.personaId, background: card.domain, learningGoal: payload.learningGoal, intentType: card.intentType, availableTime: b.dailyMinutes ? b.dailyMinutes + '分钟/天' : undefined },
      });
      const seed = enrich.data?.personaSeed;
      if (!seed || !Object.keys(seed).length) throw new Error('富化无 personaSeed');
      // 锁定情景：种子合成后保留我的情景锚（防 LLM 漂移），nameHint 对齐 personaId
      seed.background = seed.background && String(seed.background).includes(card.domain.slice(0, 6)) ? seed.background : card.domain;
      seed.scenarioCard = { personaId: card.personaId, domain: card.domain, opening: card.opening, followUps: card.followUps, budget: b, schoolAnchor: card.schoolAnchor || null, sourceRef: card.source?.ref || null };
      await api('PUT', `/api/admin/virtual-learners/${id}`, { profile: { personaSeed: seed } });
    }
    done++;
    record({ id: card.personaId, vlId: id, ok: true, enriched: ENRICH });
    console.log(`[${done + skip}] ${card.personaId} 导入${ENRICH ? '+富化' : ''} ok`);
  } catch (e) {
    fail++;
    failed.push(card.personaId);
    record({ id: card.personaId, ok: false, err: String(e.message || e).slice(0, 200) });
    console.log(`[${done + skip}] ${card.personaId} FAIL: ${String(e.message || e).slice(0, 100)}`);
  }
}

await Promise.all(Array.from({ length: CONC }, async (_, w) => {
  for (let i = w; i < selected.length; i += CONC) await importCard(selected[i]);
}));
console.log(`导入完成: ok=${done} skip=${skip} fail=${fail} / ${selected.length}`);
if (failed.length) { fs.writeFileSync(path.join(ROOT, 'doc/local/runs', RUN_DATE, 'vl-import-failed.txt'), failed.join('\n') + '\n'); console.log('失败清单 → vl-import-failed.txt'); }
