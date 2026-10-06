/**
 * 存量卡 LLM 昵称补齐（2026-10-06，用户令「改吧」）：normalize-learner-cards 确定性派生
 * 覆盖 232/465 后，剩余 233 张裸 ID 卡（nameHint 为 key 形态或缺失、users.name 无括号/竖线
 * 可提取）用 LLM 从 卡目标/背景/cardKey 起一个人设化昵称（≤12 字），写 personaSeed.nickname。
 *
 * 上游：AI_API_URL/AI_API_KEY/AI_MODEL（与网关同一通道，.env）。
 * 用法：node scripts/enrich-card-nicknames.mjs            # 干跑（只打印样例）
 *       node scripts/enrich-card-nicknames.mjs --apply    # 写入
 *       CONCURRENCY=8 node scripts/...                    # 并发档（默认 6）
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const readEnv = (k) => {
  const m = new RegExp(`^${k}=(.*)$`, 'm').exec(env);
  return m ? m[1].trim() : '';
};
const BASE = (readEnv('AI_API_URL') || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = readEnv('AI_API_KEY');
// AI_MODEL=deepseek-v4-flash 在该上游无渠道（memory：标准通道整链只用 dsv4.1）——
// 昵称这种轻任务显式用 dsv4.1-flash（同通道、非啰嗦变体）
const MODEL = 'deepseek-v4.1-flash';
const URL_ = /\/v1$/i.test(BASE) ? `${BASE}/chat/completions` : `${BASE}/v1/chat/completions`;

const prisma = new PrismaClient();
const CARD_KEY_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function buildPrompt(card) {
  const facts = [];
  if (card.goal) facts.push(`学习目标：${card.goal}`);
  if (card.background) facts.push(`背景：${String(card.background).slice(0, 120)}`);
  if (card.nameHint && !CARD_KEY_RE.test(card.nameHint)) facts.push(`画像提示：${card.nameHint}`);
  facts.push(`卡 ID：${card.cardKey || card.profileId.slice(0, 8)}`);
  return [
    '给下面这个虚拟学习者卡起一个中文昵称：人设化短语，8-14 个字，有画面感，',
    '不要出现批次代号/ID/英文（除非是人设本身），不要引号，直接输出昵称本身。',
    '',
    facts.join('\n'),
  ].join('\n');
}

async function askNickname(card, attempt = 1) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(card) }],
      temperature: 0.7,
      // 40 会被推理段吃光出「空响应」——给足额度后取 content（模型本身听指令只回昵称）
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  const raw = String(j?.choices?.[0]?.message?.content || '').trim();
  // 清理：去引号/前后缀说明/超长截断
  const cleaned = raw
    .replace(/^["'「『]|["'」』]$/g, '')
    .replace(/^(昵称|昵称：)\s*/i, '')
    .split('\n')[0]
    .trim()
    .slice(0, 20);
  if (!cleaned) throw new Error('空响应');
  return cleaned;
}

const rows = await prisma.virtual_learner_profiles.findMany({
  where: { presetKey: null },
  select: { id: true, profile: true, learningGoal: true, users: { select: { name: true } } },
});

const targets = [];
for (const r of rows) {
  try {
    const p = JSON.parse(r.profile || '{}');
    const seed = p.personaSeed || {};
    if (typeof seed.nickname === 'string' && seed.nickname.trim()) continue;
    const hint = typeof seed.nameHint === 'string' ? seed.nameHint.trim() : '';
    const usersName = String(r.users?.name || '');
    const usersNameUsable = /^[^\s（(]{2,}[（(]([^）)]{2,})[）)]$/.test(usersName) || /^[a-z0-9][a-z0-9._-]{1,63}\s*[｜|]/.test(usersName);
    if (hint && !CARD_KEY_RE.test(hint)) continue; // 确定性派生应已覆盖（防御性跳过）
    if (usersNameUsable) continue;
    const seed2 = seed.scenarioCard || {};
    targets.push({
      profileId: r.id,
      profile: r.profile,
      cardKey: seed2.cardKey || p.cardKey || null,
      goal: r.learningGoal,
      background: typeof seed.background === 'string' ? seed.background : '',
      nameHint: hint,
    });
  } catch { /* 坏 JSON 跳过 */ }
}

console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'DRY-RUN', total: rows.length, targets: targets.length, model: MODEL, url: URL_, concurrency: CONCURRENCY }));

let ok = 0;
let fail = 0;
const samples = [];
let idx = 0;

async function worker() {
  while (idx < targets.length) {
    const t = targets[idx++];
    try {
      let nickname = null;
      for (let a = 0; a < 2 && !nickname; a++) {
        try { nickname = await askNickname(t); } catch (e) { if (a === 1) throw e; }
      }
      if (!nickname) throw new Error('两次尝试均空响应');
      if (APPLY) {
        const p = JSON.parse(t.profile);
        p.personaSeed = p.personaSeed || {};
        p.personaSeed.nickname = nickname;
        await prisma.virtual_learner_profiles.update({ where: { id: t.profileId }, data: { profile: JSON.stringify(p) } });
      }
      ok++;
      if (samples.length < 15) samples.push({ cardKey: t.cardKey, goal: t.goal.slice(0, 30), nickname });
    } catch (e) {
      fail++;
      if (fail <= 5) console.error(`[fail] ${t.cardKey || t.profileId.slice(0, 8)}: ${String(e.message || e).slice(0, 160)}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

console.log(JSON.stringify({ ok, fail, samples }, null, 1));
await prisma.$disconnect();
