// 对话式学习 API
import api from '../utils/api';
import type {
  DialogueLearningSession,
  SubmitResponseResult,
  ContentAgentOutput
} from '@/types/learning';

export const dialogueAPI = {
  /**
   * 开始对话式学习任务
   * @param taskId 任务 ID
   * @returns 对话学习会话信息
   */
  async startDialogueTask(taskId: string): Promise<DialogueLearningSession> {
    const response = await api.post('/learning/dialogue/start', {
      taskId
    });
    return response.data || response;
  },

  /**
   * 提交学生回答
   * @param sessionId 会话 ID
   * @param response 学生回答
   * @returns AI 反馈和下一轮内容
   */
  async submitResponse(
    sessionId: string,
    response: string
  ): Promise<SubmitResponseResult> {
    const result = await api.post('/learning/dialogue/submit', {
      sessionId,
      response
    });
    return result.data || result;
  },

  /**
   * 获取提示
   * @param sessionId 会话 ID
   * @returns 提示信息
   */
  async getHint(sessionId: string): Promise<string> {
    const result = await api.post('/learning/dialogue/hint', {
      sessionId
    });
    return result.data?.hint || result.hint || '';
  },

  /**
   * 跳过当前任务
   * @param sessionId 会话 ID
   * @returns 完成状态
   */
  async skipTask(sessionId: string): Promise<{ success: boolean }> {
    const result = await api.post('/learning/dialogue/skip', {
      sessionId
    });
    return result.data || result;
  },

  /**
   * 获取对话状态
   * @param sessionId 会话 ID
   * @returns 当前对话状态
   */
  async getDialogueState(sessionId: string): Promise<{
    roundNumber: number;
    totalRounds?: number;
    conversationHistory: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }>;
    studentState: any;
  }> {
    const result = await api.get(`/learning/dialogue/state/${sessionId}`);
    return result.data || result;
  }
};

export default dialogueAPI;
