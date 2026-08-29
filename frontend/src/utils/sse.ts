// SSE 流式客户端：与 axios 拦截器对齐认证（Bearer / X-Projection-Token / credentials）
import { API_BASE_URL } from './api';
import { getProjectionToken } from './projection';
import { setAuthFlashMessage } from './authFlash';
import { clearUserLocalState } from './sessionCleanup';

export interface StreamSseHandlers {
  /** 每个 SSE 事件回调（event 为 'delta' | 'final' | 'done' | 'error' | 'restart' 等） */
  onEvent: (event: string, data: any) => void;
  signal?: AbortSignal;
  /** 空闲超时（ms）：超过该时长未收到任何字节（含注释心跳行）即中止并报错，防服务器挂起导致 typing 永久卡死；默认 60000 */
  idleTimeoutMs?: number;
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
  const idleTimeoutMs = handlers.idleTimeoutMs ?? 60_000;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'text/event-stream'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (projectionToken) headers['X-Projection-Token'] = projectionToken;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: handlers.signal
    });
  } catch (error) {
    // 调用方主动 abort（离页/卸载止损）：单独标记 cancelled，避免被误判为传输层失败而重发
    if (isAbort(error, handlers.signal)) throw markCancelled(error);
    throw error;
  }

  if (!response.ok) {
    // 401：与 axios 拦截器行为对齐（清会话 + 跳登录），避免 SSE 路径静默保留过期会话
    if (response.status === 401) {
      clearUserLocalState();
      setAuthFlashMessage('登录状态已失效，请重新登录');
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
      throw new Error('登录状态已失效，请重新登录');
    }
    let message = '请求失败';
    let code: string | undefined;
    const status = response.status;
    try {
      const data = await response.json();
      message = data?.error?.message || message;
      // 保留后端错误码（如 TEACHING_SESSION_STALE）：调用方据此做 stale 重同步，
      // 只传 message 会导致恢复机制失效、重试带旧 revision 进入死循环
      code = typeof data?.error?.code === 'string' ? data.error.code : undefined;
    } catch {
      // 忽略非 JSON 错误体
    }
    const error = new Error(message);
    return Promise.reject(Object.assign(error, { code, status, serverError: true }));
  }

  if (!response.body) {
    throw new Error('当前环境不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingEvent = 'message';
  let pendingData: string[] = [];
  /** 空闲超时：任何字节到达都会重置计时（含心跳注释行），超时即中止，防止服务器挂起时调用方状态机（typing 等）永久卡死 */
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimedOut = false;

  const kickIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  kickIdleTimer();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  handlers.signal?.addEventListener('abort', onAbort, { once: true });
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    handlers.signal?.removeEventListener('abort', onAbort);
  };

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
  try {
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      // 收到任何字节即重置空闲计时
      kickIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
      }
    }
  } catch (error) {
    if (idleTimedOut) {
      throw Object.assign(new Error('连接空闲超时，请重试'), { transport: true });
    }
    if (isAbort(error, handlers.signal)) throw markCancelled(error);
    throw error;
  } finally {
    cleanup();
  }
  if (buffer) processLine(buffer.replace(/\r$/, ''));
  if (pendingData.length) dispatch(pendingEvent, pendingData.join('\n'));
  cleanup();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as { name?: string })?.name === 'AbortError' || signal?.aborted === true;
}

function markCancelled(error: unknown): unknown {
  const e = error instanceof Error ? error : new Error('请求已取消');
  return Object.assign(e, { cancelled: true });
}
