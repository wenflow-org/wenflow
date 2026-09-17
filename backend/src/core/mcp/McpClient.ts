/**
 * McpClient —— MCP 协议客户端（最小可用实现）。
 *
 * 与同目录 McpGateway 的本质区别：
 *   McpGateway 是「通用 HTTP 端点注册表」——一律 POST + `Authorization: Bearer`，并不是 MCP；
 *   McpClient   实现真正的 MCP：JSON-RPC 2.0 + initialize 握手 + tools/list + tools/call，
 *               传输走 Streamable HTTP（响应可能是 application/json，也可能是 text/event-stream）。
 *
 * 定位（Phase 0 试点）：先证明「能连上真 MCP server 并调用其工具」，
 * 并与同源 REST 通道做差分测试；生产接线（servers/tools 模型改造）另行决策。
 *
 * 依赖：复用 safeHttpRequest（SSRF 白名单、超时、字节上限、可信域跳过）。
 */

import { safeHttpRequest } from '../../utils/safe-http';

export const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_MCP_TIMEOUT_MS = 60_000;

export class McpClientError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
  }
}

export interface McpClientOptions {
  /** MCP server 端点，如 https://tavily.fuhuagoogle.top/mcp */
  endpoint: string;
  /** Bearer 令牌（MCP 官方规范用 OAuth；本实现对静态 Bearer 兼容） */
  apiKey?: string;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  timeoutMs?: number;
  privateNetworkPolicy?: 'runtime' | 'public-only';
  signal?: AbortSignal;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  isError: boolean;
  content: McpContentBlock[];
  structuredContent?: unknown;
  raw: unknown;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorPayload;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function toServerInfo(value: unknown): McpServerInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return { name: asOptionalString(record.name), version: asOptionalString(record.version) };
}

interface RawHttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

function readHeader(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return '';
}

/** 解析响应体：兼容裸 JSON 与 SSE（text/event-stream）两种形态 */
function parseMessages(body: string, contentType: string): JsonRpcMessage[] {
  const text = (body || '').trim();
  if (!text) return [];

  const looksLikeSse = /text\/event-stream/i.test(contentType)
    || text.startsWith('event:')
    || text.includes('\ndata:')
    || text.startsWith('data:');

  if (!looksLikeSse) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  // SSE：按事件边界（空行）聚合 data 行，逐条 JSON.parse
  const messages: JsonRpcMessage[] = [];
  let dataLines: string[] = [];
  const flush = () => {
    if (!dataLines.length) return;
    const payload = dataLines.join('\n').trim();
    dataLines = [];
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) messages.push(...parsed);
      else messages.push(parsed);
    } catch {
      // 忽略非 JSON 事件（如注释/心跳）
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    } else if (line.trim() === '') {
      flush();
    }
  }
  flush();
  return messages;
}

export class McpClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly protocolVersion: string;
  private readonly timeoutMs: number;
  private readonly privateNetworkPolicy: 'runtime' | 'public-only';
  private readonly signal?: AbortSignal;

  private sessionId?: string;
  private nextId = 1;
  private serverInfo?: McpServerInfo;
  private negotiatedProtocolVersion?: string;

  constructor(options: McpClientOptions) {
    if (!options?.endpoint || !options.endpoint.trim()) {
      throw new McpClientError('MCP_ENDPOINT_REQUIRED', 'MCP endpoint 不能为空');
    }
    this.endpoint = options.endpoint.trim();
    this.apiKey = options.apiKey?.trim() || undefined;
    this.clientName = options.clientName || 'wenflow';
    this.clientVersion = options.clientVersion || '1.0.0';
    this.protocolVersion = options.protocolVersion || DEFAULT_MCP_PROTOCOL_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    this.privateNetworkPolicy = options.privateNetworkPolicy || 'public-only';
    this.signal = options.signal;
  }

  get session(): string | undefined {
    return this.sessionId;
  }

  get server(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  get protocol(): string | undefined {
    return this.negotiatedProtocolVersion;
  }

  /** initialize 握手 + 发送 initialized 通知。之后才可 listTools / callTool。 */
  async initialize(): Promise<{ protocolVersion?: string; serverInfo?: McpServerInfo }> {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: this.clientName, version: this.clientVersion },
      },
    });
    const result = this.expectResult(response);
    const session = readHeader(response.headers, 'mcp-session-id');
    if (session) this.sessionId = session;
    this.negotiatedProtocolVersion = asOptionalString(result.protocolVersion) || this.protocolVersion;
    this.serverInfo = toServerInfo(result.serverInfo);

    // 握手完成后必须发 initialized 通知（无 id、无响应）
    await this.notify('notifications/initialized');
    return { protocolVersion: this.negotiatedProtocolVersion, serverInfo: this.serverInfo };
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
      params: {},
    });
    const result = this.expectResult(response);
    const tools = result.tools;
    return Array.isArray(tools) ? (tools as McpToolDescriptor[]) : [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    if (!name || !name.trim()) {
      throw new McpClientError('MCP_TOOL_NAME_REQUIRED', 'MCP 工具名不能为空');
    }
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const result = this.expectResult(response);
    const content = result.content;
    return {
      isError: result.isError === true,
      content: Array.isArray(content) ? (content as McpContentBlock[]) : [],
      structuredContent: result.structuredContent,
      raw: result,
    };
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    try {
      await this.post({ jsonrpc: '2.0', method, params });
    } catch (error) {
      // 通知失败不阻断后续调用（部分 server 对通知返回空体/不同状态码）
      if (error instanceof McpClientError && error.code === 'MCP_TRANSPORT_ERROR') throw error;
    }
  }

  private async post(payload: JsonRpcRequest): Promise<RawHttpResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.negotiatedProtocolVersion || this.protocolVersion,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    let response: { status: number; headers: Record<string, string>; data: unknown };
    try {
      response = await safeHttpRequest<unknown>(this.endpoint, {
        method: 'POST',
        headers,
        body: payload,
        responseType: 'text',
        timeoutMs: this.timeoutMs,
        privateNetworkPolicy: this.privateNetworkPolicy,
        signal: this.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = (error as { name?: string })?.name || '';
      if (name === 'UnsafeUrlError') {
        throw new McpClientError('MCP_ENDPOINT_FORBIDDEN', `MCP 地址不允许访问：${message}`);
      }
      throw new McpClientError('MCP_TRANSPORT_ERROR', `MCP 传输失败：${message}`);
    }

    const raw = response.data;
    return {
      status: response.status,
      headers: response.headers || {},
      body: typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''),
      contentType: readHeader(response.headers || {}, 'content-type'),
    };
  }

  private expectResult(response: RawHttpResult): Record<string, unknown> {
    if (response.status === 401 || response.status === 403) {
      throw new McpClientError('MCP_UNAUTHORIZED', `MCP 鉴权失败（HTTP ${response.status}）`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new McpClientError('MCP_UPSTREAM_HTTP_ERROR', `MCP 上游返回 HTTP ${response.status}`);
    }

    const messages = parseMessages(response.body, response.contentType);
    if (!messages.length) {
      throw new McpClientError('MCP_EMPTY_RESPONSE', 'MCP 服务端返回空响应或无法解析');
    }
    // 取带 result/error 的响应（通知无 id，可能夹杂）
    const message = messages.find((m) => m && (m.result !== undefined || m.error !== undefined)) || messages[messages.length - 1];
    if (message?.error) {
      throw new McpClientError(
        'MCP_JSONRPC_ERROR',
        `MCP 错误 ${message.error.code}: ${message.error.message}`
      );
    }
    const result = message?.result;
    return result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  }
}
