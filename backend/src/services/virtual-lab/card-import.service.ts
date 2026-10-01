/**
 * 学习者卡导入服务（卡库 v1，2026-10-01 用户拍板设计）。
 *
 * 设计口径：卡=数据，结构化导入即用，不经过任何 prompt 编译链；一张卡 = 一个系统账号
 * （isVirtualLearner，随机密码不可登录）+ 一份档案 + 故事池，创建原子完成。
 * 校验规则源自 2026-10-01 实测教训：来源诚实性（假来源 authored 事故）、预算自洽
 * （18 张虚高）、followUps 数量、同源重复预警（563 张里 60 张重复）。
 * 语义级去重（同场景改写）不在校验器内做——由 LLM 判读流程负责；校验器只做确定性检查。
 */
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import yaml from 'js-yaml';
import { executeSkill } from '../../skills';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import {
  createVirtualLearnerUser,
  createVirtualLearnerProfile,
  updateProfileFields,
  findAllProfilesForCardIndex,
  findCustomCardsForExport,
} from './virtual-learner-profile.repo';
import { logger } from '../../utils/logger';

export interface LearnerCard {
  cardKey: string;
  version?: number;
  enabled?: boolean;
  account?: { displayName?: string; emailPrefix?: string };
  persona?: Record<string, unknown>;
  story?: {
    visibleOpening?: string;
    followUps?: string[];
    goalSeed?: Record<string, unknown>;
    title?: string;
  };
  source?: { kind?: 'web' | 'synthetic'; ref?: string; note?: string };
  tags?: string[];
  knowledgeLevel?: string;
  notes?: string;
}

export interface CardReport {
  cardKey: string | null;
  status: 'ok' | 'error' | 'exists' | 'warn';
  errors: string[];
  warnings: string[];
  existingProfileId?: string;
}

