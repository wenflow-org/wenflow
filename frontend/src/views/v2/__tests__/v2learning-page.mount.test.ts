/**
 * V2LearningPage 挂载回归（拆分安全网，先于检查点域外迁补齐）：
 * - 新开课：AI 开场白气泡 + 开场行动台（quickReplies/question 收进面板）+ 知识点面板汇总
 * - 恢复续课：历史双通道回填（主对话气泡 + 伴学浮窗 peer 标记消息）、开场景卡片承接恢复横幅、待处理检查点
 * - 检查点提交：选项校验 → 流式提交（onJudgement 先行上锁）→ 反馈与防重交（3s 自动收起不在此断言）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  requestGet: vi.fn(),
  startSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getLatestTaskEvaluation: vi.fn(),
  streamSubmitCheckpoint: vi.fn(),
  submitCheckpoint: vi.fn(),
  streamSendMessage: vi.fn(),
  finalizeSessionReliably: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  default: { get: api.requestGet, post: vi.fn() },
  API_BASE_URL: '/api',
}));

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: {
    startSession: api.startSession,
    startReviewSession: vi.fn(),
    getSessionDetail: api.getSessionDetail,
    getLatestTaskEvaluation: api.getLatestTaskEvaluation,
    streamSendMessage: api.streamSendMessage,
    sendMessage: vi.fn(),
    streamContinueSession: vi.fn(),
    streamSubmitCheckpoint: api.streamSubmitCheckpoint,
    submitCheckpoint: api.submitCheckpoint,
    finalizeSessionReliably: api.finalizeSessionReliably,
    pauseSession: vi.fn().mockResolvedValue(1),
    resumeSession: vi.fn(),
    resetSession: vi.fn(),
    streamSendPeerMessage: vi.fn(),
    sendPeerMessage: vi.fn(),
  },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 'task_1' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import V2LearningPage from '../V2LearningPage.vue';

const PENDING_CP = {
  id: 'cp_1',
  type: 'single_choice',
  title: '作用域小测',
  question: '下面哪个说法正确？',
  options: [
    { id: 'opt_a', text: '函数内声明的变量只在函数内可见' },
    { id: 'opt_b', text: '全局变量在任何地方都不可见' },
  ],
};

function mockTaskInfo() {
  api.requestGet.mockResolvedValue({
    title: '理解函数作用域',
    pathTitle: 'Python 入门路径',
    learningPathId: 'lp_1',
  });
}

async function mountPage() {
  const w = mount(V2LearningPage, { global: { stubs: { 'router-link': true } } });
  await flushPromises();
  await flushPromises();
  return w;
}

describe('V2LearningPage 挂载回归', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskInfo();
    api.getLatestTaskEvaluation.mockResolvedValue({});
  });

  it('新开课：开场白气泡 + 行动台收进面板 + 知识点面板汇总', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_new',
      revision: 2,
      mode: 'new',
      opening: {
        message: '我们开始学函数作用域吧。',
        question: '你之前写过函数吗？',
        quickReplies: [{ text: '直接开始' }, { text: '先举个例子' }],
      },
      knowledgePoints: [
        { id: 'k1', name: '函数定义', status: 'mastered' },
        { id: 'k2', name: '变量作用域', status: 'learning', progress: 40 },
      ],
    });

    const w = await mountPage();

    // 任务标题与路径名（boot 的 task 信息拉取）
    expect(w.find('.learn__title strong').text()).toContain('理解函数作用域');
    expect(w.find('.learn__title small').text()).toContain('Python 入门路径');

    // 开场白成 AI 气泡；摸底 question 收进面板（不再单独成待答气泡）
    const bubbles = w.findAll('.msg--ai .msg__bubble');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].text()).toContain('我们开始学函数作用域吧');
    expect(w.find('.replies').exists()).toBe(true);
    expect(w.find('.replies__question').text()).toContain('你之前写过函数吗');
    expect(w.findAll('.reply')).toHaveLength(2);
    // 首课（无 scene）行动台标题回落「怎么开始」
    expect(w.find('.replies__kicker').text()).toBe('怎么开始');

    // 知识点面板头部（2026-09-27 收敛）：只保留掌握胶囊，进行中胶囊退役
    expect(w.find('.kp__head').text()).toContain('1/2 已掌握');
    expect(w.find('.kp__head').text()).not.toContain('进行中');
    expect(w.find('.kp__chip--mastered').exists()).toBe(true);
    expect(w.find('.kp__chip--progress').exists()).toBe(false);
    expect(w.find('.kp__list').text()).toContain('已掌握');
    expect(w.find('.kp__list').text()).toContain('学习中 · 40%');

    w.unmount();
  });

  it('恢复续课：主对话与伴学双通道回填，开场景卡片承接，待处理检查点可见', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_resumed',
      revision: 7,
      mode: 'resumed',
      scene: { kind: 'resume', title: '接着上次的作用域' },
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 8,
      messages: [
        { role: 'user', content: '什么是作用域？' },
        { role: 'assistant', content: '作用域是变量的可见范围。', peer: false },
        { role: 'assistant', content: '卡在这里了？我用费曼方式给你讲。', peer: true, peerStrategy: 'feynman' },
      ],
      pendingCheckpoint: PENDING_CP,
    });

    const w = await mountPage();

    // 主对话只回填非 peer 消息（user + assistant 各一条）
    const userMsgs = w.findAll('.msg--user');
    const aiMsgs = w.findAll('.msg--ai');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].text()).toContain('什么是作用域？');
    expect(aiMsgs).toHaveLength(1);
    expect(aiMsgs[0].text()).toContain('可见范围');

    // peer 标记消息进伴学浮窗（未展开 → 悬浮球），开场景卡片承接（恢复横幅让位）
    expect(w.find('.tutor__resume').exists()).toBe(false);
    expect(w.find('.oscene').exists()).toBe(true);
    expect(w.find('.oscene__tag').text()).toBe('继续上课');
    expect(w.find('.peerfab').exists()).toBe(true);

    // 待处理检查点回填可见（标题 + 选项）
    expect(w.find('.checkpoint').exists()).toBe(true);
    expect(w.find('.checkpoint__head strong').text()).toContain('作用域小测');
    expect(w.findAll('.checkpoint__option')).toHaveLength(2);

    w.unmount();
  });

  it('检查点提交：空选拦截 → 流式提交 onJudgement 先行 → 反馈展示与防重交上锁', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_resumed',
      revision: 7,
      mode: 'resumed',
      scene: { kind: 'resume' },
    });
    api.getSessionDetail.mockResolvedValue({
      revision: 8,
      messages: [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }],
      pendingCheckpoint: PENDING_CP,
    });
    api.streamSubmitCheckpoint.mockImplementation(async (_sid, _cpId, _payload, _rev, cbs = { onDelta: undefined, onJudgement: undefined }) => {
      cbs.onJudgement?.({ passed: true, judgedBy: 'exact-match', detail: null });
      cbs.onDelta?.('回答正确。作用域规定了名字的查找范围。');
      return { revision: 9, passed: true, feedback: '回答正确。作用域规定了名字的查找范围。' };
    });

    const w = await mountPage();
    const submit = () => w.find('.checkpoint__actions .btn-primary').trigger('click');

    // 未选选项直接提交：本地拦截，不发请求
    await submit();
    await flushPromises();
    expect(api.streamSubmitCheckpoint).not.toHaveBeenCalled();
    expect(w.find('.checkpoint__feedback').text()).toContain('请先选择一个选项');

    // 选中 opt_a 后提交：流式提交携带选项与 revision
    await w.findAll('.checkpoint__option')[0].find('input').setValue(true);
    await submit();
    await flushPromises();
    expect(api.streamSubmitCheckpoint).toHaveBeenCalledWith(
      's_resumed', 'cp_1', { selectedOptionIds: ['opt_a'] }, 8, expect.anything()
    );

    // 判定反馈展示（答对为 ok 档），提交按钮消失（防重交上锁，只剩「继续」）
    const feedback = w.find('.checkpoint__feedback');
    expect(feedback.classes()).toContain('checkpoint__feedback--ok');
    expect(feedback.text()).toContain('回答正确');
    expect(w.find('.checkpoint__actions .btn-primary').exists()).toBe(false);
    expect(w.find('.checkpoint__actions').text()).toContain('继续');

    w.unmount();
  });

  it('完课门禁：完成回合后输入锁定，收尾追问不再打进已终态化的会话', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_done',
      revision: 2,
      mode: 'new',
      opening: { message: '我们开始吧。', question: '准备好了吗？', quickReplies: [{ text: '开始' }] },
    });
    api.streamSendMessage.mockResolvedValue({
      revision: 3,
      aiResponse: '这节课到这儿就可以了。明天按格式报回来就行。',
      isCompletion: true,
    });
    api.finalizeSessionReliably.mockResolvedValue({ wrapup: { summary: { topicSummary: '收官' }, progress: { newlyMastered: ['k1'] } } });

    const w = await mountPage();
    const before = api.streamSendMessage.mock.calls.length;

    // 发一条触发完成候选的回复
    await w.find('textarea').setValue('我明白了');
    await w.find('[aria-label="发送"]').trigger('click');
    await flushPromises();
    await flushPromises();

    // 完成面板：wrapup 落库、输入区锁死（textarea 原生禁用 + 发送键置灰）
    expect(api.streamSendMessage.mock.calls.length).toBe(before + 1);
    expect(w.find('.finish').exists()).toBe(true);
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
    expect(w.find('[aria-label="发送"]').classes()).toContain('composer__send--off');

    // 教师收尾追问还在屏上，但再点发送/回车都不产生新请求、不重复用户气泡
    const userBubbles = w.findAll('.msg--user').length;
    await w.find('[aria-label="发送"]').trigger('click');
    await w.find('textarea').trigger('keydown.enter');
    await flushPromises();
    expect(api.streamSendMessage.mock.calls.length).toBe(before + 1);
    expect(w.findAll('.msg--user')).toHaveLength(userBubbles);
    expect(w.text()).not.toContain('这次回复失败了');

    w.unmount();
  });

  it('陈旧 revision 重试：用户气泡只推一次（skipUserPush 修复双渲染）', async () => {
    api.startSession.mockResolvedValue({
      sessionId: 's_stale',
      revision: 2,
      mode: 'new',
      opening: { message: '我们开始吧。', question: '准备好了吗？', quickReplies: [{ text: '开始' }] },
    });
    const staleErr = { response: { data: { error: { code: 'TEACHING_SESSION_STALE' } } } };
    api.streamSendMessage
      .mockRejectedValueOnce(staleErr)
      .mockResolvedValue({ revision: 4, aiResponse: '接着说。' });

    const w = await mountPage();

    await w.find('textarea').setValue('第一条');
    await w.find('[aria-label="发送"]').trigger('click');
    await flushPromises();
    await flushPromises();

    // 首轮失败回退重发：同一条用户消息只渲染一个气泡
    expect(w.findAll('.msg--user')).toHaveLength(1);
    expect(w.findAll('.msg--user')[0].text()).toContain('第一条');
    // 重发成功：AI 气泡落定，不再有失败提示
    expect(w.findAll('.msg--ai .msg__bubble').length).toBeGreaterThan(0);
    expect(w.text()).not.toContain('这次回复失败了');

    w.unmount();
  });
});
