/**
 * 决策模型统一类型（SystemOne 槽位协议）。
 *
 * 与 services/embedding、services/search 同构：调用方只依赖本文件，
 * provider（Cloudflare Clef / 阿里云 MaaS / Venice / OpenCode Zen）可替换、可降级。
 *
 * 与聊天模型的区别（决定了它不能用于抽取）：
 *   输入是「一个 state + 若干带类型的 question」，输出是**每个 question 的概率/选项/分值**，
 *   不生成自由文本。因此它只能做判定（可用性、可答性、覆盖度、分级），不能产出 tldr/sections。
 *
 * 已实测的 provider（2026-10-18）：
 *   - alibaba：`decision-model-preview`（私有部署域名），90~300ms —— **默认主通道**
 *   - cloudflare：`@cf/cloudflare/clef-omni` 等，0.3~1.9s（额度/可用性不稳，需显式启用）
 *   - venice：`jev-latest`，需余额（当前 402）
 *   - opencode：`jev-1.13-free`，免费共享额度
 *   - custom：任意 SystemOne 兼容部署（如自建的 laya 等），只靠环境变量接入，不改代码
 */

export type DecisionProviderId = 'custom' | 'alibaba' | 'cloudflare' | 'venice' | 'opencode';

export type DecisionQuestionType = 'choice' | 'noul' | 'score';

/** choice 的选项：扁平「键 → 描述」映射；部分 provider 也接受 {key:{description}} */
export type DecisionCriteria = Record<string, string> | Record<string, { description: string }> | string[];

export interface DecisionQuestion {
  type: DecisionQuestionType;
  /** 问题的自然语言表述（provider 会把 id 隐去，语义必须写在这里） */
  question?: string;
  /** 判定口径；比 question 更能左右结果 */
  instructions?: string;
  /** choice 的枚举键；score 的有序描述数组 */
  criteria?: DecisionCriteria;
}

export interface DecisionRequest {
  /** 待判定的材料：字符串或结构化对象（长文本建议调用方先采样） */
  state: string | Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  /** 覆盖 provider 默认模型（一般不传） */
  model?: string;
}

export interface DecisionAnswer {
  type: string;
  /** choice：选中的键 */
  choice?: string;
  /** noul：0~1 概率 */
  noul?: number;
  /** score：0~len-1 的期望分 */
  score?: number;
  /** choice/score：模型自报置信度，与概率分布是两回事 */
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
}

export interface DecisionResponse {
  model: string;
  answers: Record<string, DecisionAnswer>;
  provider: DecisionProviderId;
  attempts: DecisionProviderId[];
  latencyMs: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface DecisionCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖 provider 顺序（测试 / 灰度用） */
  providerOrder?: DecisionProviderId[];
}

export type DecisionErrorCode =
  | 'DECISION_DISABLED'
  | 'DECISION_REQUEST_INVALID'
  | 'DECISION_PROVIDER_NOT_CONFIGURED'
  | 'DECISION_ALL_PROVIDERS_FAILED';

export class DecisionError extends Error {
  readonly code: DecisionErrorCode;
  readonly cause?: unknown;

  constructor(code: DecisionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
    this.cause = cause;
  }
}

export interface DecisionProviderResult {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface DecisionProvider {
  readonly id: DecisionProviderId;
  /** 凭证/端点是否齐备；未配置的 provider 会被服务层跳过 */
  isConfigured(): boolean;
  decide(request: DecisionRequest, options?: DecisionCallOptions): Promise<DecisionProviderResult>;
}