const CARD_KEY_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function parseCardDocument(content: string, format: 'yaml' | 'json'): { cards: LearnerCard[]; parseError?: string } {
  let doc: unknown;
  try {
    doc = format === 'json' ? JSON.parse(content) : yaml.load(content);
  } catch (e) {
    return { cards: [], parseError: `解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const cards = (doc as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) return { cards: [], parseError: '文档缺少 cards 数组（格式：{cards: [...]}）' };
  return { cards: cards as LearnerCard[] };
}

/** 确定性校验（不做语义判重）。existing: 库内已存在卡的 cardKey→profileId 与同源引用集合 */
export function validateCard(card: LearnerCard, existing: { byKey: Map<string, string>; refs: Map<string, string[]>; seenInDoc: Set<string> }): CardReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const key = typeof card.cardKey === 'string' ? card.cardKey.trim() : '';
  if (!key) errors.push('cardKey 必填');
  else if (!CARD_KEY_RE.test(key)) errors.push('cardKey 需匹配 [a-z0-9._-]，2-64 字符');
  else if (existing.seenInDoc.has(key)) errors.push('文件内 cardKey 重复');
  if (key) existing.seenInDoc.add(key);

  const persona = (card.persona || {}) as Record<string, unknown>;
  if (!persona.nameHint) warnings.push('persona.nameHint 缺失（显示名将回退 cardKey）');
  if (!persona.background) errors.push('persona.background 必填（此人是谁）');

  const story = card.story || {};
  const opening = String(story.visibleOpening || '').trim();
  if (!opening) errors.push('story.visibleOpening 必填（开场原话）');
  else if (opening.length < 30 || opening.length > 600) warnings.push(`story.visibleOpening 长度 ${opening.length}（建议 30-600）`);
  const fus = story.followUps || [];
  if (!Array.isArray(fus) || fus.length !== 3 || fus.some((t) => typeof t !== 'string' || !t.trim())) {
    warnings.push('story.followUps 建议恰好 3 条非空（当前 ' + (Array.isArray(fus) ? fus.length : 0) + '）');
  }

  const budget = (story.goalSeed?.budget || {}) as Record<string, unknown>;
  const daily = Number(budget.dailyMinutes);
  const days = Number(budget.horizonDays);
  const hours = Number(budget.expectedHours);
  if (daily > 0 && days > 0 && hours > 0) {
    const expected = (daily * days) / 60;
    const drift = Math.abs(hours - expected) / Math.max(hours, expected);
    if (drift > 0.5) warnings.push(`预算不自洽：expectedHours=${hours} 与 daily×days=${expected.toFixed(1)} 偏差 ${(drift * 100).toFixed(0)}%`);
  } else if (daily || days || hours) {
    warnings.push('预算字段不完整（dailyMinutes/horizonDays/expectedHours 建议同时给）');
  }

  const src = card.source || {};
  if (!src.kind) errors.push('source.kind 必填（web | synthetic）');
  else if (src.kind === 'web') {
    if (!src.ref || !/^https?:\/\//.test(String(src.ref))) errors.push('source.kind=web 时 ref 必填且为 http(s) 链接');
  } else if (src.kind === 'synthetic') {
    if (src.ref && /^https?:/.test(String(src.ref))) warnings.push('source.kind=synthetic 但给了 URL，确认标注是否正确');
    warnings.push('合成来源将标记 isSynthetic（不得伪造真实链接）');
  } else {
    errors.push(`source.kind 非法：${String(src.kind)}（仅 web | synthetic）`);
  }

  if (src.kind === 'web' && src.ref) {
    const dup = existing.refs.get(String(src.ref));
    if (dup && dup.length) warnings.push(`同源预警：${String(src.ref)} 已被 ${dup.slice(0, 3).join('、')} 使用（跨波重渲染高发，导入前建议 LLM 判读是否同场景）`);
  }

  const exists = key ? existing.byKey.get(key) : undefined;
  if (exists) return { cardKey: key || null, status: 'exists', errors, warnings, existingProfileId: exists };
  if (errors.length) return { cardKey: key || null, status: 'error', errors, warnings };
  return { cardKey: key || null, status: warnings.length ? 'warn' : 'ok', errors, warnings };
}

function normalizeProfileShape(profile: Record<string, unknown>): Record<string, unknown> {
  // 与创建路由同款：把 personaSeed 里的 availableTime/cognitiveLoadTolerance 抬到顶层（下游读顶层）
  const normalized: Record<string, unknown> = { ...profile };
  const seed = (profile.personaSeed || {}) as Record<string, unknown>;
  for (const field of ['availableTime', 'cognitiveLoadTolerance'] as const) {
    if (normalized[field] === undefined && seed[field] !== undefined) normalized[field] = seed[field];
  }
  return normalized;
}

function cardToProfile(card: LearnerCard): Record<string, unknown> {
  const persona = (card.persona || {}) as Record<string, unknown>;
  const story = card.story || {};
  const goalSeed = (story.goalSeed || {}) as Record<string, unknown>;
  const budget = (goalSeed.budget || {}) as Record<string, unknown>;
  const domain = String(goalSeed.domain || persona.background || card.cardKey);
  const scenarioCard = {
    cardKey: card.cardKey,
    domain,
    opening: story.visibleOpening,
    followUps: story.followUps || [],
    budget,
    schoolAnchor: goalSeed.schoolAnchor || null,
    intentType: goalSeed.intentType || null,
    sourceRef: card.source?.ref || null,
    sourceKind: card.source?.kind || null,
  };
  return normalizeProfileShape({
    personaSeed: { ...persona, scenarioCard },
    storyPool: [{
      id: 'story-1',
      title: story.title || domain,
      visibleOpening: story.visibleOpening,
      behaviorHooks: story.followUps || [],
      goalSeed,
      budget,
    }],
    cardKey: card.cardKey,
    cardVersion: card.version || 1,
    isSyntheticSource: card.source?.kind === 'synthetic',
    importedAt: new Date().toISOString(),
  });
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const t = JSON.parse(raw);
    return Array.isArray(t) ? t.map(String) : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

/**
 * 卡身份解析：优先 profile.cardKey（卡库导入写入），回退到 personaSeed.scenarioCard.personaId /
 * nameHint / tags 中首个符合 cardKey 形态的段。回退不取 'w5'/'w6' 这类波次标签——历史批量导入
 * （import-personas）把波次放在 tags[0]，直接取 tags[0] 会让整波卡撞成同一个 key。
 */
export function resolveCardKey(profile: Record<string, unknown>, tags: string[]): string | null {
  const direct = typeof profile.cardKey === 'string' ? profile.cardKey.trim() : '';
  if (direct) return direct;
  const seed = (profile.personaSeed || {}) as Record<string, unknown>;
  const scenario = (seed.scenarioCard || {}) as Record<string, unknown>;
  if (typeof scenario.personaId === 'string' && scenario.personaId.trim()) return scenario.personaId.trim();
  if (typeof seed.nameHint === 'string' && CARD_KEY_RE.test(seed.nameHint)) return seed.nameHint;
  for (const t of tags) if (CARD_KEY_RE.test(t) && !/^w\d+$/i.test(t)) return t;
  return null;
}

/** 收集库内已存在卡的查重索引 */
async function buildExistingIndex(): Promise<{ byKey: Map<string, string>; refs: Map<string, string[]> }> {
  const rows = await findAllProfilesForCardIndex();
  const byKey = new Map<string, string>();
  const refs = new Map<string, string[]>();
  for (const r of rows) {
    let cardKey: string | null = null;
    let ref: string | null = null;
    let name: string | null = null;
    try {
      const p = JSON.parse(r.profile || '{}') as Record<string, unknown>;
      cardKey = resolveCardKey(p, parseTags(r.tags));
      const seed = (p.personaSeed || {}) as Record<string, unknown>;
      ref = ((seed.scenarioCard as Record<string, unknown> | undefined)?.sourceRef as string) || null;
      name = (seed.nameHint as string) || null;
    } catch { /* 坏 JSON 忽略 */ }
    if (cardKey) byKey.set(cardKey, r.id);
    if (ref) { const list = refs.get(ref) || []; list.push(cardKey || name || r.id); refs.set(ref, list); }
  }
  return { byKey, refs };
}

export async function validateCards(content: string, format: 'yaml' | 'json') {
  const parsed = parseCardDocument(content, format);
  if (parsed.parseError) return { parseError: parsed.parseError, reports: [] as CardReport[], summary: null };
  const { byKey, refs } = await buildExistingIndex();
  const seenInDoc = new Set<string>();
  const reports = parsed.cards.map((c) => validateCard(c, { byKey, refs, seenInDoc }));
  const summary = {
    total: reports.length,
    ok: reports.filter((r) => r.status === 'ok' || r.status === 'warn').length,
    exists: reports.filter((r) => r.status === 'exists').length,
    error: reports.filter((r) => r.status === 'error').length,
  };
  return { parseError: null, reports, summary };
}

export interface ImportOptions { enrich?: boolean; update?: boolean }

export async function importCards(content: string, format: 'yaml' | 'json', opts: ImportOptions = {}) {
  const parsed = parseCardDocument(content, format);
  if (parsed.parseError) return { parseError: parsed.parseError, results: [], summary: null };
  const { byKey, refs } = await buildExistingIndex();
  const seenInDoc = new Set<string>();
  const results: Array<{ cardKey: string | null; action: 'created' | 'updated' | 'skipped' | 'failed'; reason?: string }> = [];

  for (const card of parsed.cards) {
    const report = validateCard(card, { byKey, refs, seenInDoc });
    if (report.status === 'error') { results.push({ cardKey: report.cardKey, action: 'failed', reason: report.errors.join('；') }); continue; }
    if (report.status === 'exists' && !opts.update) { results.push({ cardKey: report.cardKey, action: 'skipped', reason: '已存在（update=false）' }); continue; }
    try {
      let profile = cardToProfile(card);
      if (opts.enrich) profile = await enrichProfile(card, profile);
      if (report.status === 'exists' && report.existingProfileId && opts.update) {
        await updateProfileFields(report.existingProfileId, {
          profile: JSON.stringify(profile),
          learningGoal: String((card.story?.goalSeed?.domain as string) || (card.persona?.background as string) || card.cardKey),
          knowledgeLevel: card.knowledgeLevel || 'beginner',
          tags: JSON.stringify([card.cardKey, ...(card.tags || [])]),
          notes: card.notes || card.source?.note || null,
        });
        results.push({ cardKey: card.cardKey, action: 'updated' });
        continue;
      }
      const email = `${(card.account?.emailPrefix || `vl-${card.cardKey}`).replace(/[^a-z0-9._-]/gi, '-')}@cards.local`;
      const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
      const user = await createVirtualLearnerUser({
        data: {
          id: randomUUID(), email, name: card.account?.displayName || String(card.persona?.nameHint || card.cardKey),
          password, role: 'user', currentLevel: card.knowledgeLevel || 'beginner', isAdmin: false,
          isVirtualLearner: true, updatedAt: new Date(),
        },
      });
      await createVirtualLearnerProfile({
        data: {
          id: randomUUID(), userId: user.id, profile: JSON.stringify(profile),
          learningGoal: String((card.story?.goalSeed?.domain as string) || (card.persona?.background as string) || card.cardKey),
          knowledgeLevel: card.knowledgeLevel || 'beginner',
          knownConcepts: card.persona?.knownConcepts ? JSON.stringify(card.persona.knownConcepts) : null,
          struggleConcepts: card.persona?.struggleConcepts ? JSON.stringify(card.persona.struggleConcepts) : null,
          simulationTemperature: 0.8,
          tags: JSON.stringify([card.cardKey, ...(card.tags || [])]),
          notes: card.notes || card.source?.note || null,
        },
      });
      byKey.set(card.cardKey, 'created');
      results.push({ cardKey: card.cardKey, action: 'created' });
    } catch (e) {
      logger.warn('[card-import] 卡导入失败', { cardKey: card.cardKey, error: (e as Error).message });
      results.push({ cardKey: card.cardKey, action: 'failed', reason: (e as Error).message.slice(0, 160) });
    }
  }
  const summary = {
    total: results.length,
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    skipped: results.filter((r) => r.action === 'skipped').length,
    failed: results.filter((r) => r.action === 'failed').length,
  };
  return { parseError: null, results, summary };
}

/** 可选富化：情景强制 grounding（2026-10-01 实证：不锁情景会生成张冠李戴的人设） */
async function enrichProfile(card: LearnerCard, profile: Record<string, unknown>): Promise<Record<string, unknown>> {
  const persona = (card.persona || {}) as Record<string, unknown>;
  const story = card.story || {};
  const seed = (profile.personaSeed || {}) as Record<string, unknown>;
  const scenario = (seed.scenarioCard || {}) as Record<string, unknown>;
  const hint = `【务必以下面这个真实情景为本生成画像，身份/学段/学科/卡点必须与之一致，不得自由采样】\n情景：${scenario.domain}\n开场原话：${scenario.opening}\n追问细节：${(story.followUps || []).join('；')}`;
  const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
    candidatePersonas: [hint],
    preferredLevels: [String(card.knowledgeLevel || 'beginner')],
    existingPersonaSeed: { nameHint: card.cardKey, background: String(persona.background || scenario.domain), intentType: scenario.intentType },
  }) as { personaSeed?: Record<string, unknown> } | undefined;
  if (!result?.personaSeed) return profile;
  const merged = { ...result.personaSeed, scenarioCard: seed.scenarioCard };
  return { ...profile, personaSeed: merged };
}

/** 导出当前卡库（自建档案，cardKey 由 resolveCardKey 解析）为卡文档 */
export async function exportCards(): Promise<{ format: 'yaml'; content: string; count: number }> {
  const rows = await findCustomCardsForExport();
  const cards: LearnerCard[] = [];
  for (const r of rows) {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(r.profile || '{}'); } catch { continue; }
    const tags = parseTags(r.tags);
    const cardKey = resolveCardKey(p, tags);
    if (!cardKey) continue;
    const seed = (p.personaSeed || {}) as Record<string, unknown>;
    const scenario = (seed.scenarioCard || {}) as Record<string, unknown>;
    const pool = (p.storyPool as Array<Record<string, unknown>> | undefined) || [];
    const ref = (scenario.sourceRef as string) || undefined;
    // 历史批量导入的卡没有显式 sourceKind/isSyntheticSource：只能按 ref 形态推断，避免导出的卡
    // 因缺 kind 而无法回灌（校验器会拦「source.kind 必填」）。ref 为 http(s) → web，否则 synthetic。
    const kind = (scenario.sourceKind as 'web' | 'synthetic')
      || (p.isSyntheticSource ? 'synthetic' : ref ? (/^https?:/.test(ref) ? 'web' : 'synthetic') : undefined);
    cards.push({
      cardKey,
      version: (p.cardVersion as number) || 1,
      knowledgeLevel: r.knowledgeLevel || undefined,
      persona: { ...seed, scenarioCard: undefined } as Record<string, unknown>,
      story: {
        title: (pool[0]?.title as string) || (scenario.domain as string) || undefined,
        visibleOpening: String(scenario.opening || pool[0]?.visibleOpening || ''),
        followUps: (scenario.followUps as string[]) || (pool[0]?.behaviorHooks as string[]) || [],
        goalSeed: (pool[0]?.goalSeed as Record<string, unknown>) || { domain: scenario.domain, intentType: scenario.intentType, budget: scenario.budget, schoolAnchor: scenario.schoolAnchor },
      },
      source: { kind, ref },
      tags: tags.filter((t) => t !== cardKey && !/^w\d+$/i.test(t)),
      notes: r.notes || undefined,
    });
  }
  const content = yaml.dump({ version: 1, cards }, { lineWidth: 120, noRefs: true });
  return { format: 'yaml', content, count: cards.length };
}
