// 璁よ瘉API
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

export const authAPI = {

  // 鐧诲綍

  async login(data: LoginData): Promise<AuthResponse> {

    const response = await api.post('/auth/login', data);

    return response.data;

  },



  // 娉ㄥ唽

  async register(data: RegisterData): Promise<AuthResponse> {

    const response = await api.post('/auth/register', data);

    return response.data;

  },

  // 娉ㄥ唽鐘舵€?
  async getRegistrationStatus(): Promise<{ registrationEnabled: boolean }> {
    const response: any = await api.get('/auth/registration-status');
    return response?.data || { registrationEnabled: true };
  },



  // 楠岃瘉 token

  async verifyToken(token: string): Promise<any> {

    const response = await api.post('/auth/verify', { token });

    return response.data;

  }

};
