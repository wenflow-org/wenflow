// 统一 Axios 客户端工厂（审计 #7「API 双实例」整改：实例创建与响应拦截器单实现，语义差异经画像注入）
// 画像差异仅三类：成功解包形态（user=response.data / admin=原样）、请求头注入（user 注 Token）、
// 401 策略（user 静默刷新重试 / admin 受保护路径守卫重定向）。
// 其余（取消归一化、错误信封归一化、网络错误文案）为两实例共享的单套实现——后续改进自动双向生效。
import axios, { type AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

const isDev = import.meta.env.DEV;

// 统一使用 VITE_API_BASE_URL（VITE_API_URL 为历史遗留别名，保留兼容）。
// dev 固定 '/api' 走代理，prod 读环境变量。
export function resolveApiBaseUrl(): string {
  return isDev
    ? '/api'
    : (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '/api');
}

export interface ApiClientProfile {
  /** 普通请求超时；AI/LLM 类在调用点用 { timeout: AI_REQUEST_TIMEOUT } 覆盖 */
  timeout: number;
  /** 成功响应解包：user 侧历史契约返回 response.data；admin 侧原样 AxiosResponse（~150 方法消费形态不动） */
  unwrapResponse?: boolean;
  /** 请求头注入（user 侧：Bearer/投影 Token；admin 侧无——会话走 HttpOnly Cookie） */
  injectHeaders?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
  /** 401 端点豁免：凭证错误不应触发会话失效流程（user：登录/注册/验证；admin：登出） */
  isAuthEndpoint?: (url: string) => boolean;
  /**
   * 401 处理：返回重试成功的 response 则以它继续；返回 void 落到统一错误归一化拒绝。
   * user 侧：静默刷新（mutex 防并发）+ 原请求重试，失败跳登录；admin 侧：受保护路径守卫重定向。
   */
  handleUnauthorized?: (error: AxiosError) => Promise<AxiosResponse | void>;
}

export function createApiClient(profile: ApiClientProfile): AxiosInstance {
  const client = axios.create({
    baseURL: resolveApiBaseUrl(),
    timeout: profile.timeout,
    withCredentials: true,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  client.interceptors.request.use(
    (config) => (profile.injectHeaders ? profile.injectHeaders(config) : config),
    (error) => Promise.reject(error),
  );

  client.interceptors.response.use(
    (response) => (profile.unwrapResponse ? response.data : response),
    async (error: AxiosError) => {
      // 取消（离页中止 / 用户停止生成）：归一化为可判定的 cancelled 标记
      if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
        return Promise.reject({ message: '请求已取消', cancelled: true });
      }

      if (error.response) {
        const { status, data } = error.response;
        const url = typeof error.config?.url === 'string' ? error.config.url : '';

        // 401：非凭证错误端点且未重试过 → 交给画像策略（静默刷新重试 / 守卫重定向）
        if (
          status === 401
          && !(error.config as { _retry?: boolean } | undefined)?._retry
          && !(profile.isAuthEndpoint?.(url) ?? false)
        ) {
          const retried = profile.handleUnauthorized ? await profile.handleUnauthorized(error) : undefined;
          if (retried) return retried;
        }

        // 返回错误信息，保留完整 response 以便上层读取 422 恢复信封等结构化数据。
        // 兼容后端两种错误形态：{ error: { message } } 与 { error: "字符串" }（约 209 处历史端点）
        const errBody = (data as { error?: { message?: string; details?: unknown } | string } | null)?.error;
        const errMessage = typeof errBody === 'string'
          ? errBody
          : errBody?.message || (data as { message?: string } | null)?.message || '请求失败';
        return Promise.reject({
          message: errMessage,
          status,
          details: typeof errBody === 'object' ? errBody?.details : undefined,
          response: error.response,
        });
      }

      // 网络错误
      if (error.code === 'ECONNABORTED') {
        return Promise.reject({ message: '请求超时，请稍后重试' });
      }
      return Promise.reject({ message: '网络错误，请检查连接' });
    },
  );

  return client;
}
