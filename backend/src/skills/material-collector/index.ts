/**
 * 资料采集编排器 Skill（外挂能力，handler-only 主接口 + 一个 LLM 抽取环节）。
 *
 * 定位（goal → path 之间的资料补齐）：
 *   用户目标常依赖外部权威资料（如《3-6 岁儿童学习与发展指南》）。LLM 只知道「有这份资料」、
 *   写不出内容，于是 path 只能编泛化套路。本 Skill 在 goal→path 之间做一次**资料采集**，
 *   落盘成「资料包 Material Pack」：path 用大纲/要点设计路径，learn 按需引用选段。
 *
 * 分工（确定性优先，LLM 只碰抽取）：
 *   1. 检索（search）：把 goal 的 needsMaterial.queries 交给 backend/src/services/search；
 *   2. 选源（rank）：去重 + 丢黑名单 + 域白名单优先 + sourceTier 分级（官方/标准 > 教材 > 权威机构 > 社区）；
 *   3. 抓取（fetch）：交 backend/src/services/fetch（ttl 缓存复用、部分成功语义、suspicious 标记）；
 *   4. 抽取（LLM）：只把「目标资料 + 一条已抓取正文」交给 prompt，抽回带引文的要点；
 *   5. 组装（deterministic）：丢弃无引文/引文不在正文中的要点，生成 provenance / coverage。
 *
 * 与既有能力的关系：不重造 search/fetch（直接用 services/search、services/fetch）；
 * 与 lesson-knowledge-enricher 不抢职责（那个做课后知识台账、不抓网）。
 *
 * 依赖注入边界：`MaterialCollectorDeps` 可整体替换，单测注入假 search/fetch/extract，
 * 不触达真实网络与 LLM。
 */

import { searchWeb } from '../../services/search';
import { fetchWeb } from '../../services/fetch';
import type { SearchCallOptions, SearchQuery, SearchResponse, SearchResultItem } from '../../services/search/types';
import type { FetchCallOptions, FetchContentItem, FetchRequest, FetchResponse } from '../../services/fetch/types';
import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { createPromptExtractor } from './extractor';
import type {
  MaterialCoverage,
  MaterialExtractionDraft,
  MaterialExtractionRequest,
  MaterialExtractor,
  MaterialKeyPoint,
  MaterialNeed,
  MaterialPack,
  MaterialPackResult,
  MaterialProvenance,
  MaterialSection,
  SourceTier,
} from './types';

export * from './types';

/** 可 mock 的 provider 边界（默认实现 = services/search + services/fetch + prompt 抽取器） */
export interface MaterialCollectorProviderDeps {
  searchWeb: (query: SearchQuery, options?: SearchCallOptions) => Promise<SearchResponse>;
  fetchWeb: (request: FetchRequest, options?: FetchCallOptions) => Promise<FetchResponse>;
  extract: MaterialExtractor;
}

/** 依赖注入别名（对外可读名） */
export type MaterialCollectorDeps = MaterialCollectorProviderDeps;

