// SSE 流式客户端：与 axios 拦截器对齐认证（Bearer / X-Projection-Token / credentials）
import { API_BASE_URL, refreshSessionSilently } from './api';
import { getProjectionToken } from './projection';
import { setAuthFlashMessage } from './authFlash';
import { clearUserLocalState } from './sessionCleanup';

/** 登录失效统一话术：横幅提示与抛错信息共用一份（R6 复读单源化） */
const AUTH_EXPIRED_MESSAGE = '登录状态已失效，请重新登录';

export interface StreamSseHandlers {
  /** 每个 SSE 事件回调（event 为 'delta' | 'final' | 'done' | 'error' | 'restart' 等） */
  onEvent: (event: string, data: any) => void;
  signal?: AbortSignal;
  /** 额外请求头（如 Idempotency-Key）；认证头由本函数统一补齐 */
  headers?: Record<string, string>;
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
  const projectionToken = getProjectionToken();
  const idleTimeoutMs = handlers.idleTimeoutMs ?? 60_000;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'text/event-stream',
    ...(handlers.headers || {}),
  };
  if (projectionToken) headers['X-Projection-Token'] = projectionToken;

  // 中止总线：调用方 signal（停止/离页/上层看门狗）与本层空闲超时都汇到同一个 controller，
  // fetch 只认它。旧实现 fetch 挂的是 handlers.signal，而空闲超时 abort 的却是无人监听的
  // controller——60s 空闲看门狗从未真正中止过连接（#111/#113 回归：服务端挂起时流永不收尾，
  // 无上层看门狗的调用方会永久挂起）。
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  handlers.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const send = () => fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  let response: Response;
  try {
    response = await send();
    // access token（30m）过期时，axios 通道会静默 refresh，SSE 通道此前直接踢回登录页——
    // 长课堂/长生成必然遇到（#116）。这里复用同一把刷新互斥锁，成功后重发一次。
    if (response.status === 401) {
      const refreshed = await refreshSessionSilently();
      if (refreshed) response = await send();
    }
  } catch (error) {
    // 调用方主动 abort（离页/卸载止损）：单独标记 cancelled，避免被误判为传输层失败而重发
    if (isAbort(error, handlers.signal)) throw markCancelled(error);
    throw error;
  }

  if (!response.ok) {
    // 401：与 axios 拦截器行为对齐（清会话 + 跳登录），避免 SSE 路径静默保留过期会话
    if (response.status === 401) {
      clearUserLocalState();
      setAuthFlashMessage(AUTH_EXPIRED_MESSAGE);
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
      throw new Error(AUTH_EXPIRED_MESSAGE);
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
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    handlers.signal?.removeEventListener('abort', onOuterAbort);
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
