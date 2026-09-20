// Axios API 客户端（user 画像：成功解包 response.data + 401 静默刷新重试）
import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { getProjectionToken } from './projection';
import { setAuthFlashMessage } from './authFlash';
import { clearUserLocalState } from './sessionCleanup';
import { createApiClient, resolveApiBaseUrl } from './http';

// baseURL 解析与拦截器实现单点在 utils/http.ts（admin 侧 adminApi.ts 走同一工厂）；
// 此处 re-export 保持既有导入路径（API_BASE_URL / resolveApiBaseUrl）稳定
export { resolveApiBaseUrl };
export const API_BASE_URL = resolveApiBaseUrl();

/**
 * 超时分级：普通请求 60s；AI/LLM 类请求（对话、生成、重规划、连接测试）300s
 * 在调用点通过 { timeout: AI_REQUEST_TIMEOUT } 覆盖
 */
export const AI_REQUEST_TIMEOUT = 300000;

let unauthorizedRedirect: Promise<void> | null = null;

// ---- Token-refresh mutex ----
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const resp = await axios.post('/api/auth/refresh', null, { withCredentials: true });
      return resp.data?.success === true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * 用户会话标记：token 已通过 HttpOnly Cookie 下发，JS 侧只记录"已登录"标记（非敏感）
 * 旧的 localStorage token 为历史遗留，读取处均做兼容
 */
export const USER_SESSION_KEY = 'wenflow_session';

export const hasUserSession = (): boolean =>
  localStorage.getItem(USER_SESSION_KEY) === '1' || !!localStorage.getItem('token');

const redirectToLoginOnce = () => {
  if (!unauthorizedRedirect) {
    unauthorizedRedirect = Promise.resolve().then(() => {
      clearUserLocalState();
      setAuthFlashMessage('登录状态已失效，请重新登录');
      // 保留回跳地址，重新登录后可返回原页面
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
    });
  }

  return unauthorizedRedirect;
};

// 认证类端点自身返回 401 表示"凭证错误"，不应被误判为会话失效
const AUTH_ENDPOINT_PATTERN = /^\/auth\/(login|register|verify)(\?|$)/;

function injectAuthHeaders(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = localStorage.getItem('token');
  const projectionToken = getProjectionToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (projectionToken) {
    config.headers['X-Projection-Token'] = projectionToken;
  }

  return config;
}

/** 401 静默刷新 + 原请求重试；无会话标记或刷新失败 → 跳登录并落到统一归一化拒绝 */
async function handleUnauthorized(error: AxiosError): Promise<AxiosResponse | void> {
  if (!(hasUserSession() || getProjectionToken())) return;
  // 保存原始请求配置用于重试
  const originalConfig = { ...(error.config ?? {}) };
  (originalConfig as { _retry?: boolean })._retry = true;
  const refreshed = await tryRefresh();
  if (refreshed) {
    // 刷新成功，重试原始请求
    return api.request(originalConfig);
  }
  // 刷新失败，跳转登录
  redirectToLoginOnce();
}

const api = createApiClient({
  timeout: 60000,
  unwrapResponse: true,
  injectHeaders: injectAuthHeaders,
  isAuthEndpoint: (url) => AUTH_ENDPOINT_PATTERN.test(url),
  handleUnauthorized,
});

export default api;
