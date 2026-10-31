/**
 * 资料库选择：把「按上传时间取最新 N 份」改成「按目标相关性排序，时间做回退」。
 *
 * 为什么单独一层：
 *   goal 资料摘要、path 资料包、跨库召回此前各自 slice 不同数量，且都只看 createdAt。
 *   用户传 10 份资料时，真正相关的旧资料会被新上传的无关资料挤掉，且界面不说明。
 *
 * 这一层只做**确定性排序**，不调模型：
 *   ① 相关性以 **≥4 字连续片段** 判定（词面闸门，同 material-ref-coverage 的
 *      materialsHaveLexicalOverlap 口径；作用对象是 MaterialRecord，为避免循环依赖
 *      在本文件内实现同口径函数）：目标文本里至少一个 ≥4 字连续片段原样出现在
 *      资料可检索文本里才算相关——通用词组合可共享几十个 bigram，连续片段是更强信号；
 *   ② 有片段命中 → relevance：片段命中的排前，组内按标题 / brief / 章节标题的
 *      字符 bigram 重合度排序；
 *   ③ 没有任何片段命中 → 按 createdAt 新→旧（recent 回退）；
 *   ④ 同分仍按 createdAt 新→旧，保证结果稳定。
 *
 * selectMaterialsRanked 是可选的模型排序增强（2026-10-21 评测后接入）：在词面短名单上
 * 用决策模型（网关 jev-1.14.0，SystemOne 槽位协议）按目标相关性重排，AUC 0.908 显著
 * 高于词面排序；fail-open——没配置/超时/报错一律退回词面顺序，绝不阻塞 goal/path。
 */
import { listMaterials, type MaterialRecord } from './material-store';
import type { DecisionCallOptions, DecisionRequest, DecisionResponse } from '../decision';

export type MaterialSelectionStrategy = 'relevance' | 'recent' | 'decision';

export interface MaterialSelectionOptions {
  userId: string;
  /** 目标 / 查询词；为空时退化为最近上传优先。 */
  query?: string | null;
  /** 本次最多选几份。 */
  limit: number;
  /** 是否允许联网入库资料参与；默认 false（上传附件主线）。 */
  includeWeb?: boolean;
  /** 调用方已持有记录时直接传入，省一次 listMaterials。 */
  records?: MaterialRecord[];
}

export interface MaterialSelection {
  selected: MaterialRecord[];
  omitted: MaterialRecord[];
  total: number;
  strategy: MaterialSelectionStrategy;
  /** 4 字片段闸门：资料池里是否至少一份资料原样命中目标文本的 ≥4 字连续片段。 */
  hasPhraseHit: boolean;
}

/** 查询词与资料的可检索文本：文件名 + brief 主题/概览/目录 + 章节标题。 */
export function materialSelectionText(record: MaterialRecord): string {
  const parts: string[] = [record.name || ''];
  const brief = record.brief;
  if (brief) {
    parts.push(brief.subject || '', brief.overview || '', brief.docType || '');
    for (const item of brief.toc || []) parts.push(item?.title || '', item?.gist || '');
    for (const item of brief.naturalDivisions || []) parts.push(item || '');
  }
  for (const anchor of record.anchors || []) {
    const heading = String(anchor?.heading || '').trim();
    if (heading && heading !== '（无标题）') parts.push(heading);
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * 轻量分词：英文/数字按词，中文按字符 bigram（单字保留）。
 * 不引分词库——资料选择只需要稳定的相对排序，不需要语言学最优。
 */
export function materialSelectionTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  for (const chunk of normalized.split(/\s+/)) {
    if (!chunk) continue;
    if (/^[a-z0-9]+$/.test(chunk)) {
      if (chunk.length > 1) tokens.add(chunk);
      continue;
    }
    const chars = [...chunk];
    if (chars.length === 1) tokens.add(chars[0]);
    for (let i = 0; i < chars.length - 1; i += 1) tokens.add(`${chars[i]}${chars[i + 1]}`);
  }
  return tokens;
}

function relevanceScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0;
  const textTokens = materialSelectionTokens(text);
  let hit = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) hit += 1;
  }
  return hit / queryTokens.size;
}

/** 词面闸门的最小连续片段长度（与 material-ref-coverage.materialsHaveLexicalOverlap 缺省一致）。 */
const PHRASE_HIT_MIN_CHARS = 4;

