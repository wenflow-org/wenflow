/**
 * 课堂页 2026-11-11 实机走查（1280 浅色，真实账号）：
 *  ① 首屏只有一条开场白，中间 ~450px 全空——用真实知识点补「本节要掌握」并居中；
 *  ② 服务端快选被截成同一前缀（「先讲「同一星期几同…」」「拿「…」试一小步」），
 *     显示层必须能区分讲解与练习，发送仍用原文；
 *  ③ 标题副行补「第 N / M 节」，数据取自任务详情自带 subtasks，不新增请求。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  requestGet: vi.fn(),
  startSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getLatestTaskEvaluation: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  default: { get: api.requestGet, post: vi.fn() },
  API_BASE_URL: '/api',
}));

vi.mock('@/api/aiTeaching', () => ({
  createTeachingIdempotencyKey: (scope: string) => `${scope}:test-key`,
  aiTeachingAPI: {
    startSession: api.startSession,
    startReviewSession: vi.fn(),
    getSessionDetail: api.getSessionDetail,
    getLatestTaskEvaluation: api.getLatestTaskEvaluation,
    streamSendMessage: vi.fn(),
    sendMessage: vi.fn(),
    streamContinueSession: vi.fn(),
    streamSubmitCheckpoint: vi.fn(),
    submitCheckpoint: vi.fn(),
    finalizeSessionReliably: vi.fn(),
    pauseSession: vi.fn().mockResolvedValue(1),
    resumeSession: vi.fn(),
    resetSession: vi.fn(),
    streamSendPeerMessage: vi.fn(),
    sendPeerMessage: vi.fn(),
  },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 'task_2' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import V2LearningPage from '../V2LearningPage.vue';

const LABEL_A = '先讲「同一星期几同…」';
const LABEL_B = '拿「同一星期几同…」试一小步';

describe('课堂首屏：目标卡、快选标签与课次进度', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.requestGet.mockResolvedValue({
      title: '看懂后台导出的每小时客流记录长什么样',
      pathTitle: '奶茶店店长用客流排下周班',
      learningPathId: 'lp_1',
      milestones: {
        subtasks: [
          { id: 'task_1', order: 1 },
          { id: 'task_2', order: 2 },
          { id: 'task_3', order: 3 },
          { id: 'task_4', order: 4 },
        ],
      },
    });
    api.getLatestTaskEvaluation.mockResolvedValue({});
    api.startSession.mockResolvedValue({
      sessionId: 's_intro',
      revision: 1,
      mode: 'new',
      opening: {
        message: '这节课先把你后台导出的那份每小时客流表看明白。',
        question: '同样是客流数字，为什么不能直接拿来比大小？',
        quickReplies: [{ text: LABEL_A }, { text: LABEL_B }, { text: '跳过自评，直接练' }],
      },
      knowledgePoints: [{ id: 'k1', name: '同一星期几的时段可比', status: 'learning', progress: 0 }],
    });
  });

  it('只有开场白时显示「本节要掌握」并居中；快选标签可区分', async () => {
    const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
    await flushPromises();
    await flushPromises();

    expect(w.find('.tutor__intro').exists()).toBe(true);
    expect(w.find('.tutor__intro').text()).toContain('同一星期几的时段可比');
    expect(w.find('.tutor__scroll').classes()).toContain('tutor__scroll--intro');

    const labels = w.findAll('.replies .reply__text').map((n) => n.text());
    expect(labels).toContain('先讲这一条');
    expect(labels).toContain('拿它练一小步');
    expect(new Set(labels).size).toBe(labels.length);
    const buttons = w.findAll('.replies .reply');
    expect(buttons[0].attributes('title')).toBe(LABEL_A);
    expect(buttons[1].attributes('title')).toBe(LABEL_B);
    w.unmount();
  });

  it('标题副行按任务详情给出「第 2 / 4 节」，不新增接口', async () => {
    const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
    await flushPromises();
    await flushPromises();
    expect(w.find('.learn__title small').text()).toContain('第 2 / 4 节');
    // 任务详情只拉一次，进度没有额外请求
    expect(api.requestGet.mock.calls.filter(([url]) => String(url).includes('/learning/tasks/'))).toHaveLength(1);
    w.unmount();
  });
});
