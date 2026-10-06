/**
 * LLM 昵称清理趟（2026-10-06）：①剥昵称开头的批次 ID 前缀（rw-、vl- 开头的批次 ID 前缀加 ·/|///分隔符）；
 * ②元话产物（「缺人设内容——只有卡 ID」）重新问 LLM（更硬的约束）。
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const readEnv = (k) => { const m = new RegExp(`^${k}=(.*)$`, 'm').exec(env); return m ? m[1].trim() : ''; };
const BASE = (readEnv('AI_API_URL') || '').replace(/\/+$/, '');
const KEY = readEnv('AI_API_KEY');
const URL_ = `${BASE}/v1/chat/completions`;

const prisma = new PrismaClient();
const ID_PREFIX_RE = /^(?:rw|vl|card)-[a-z0-9._-]+\s*[·|｜/／,，、:：-]?\s*/i;
const META_RE = /缺人设|只有卡|无法|没有足够|错误|抱歉|未知/;

function cleanNickname(n) {
  let out = String(n || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(ID_PREFIX_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

const rows = await prisma.virtual_learner_profiles.findMany({ where: { presetKey: null }, select: { id: true, profile: true, learningGoal: true } });

let prefixStripped = 0;
const metaCards = [];
for (const r of rows) {
  try {
    const p = JSON.parse(r.profile || '{}');
    const seed = p.personaSeed || {};
    const n = typeof seed.nickname === 'string' ? seed.nickname.trim() : '';
    if (!n) continue;
    if (META_RE.test(n)) { metaCards.push({ id: r.id, profile: r.profile, goal: r.learningGoal, nickname: n }); continue; }
    const cleaned = cleanNickname(n);
    if (cleaned && cleaned !== n) {
      seed.nickname = cleaned;
      await prisma.virtual_learner_profiles.update({ where: { id: r.id }, data: { profile: JSON.stringify(p) } });
      prefixStripped++;
    }
  } catch { /* 坏 JSON 跳过 */ }
}

console.log(JSON.stringify({ prefixStripped, metaCards: metaCards.length }));

let reasked = 0;
for (const m of metaCards) {
  try {
    const p = JSON.parse(m.profile);
    const goal = m.goal || '';
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{
          role: 'user',
          content: `这张虚拟学习者卡只有学习目标，没有其他人设字段。目标：「${goal}」。\n只输出一个 8-14 字的中文人设化昵称（描述「一个什么样的人」，如「想转数据分析的制造业老兵」）。禁止输出任何说明、引号、ID。`,
        }],
        temperature: 0.8,
        max_tokens: 400,
      }),
    });
    const j = await res.json();
    const raw = String(j?.choices?.[0]?.message?.content || '').trim().replace(/^["'「『]|["'」』]$/g, '').split('\n')[0].trim();
    if (raw && !META_RE.test(raw) && raw.length <= 24) {
      p.personaSeed.nickname = raw;
      await prisma.virtual_learner_profiles.update({ where: { id: m.id }, data: { profile: JSON.stringify(p) } });
      reasked++;
      console.log(`[reask] ${m.id.slice(0, 8)}: ${raw}`);
    } else {
      console.log(`[reask-fail] ${m.id.slice(0, 8)}: ${raw.slice(0, 60)}`);
    }
  } catch (e) {
    console.log(`[reask-err] ${m.id.slice(0, 8)}: ${String(e).slice(0, 80)}`);
  }
}
console.log(JSON.stringify({ prefixStripped, metaReasked: reasked }));
await prisma.$disconnect();
