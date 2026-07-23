export type GatewayFailureCategory =
  | 'caller_abort'
  | 'security'
  | 'configuration'
  | 'authentication'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'provider_timeout'
  | 'provider_http'
  | 'protocol'
  | 'internal';

export interface GatewayFailureDetails {
  category: GatewayFailureCategory;
  code: string;
  retryable: boolean;
  statusCode?: number;
  requestUrl?: string;
  contentType?: string;
  retryAfterMs?: number;
}

export interface GatewayExecutionMetadata {
  llmRequestId: string;
  attemptCount: number;
  providerId: string;
  model: string;
}

export class GatewayExecutionError extends Error {
  readonly category: GatewayFailureCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly requestUrl?: string;
  readonly contentType?: string;
  readonly retryAfterMs?: number;
  llmRequestId?: string;
  attemptCount?: number;
  providerId?: string;
  model?: string;

  constructor(message: string, details: GatewayFailureDetails) {
    super(message);
    this.name = 'GatewayExecutionError';
    this.category = details.category;
    this.code = details.code;
    this.retryable = details.retryable;
    this.statusCode = details.statusCode;
    this.requestUrl = details.requestUrl;
    this.contentType = details.contentType;
    this.retryAfterMs = details.retryAfterMs;
  }

  attachExecutionMetadata(metadata: GatewayExecutionMetadata): this {
    this.llmRequestId = metadata.llmRequestId;
    this.attemptCount = metadata.attemptCount;
    this.providerId = metadata.providerId;
    this.model = metadata.model;
    return this;
  }
}

export function parseRetryAfterMs(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - now);
}