export interface MaterialCollectorOptions {
  /** 依赖注入（单测注入假 provider，不打真实网络/LLM） */
  deps?: Partial<MaterialCollectorProviderDeps>;
  /** 覆盖检索词（缺省取 need.queries，否则由 need.title/kind/publisher 生成） */
  queries?: string[];
  maxResultsPerQuery?: number;
  /** 单次最多抓取几条候选（默认 3） */
  maxSources?: number;
  /** 抓取缓存新鲜度容忍（秒，默认 24h；0 = 强制实时） */
  ttlSeconds?: number;
  /** 每源返回的相关片段数（默认 3；仅 provider 支持查询定向抽取时生效） */
  chunksPerSource?: number;
  /** 抽取深度（默认 advanced：要正文，宁可多花 1 credit；basic 更便宜但内容更少） */
  extractDepth?: 'basic' | 'advanced';
  /** 域白名单（优先级加权；strictWhitelist=true 时同时作为 search.includeDomains） */
  domainWhitelist?: string[];
  /** 追加域黑名单（内容农场等；与内置黑名单合并） */
  domainBlocklist?: string[];
  /** true = 白名单直接作为检索 includeDomains（默认 false，只做排序加权，避免白名单空结果） */
  strictWhitelist?: boolean;
  /** 期望覆盖的主题（用于 coverage.missing；缺省由 need.queries 派生） */
  expectedTopics?: string[];
  /** 引文校验（默认 true：quote 必须能在给定正文中原样找到，否则丢弃该要点） */
  verifyQuotes?: boolean;
  language?: string;
  location?: string;
  signal?: AbortSignal;
  /** 可注入时钟（测试固定 fetchedAt） */
  now?: () => Date;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/** 查询定向抽取：每源默认取的片段数（Tavily chunks_per_source 上限 5） */
const DEFAULT_CHUNKS_PER_SOURCE = 3;

/**
 * 交给抽取器的正文上限（字符）。2026-09-22 实测：UNICEF 的《指南》全文 29,466 字——
 * 直接塞进去会让模型输出超限、JSON 被截断（"response does not contain valid JSON"）。
 * 业界做法是"先切片再按查询取相关 span"；这里先做最小确定性版本：截断 + 明示已截断。
 */
const MAX_EXTRACTION_CHARS = 6000;

/** 文档型 URL：这些扩展名基本等同于"资料原文"（而非通知/导航页） */
const DOCUMENT_URL_SUFFIXES = ['.pdf', '.doc', '.docx', '.docm', '.odt', '.rtf', '.ppt', '.pptx', '.xls', '.xlsx', '.csv'];
/** 标题/URL 里出现这些词，说明这条更可能是"原文/附件"而不是索引页 */
const DOCUMENT_HINT_PATTERN = /(全文|原文|附件|下载|电子版|pdf|docx?|标准文本|指南全文)/i;

/**
 * 文档型来源评分（2026-09-22，P0-b）。
 *
 * 为什么需要：实测"找《3-6 岁儿童学习与发展指南》"时，排序**只看域名权威度**，
 * 结果"官方域名的【印发通知】页"压过了"非官方域的【全文 PDF】"——而我们要的恰恰是后者。
 * 业界（Perplexity）按资料类型选源；这里用确定性规则做最小版本：**文档型优先**。
 * 不惩罚非文档源（通知页可能是入口），只把"更像原文"的往前放；万一放错，
 * 抽取侧的"资料名对不上 ⇒ not_found"仍会兜住（不冒充）。
 */
export function documentSourceScore(url: string, title = ''): number {
  const lowerUrl = normalizeText(url).toLowerCase();
  const lowerTitle = normalizeText(title);
  const isDocumentUrl = DOCUMENT_URL_SUFFIXES.some((suffix) => lowerUrl.split('?')[0].endsWith(suffix));
  const hasHint = DOCUMENT_HINT_PATTERN.test(lowerTitle);
  return isDocumentUrl ? 2 : hasHint ? 1 : 0;
}

const DEFAULT_MAX_SOURCES = 5;
const DEFAULT_MAX_RESULTS_PER_QUERY = 8;

/** 来源分级权重：官方/标准 > 教材 > 权威机构 > 社区 */
const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  official: 5,
  standard: 4,
  textbook: 3,
  authority: 2,
  community: 1,
  unknown: 0,
};

/** 官方（政府/监管部门）域名后缀 */
const OFFICIAL_SUFFIXES = ['.gov', '.gov.cn', '.gov.uk', '.gov.au', '.gov.hk', '.gov.tw', '.go.jp'];
/** 标准机构 */
const STANDARD_DOMAINS = ['iso.org', 'iec.ch', 'ieee.org', 'w3.org', 'ietf.org', 'open-std.org', 'sac.gov.cn'];
/** 教材/高校域名后缀 */
const TEXTBOOK_SUFFIXES = ['.edu', '.edu.cn', '.ac.cn', '.ac.uk', '.edu.hk', '.edu.tw'];
/** 权威机构/期刊 */
const AUTHORITY_DOMAINS = [
  'who.int', 'unicef.org', 'unesco.org', 'oecd.org', 'worldbank.org', 'un.org',
  'nature.com', 'science.org', 'sciencedirect.com', 'springer.com', 'arxiv.org',
  'acm.org', 'pubmed.ncbi.nlm.nih.gov', 'moe.gov.cn', 'nhc.gov.cn',
];
/** 社区/自媒体/百科 */
const COMMUNITY_DOMAINS = [
  'zhihu.com', 'csdn.net', 'jianshu.com', 'cnblogs.com', 'segmentfault.com',
  'medium.com', 'substack.com', 'reddit.com', 'quora.com', 'baidu.com',
  'wikipedia.org', 'bilibili.com', 'douban.com', 'github.io', 'wordpress.com',
];
/** 内置黑名单：内容农场/文档搬运站（默认丢弃） */
const DEFAULT_BLOCKLIST = [
  'wenku.baidu.com', 'docin.com', 'doc88.com', '360doc.com', 'renrendoc.com', 'book118.com',
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hostMatchesSuffix(host: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => {
    const bare = suffix.replace(/^\./, '');
    return host === bare || host.endsWith(suffix);
  });
}

