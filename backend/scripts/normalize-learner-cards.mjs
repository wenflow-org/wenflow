/**
 * 存量卡规范化（2026-10-05 卡库 demo 化，用户令「给这些卡重新优化设计一下」）：
 * ①为缺 nickname 的自建卡回填 personaSeed.nickname（deriveCardNickname：nameHint 人设短语 /
 *   users.name 括号提取），导出回程即带昵称；
 * ②tags 数据层剔除 w\d+ 波次标签（本地跑批批次代号不入 demo 数据）。
 * 预置卡（presetKey 非空）跳过——部署时按 presets.yaml 幂等同步，脚本写了会被覆写。
 *
 * 用法：node scripts/normalize-learner-cards.mjs          # 干跑（只报数）
 *       node scripts/normalize-learner-cards.mjs --apply  # 写入
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const CARD_KEY_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function cleanDisplayName(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^[^\s（(]{2,}[（(]([^）)]{2,})[）)]\s*$/);
  if (m) return m[1].trim();
  const pipe = s.match(/^[a-z0-9][a-z0-9._-]{1,63}\s*[｜|]\s*(.+)$/);
  if (pipe) return pipe[1].trim();
  return s;
}

function deriveCardNickname(seed, usersName) {
  if (typeof seed.nickname === 'string' && seed.nickname.trim()) return null;
  const hint = typeof seed.nameHint === 'string' ? seed.nameHint.trim() : '';
  if (hint && !CARD_KEY_RE.test(hint)) {
    const fromHint = cleanDisplayName(hint);
    if (fromHint) return fromHint;
  }
  const rawName = String(usersName || '').trim();
  const fromUsers = cleanDisplayName(rawName);
  if (fromUsers && fromUsers !== rawName) return fromUsers;
  return null;
}

function stripWaveTags(tags) {
  return tags.filter((t) => !/^w\d+$/i.test(t));
}

const rows = await prisma.virtual_learner_profiles.findMany({
  select: { id: true, profile: true, tags: true, presetKey: true, users: { select: { name: true } } },
});

let skippedPreset = 0;
let nicknameFilled = 0;
let tagsCleaned = 0;
let unchanged = 0;
let badJson = 0;
const samples = [];

for (const r of rows) {
  if (r.presetKey) { skippedPreset++; continue; }
  let p;
  let tags;
  try {
    p = JSON.parse(r.profile || '{}');
    tags = JSON.parse(r.tags || '[]');
    if (!Array.isArray(tags)) tags = [];
  } catch {
    badJson++;
    continue;
  }
  p.personaSeed = p.personaSeed || {};
  const nickname = deriveCardNickname(p.personaSeed, r.users?.name);
  const nextTags = stripWaveTags(tags);
  const nicknameChanged = nickname != null;
  const tagsChanged = nextTags.length !== tags.length;
  if (!nicknameChanged && !tagsChanged) { unchanged++; continue; }
  if (nicknameChanged) p.personaSeed.nickname = nickname;
  if (APPLY) {
    await prisma.virtual_learner_profiles.update({
      where: { id: r.id },
      data: {
        ...(nicknameChanged ? { profile: JSON.stringify(p) } : {}),
        ...(tagsChanged ? { tags: JSON.stringify(nextTags) } : {}),
      },
    });
  }
  if (nicknameChanged) nicknameFilled++;
  if (tagsChanged) tagsCleaned++;
  if (samples.length < 8) {
    samples.push({
      id: r.id,
      usersName: r.users?.name || null,
      nickname: nicknameChanged ? nickname : null,
      nicknameFrom: nicknameChanged ? null : undefined,
      tagsBefore: tags,
      tagsAfter: nextTags,
    });
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'APPLY' : 'DRY-RUN',
  total: rows.length,
  skippedPreset,
  nicknameFilled,
  tagsCleaned,
  unchanged,
  badJson,
  samples,
}, null, 1));

await prisma.$disconnect();
