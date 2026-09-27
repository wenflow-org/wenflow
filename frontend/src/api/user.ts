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
  createdAt?: string;
  lastLoginAt?: string | null;
  streakDays?: number;
  longestStreak?: number;
  onboardingCompleted?: boolean;
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
  }
};
