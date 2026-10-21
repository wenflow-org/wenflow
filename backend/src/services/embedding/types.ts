/**
 * 向量化与重排统一类型（平台基础设施模型 embedding / rerank）。
 *
 * 与 services/search / services/fetch / services/image 同构：调用方只依赖本文件，
 * provider 可替换、可降级。但分类不同：embedding/rerank 是平台必需的基础设施模型
 * （模型原语），不是用户可见插件；配置走「模型与接入」，provider 适配器可替换。
 * 新增 provider 只需实现 EmbeddingProvider / RerankProvider 并在 providers/index.ts 注册。
 *
 * 与 search / fetch / image 的差异（决定了接口形态）：
 * 1. 输入是**文本数组**（不是 query / urls / prompt），产出是**浮点向量**（不是 URL / 图片）——
 *    因此并列而不合并：search 找 URL，fetch 取正文，image 生成图片，embedding 出向量、rerank 出序。
 * 2. embedding 是「一次请求一批」的语义（OpenAI 兼容 /v1/embeddings 的 input 收 string 或 string[]），
 *    批内**顺序即调用方顺序**，返回必须逐条对齐；次数不匹配直接判上游异常。
 * 3. 上游「维度」由模型自定（bge-m3=1024、bge-large-zh=1024 等），调用方不应假设维数——
 *    只在需要时按返回的 `dimensions` 校验。
 * 4. rerank 是「一条 query + 一批候选 → 每个候选一个相关分」，返回按下标对齐的序列。
 *
 * 定位（2026-10-16 用户令）：材料理解层是唯一「开放长语料」，检索只在这里是刚需；
 * 其余环节候选池小且强类型，不接。故本能力**只提供「算向量 / 排序」**，不含向量库/存储——
 * 存储与检索策略由消费方决定（当前量级：SQLite 落 BLOB + 应用层算余弦即可，勿引 pgvector/faiss）。
 */

/** 当前实现的两类能力；provider 的 id 在各自类型里另定义 */
export type EmbeddingProviderId = 'bge';
export type RerankProviderId = 'bge';

export interface EmbeddingRequest {
  /** 待向量化文本；单条或批量。批量时返回顺序与入参顺序严格一致 */
  input: string | string[];
  /** 模型 id；不传 = provider 默认（EMBEDDING_MODEL，如 BAAI/bge-m3） */
  model?: string;
  /** 单条文本字符上限（超出由 validate 拒绝，避免上游静默截断——见 validate.ts 说明） */
}

export interface EmbeddedVector {
  /** 第几条入参（0-based），与入参顺序对齐 */
  index: number;
  /** 向量（维数由模型决定） */
  embedding: number[];
}

/** adapter 归一化后的结果（provider / attempts / latency 由 service 补齐） */
export interface EmbeddingProviderResult {
  vectors: EmbeddedVector[];
  /** 实际使用的模型（provider 默认值填充后） */
  model: string;
  /** 向量维度（由首条向量长度得出；空结果时为 0） */
  dimensions: number;
}

export interface EmbeddingResponse extends EmbeddingProviderResult {
  provider: EmbeddingProviderId;
  attempts: EmbeddingProviderId[];
  latencyMs: number;
}

export interface RerankRequest {
  /** 检索意图（一条 query） */
  query: string;
  /** 候选文本（每条一段）；返回其对 query 的相关分，按下标对齐 */
  documents: string[];
  /** 模型 id；不传 = provider 默认（RERANK_MODEL，如 BAAI/bge-reranker-v2-m3） */
  model?: string;
  /** 只保留前 N 条（上游普遍支持 top_n）；不传 = 返回全部候选的分数 */
  topN?: number;
}

export interface RerankedDocument {
  /** 原始候选下标（0-based），用于回指 documents */
  index: number;
  /** 相关分（越大越相关；尺度由模型决定，**不保证 0-1**） */
  relevanceScore: number;
}

export interface RerankProviderResult {
  /** 已按相关分降序排列 */
  results: RerankedDocument[];
  model: string;
}

export interface RerankResponse extends RerankProviderResult {
  provider: RerankProviderId;
  attempts: RerankProviderId[];
  latencyMs: number;
}

export interface EmbeddingCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  /** 是否具备调用条件（endpoint / key 已配置）；未配置的 provider 会被 service 跳过 */
  isConfigured(): boolean;
  embed(request: EmbeddingRequest, options?: EmbeddingCallOptions): Promise<EmbeddingProviderResult>;
}

export interface RerankProvider {
  readonly id: RerankProviderId;
  isConfigured(): boolean;
  rerank(request: RerankRequest, options?: EmbeddingCallOptions): Promise<RerankProviderResult>;
}

export type EmbeddingErrorCode =
  | 'EMBEDDING_REQUEST_INVALID'
  | 'EMBEDDING_PROVIDER_NOT_CONFIGURED'
  | 'EMBEDDING_PROVIDER_UNKNOWN'
  | 'EMBEDDING_UPSTREAM_HTTP_ERROR'
  | 'EMBEDDING_UPSTREAM_UNAVAILABLE'
  | 'EMBEDDING_UPSTREAM_TIMEOUT'
  | 'EMBEDDING_UPSTREAM_MALFORMED'
  | 'EMBEDDING_EMPTY_RESULT'
  | 'EMBEDDING_ALL_PROVIDERS_FAILED'
  | 'RERANK_REQUEST_INVALID'
  | 'RERANK_UPSTREAM_HTTP_ERROR'
  | 'RERANK_UPSTREAM_MALFORMED';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly status?: number;

  constructor(code: EmbeddingErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.status = status;
  }
}
