import axios from 'axios';
import { toast } from './toast';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json; charset=utf-8'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      const status = error.response.status;

      switch (status) {
        case 401:
          toast.error('未授权，请重新登录');
          localStorage.removeItem('token');
          window.location.href = '/login';
          break;
        case 403:
          toast.error('权限不足');
          break;
        case 404:
          toast.error('资源不存在');
          break;
        case 429:
          toast.error('请求过于频繁，请稍后重试');
          break;
        case 500:
          toast.error('服务器错误');
          break;
        default:
          toast.error(error.response.data?.error?.message || '请求失败');
      }
    } else if (error.request) {
      toast.error('网络连接异常，请检查后重试');
    } else {
      toast.error('请求配置错误');
    }

    return Promise.reject(error);
  }
);

export default api;
