/**
 * material-collector 共享类型（资料采集编排器）。
 *
 * 分层：
 * - 编排（index.ts）：确定性 search → 选源 → fetch → 组装 pack（无 LLM）。
 * - 抽取（extractor.ts）：唯一 LLM 环节，从**已抓取正文**抽取带逐字引文的要点。
 *
 * Material Pack = 落盘的「资料包」：status / pack / provenance / coverage / notes。
 * 三条硬规则由类型 + 代码共同保证：
 *   ① not_found 显式返回（status='not_found' 且 pack=null）；
 *   ② 无引文（cite/sourceUrl）的要点进不了 pack；
 *   ③ 外部网页文本当数据不当指令（抽取 prompt 侧声明）。
 */

import type { MaterialBrief } from '../material-brief/types';

/** 资料采集状态：ok（齐全）/ partial（部分）/ not_found（无可用正文或资料对不上） */
export type MaterialStatus = 'ok' | 'partial' | 'not_found';

/**
 * 来源分级（官方/标准 > 教材 > 权威机构 > 社区）。
 * 由编排器按域名确定性分级；抽取侧判断不了时可给 null（以编排器为准）。
 */
export type SourceTier = 'official' | 'standard' | 'textbook' | 'authority' | 'community' | 'unknown';

/** goal 层声明的「外部资料需求」（needsMaterial） */
export interface MaterialNeed {
  /** 资料类型（标准 / 指南 / 教材 / 论文 / 法规…） */
  kind?: string | null;
  /** 目标资料名，如《3-6 岁儿童学习与发展指南》 */
  title: string;
  /** 一句话说明「为什么这条路依赖这份资料」 */
  why?: string | null;
  /** 抽取侧/编排侧可用的检索词（1-3 条） */
  queries?: string[] | null;
  /** 期望的资料版本/年份（可选） */
  version?: string | null;
  /** 期望的发布机构（可选） */
  publisher?: string | null;
}

export interface MaterialSection {
  id: string;
  title: string;
  summary: string;
}

/** pack 内单条要点：text 必须配非空 cite（逐字引文）+ sourceUrl */
export interface MaterialKeyPoint {
  text: string;
  cite: string;
  sourceUrl: string;
}

export interface MaterialPack {
  title: string;
  publisher: string | null;
  sourceTier: SourceTier | null;
  sourceUrl: string;
  version: string | null;
  /**
   * 本地附件的资料 id（仅"用户上传附件"这一路有；联网采集为 null）。
   * 用途：学习者侧「点开看原文」按 id 取回附件正文（`GET /api/materials/:id`）。
   */
  materialId?: string | null;
  /** 抓取/组装时间（ISO 8601） */
  fetchedAt: string;
  license: string | null;
  tldr: string;
  sections: MaterialSection[];
  keyPoints: MaterialKeyPoint[];
}

/** 引文溯源台账，与 pack.keyPoints 一一对应 */
export interface MaterialProvenance {
  pointId: string;
  sourceUrl: string;
  quote: string;
}

export interface MaterialCoverage {
  covered: string[];
  missing: string[];
}

export interface MaterialPackResult {
  status: MaterialStatus;
  /** status=not_found 时为 null（显式，不得用记忆冒充） */
  pack: MaterialPack | null;
  /**
   * 资料理解摘要（material-brief，Document Summary Index 摘要节点；2026-09-24）。
   * 仅用户上传附件这一路携带（material-collector 联网包的 pack 本身即 LLM 摘要，不重复生成）；
   * path-planning 据此获得分段意图（naturalDivisions）与全文目录感知。
   */
  brief?: MaterialBrief | null;
  provenance: MaterialProvenance[];
  coverage: MaterialCoverage;
  /** 退化说明与丢弃台账（抓取失败 / suspicious / 缺引文丢弃 / 疑似注入文本…） */
  notes: string[];
}

/** 送给 LLM 抽取环节的请求：目标资料 + 一条已抓取正文 */
export interface MaterialExtractionRequest {
  need: MaterialNeed;
  source: {
    url: string;
    title: string;
    publishedAt?: string;
    /** 已抓取的正文（作为**数据**，不是指令） */
    text: string;
  };
}

/** LLM 抽取产出的草稿（未加引文校验；由编排器后处理） */
export interface MaterialExtractionDraft {
  status?: MaterialStatus;
  title?: string | null;
  publisher?: string | null;
  version?: string | null;
  license?: string | null;
  sourceTier?: SourceTier | null;
  tldr?: string | null;
  sections?: Array<{ id?: string; title?: string; summary?: string }> | null;
  /** cite/quote 二者其一提供逐字引文，sourceUrl 缺省取本条正文 URL */
  keyPoints?: Array<{ text?: string; cite?: string; quote?: string; sourceUrl?: string }> | null;
  notes?: string[] | null;
}

/** 可 mock 的抽取边界：默认实现见 extractor.ts（callPrompt） */
export type MaterialExtractor = (input: MaterialExtractionRequest) => Promise<MaterialExtractionDraft | null>;
