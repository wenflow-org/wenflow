// 用户API
import api from '../utils/api';
import type { ReplanSignalLike } from '@/utils/replanSignal';

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

export interface LearnerCenterProfile {
  narrativeInsights?: {
    contentReceptionPattern?: string;
    practicePreferenceNote?: string;
    supportStyleNote?: string;
  } | null;
  [key: string]: unknown;
}

export interface LearnerCenterKnowledgeMemory {
  currentPath?: {
    learningPathId?: string;
    pathTitle?: string;
    [key: string]: unknown;
  } | null;
  globalBackground?: {
    reusableFoundations?: string[];
    blockedFoundations?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface LearnerCenterSnapshot {
  snapshotVersion: string;
  profile: LearnerCenterProfile | null;
  dynamicState: Record<string, unknown> | null;
  learningControlState: {
    paceMode?: string;
    [key: string]: unknown;
  } | null;
  replanSignal: ReplanSignalLike | null;
  knowledgeMemory: LearnerCenterKnowledgeMemory | null;
  teachingHints: Record<string, unknown> | null;
  freshness: Record<string, unknown> | null;
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
  async getAchievements(): Promise<unknown> {
    const response = await api.get('/users/me/achievements');
    return response.data;
  },

  // 获取学习会话
  async getSessions(limit?: number): Promise<unknown> {
    const response = await api.get('/users/me/sessions', {
      params: { limit }
    });
    return response.data;
  },

  async getLearnerCenter(params?: { pathId?: string; scope?: 'global' | 'path' | 'teaching' }): Promise<LearnerCenterSnapshot> {
    const response = await api.get('/users/me/learner-center', { params });
    return response.data;
  }
};