/**
 * 4 字片段闸门（单资料口径）：目标文本里至少一个 ≥4 字连续片段原样出现在该资料的
 * 可检索文本（materialSelectionText）里才算相关。
 *
 * 算法与 material-ref-coverage.materialsHaveLexicalOverlap 同口径（英文整词 ≥4 字、
 * 中文按 run 内滑动窗口），但作用对象是 MaterialRecord——不 import 那边（其入参是
 * PromptMaterial），避免 materials ↔ learning 域互相引用成环。
 */
export function materialRecordHasPhraseHit(query: string, record: MaterialRecord): boolean {
  const source = materialSelectionText(record).toLowerCase().replace(/\s+/g, '');
  if (!source.trim() || !String(query || '').trim()) return false;
  const runs = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  for (const run of runs) {
    const chars = [...run];
    if (/^[a-z0-9]+$/.test(run)) {
      if (chars.length >= PHRASE_HIT_MIN_CHARS && source.includes(run)) return true;
      continue;
    }
    const maxLen = Math.min(chars.length, Math.max(PHRASE_HIT_MIN_CHARS, 8));
    for (let len = PHRASE_HIT_MIN_CHARS; len <= maxLen; len += 1) {
      for (let i = 0; i + len <= chars.length; i += 1) {
        if (source.includes(chars.slice(i, i + len).join(''))) return true;
      }
    }
  }
  return false;
}

/**
 * 选资料。返回的 selected 已按「片段命中 → bigram 相关性 → 新→旧」排好；omitted 保留其余资料，
 * 供调用方记账/提示「资料库还有 N 份未进入本次路径」。
 * strategy 沿用 bigram 口径：片段命中（hasPhraseHit）只是排序加权，不改变 relevance/recent 判定，
 * 也不作为过滤依据——2026-10-21 离线对比实证（doc/local/RESOURCE-LIBRARY-OPT-2026-10-20/
 * INJECTION-GATE-COMPARISON.md），拿片段闸门过滤注入会误杀「学科相关但措辞无 4 字重叠」的
 * 真引用资料（9/15），故只做排序信号。
 */
export function selectMaterials(options: MaterialSelectionOptions): MaterialSelection {
  const limit = Math.max(0, Math.floor(Number(options.limit) || 0));
  let records: MaterialRecord[] = [];
  try {
    records = options.records ?? listMaterials(options.userId);
  } catch {
    return { selected: [], omitted: [], total: 0, strategy: 'recent', hasPhraseHit: false };
  }

  const pool = (options.includeWeb ? records : records.filter((record) => record.origin !== 'web')).slice();
  const queryText = String(options.query || '').trim();
  const queryTokens = materialSelectionTokens(queryText);
  const scored = pool.map((record) => ({
    record,
    score: relevanceScore(queryTokens, materialSelectionText(record)),
    phraseHit: materialRecordHasPhraseHit(queryText, record),
  }));
  const hasPhraseHit = scored.some((item) => item.phraseHit);
  const hasRelevance = scored.some((item) => item.score > 0);
  scored.sort((a, b) => {
    if (hasPhraseHit) {
      if (a.phraseHit !== b.phraseHit) return a.phraseHit ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
    }
    const byTime = String(b.record.createdAt).localeCompare(String(a.record.createdAt));
    if (byTime !== 0) return byTime;
    return String(a.record.id).localeCompare(String(b.record.id));
  });

  const selected = scored.slice(0, limit).map((item) => item.record);
  const omitted = scored.slice(limit).map((item) => item.record);
  return {
    selected,
    omitted,
    total: pool.length,
    strategy: hasRelevance ? 'relevance' : 'recent',
    hasPhraseHit,
  };
}

/* ================= 决策模型排序增强（selectMaterialsRanked） =================
 * 2026-10-21 离线评测（doc/local/RESOURCE-LIBRARY-OPT-2026-10-20/
 * EMBEDDING-DECISION-EVAL.md）：网关 jev-1.14.0 以 noul 问法对「(目标, 资料)」
 * 排序 AUC 0.908（词面/向量排序远不及）。这里作为词面排序之上的可选增强，
 * 不替代 selectMaterials 的确定性语义（strategy 仍记录词面口径）。 */

/** 判定口径写在 instructions（J 报告：决策模型 question 字段是惰性的）。 */
const RANK_INSTRUCTIONS =
  '资料与目标在学科、考试或领域上直接对应才给高分；只服务于目标的一部分可给中高分；仅有泛化词（如健康、管理、学习）重叠给低分。';

/** 短名单上限：只重排词面序的前 N 个，控制决策调用次数（pool 通常个位数）。 */
const RANK_SHORTLIST_MAX = 12;

