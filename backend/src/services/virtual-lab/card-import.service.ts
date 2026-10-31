/**
 * 学习者卡导入服务（卡库 v1，2026-10-01 用户拍板设计）。
 *
 * 设计口径：卡=数据，结构化导入即用，不经过任何 prompt 编译链。2026-10-29 用户拍板修正：
 * 卡库不是账号，只是档案——导入一张卡 = 一份档案 + 故事池（userId 为空），随卡资料落在
 * 卡归属键目录 `card-<profileId>`；只有派生（cloneCardsToLearners）才建虚拟账号。
 * 预置卡（presetKey 非空）与派生实例仍保留账号。
 * 校验规则源自 2026-10-01 实测教训：来源诚实性（假来源 authored 事故）、预算自洽
 * （18 张虚高）、followUps 数量、同源重复预警（563 张里 60 张重复）。
 * 语义级去重（同场景改写）不在校验器内做——由 LLM 判读流程负责；校验器只做确定性检查。
 */
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import yaml from 'js-yaml';
import { executeSkill } from '../../skills';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import {
  createVirtualLearnerUser,
  createVirtualLearnerProfile,
  updateProfileFields,
  findAllProfilesForCardIndex,
  findProfilesForCardWall,
  findCustomCardsForExport,
  findProfileUserIdById,
  findProfileJsonById,
} from './virtual-learner-profile.repo';
import { writeMaterial, listMaterials, readMaterial, type MaterialRecord } from '../materials/material-store';
import { cardOwnerKey } from './card-owner-key';
import { CARD_KEY_RE, cleanDisplayName } from './card-display-name';

export { cardOwnerKey } from './card-owner-key';
export { cleanDisplayName, deriveCardNickname, stripWaveTags } from './card-display-name';
import type { DocumentAnchor } from '../materials/document-parser.types';
import { logger } from '../../utils/logger';

export interface LearnerCardMaterial {
  /** book=某本书 / course=某门课 / syllabus=考纲大纲 / note=笔记资料 */
  kind?: 'book' | 'course' | 'syllabus' | 'note';
  title: string;
  /** 资料来源链接（可选，溯源用） */
  sourceRef?: string;
  /** 完整 markdown 正文（与 outline 二选一；书/课的目录、讲义、笔记原文） */
  content?: string;
  /** 章节清单（无正文时按此渲染 markdown 标题，供路径里程碑引用锚点） */
  outline?: string[];
}

export interface LearnerCard {
  cardKey: string;
  version?: number;
  enabled?: boolean;
  /**
   * 昵称（2026-10-05 卡库 demo 化）：卡面主名——人设化短语（如「想啃西瓜书的研究生」），
   * 与 cardKey（稳定 ID，可含批次代号）分离。
   * 展示链以 buildCardWallEntries 为准：nickname → persona.nameHint → users.name 清理版 →
   * cardKey → email（富化路径 enrichProfile 同样保留显式 nickname——2026-10-14 #14 修正，
   * 此前注释误写 story.title 进链、且富化会丢 nickname）。导入写 personaSeed.nickname，
   * 导出带回，YAML demo 面貌完整。
   */
  nickname?: string;
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
  /**
   * 自带资料（2026-10-02）：「学某课/学某书」的学习者随卡携带的教材/大纲/笔记。
   * 导入时写入卡归属键（`card-<profileId>`）的资料目录（origin='upload'）——派生实例时
   * 再搬到新账号目录；路径生成的「附件主线」、库优先跳采集、材料 brief 零改造复用现网管线。
   */
  materials?: LearnerCardMaterial[];
}

export interface CardReport {
  cardKey: string | null;
  status: 'ok' | 'error' | 'exists' | 'warn';
  errors: string[];
  warnings: string[];
  existingProfileId?: string;
}


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

  // 自带资料（可选增强）：有段就必须完整；「学某课/学某书」的锚点全靠它
  const materials = Array.isArray(card.materials) ? card.materials : [];
  materials.forEach((m, i) => {
    const label = `materials[${i}]`;
    if (!m || !String(m.title || '').trim()) { errors.push(`${label}.title 必填（资料名）`); return; }
    const hasBody = String(m.content || '').trim().length > 0 || (Array.isArray(m.outline) && m.outline.some((s) => String(s || '').trim()));
    if (!hasBody) errors.push(`${label}（${String(m.title).slice(0, 24)}）缺正文：content 与 outline 至少给一个`);
    if (m.kind && !['book', 'course', 'syllabus', 'note'].includes(m.kind)) {
      errors.push(`${label}.kind 非法（book | course | syllabus | note）`);
    }
  });

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
  const materials = (card.materials || []).map((m) => ({ kind: m.kind || 'note', title: m.title }));
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
    // 自带资料（2026-10-02）：goal 对话/教师据此知道「学习者在学这本书/这门课」
    ...(materials.length ? { materials } : {}),
  };
  return normalizeProfileShape({
    personaSeed: { ...(card.nickname ? { nickname: String(card.nickname).trim() } : {}), ...persona, scenarioCard },
    storyPool: [{
      id: 'story-1',
      title: story.title || domain,
      visibleOpening: story.visibleOpening,
      behaviorHooks: story.followUps || [],
      goalSeed: materials.length ? { ...goalSeed, materials } : goalSeed,
      budget,
    }],
    cardKey: card.cardKey,
    cardVersion: card.version || 1,
    isSyntheticSource: card.source?.kind === 'synthetic',
    importedAt: new Date().toISOString(),
  });
}