function hostMatchesDomain(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * 来源分级（确定性，按域名 + 标题线索）。
 * 顺序即优先级：官方 > 标准 > 教材 > 权威机构 > 社区 > unknown。
 */
export function classifySourceTier(url: string, title = ''): SourceTier {
  const host = hostnameOf(url);
  if (!host) return 'unknown';
  if (hostMatchesSuffix(host, OFFICIAL_SUFFIXES)) return 'official';
  if (hostMatchesDomain(host, STANDARD_DOMAINS)) return 'standard';
  if (hostMatchesSuffix(host, TEXTBOOK_SUFFIXES) || /教材|教科书|textbook/i.test(title)) return 'textbook';
  if (hostMatchesDomain(host, AUTHORITY_DOMAINS)) return 'authority';
  if (hostMatchesDomain(host, COMMUNITY_DOMAINS)) return 'community';
  return 'unknown';
}

function isBlocked(url: string, blocklist: string[]): boolean {
  const host = hostnameOf(url);
  if (!host) return true;
  return hostMatchesDomain(host, blocklist);
}

function isWhitelisted(url: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return false;
  const host = hostnameOf(url);
  return hostMatchesDomain(host, whitelist);
}

/** 排序后的候选源（附 sourceTier 供后续 provenance/pack 使用） */
export interface RankedSource extends SearchResultItem {
  sourceTier: SourceTier;
  whitelisted: boolean;
}

/**
 * 选源：丢非法/黑名单 → 去重（同 URL + 同 host 只留最高优先）→ 白名单优先 → tier 降序 → 原位置升序。
 */
export function rankSources(
  results: SearchResultItem[],
  options: { whitelist?: string[]; blocklist?: string[] } = {}
): RankedSource[] {
  const whitelist = (options.whitelist ?? []).map((d) => d.toLowerCase());
  const blocklist = [...DEFAULT_BLOCKLIST, ...(options.blocklist ?? [])].map((d) => d.toLowerCase());

  const seenUrls = new Set<string>();
  const candidates: RankedSource[] = [];
  for (const item of results) {
    const url = normalizeText(item?.url);
    if (!url || !isHttpUrl(url) || isBlocked(url, blocklist)) continue;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    candidates.push({
      ...item,
      url,
      sourceTier: classifySourceTier(url, item?.title),
      whitelisted: isWhitelisted(url, whitelist),
    });
  }

  return candidates.sort((a, b) => {
    if (a.whitelisted !== b.whitelisted) return a.whitelisted ? -1 : 1;
    // 文档型优先（全文 PDF/附件 > 通知/导航页）：见 documentSourceScore 注释
    const docDiff = documentSourceScore(b.url, b.title) - documentSourceScore(a.url, a.title);
    if (docDiff !== 0) return docDiff;
    const tierDiff = SOURCE_TIER_RANK[b.sourceTier] - SOURCE_TIER_RANK[a.sourceTier];
    if (tierDiff !== 0) return tierDiff;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

function buildQueries(need: MaterialNeed, options: MaterialCollectorOptions): string[] {
  const explicit = (options.queries ?? need.queries ?? []).map(normalizeText).filter(Boolean);
  if (explicit.length > 0) return Array.from(new Set(explicit)).slice(0, 5);
  const title = normalizeText(need.title);
  const parts = [title];
  if (need.publisher) parts.push(normalizeText(need.publisher));
  if (need.kind) parts.push(normalizeText(need.kind));
  const query = parts.filter(Boolean).join(' ');
  return query ? [query] : [];
}

/**
 * 正文截断（带可见标记）：确定性、可预期。标记会进 prompt，抽取器据此**只就所见部分抽取**、不补全。
 */
function truncateForExtraction(text: string): string {
  if (text.length <= MAX_EXTRACTION_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTION_CHARS)}

（正文过长，已截断：仅提供前 ${MAX_EXTRACTION_CHARS} 字，后续内容未提供，不要补全）`;
}

function expectedTopicsOf(need: MaterialNeed, options: MaterialCollectorOptions): string[] {
  const explicit = (options.expectedTopics ?? need.queries ?? []).map(normalizeText).filter(Boolean);
  return need.kind ? Array.from(new Set([normalizeText(need.kind), ...explicit])).filter(Boolean) : Array.from(new Set(explicit));
}

/** 归一化便于 substring 比对：去空白 + 小写（引文可能被换行/空格切碎） */
function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function quoteInText(quote: string, text: string): boolean {
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return false;
  return normalizeForMatch(text).includes(normalizedQuote);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveDeps(partial?: Partial<MaterialCollectorProviderDeps>): MaterialCollectorProviderDeps {
  return {
    searchWeb: partial?.searchWeb ?? searchWeb,
    fetchWeb: partial?.fetchWeb ?? fetchWeb,
    extract: partial?.extract ?? createPromptExtractor(),
  };
}

function notFound(coverage: MaterialCoverage, notes: string[]): MaterialPackResult {
  return { status: 'not_found', pack: null, provenance: [], coverage, notes };
}

/**
 * 组装 pack：丢弃无引文 / 引文不在正文中的要点（硬规则②），生成 provenance 与 coverage。
 * 返回 null 表示无任何可核验要点 → 上层显式 not_found。
 */
function assemblePack(input: {
  need: MaterialNeed;
  sourceUrl: string;
  sourceTier: SourceTier | null;
  draft: MaterialExtractionDraft;
  text: string;
  options: MaterialCollectorOptions;
  notes: string[];
}): { pack: MaterialPack; provenance: MaterialProvenance[]; missing: string[] } | null {
  const { need, sourceUrl, sourceTier, draft, text, options, notes } = input;
  const verifyQuotes = options.verifyQuotes !== false;
  const expectedTopics = expectedTopicsOf(need, options);

  const sections: MaterialSection[] = (draft.sections ?? [])
    .map((section, index) => ({
      id: normalizeText(section?.id) || `s-${index + 1}`,
      title: normalizeText(section?.title),
      summary: normalizeText(section?.summary),
    }))
    .filter((section) => section.title.length > 0);

  const keyPoints: MaterialKeyPoint[] = [];
  const provenance: MaterialProvenance[] = [];
  let dropped = 0;
  let quoteNotVerified = 0;

  for (const point of draft.keyPoints ?? []) {
    const pointText = normalizeText(point?.text);
    const quote = normalizeText(point?.quote) || normalizeText(point?.cite);
    const pointUrl = normalizeText(point?.sourceUrl) || sourceUrl;
    // 硬规则②：没有引文（cite/sourceUrl）的要点不得进入 pack
    if (!pointText || !quote || !pointUrl) {
      dropped += 1;
      continue;
    }
    if (verifyQuotes && !quoteInText(quote, text)) {
      quoteNotVerified += 1;
      continue;
    }
    const pointId = `p-${keyPoints.length + 1}`;
    keyPoints.push({ text: pointText, cite: quote, sourceUrl: pointUrl });
    provenance.push({ pointId, sourceUrl: pointUrl, quote });
  }

  if (dropped > 0) notes.push(`因缺引文（cite/sourceUrl）丢弃要点 ${dropped} 条`);
  if (quoteNotVerified > 0) notes.push(`因引文无法在正文中原样找到而丢弃要点 ${quoteNotVerified} 条`);
  if (keyPoints.length === 0) return null;

  const covered = Array.from(new Set([...sections.map((section) => section.title), ...keyPoints.map((point) => point.text)]));
  const missing = expectedTopics.filter(
    (topic) => !covered.some((entry) => entry.includes(topic) || topic.includes(entry))
  );

  const tldr = normalizeText(draft.tldr) || sections.slice(0, 3).map((section) => section.summary || section.title).filter(Boolean).join('；');

  const pack: MaterialPack = {
    title: normalizeText(draft.title) || need.title,
    publisher: normalizeText(draft.publisher) || normalizeText(need.publisher) || null,
    // sourceTier 以编排器的确定性分级为准（抽取侧看不准）
    sourceTier,
    sourceUrl,
    version: normalizeText(draft.version) || normalizeText(need.version) || null,
    fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    license: normalizeText(draft.license) || null,
    tldr,
    sections,
    keyPoints,
  };

  return { pack, provenance, missing };
}

/**
 * 主入口：goal 的 needsMaterial → 确定性采集 → Material Pack。
 * 永远不抛（除依赖注入自身错误外）：检索/抓取/抽取失败退化为显式 not_found 或 partial。
 */
export async function collectMaterialPack(
  need: MaterialNeed,
  options: MaterialCollectorOptions = {}
): Promise<MaterialPackResult> {
  const notes: string[] = [];
  const title = normalizeText(need?.title);
  const expectedTopics = expectedTopicsOf(need ?? { title: '' }, options);
  const emptyCoverage: MaterialCoverage = { covered: [], missing: expectedTopics };

  if (!title) {
    return notFound(emptyCoverage, ['缺少 need.title，无法采集外部资料（显式 not_found）']);
  }

  const deps = resolveDeps(options.deps);
  const whitelist = (options.domainWhitelist ?? []).map((domain) => domain.toLowerCase());
  const blocklist = (options.domainBlocklist ?? []).map((domain) => domain.toLowerCase());
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const callOptions: { signal?: AbortSignal } | undefined = options.signal ? { signal: options.signal } : undefined;

  // --- 1) 检索（部分失败不影响其余 query） ---
  const queries = buildQueries(need, options);
  const candidates: SearchResultItem[] = [];
  for (const query of queries) {
    try {
      const response = await deps.searchWeb(
        {
          query,
          maxResults: options.maxResultsPerQuery ?? DEFAULT_MAX_RESULTS_PER_QUERY,
          purpose: `采集外部权威资料：${title}`,
          language: options.language,
          location: options.location,
          includeDomains: options.strictWhitelist && whitelist.length > 0 ? whitelist : undefined,
        },
        callOptions
      );
      candidates.push(...(response.results ?? []));
    } catch (error) {
      notes.push(`检索失败（${query}）：${errorMessage(error)}`);
    }
  }

  const ranked = rankSources(candidates, { whitelist, blocklist });
  if (ranked.length === 0) {
    return notFound(emptyCoverage, [
      ...notes,
      '检索无可用候选源，显式返回 not_found（不使用模型记忆冒充资料内容）',
    ]);
  }
  const selected = ranked.slice(0, maxSources);

  // --- 2) 抓取（部分成功语义：单条 URL 失败不影响其余；ttl 缓存复用；suspicious 丢弃） ---
  let fetchResponse: FetchResponse;
  try {
    fetchResponse = await deps.fetchWeb(
      {
        urls: selected.map((source) => source.url),
        format: 'markdown',
        ttl: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        purpose: `采集外部权威资料：${title}`,
        // 查询定向抽取（2026-09-22）：只取与目标资料相关的片段，避免把整页导航/模板喂给抽取器
        query: [title, normalizeText(need.publisher), normalizeText(need.kind)].filter(Boolean).join(' '),
        chunksPerSource: options.chunksPerSource ?? DEFAULT_CHUNKS_PER_SOURCE,
        extractDepth: options.extractDepth ?? 'advanced',
      },
      callOptions
    );
  } catch (error) {
    return notFound(emptyCoverage, [...notes, `抓取失败：${errorMessage(error)}（显式 not_found）`]);
  }

  for (const itemError of fetchResponse.errors ?? []) {
    notes.push(`抓取失败（${itemError.url}）：${itemError.code}`);
  }
  for (const item of fetchResponse.results ?? []) {
    if (item.suspicious) notes.push(`丢弃可疑正文（suspicious）：${item.url}`);
  }

  const usable: FetchContentItem[] = (fetchResponse.results ?? []).filter(
    (item) => !item.suspicious && typeof item.text === 'string' && item.text.trim().length > 0
  );
  if (usable.length === 0) {
    return notFound(emptyCoverage, [
      ...notes,
      '无可用正文（全部抓取失败或被判可疑），显式返回 not_found',
    ]);
  }

  // --- 3) 抽取（LLM；按候选顺序直到拿到可用草稿） ---
  const tierByUrl = new Map(selected.map((source) => [source.url, source.sourceTier]));
  let chosen: FetchContentItem | null = null;
  let draft: MaterialExtractionDraft | null = null;
  for (const item of usable) {
    const sourceUrl = normalizeText(item.finalUrl) || item.url;
    const request: MaterialExtractionRequest = {
      need: { ...need, title },
      source: {
        url: sourceUrl,
        title: normalizeText(item.title),
        publishedAt: item.publishedAt,
        // 超长正文先截断：模型输出规模有限，整份文档塞进去会把 JSON 挤爆（实测 29k 字必失败）
        text: truncateForExtraction(String(item.text)),
      },
    };
    try {
      const candidate = await deps.extract(request);
      // 2026-09-22 修复（真实案例：3-6 岁儿童学习与发展指南）：
      // **只有拿到可用要点才算成功**。抽取器可能（正确地）返回 status=not_found —— 例如首选候选
      // 是《印发通知》而不是《指南》正文；此前 `if (candidate)` 直接 break，导致
      // **后面的正确候选源（如 UNICEF 的《指南》全文）永远不会被尝试**，
      // 且模型给出的诊断 notes 被丢弃，最终只剩一句泛化的"无有效引文"，掩盖真实原因。
      if (candidate?.notes?.length) {
        notes.push(...candidate.notes.slice(0, 2).map((note) => `抽取诊断（${sourceUrl}）：${note}`));
      }
      if (candidate && Array.isArray(candidate.keyPoints) && candidate.keyPoints.length > 0) {
        chosen = item;
        draft = candidate;
        break;
      }
      notes.push(`候选源未产出可用要点（${sourceUrl}），继续尝试下一条来源`);
    } catch (error) {
      notes.push(`抽取失败（${sourceUrl}）：${errorMessage(error)}`);
    }
  }

  if (!chosen || !draft) {
    return notFound(emptyCoverage, [...notes, '所有来源抽取均失败，显式返回 not_found（不使用模型记忆）']);
  }

  const sourceUrl = normalizeText(chosen.finalUrl) || chosen.url;

  // --- 4) 组装（确定性；无引文要点丢弃） ---
  const assembled = assemblePack({
    need: { ...need, title },
    sourceUrl,
    sourceTier: tierByUrl.get(chosen.url) ?? classifySourceTier(sourceUrl),
    draft,
    text: String(chosen.text),
    options,
    notes,
  });

  if (!assembled) {
    return notFound(emptyCoverage, [...notes, '抽取要点全部无有效引文，显式返回 not_found（无引文要点不得进入 pack）']);
  }

  const { pack, provenance, missing } = assembled;
  const coverage: MaterialCoverage = { covered: pack.sections.map((section) => section.title), missing };
  const degraded =
    (fetchResponse.errors?.length ?? 0) > 0 ||
    usable.length < selected.length ||
    missing.length > 0 ||
    notes.some((note) => note.startsWith('因'));

  return {
    status: degraded ? 'partial' : 'ok',
    pack,
    provenance,
    coverage,
    notes: [...(draft.notes ?? []).map(normalizeText).filter(Boolean), ...notes],
  };
}

/**
 * Skill handler（Capability Runtime 入口）。
 * status=not_found 属于**合法业务结果**（不是执行失败）：success 仍为 true，由调用方按 status 分支。
 */
export async function executeMaterialCollector(
  input: { need: MaterialNeed } & MaterialCollectorOptions
): Promise<SkillExecutionResult<MaterialPackResult>> {
  const startedAt = Date.now();
  try {
    const result = await collectMaterialPack(input?.need, input ?? {});
    return {
      success: true,
      output: result,
      duration: Date.now() - startedAt,
      quality: 'model',
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 'MATERIAL_COLLECTOR_EXECUTION_FAILED', message: errorMessage(error) },
      duration: Date.now() - startedAt,
    };
  }
}

// ============================================================
// goal → path 接线缝（接口已备好，调用点见下方注释）
// ============================================================

/**
 * 读取 goal 层的可见输出，批量采集资料包。
 *
 * 期望调用位置（**尚未接线**，最小侵入优先）：
 *   - 数据来源：goal-conversation 新增 hidden 字段 `needsMaterial`
 *     （prompts/core/goal-conversation.yaml），随 goalFinalPayload 落到
 *     goal_conversations.collectedData（现有 JSON 列，**无需数据库迁移**）；
 *   - 采集时机：goal 确认（stage=ready）之后、path-planning 之前；
 *   - 建议调用点：coordinators/path.coordinator.ts `normalizeGoalRequest` 内，
 *     读 `goalFinalPayload.visibleSummary.needsMaterial`（或 collectedData.understanding.needsMaterial）
 *     → `await collectMaterialForGoal(...)`；
 *   - 结果落盘（复用现有 JSON 槽位，不新增列）：把 packs 写回
 *     `normalizedInput.resources.materials`（path.coordinator buildNormalizedInputV1 的 resources 段），
 *     供 path-planning 读大纲、teaching 按需引用选段。
 *   - learn 侧只留接口：由教学层在需要选段时按 sourceUrl+quote 引用即可，不在此实现。
 */
export async function collectMaterialForGoal(
  needsMaterial: MaterialNeed | MaterialNeed[] | null | undefined,
  options: MaterialCollectorOptions = {}
): Promise<MaterialPackResult[]> {
  const needs = (Array.isArray(needsMaterial) ? needsMaterial : needsMaterial ? [needsMaterial] : [])
    .filter((need): need is MaterialNeed => Boolean(need && normalizeText(need.title)));
  const results: MaterialPackResult[] = [];
  for (const need of needs) {
    results.push(await collectMaterialPack(need, options));
  }
  return results;
}

/** goal 输出是否声明了外部资料需求（供调用点做 0 成本早退判断） */
export function hasMaterialNeed(goalOutput: unknown): boolean {
  const record = goalOutput && typeof goalOutput === 'object' ? (goalOutput as Record<string, any>) : {};
  const need = record.needsMaterial ?? record.visibleSummary?.needsMaterial ?? record.understanding?.needsMaterial;
  if (Array.isArray(need)) return need.some((item) => Boolean(item && normalizeText(item.title)));
  return Boolean(need && normalizeText((need as Record<string, any>).title));
}

export const materialCollectorDefinition: SkillDefinition = {
  name: 'material-collector',
  displayName: '资料采集编排器 Skill',
  version: '1.0.0',
  category: 'retrieval',
  description: '在 goal→path 之间采集外部权威资料：确定性编排 search→选源→fetch，LLM 仅抽取带引文的要点，产出 Material Pack',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      need: { type: 'object', description: '外部资料需求 { kind, title, why, queries[] }', required: true },
      queries: { type: 'array', description: '覆盖检索词（缺省取 need.queries）' },
      maxSources: { type: 'number', description: '单次最多抓取候选数（默认 3）' },
      ttlSeconds: { type: 'number', description: '抓取缓存新鲜度容忍（秒，默认 86400）' },
      domainWhitelist: { type: 'array', description: '域白名单（排序优先）' },
      domainBlocklist: { type: 'array', description: '追加域黑名单' },
      expectedTopics: { type: 'array', description: '期望覆盖主题（用于 coverage.missing）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'ok | partial | not_found' },
      pack: { type: 'object', description: '资料包（not_found 时为 null）' },
      provenance: { type: 'array', description: '引文溯源台账' },
      coverage: { type: 'object', description: '{ covered, missing }' },
      notes: { type: 'array', description: '退化说明与丢弃台账' },
    },
  },
  capabilities: ['material-collection', 'external-retrieval', 'material-pack', 'source-tiering'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

export default executeMaterialCollector;
