// SSE 流式客户端：与 axios 拦截器对齐认证（Bearer / X-Projection-Token / credentials）
import { API_BASE_URL } from './api';
import { getProjectionToken } from './projection';

export interface StreamSseHandlers {
  /** 每个 SSE 事件回调（event 为 'delta' | 'final' | 'done' | 'error' | 'restart' 等） */
  onEvent: (event: string, data: any) => void;
  signal?: AbortSignal;
}

/**
 * POST 并消费 SSE 响应。
 * 解析 event:/data: 行；data 优先 JSON.parse，失败保留原文。
 * 网络错误/非 2xx 时抛错；流正常结束即 resolve。
 */
export async function streamSsePost(
  url: string,
  payload: Record<string, unknown>,
  handlers: StreamSseHandlers
): Promise<void> {
  const token = localStorage.getItem('token');
  const projectionToken = getProjectionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'text/event-stream'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (projectionToken) headers['X-Projection-Token'] = projectionToken;

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
    signal: handlers.signal
  });

  if (!response.ok) {
    let message = '请求失败';
    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('当前环境不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingEvent = 'message';
  let pendingData: string[] = [];

  const dispatch = (event: string, data: string) => {
    let parsed: any = data;
    try {
      parsed = JSON.parse(data);
    } catch {
      // 保留原始字符串
    }
    handlers.onEvent(event, parsed);
  };

  const processLine = (line: string) => {
    if (line === '') {
      if (pendingData.length) {
        dispatch(pendingEvent, pendingData.join('\n'));
        pendingEvent = 'message';
        pendingData = [];
      }
      return;
    }
    if (line.startsWith(':')) return;
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value = colonIndex === -1 ? '' : line.slice(colonIndex + 1).replace(/^ /, '');
    if (field === 'event') {
      pendingEvent = value || 'message';
    } else if (field === 'data') {
      pendingData.push(value);
    }
  };

  let streamDone = false;
  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
    }
  }
  if (buffer) processLine(buffer.replace(/\r$/, ''));
  if (pendingData.length) dispatch(pendingEvent, pendingData.join('\n'));
}
