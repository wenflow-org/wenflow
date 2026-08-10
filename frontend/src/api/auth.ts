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

interface AuthPayloadEnvelope {
  data?: unknown;
  success?: unknown;
}

const unwrapAuthPayload = <T>(response: unknown): T => {
  const payload = (response as AuthPayloadEnvelope | null | undefined)?.data ?? response;
  const envelope = payload as AuthPayloadEnvelope | null | undefined;
  if (envelope?.data !== undefined && envelope?.success !== undefined) {
    return envelope.data as T;
  }
  return payload as T;
};

export const authAPI = {
  // 登录
  async login(data: LoginData): Promise<AuthResponse> {
    const response = await api.post('/auth/login', data);
    return unwrapAuthPayload<AuthResponse>(response);
  },

  // 注册
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await api.post('/auth/register', data);
    return unwrapAuthPayload<AuthResponse>(response);
  },

  // 注册状态
  async getRegistrationStatus(): Promise<{
    registrationEnabled: boolean;
    configuredRegistrationEnabled?: boolean;
    temporaryUnavailable?: boolean;
  }> {
    const response = await api.get('/auth/registration-status');
    return unwrapAuthPayload<{
      registrationEnabled: boolean;
      configuredRegistrationEnabled?: boolean;
      temporaryUnavailable?: boolean;
    }>(response) || { registrationEnabled: false, temporaryUnavailable: true };
  },

  // 验证 token
  async verifyToken(token: string): Promise<unknown> {
    const response = await api.post('/auth/verify', { token });
    return unwrapAuthPayload<unknown>(response);
  }
};
