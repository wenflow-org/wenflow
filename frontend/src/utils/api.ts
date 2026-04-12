// Axios API 客户端
import axios from 'axios';

// 使用 Vite 代理，通过 /api 前缀转发到后端
// 开发环境下使用代理，生产环境可以使用环境变量
const isDev = import.meta.env.DEV;
const API_BASE_URL = isDev ? '/api' : (import.meta.env.VITE_API_URL || '/api');

// 存储 pending 请求的 Map
const pendingRequests = new Map<string, AbortController>();

// 生成请求唯一标识
const generateRequestKey = (config: any): string => {
  const { method, url, params, data } = config;
  return `${method?.toUpperCase() || 'GET'}_${url}_${JSON.stringify(params || {})}_${JSON.stringify(data || {})}`;
};

// 创建 axios 实例
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 增加到 5 分钟，适应 DeepSeek Think 模型
  headers: {
    'Content-Type': 'application/json; charset=utf-8'
  }
});

// 请求拦截器 - 自动添加token和取消控制器
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 为每个请求创建 AbortController
    const controller = new AbortController();
    config.signal = controller.signal;

    // 存储控制器
    const requestKey = generateRequestKey(config);
    pendingRequests.set(requestKey, controller);

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
    const requestKey = generateRequestKey(response.config);
    pendingRequests.delete(requestKey);

    return response.data;
  },
  (error) => {
    // 清理失败的请求
    if (error.config) {
      const requestKey = generateRequestKey(error.config);
      pendingRequests.delete(requestKey);
    }

    // 如果是取消错误，直接返回
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      return Promise.reject({ message: '请求已取消', cancelled: true });
    }

    if (error.response) {
      const { status, data } = error.response;

      // 401 未授权 - 跳转登录
      if (status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }

      // 返回错误信息
      return Promise.reject({
        message: data.error?.message || '请求失败',
        status,
        details: data.error?.details
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
  const controller = pendingRequests.get(requestKey);
  if (controller) {
    controller.abort();
    pendingRequests.delete(requestKey);
    return true;
  }
  return false;
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