/* ---------- 自带资料（卡 → 资料目录，复用现网上传资料管线） ---------- */

/** 确定性资料 id：重导入覆盖同一条而非堆积（id 需匹配 UUID 形态的存储校验） */
function materialId(cardKey: string, title: string): string {
  const hash = createHash('md5').update(`${cardKey}::${title.trim()}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function renderMaterialMarkdown(card: LearnerCard, m: LearnerCardMaterial): string {
  const kind = m.kind || 'note';
  const head = [
    `# ${m.title}`,
    '',
    `- 类型：${kind}`,
    m.sourceRef ? `- 来源：${m.sourceRef}` : null,
    `- 随卡资料：${card.cardKey}`,
    '',
  ].filter((x): x is string => x !== null).join('\n');
  const body = String(m.content || '').trim();
  if (body) return `${head}${body}\n`;
  const outline = (m.outline || []).map((s) => String(s || '').trim()).filter(Boolean);
  return `${head}${outline.map((s) => `## ${s}`).join('\n')}\n`;
}

/** 从 markdown 标题抽章节锚点（供路径里程碑直接引用核对，同上传资料口径） */
function markdownAnchors(markdown: string): DocumentAnchor[] {
  const anchors: DocumentAnchor[] = [];
  for (const match of markdown.matchAll(/^##\s+(.+)$/gm)) {
    const heading = match[1].trim();
    if (!heading) continue;
    const rest = markdown.slice((match.index ?? 0) + match[0].length).trim();
    anchors.push({ heading, location: 'md', preview: rest.slice(0, 80) });
    if (anchors.length >= 500) break;
  }
  return anchors;
}

/** 导出回程兜底：确定性 id 未命中时按标题归一匹配（兼容手工改过名的资料） */
function findMaterialByTitle(ownerKey: string, title: string): { record: MaterialRecord; markdown: string } | null {
  const target = title.trim().toLowerCase();
  for (const record of listMaterials(ownerKey)) {
    if (record.origin === 'web') continue;
    if (record.name.replace(/\.md$/i, '').trim().toLowerCase() !== target) continue;
    return readMaterial(ownerKey, record.id);
  }
  return null;
}

/**
 * 把卡的资料写进归属目录（origin='upload'，路径生成的「附件主线」自动消费）。
 * ownerKey 可以是账号 userId（派生实例/老卡），也可以是卡归属键 `card-<profileId>`（纯档案模板卡）。
 * 幂等：同卡同名覆盖。
 */
function writeCardMaterials(cardKey: string, ownerKey: string, materials: LearnerCardMaterial[]): number {
  let written = 0;
  for (const m of materials) {
    const title = String(m.title || '').trim();
    if (!title) continue;
    try {
      const markdown = renderMaterialMarkdown({ cardKey } as LearnerCard, m);
      const headingCount = (markdown.match(/^#{1,3}\s+/gm) || []).length;
      const record: MaterialRecord = {
        id: materialId(cardKey, title),
        userId: ownerKey,
        name: `${title}.md`,
        ext: '.md',
        format: 'markdown',
        size: Buffer.byteLength(markdown, 'utf8'),
        charCount: markdown.length,
        structure: {
          pageCount: null,
          slideCount: 0,
          sheetCount: 0,
          headingCount,
          tableCount: 0,
          listCount: 0,
          paragraphCount: markdown.split(/\n{2,}/).filter((s) => s.trim()).length,
          chunkCount: 0,
        },
        anchors: markdownAnchors(markdown),
        warnings: [],
        createdAt: new Date().toISOString(),
        origin: 'upload',
        sourceUrl: m.sourceRef || null,
      };
      writeMaterial(record, markdown);
      written++;
    } catch (error) {
      logger.warn('[card-import] 随卡资料写入失败（不影响卡本身）', { cardKey, title, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return written;
}

/**
 * 给已有虚拟学习者挂资料（2026-10-02「筛一批配上资料」）：
 * 资料写库（同卡导入口径）+ profile 外科手术式锚定。**不整包覆盖 profile**——
 * 存量 VL 的 enriched 人设（persona-designer 富化产物）必须原样保留，
 * 只注入 scenarioCard.materials 与 storyPool[0].goalSeed.materials 两个锚点。
 * @returns 实际写入的资料份数
 */
export async function attachMaterialsToLearner(profileId: string, materials: LearnerCardMaterial[]): Promise<number> {
  if (!materials.length) return 0;
  for (const m of materials) {
    if (!m || !String(m.title || '').trim()) throw new Error('materials[].title 必填');
    const hasBody = String(m.content || '').trim().length > 0 || (Array.isArray(m.outline) && m.outline.some((s) => String(s || '').trim()));
    if (!hasBody) throw new Error(`资料「${String(m.title).slice(0, 24)}」缺正文：content 与 outline 至少给一个`);
  }
  const row = await findProfileJsonById(profileId);
  if (!row) throw new Error('虚拟学习者不存在');
  // 归属键：实例/老卡按账号 userId；纯档案模板卡按卡归属键（2026-10-29）
  const userId = await findProfileUserIdById(profileId);
  const ownerKey = userId ?? cardOwnerKey(profileId);

  // 1) 资料本体落库（路径主线消费的实体）
  const cardKey = `vl-${profileId.slice(0, 8)}`;
  const written = writeCardMaterials(cardKey, ownerKey, materials);

  // 2) profile 锚定：读-改-写，只动两个锚点位
  let profile: Record<string, unknown> = {};
  try { profile = JSON.parse(row.profile || '{}'); } catch { /* 空 profile 视为全新 */ }
  const anchorList = materials.map((m) => ({ kind: m.kind || 'note', title: String(m.title).trim() }));
  const seed = (profile.personaSeed || {}) as Record<string, unknown>;
  const scenario = { ...(seed.scenarioCard as Record<string, unknown> | undefined), materials: anchorList };
  profile.personaSeed = { ...seed, scenarioCard: scenario };
  const pool = Array.isArray(profile.storyPool) ? [...(profile.storyPool as Array<Record<string, unknown>>)] : [];
  if (pool[0]) {
    pool[0] = { ...pool[0], goalSeed: { ...((pool[0].goalSeed as Record<string, unknown>) || {}), materials: anchorList } };
    profile.storyPool = pool;
  }
  await updateProfileFields(profileId, { profile: JSON.stringify(profile) });
  return written;
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

/**
 * 自建卡也必须带 cardKey。
 *
 * 为什么：`exportCards` 以 cardKey 作回灌幂等键，没有 key 的卡会被 `continue` 静默跳过——
 * 于是「卡库自建 N 张」与「导出 N 张」对不上（2026-10-08 端到端验证实测：自建 1 张、导出 0 张），
 * 迁移/回灌会丢卡。此前只有导入的卡带 key，「平台生产」与批量创建的自建卡都没有。
 *
 * 已有 key（显式 cardKey / scenarioCard.personaId / nameHint / tags）的画像原样返回，不覆盖。
 * 新增 key 取 `vl-<profileId 前 8 位>`：与随卡资料 materialId 的既有约定一致
 * （attachMaterialsToLearner 同样用 vl-<id8>），且同一学习者恒得同一个 key。
 */
export function ensureCardKey<T extends Record<string, unknown>>(
  profile: T,
  profileId: string,
  tags: string[] = []
): T {
  if (resolveCardKey(profile, tags)) return profile;
  return { ...profile, cardKey: `vl-${profileId.slice(0, 8)}` } as T;
}

/** 收集库内已存在卡的查重索引 */
async function buildExistingIndex(): Promise<{ byKey: Map<string, string>; refs: Map<string, string[]> }> {  const rows = await findAllProfilesForCardIndex();
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

export interface CardWallEntry {
  profileId: string;
  /** 账号 id（2026-10-29）：模板卡是纯档案，没有账号 → null */
  userId: string | null;
  cardKey: string | null;
  /** 卡面昵称（2026-10-05）：nickname → nameHint → users.name 清理版 → key → email */
  name: string;
  goal: string;
  opening: string | null;
  knowledgeLevel: string;
  /** 展示标签（已剔 cardKey 自身与 w\d+ 波次标签；波次代号不入 demo 卡面） */
  tags: string[];
  preset: boolean;
  sourceKind: string | null;
  email: string | null;
  /** 派生来源模板名（2026-10-16 卡=身份模板）：非空即「已派生实例」，空为身份池里的模板卡 */
  derivedFrom: string | null;
  /** 故事池任务数（2026-10-27 卡面密度）：创建实例时要勾任务，卡面先给出「这张卡能开几节课」 */
  taskCount: number;
  /** 首个任务标题（2026-10-27）：卡面上真正会被开的那节课叫什么，比抽象的学习目标更能判断要不要用 */
  firstTaskTitle: string | null;
}

/**
 * 卡墙索引映射（2026-10-05 卡库改版「导入是功能，卡展示也是」）：profiles 即卡，
 * 解析 personaSeed.scenarioCard 取展示字段。2026-10-29 起模板卡无账号（users/userId 可空），
 * 展示名走档案内 nickname → nameHint → cardKey 链，不依赖 users 行。
 * 纯函数（可单测）；坏 JSON 行降级为占位卡，不阻断整面卡墙。
 */
export function buildCardWallEntries(
  rows: Array<{
    id: string;
    userId: string | null;
    profile: string;
    tags: string | null;
    learningGoal: string;
    knowledgeLevel: string;
    presetKey: string | null;
    users: { name: string | null; email: string | null } | null;
  }>
): CardWallEntry[] {
  return rows.map((r) => {
    const tagList = parseTags(r.tags);
    let cardKey: string | null = null;
    let nickname: string | null = null;
    let nameHint: string | null = null;
    let opening: string | null = null;
    let sourceKind: string | null = null;
    let derivedFrom: string | null = null;
    let taskCount = 0;
    let firstTaskTitle: string | null = null;
    try {
      const p = JSON.parse(r.profile || '{}') as Record<string, unknown>;
      const seed = (p.personaSeed || {}) as Record<string, unknown>;
      const sc = (seed.scenarioCard || {}) as Record<string, unknown>;
      // 复用查重同款回退链（profile.cardKey → scenarioCard.personaId → 合法形态 tags，跳过 w5/w6 波次标签）
      cardKey = resolveCardKey(p, tagList);
      nickname = (seed.nickname as string) || null;
      nameHint = (seed.nameHint as string) || null;
      opening = (sc.opening as string) || null;
      sourceKind = (sc.sourceKind as string) || null;
      derivedFrom = ((p.derivedFrom as Record<string, unknown> | undefined)?.name as string) || null;
      const pool = Array.isArray(p.storyPool) ? (p.storyPool as Array<Record<string, unknown>>) : [];
      taskCount = pool.length;
      const first = pool[0];
      firstTaskTitle =
        first && typeof first.title === 'string' && first.title.trim() ? first.title.trim() : null;
    } catch {
      /* 坏 JSON：占位展示（名称回退 email/cardKey），不阻断整面卡墙 */
    }
    const email = r.users?.email ?? null;
    const key = cardKey || tagList.find((t) => CARD_KEY_RE.test(t) && !/^w\d+$/i.test(t)) || null;
    return {
      profileId: r.id,
      userId: r.userId,
      cardKey: key,
      name: nickname || nameHint || cleanDisplayName(r.users?.name) || key || email || '未命名卡',
      goal: r.learningGoal,
      opening,
      knowledgeLevel: r.knowledgeLevel,
      tags: tagList.filter((t) => t !== key && !/^w\d+$/i.test(t)),
      preset: r.presetKey != null,
      sourceKind,
      email,
      derivedFrom,
      taskCount,
      firstTaskTitle,
    };
  });
}

/** 卡墙索引聚合（GET /cards/index 数据源）：身份卡列表 + 预置/自建分计。
 *  2026-10-24 层级收口：卡库＝身份池，只列未派生的身份卡（克隆实例归虚拟学习者列表）；derived 仍披露实例数。 */
export async function getCardWallIndex() {
  const rows = await findProfilesForCardWall();
  const all = buildCardWallEntries(rows);
  const cards = all.filter((c) => !c.derivedFrom);
  return {
    cards,
    summary: {
      total: cards.length,
      builtin: cards.filter((c) => c.preset).length,
      custom: cards.filter((c) => !c.preset).length,
      derived: all.length - cards.length, // 已派生实例数：不在这面墙上，点 KPI 去虚拟学习者列表看
    },
  };
}
/* ============ 卡 → 虚拟学习者（2026-10-16 用户拍板：卡=身份模板，派生=建运行实例） ============
   卡库是「身份池」：一张卡 = 一份身份模板（人设 + 若干任务），虚拟学习者 = 用某张模板派生的实例。
   派生取「身份克隆」而非「引用」语义——同一张卡可反复派生多个独立实例，源卡留在池里。
   实现与卡导入（importCards）同构，只是来源从卡文档换成库内已有档案，故同样落
   users(isVirtualLearner) + virtual_learner_profiles + 随卡资料。 */

/** 运行期累积状态：克隆身份时必须剥掉，否则派生实例带着模板的学习痕迹起跑
    （recentCompleted 由跑批证据写回档案，见 virtual-lab/learner-memory.ts:653）。 */
const RUNTIME_PROFILE_KEYS = ['recentCompleted'] as const;

/** 派生单次上限（与批量新建 batch-create 的 20 人同档，超限由路由拒绝而非静默截断） */
export const CLONE_MAX_ITEMS = 20;

type CardWallRow = Awaited<ReturnType<typeof findProfilesForCardWall>>[number];

/** 档案里的故事池原样读（不走卡详情的展示映射——展示映射会丢掉 goalSeed / problemKnowledge 等，
 *  照它克隆出来的实例任务会残，路径生成质量跟着掉） */
function parseStoryPool(profileJson: string | null | undefined): Array<Record<string, unknown>> {
  try {
    const d = JSON.parse(profileJson || '{}') as Record<string, unknown>;
    return Array.isArray(d.storyPool) ? (d.storyPool as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/** 任务（故事）稳定 id：卡导入写 story-1、场景设计器写 story_<uuid>；缺 id 的按序位兜底 */
export function storyIdOf(story: Record<string, unknown>, index: number): string {
  const id = typeof story.id === 'string' ? story.id.trim() : '';
  return id || `story-${index + 1}`;
}

export interface CardTaskGroup {
  profileId: string;
  name: string;
  tasks: Array<{ id: string; title: string; opening: string | null }>;
}

/** 卡的任务清单（创建面板勾选任务的数据源）。纯函数，可单测。 */
export function buildCardTaskGroups(rows: CardWallRow[], profileIds: string[]): CardTaskGroup[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups: CardTaskGroup[] = [];
  for (const pid of profileIds) {
    const row = byId.get(pid);
    if (!row) continue;
    const [entry] = buildCardWallEntries([row]);
    groups.push({
      profileId: pid,
      name: entry.name,
      tasks: parseStoryPool(row.profile).map((s, i) => ({
        id: storyIdOf(s, i),
        title: (typeof s.title === 'string' && s.title.trim()) || `任务 ${i + 1}`,
        opening: typeof s.visibleOpening === 'string' && s.visibleOpening.trim() ? s.visibleOpening : null,
      })),
    });
  }
  return groups;
}

export async function getCardTaskGroups(profileIds: string[]): Promise<CardTaskGroup[]> {
  return buildCardTaskGroups(await findProfilesForCardWall(), profileIds);
}

export interface CloneCardItem {
  profileId: string;
  /** 勾选的任务 id；省略或空数组 = 全部任务随身份带走 */
  storyIds?: string[];
}

export interface CloneCardOutcome {
  created: Array<{ profileId: string; userId: string; name: string; cardKey: string; taskCount: number }>;
  failed: Array<{ profileId: string; reason: string }>;
}

/** 随卡资料随身份搬一份：资料库按归属键分目录，不搬则派生实例的 personaSeed 挂着指向源卡的资料。
 *  源归属键 = 老卡/预置卡的账号 userId，或纯档案模板卡的 `card-<profileId>`（2026-10-29）；
 *  归属判据与卡导出回程同源（标题清单 → 按标题回查源资料目录）。 */
function copyOwnedMaterials(
  sourceProfile: Record<string, unknown>,
  srcOwnerKey: string,
  dstUserId: string,
  newCardKey: string
): number {
  const seed = (sourceProfile.personaSeed || {}) as Record<string, unknown>;
  const sc = (seed.scenarioCard || {}) as Record<string, unknown>;
  const owned = (sc.materials as Array<{ title?: string }> | undefined) || [];
  let copied = 0;
  for (const m of owned) {
    const title = String(m.title || '').trim();
    if (!title) continue;
    try {
      const found = findMaterialByTitle(srcOwnerKey, title);
      if (!found) continue;
      writeMaterial({ ...found.record, id: materialId(newCardKey, title), userId: dstUserId }, found.markdown);
      copied++;
    } catch {
      /* 单份资料搬家失败不阻断派生：卡身份本身已落库 */
    }
  }
  return copied;
}

/**
 * 从库内卡派生虚拟学习者（批量）。返回逐项结果——部分失败不整体回滚，
 * 调用方按 created/failed 分别汇报（与批量新建「投产半成不报成整单失败」同判例）。
 */
export async function cloneCardsToLearners(items: CloneCardItem[], note?: string): Promise<CloneCardOutcome> {
  const rows = await findProfilesForCardWall();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const created: CloneCardOutcome['created'] = [];
  const failed: CloneCardOutcome['failed'] = [];

  for (const item of items) {
    const sourceId = String(item.profileId || '');
    const row = byId.get(sourceId);
    if (!row) {
      failed.push({ profileId: sourceId, reason: '卡不存在' });
      continue;
    }
    try {
      const [entry] = buildCardWallEntries([row]);
      const source = (() => {
        try {
          return JSON.parse(row.profile || '{}') as Record<string, unknown>;
        } catch {
          return {} as Record<string, unknown>;
        }
      })();
      const pool = parseStoryPool(row.profile);
      const wanted = Array.isArray(item.storyIds) && item.storyIds.length ? new Set(item.storyIds.map(String)) : null;
      const picked = wanted ? pool.filter((s, i) => wanted.has(storyIdOf(s, i))) : pool;
      if (!picked.length) {
        failed.push({ profileId: sourceId, reason: '未勾选任何任务' });
        continue;
      }

      const userId = randomUUID();
      const profileId = randomUUID();
      // 身份克隆：源档案剥掉运行期累积状态与卡号后整体带走。用减法而非人设字段白名单——
      // 人设 schema 有 30+ 字段且随版本增删，白名单会静默漏字段。
      const template: Record<string, unknown> = { ...source };
      for (const k of RUNTIME_PROFILE_KEYS) delete template[k];
      delete template.cardKey;
      // 卡号必须重算：沿用源卡号 → 「导出卡库」以 cardKey 去重会把它当成同一张卡、
      // 卡导入校验也会判「已存在」。取法与 ensureCardKey 的新增分支同源（vl-<id8>）。
      const cardKey = `vl-${profileId.slice(0, 8)}`;
      template.cardKey = cardKey;
      template.storyPool = picked.map((s) => ({ ...s }));
      template.derivedFrom = {
        profileId: row.id,
        cardKey: entry.cardKey,
        name: entry.name,
        at: new Date().toISOString(),
      };
      template.importedAt = new Date().toISOString();

      const email = `virtual_${userId.slice(0, 8)}@test.local`;
      const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
      const user = await createVirtualLearnerUser({
        data: {
          id: userId,
          email,
          name: entry.name,
          password,
          role: 'user',
          currentLevel: row.knowledgeLevel || 'beginner',
          isAdmin: false,
          isVirtualLearner: true,
          updatedAt: new Date(),
        },
      });

      // 标签：新卡号置顶（与卡导入同形），源卡号剔除——不剔会被 buildCardWallEntries 当作
      // 「本卡 key」而把源卡号留在卡面标签里，指向另一张卡
      const srcTags = parseTags(row.tags);
      const carriedTags = srcTags.filter((t) => t !== entry.cardKey && t !== source.cardKey);

      await createVirtualLearnerProfile({
        data: {
          id: profileId,
          userId: user.id,
          profile: JSON.stringify(template),
          learningGoal: row.learningGoal,
          knowledgeLevel: row.knowledgeLevel || 'beginner',
          knownConcepts: row.knownConcepts,
          struggleConcepts: row.struggleConcepts,
          simulationTemperature: 0.8,
          tags: JSON.stringify([cardKey, ...carriedTags]),
          notes: note || row.notes || null,
        },
      });

      // 模板卡（纯档案）的随卡资料在卡归属键目录；老卡/预置卡仍按源账号 userId（2026-10-29）
      copyOwnedMaterials(source, row.userId ?? cardOwnerKey(row.id), user.id, cardKey);
      created.push({ profileId, userId: user.id, name: entry.name, cardKey, taskCount: picked.length });
    } catch (e) {
      logger.warn('[card-clone] 卡派生失败', { profileId: sourceId, error: (e as Error).message });
      failed.push({ profileId: sourceId, reason: (e as Error).message || '派生失败' });
    }
  }

  return { created, failed };
}

export interface CardDetail {
  profileId: string;
  /** 账号 id：模板卡（纯档案）为 null（2026-10-29） */
  userId: string | null;
  cardKey: string | null;
  name: string;
  goal: string;
  knowledgeLevel: string;
  tags: string[];
  preset: boolean;
  sourceKind: string | null;
  sourceRef: string | null;
  email: string | null;
  notes: string | null;
  createdAt: Date;
  /** 人设键值面（profile 根字段优先、personaSeed 兜底；去 scenarioCard/nickname/元数据键） */
  personaFacts: Array<{ label: string; value: string }>;
  nickname: string | null;
  nameHint: string | null;
  background: string | null;
  stories: Array<{
    title: string | null;
    opening: string | null;
    followUps: string[];
    domain: string | null;
    intentType: string | null;
    schoolAnchor: string | null;
    budget: Record<string, unknown>;
  }>;
  materials: Array<{ kind: string; title: string }>;
  /** 派生来源模板（2026-10-16）：非空即本卡是某个模板派生出的实例，可点回模板 */
  derivedFrom: { profileId: string; cardKey: string | null; name: string } | null;
}

const PERSONA_FACT_LABELS: Record<string, string> = {
  background: '背景',
  availableTime: '可用时间',
  cognitiveLoadTolerance: '认知负荷容忍',
  learningStylePreference: '学习风格偏好',
  learningStyle: '学习风格',
  motivation: '动机',
  motivationType: '动机类型',
  motivationOrientation: '动机取向',
  familyEnvironment: '家庭环境',
  techComfort: '技术熟练度',
  digitalLiteracy: '数字素养',
  profession: '职业',
  occupation: '职业',
  education: '教育背景',
  age: '年龄',
  gender: '性别',
  location: '所在地',
  corePersona: '核心人设',
  corePersonality: '核心性格',
  emotionalBaseline: '情绪基线',
  helpSeekingPattern: '求助模式',
  adversarialPattern: '抗辩模式',
  selfAwarenessPattern: '自我认知模式',
  planningFollowThrough: '计划执行力',
  overloadReaction: '过载反应',
  memoryRepairPattern: '记忆修复模式',
  behavioralProfileSummary: '行为档案',
  metacognitiveProfile: '元认知档案',
  selfRegulationStyle: '自我调节风格',
  priorAttempts: '既往尝试',
  communicationStyle: '沟通风格',
  resiliencePattern: '复原力模式',
};

/**
 * 人设键值面不入的键：展示位单列（scenarioCard/nickname/nameHint）、故事池，以及卡库元数据。
 * 元数据含 scenarioCard 的根级扁平镜像（domain/intentType/schoolAnchor/sourceRef/scenarioOrigin
 * ——批量导入族把故事卡字段平铺在根级）与导入时间戳：这些在「概览」「故事池」已有专属展示位，
 * 混进人设面只会重复且淹没真正的人设字段。learningGoal 同样剔除：卡详情的「学习目标」行
 * （goal=profile 列）已是更完整版本（列带期限后缀，如「…（自定义期限）」），seed 内嵌版本更短。
 */
const PERSONA_FACT_SKIP_KEYS = new Set([
  'scenarioCard', 'nickname', 'nameHint', 'storyPool',
  'cardKey', 'cardVersion', 'importedAt', 'isSyntheticSource', 'personaSeed',
  'domain', 'intentType', 'schoolAnchor', 'sourceRef', 'scenarioOrigin', 'learningGoal',
]);

/**
 * 人设键值面取数（2026-10-07 F4-1）：根字段优先、personaSeed 兜底——画像页
 * （VirtualProfile.vue 读 profile 根级 background/corePersonality/…）与本页必须给同一事实。
 * 存量卡两族形状：批量导入卡整套人设写在 profile 根（personaSeed 仅 {nickname}）；
 * 卡库导入卡（cardToProfile 经 normalizeProfileShape）落在 personaSeed。两族都读才不丢人设。
 * 兜底只补根级缺失的键，根级已有值优先。
 */
function buildPersonaFacts(
  profile: Record<string, unknown>,
  seed: Record<string, unknown>,
): CardDetail['personaFacts'] {
  const merged: Array<[string, unknown]> = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(profile)) {
    if (PERSONA_FACT_SKIP_KEYS.has(k)) continue;
    seen.add(k);
    merged.push([k, v]);
  }
  for (const [k, v] of Object.entries(seed)) {
    if (seen.has(k) || PERSONA_FACT_SKIP_KEYS.has(k)) continue;
    merged.push([k, v]);
  }
  const facts: CardDetail['personaFacts'] = [];
  for (const [k, v] of merged) {
    if (v == null || typeof v === 'object') continue;
    const value = String(v).trim();
    if (!value) continue;
    facts.push({ label: PERSONA_FACT_LABELS[k] || k, value: value.length > 200 ? `${value.slice(0, 200)}…` : value });
  }
  return facts;
}

/** 卡详情聚合（GET /cards/:profileId/detail 数据源）：卡墙点卡后的全字段可视 */
export async function getCardDetail(profileId: string): Promise<CardDetail | null> {
  const rows = await findProfilesForCardWall();
  const row = rows.find((x) => x.id === profileId);
  if (!row) return null;
  const [entry] = buildCardWallEntries([row]);
  const root = (() => {
    try {
      return JSON.parse(row.profile || '{}') as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const seed = (root.personaSeed || {}) as Record<string, unknown>;
  const sc = (seed.scenarioCard || {}) as Record<string, unknown>;
  const pool = (root.storyPool as Array<Record<string, unknown>> | undefined) || [];
  // 人设键值面：根字段优先、personaSeed 兜底（见 buildPersonaFacts）
  const personaFacts = buildPersonaFacts(root, seed);
  // 背景同样两处读：卡库导入卡落 seed.background，批量导入卡落根级（画像页读的就是根级）
  const background =
    (typeof root.background === 'string' && root.background.trim() ? root.background.trim() : null)
    || (typeof seed.background === 'string' && seed.background.trim() ? seed.background.trim() : null);
  const materials = ((sc.materials as Array<{ kind?: string; title?: string }> | undefined) || [])
    .map((m) => ({ kind: String(m.kind || 'note'), title: String(m.title || '') }))
    .filter((m) => m.title);
  return {
    profileId: row.id,
    userId: row.userId,
    cardKey: entry.cardKey,
    name: entry.name,
    goal: row.learningGoal,
    knowledgeLevel: row.knowledgeLevel,
    tags: entry.tags,
    preset: entry.preset,
    sourceKind: entry.sourceKind,
    sourceRef: (sc.sourceRef as string) || null,
    email: entry.email,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    personaFacts,
    nickname: (seed.nickname as string) || null,
    nameHint: (seed.nameHint as string) || null,
    background,
    stories: pool.map((s) => {
      const gs = (s.goalSeed as Record<string, unknown> | undefined) || {};
      return {
        title: (s.title as string) || null,
        opening: (s.visibleOpening as string) || null,
        followUps: (s.behaviorHooks as string[]) || [],
        domain: (gs.domain as string) || (sc.domain as string) || null,
        intentType: (gs.intentType as string) || (sc.intentType as string) || null,
        schoolAnchor: (gs.schoolAnchor as string) || (sc.schoolAnchor as string) || null,
        budget: (gs.budget as Record<string, unknown>) || (sc.budget as Record<string, unknown>) || {},
      };
    }),
    materials,
    derivedFrom: (() => {
      const df = root.derivedFrom as Record<string, unknown> | undefined;
      if (!df || typeof df.profileId !== 'string') return null;
      return {
        profileId: df.profileId,
        cardKey: (df.cardKey as string) || null,
        name: (df.name as string) || (df.cardKey as string) || '来源卡',
      };
    })(),
  };
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
        // 自带资料同步重写（幂等：同卡同名覆盖）；更新路径按 profile 反查归属键
        // （老卡/预置卡有账号走 userId；纯档案模板卡无账号走 card-<profileId>）
        const updUserId = await findProfileUserIdById(report.existingProfileId);
        if ((card.materials || []).length) {
          writeCardMaterials(
            card.cardKey,
            updUserId ?? cardOwnerKey(report.existingProfileId),
            card.materials || [],
          );
        }
        results.push({ cardKey: card.cardKey, action: 'updated' });
        continue;
      }
      // 2026-10-29 卡库不是账号：导入只建档案（userId=null），不建 users 行
      const profileId = randomUUID();
      await createVirtualLearnerProfile({
        data: {
          id: profileId, userId: null, profile: JSON.stringify(profile),
          learningGoal: String((card.story?.goalSeed?.domain as string) || (card.persona?.background as string) || card.cardKey),
          knowledgeLevel: card.knowledgeLevel || 'beginner',
          knownConcepts: card.persona?.knownConcepts ? JSON.stringify(card.persona.knownConcepts) : null,
          struggleConcepts: card.persona?.struggleConcepts ? JSON.stringify(card.persona.struggleConcepts) : null,
          simulationTemperature: 0.8,
          tags: JSON.stringify([card.cardKey, ...(card.tags || [])]),
          notes: card.notes || card.source?.note || null,
        },
      });
      // 自带资料 → 卡归属键目录（路径生成「附件主线」/材料 brief 零改造复用；派生时再搬进实例）
      if ((card.materials || []).length) {
        writeCardMaterials(card.cardKey, cardOwnerKey(profileId), card.materials || []);
      }
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

/**
 * 富化合并（#14，纯函数可单测）：用 persona-designer 产物替换 personaSeed 补全人设，
 * 但保留卡作者显式写的 nickname——它承载卡面展示名（buildCardWallEntries 的第一优先），
 * 不应被富化产物（通常只带 nameHint/background）冲掉，否则卡面回退成背景派生短语。
 */
export function mergeEnrichedPersonaSeed(
  enriched: Record<string, unknown>,
  baseSeed: Record<string, unknown>,
): Record<string, unknown> {
  const nickname = typeof baseSeed.nickname === 'string' && baseSeed.nickname.trim() ? baseSeed.nickname : undefined;
  return {
    ...enriched,
    ...(nickname ? { nickname } : {}),
    scenarioCard: baseSeed.scenarioCard,
  };
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
  return { ...profile, personaSeed: mergeEnrichedPersonaSeed(result.personaSeed, seed) };
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
    // 自带资料回程（2026-10-02）：从该用户资料库读回随卡资料（以 scenarioCard.materials 的
    // 标题清单为归属依据）；正文 ≤20k 内嵌保证可回灌，超限只回章节清单
    const ownedMaterials = (scenario.materials as Array<{ kind?: string; title?: string }> | undefined) || [];
    const materials: LearnerCardMaterial[] = [];
    // 归属键：纯档案模板卡（userId=null）从 card-<profileId> 读；老卡仍按账号 userId（2026-10-29）
    const ownerKey = r.userId ?? cardOwnerKey(r.id);
    if (ownedMaterials.length) {
      try {
        for (const owned of ownedMaterials) {
          const title = String(owned.title || '').trim();
          if (!title) continue;
          const found = readMaterial(ownerKey, materialId(cardKey, title)) ?? findMaterialByTitle(ownerKey, title);
          if (!found) continue;
          const outline = (found.record.anchors || []).map((a) => a.heading).filter(Boolean);
          materials.push({
            kind: (owned.kind as LearnerCardMaterial['kind']) || 'note',
            title,
            sourceRef: found.record.sourceUrl || undefined,
            ...(found.markdown.length <= 20_000 ? { content: found.markdown } : (outline.length ? { outline } : {})),
          });
        }
      } catch { /* 资料库读取失败不影响卡导出 */ }
    }
    cards.push({
      cardKey,
      version: (p.cardVersion as number) || 1,
      knowledgeLevel: r.knowledgeLevel || undefined,
      // 昵称回程（2026-10-05 卡库 demo 化）：personaSeed.nickname → 卡面主名
      ...(seed.nickname ? { nickname: String(seed.nickname) } : {}),
      persona: { ...seed, scenarioCard: undefined } as Record<string, unknown>,
      story: {
        title: (pool[0]?.title as string) || (scenario.domain as string) || undefined,
        visibleOpening: String(scenario.opening || pool[0]?.visibleOpening || ''),
        followUps: (scenario.followUps as string[]) || (pool[0]?.behaviorHooks as string[]) || [],
        goalSeed: (pool[0]?.goalSeed as Record<string, unknown>) || { domain: scenario.domain, intentType: scenario.intentType, budget: scenario.budget, schoolAnchor: scenario.schoolAnchor },
      },
      source: { kind, ref },
      ...(materials.length ? { materials } : {}),
      tags: tags.filter((t) => t !== cardKey && !/^w\d+$/i.test(t)),
      notes: r.notes || undefined,
    });
  }
  const content = yaml.dump({ version: 1, cards }, { lineWidth: 120, noRefs: true });
  return { format: 'yaml', content, count: cards.length };
}