export type DecisionRankFn = (
  request: DecisionRequest,
  options?: Pick<DecisionCallOptions, 'timeoutMs' | 'providerOrder'>
) => Promise<Pick<DecisionResponse, 'answers' | 'model'>>;

export interface MaterialSelectionRankedOptions extends MaterialSelectionOptions {
  /** 测试注入；缺省 services/decision.decide（providerOrder=['custom']，网关 jev）。 */
  decideImpl?: DecisionRankFn;
}

function rankModel(): string {
  return (process.env.MATERIAL_RANK_DECISION_MODEL || 'jev-1.14.0').trim();
}

function rankTimeoutMs(): number {
  const raw = Number(process.env.MATERIAL_RANK_DECISION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3_000;
}

function rankConcurrency(): number {
  const raw = Number(process.env.MATERIAL_RANK_DECISION_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.min(8, Math.floor(raw)) : 4;
}

/**
 * 词面排序 + 决策模型重排。流程：selectMaterials 得到词面序 → 取短名单（上限
 * RANK_SHORTLIST_MAX）并发打 noul 分 → 分数降序重排短名单 → 截 limit。
 * 短名单外的候选按词面序缀在选中之后（omitted 记账不受影响）。
 * 任何异常/未配置都退回词面结果（fail-open，strategy 不升级为 'decision'）。
 */
export async function selectMaterialsRanked(options: MaterialSelectionRankedOptions): Promise<MaterialSelection> {
  const base = selectMaterials(options);
  const disabled = process.env.MATERIAL_RANK_DECISION_DISABLED === '1';
  const decideImpl = options.decideImpl;
  if (disabled || base.selected.length + base.omitted.length < 2 || !String(options.query || '').trim()) {
    return base;
  }
  let decide: DecisionRankFn;
  if (decideImpl) {
    decide = decideImpl;
  } else {
    // 惰性 require 等价物：静态 import 会拖 material-store 测试进 decision 依赖；
    // 这里用动态 import 保持 selectMaterials 纯同步路径零外部依赖。
    try {
      const mod = await import('../decision');
      if (!mod.isDecisionEnabled() || !mod.isDecisionConfigured({ providerOrder: ['custom'] })) return base;
      decide = (request, opts) => mod.decide(request, opts) as Promise<Pick<DecisionResponse, 'answers' | 'model'>>;
    } catch {
      return base;
    }
  }

  const queryText = String(options.query || '').trim();
  const shortlist = [...base.selected, ...base.omitted].slice(0, RANK_SHORTLIST_MAX);
  const scores = new Map<string, { noul: number; index: number }>();
  let cursor = 0;
  let okCount = 0;
  async function worker(): Promise<void> {
    while (cursor < shortlist.length) {
      const index = cursor;
      cursor += 1;
      const record = shortlist[index];
      try {
        const { answers } = await decide(
          {
            model: rankModel(),
            state: `学习目标：${truncateRank(queryText, 500)}\n资料标题：${record.name}\n资料摘要：${truncateRank(materialSelectionText(record), 900)}`,
            questions: {
              relevance: { type: 'noul', question: '这份资料对学习目标的相关性有多高？', instructions: RANK_INSTRUCTIONS },
            },
          },
          { timeoutMs: rankTimeoutMs(), providerOrder: ['custom'] }
        );
        const noul = answers?.relevance?.noul;
        if (typeof noul === 'number' && Number.isFinite(noul)) {
          scores.set(record.id, { noul, index });
          okCount += 1;
        }
      } catch {
        // 单条失败保持词面位置，不中断其余打分
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(rankConcurrency(), shortlist.length) }, () => worker()));

  if (okCount === 0) return base;
  const reranked = shortlist
    .map((record, index) => ({ record, index, score: scores.get(record.id) }))
    .sort((a, b) => {
      if (a.score && b.score && b.score.noul !== a.score.noul) return b.score.noul - a.score.noul;
      if (a.score && !b.score) return -1;
      if (!a.score && b.score) return 1;
      return a.index - b.index;
    })
    .map((item) => item.record);
  const selected = reranked.slice(0, base.selected.length).map((record) => record);
  const rest = reranked.slice(base.selected.length);
  return {
    selected,
    omitted: [...rest, ...base.omitted.slice(shortlist.length)],
    total: base.total,
    strategy: 'decision',
    hasPhraseHit: base.hasPhraseHit,
  };
}

function truncateRank(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
