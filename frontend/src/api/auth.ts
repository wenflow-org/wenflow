// 认证API
import api from '../utils/api';

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  token: string;
}

export const authAPI = {

  // 登录

  async login(data: LoginData): Promise<AuthResponse> {

    const response = await api.post('/auth/login', data);

    return response.data;

  },



  // 注册

  async register(data: RegisterData): Promise<AuthResponse> {

    const response = await api.post('/auth/register', data);

    return response.data;

  },

  // 注册状态
  async getRegistrationStatus(): Promise<{ registrationEnabled: boolean }> {
    const response: any = await api.get('/auth/registration-status');
    return response?.data || { registrationEnabled: true };
  },



  // 验证 token

  async verifyToken(token: string): Promise<any> {

    const response = await api.post('/auth/verify', { token });

    return response.data;

  }

};
