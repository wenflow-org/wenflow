// Axios API 客户端
import axios from 'axios';
import { getProjectionToken } from './projection';
import { setAuthFlashMessage } from './authFlash';
import { clearUserLocalState } from './sessionCleanup';

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

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 统一错误处理和清理
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 如果是取消错误，直接返回
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      return Promise.reject({ message: '请求已取消', cancelled: true });
    }

    if (error.response) {
      const { status, data } = error.response;
      const url = typeof error.config?.url === 'string' ? error.config.url : '';

      // 401 未授权 - 跳转登录（认证类端点自身 401 为凭证错误，不触发会话失效跳转）
      if (status === 401
        && !AUTH_ENDPOINT_PATTERN.test(url)
        && (hasUserSession() || getProjectionToken())) {
        void redirectToLoginOnce();
      }

      // 返回错误信息，保留完整 response 以便上层读取 422 恢复信封等结构化数据。
      // 兼容后端两种错误形态：{ error: { message } } 与 { error: "字符串" }（约 209 处历史端点）
      const errBody = data?.error;
      const errMessage = typeof errBody === 'string'
        ? errBody
        : errBody?.message || data?.message || '请求失败';
      return Promise.reject({
        message: errMessage,
        status,
        details: typeof errBody === 'object' ? errBody?.details : undefined,
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

export default api;

