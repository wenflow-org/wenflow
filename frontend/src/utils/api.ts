// Axios API 客户端
import axios, { type AxiosRequestConfig } from 'axios';
import { clearProjectionToken, getProjectionToken, isProjectionMode } from './projection';
import { setAuthFlashMessage } from './authFlash';

const isDev = import.meta.env.DEV;
// 统一使用 VITE_API_BASE_URL（VITE_API_URL 为历史遗留别名，保留兼容）
export const API_BASE_URL = isDev
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '/api');

/**
 * 超时分级：普通请求 60s；AI/LLM 类请求（对话、生成、重规划、连接测试）300s
 * 在调用点通过 { timeout: AI_REQUEST_TIMEOUT } 覆盖
 */
export const AI_REQUEST_TIMEOUT = 300000;

const pendingRequests = new Map<string, AbortController>();
let nextRequestId = 0;
let unauthorizedRedirect: Promise<void> | null = null;

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
      if (isProjectionMode()) {
        clearProjectionToken();
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem(USER_SESSION_KEY);
      setAuthFlashMessage('登录状态已失效，请重新登录');
      // 保留回跳地址，重新登录后可返回原页面
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
    });
  }

  return unauthorizedRedirect;
};

interface RequestKeyCarrier {
  __wenflowRequestKey?: string;
}

const generateRequestKey = (config: AxiosRequestConfig): string => {
  const { method, url, params, data } = config;
  return `${method?.toUpperCase() || 'GET'}_${url}_${JSON.stringify(params || {})}_${JSON.stringify(data || {})}`;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json; charset=utf-8'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    const projectionToken = getProjectionToken();
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (projectionToken) {
      config.headers['X-Projection-Token'] = projectionToken;
    }

    if (!config.signal) {
      const controller = new AbortController();
      config.signal = controller.signal;

      const requestKey = `${generateRequestKey(config)}#${++nextRequestId}`;
      (config as RequestKeyCarrier).__wenflowRequestKey = requestKey;
      pendingRequests.set(requestKey, controller);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 统一错误处理和清理
api.interceptors.response.use(
  (response) => {
    // 清理已完成的请求
    const requestKey = (response.config as RequestKeyCarrier).__wenflowRequestKey;
    if (requestKey) pendingRequests.delete(requestKey);

    return response.data;
  },
  (error) => {
    // 清理失败的请求
    if (error.config) {
      const requestKey = error.config.__wenflowRequestKey;
      if (requestKey) pendingRequests.delete(requestKey);
    }

    // 如果是取消错误，直接返回
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      return Promise.reject({ message: '请求已取消', cancelled: true });
    }

    if (error.response) {
      const { status, data } = error.response;

      // 401 未授权 - 跳转登录
      if (status === 401 && (hasUserSession() || getProjectionToken())) {
        void redirectToLoginOnce();
      }

      // 返回错误信息，保留完整 response 以便上层读取 422 恢复信封等结构化数据
      return Promise.reject({
        message: data?.error?.message || '请求失败',
        status,
        details: data?.error?.details,
        response: error.response
      });
    }

    // 网络错误
    if (error.code === 'ECONNABORTED') {
      return Promise.reject({ message: '请求超时，请稍后重试' });
    }

    return Promise.reject({ message: '网络错误，请检查连接' });
  }
);

/**
 * 取消指定请求
 * @param requestKey 请求标识（method_url_params_data）
 */
export const cancelRequest = (requestKey: string): boolean => {
  let cancelled = false;
  pendingRequests.forEach((controller, key) => {
    if (key === requestKey || key.startsWith(`${requestKey}#`)) {
      controller.abort();
      pendingRequests.delete(key);
      cancelled = true;
    }
  });
  return cancelled;
};

/**
 * 取消所有 pending 的请求
 * @param filter 可选的过滤函数，返回 true 的请求会被取消
 */
export const cancelAllRequests = (filter?: (key: string) => boolean): number => {
  let cancelledCount = 0;
  pendingRequests.forEach((controller, key) => {
    if (!filter || filter(key)) {
      controller.abort();
      pendingRequests.delete(key);
      cancelledCount++;
    }
  });
  return cancelledCount;
};

/**
 * 取消 Agent 相关的请求
 */
export const cancelAgentRequests = (): number => {
  return cancelAllRequests((key) => key.includes('/agents/'));
};

/**
 * 获取当前 pending 请求数量
 */
export const getPendingRequestCount = (): number => {
  return pendingRequests.size;
};

export default api;

