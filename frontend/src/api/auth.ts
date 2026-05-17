// 认证API
import api from '../utils/api';

export interface LoginData {
  name: string;
  password: string;
}

export interface RegisterData {
  name: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    name: string;
  };
  token: string;
}

const unwrapAuthPayload = <T>(response: any): T => {
  const payload = response?.data ?? response;
  if (payload?.data !== undefined && payload?.success !== undefined) {
    return payload.data as T;
  }
  return payload as T;
};

export const authAPI = {

  // 鐧诲綍

  async login(data: LoginData): Promise<AuthResponse> {

    const response = await api.post('/auth/login', data);

    return unwrapAuthPayload<AuthResponse>(response);

  },



  // 娉ㄥ唽

  async register(data: RegisterData): Promise<AuthResponse> {

    const response = await api.post('/auth/register', data);

    return unwrapAuthPayload<AuthResponse>(response);

  },

  // 娉ㄥ唽鐘舵€?
  async getRegistrationStatus(): Promise<{ registrationEnabled: boolean }> {
    const response: any = await api.get('/auth/registration-status');
    return unwrapAuthPayload<{ registrationEnabled: boolean }>(response) || { registrationEnabled: true };
  },



  // 楠岃瘉 token

  async verifyToken(token: string): Promise<any> {

    const response = await api.post('/auth/verify', { token });

    return unwrapAuthPayload<any>(response);

  }

};
