// 用户API
import api from '../utils/api';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  skillLevel?: string;
  learningStyle?: string;
  timePerDay?: string;
  learningGoal?: string;
  xp: number;
  level: number;
  xpToNextLevel?: number;
}

export interface UpdateProfileData {
  name?: string;
  avatarUrl?: string;
  skillLevel?: string;
  learningStyle?: string;
  timePerDay?: string;
  learningGoal?: string;
}

export const userAPI = {
  // 获取当前用户信息
  async getProfile(): Promise<UserProfile> {
    const response = await api.get('/users/me');
    return response.data;
  },

  // 更新用户信息
  async updateProfile(data: UpdateProfileData): Promise<UserProfile> {
    const response = await api.put('/users/me', data);
    return response.data;
  },

  // 获取用户成就
  async getAchievements(): Promise<any> {
    const response = await api.get('/users/me/achievements');
    return response.data;
  },

  // 获取学习会话
  async getSessions(limit?: number): Promise<any> {
    const response = await api.get('/users/me/sessions', {
      params: { limit }
    });
    return response.data;
  }
};
