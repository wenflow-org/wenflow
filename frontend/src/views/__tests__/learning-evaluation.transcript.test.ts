/**
 * LearningEvaluationPage（当堂对话折叠）回归测试：
 * 长会话的讲解消息在移动端占好几屏，默认只回看最近两条；展开/收起可切换，
 * 且导出图片/打印前会临时全展开（导出的报告不能缺内容）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() })
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: { getSessionDetail: getSessionDetailMock }
}));

vi.mock('@/utils/api', () => ({
  default: { post: vi.fn(async () => ({ data: {} })) }
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/utils/projection', () => ({
  isProjectionMode: vi.fn(() => false)
}));

vi.mock('@/components/CompletionCard.vue', () => ({ default: { template: '<div class="stub-completion" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));

const html2canvasMock = vi.hoisted(() => vi.fn());
vi.mock('html2canvas-pro', () => ({ default: html2canvasMock }));

const messages = [
  { role: 'assistant', content: '第一条讲解', timestamp: '2026-09-23T02:51:00.000Z' },
  { role: 'user', content: '我准备好了', timestamp: '2026-09-23T02:55:00.000Z' },
  { role: 'assistant', content: '第二条讲解', timestamp: '2026-09-23T02:56:00.000Z' },
  { role: 'user', content: '这是我的判断', timestamp: '2026-09-23T03:00:00.000Z' },
  { role: 'assistant', content: '第三条讲解', timestamp: '2026-09-23T03:01:00.000Z' }
];

const detail = {
  status: 'completed',
  topic: '拆解一页乱版汇报稿的对齐关系',
  duration: 12,
  knowledgePoints: [],
  messages,
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' }
  }
};

async function mountReady() {
  const w = mount(LearningEvaluationPage);
  await flushPromises();
  return w;
}

describe('LearningEvaluationPage 当堂对话折叠', () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
    getSessionDetailMock.mockResolvedValue(detail);
  });

  it('默认只渲染最近两条消息，并给出展开入口', async () => {
    const w = await mountReady();
    const items = w.findAll('.evaluation-transcript-item');
    expect(items.length).toBe(2);
    // 折叠态保留的是最新的两条（第 4、5 条）
    expect(items[0].text()).toContain('这是我的判断');
    expect(items[1].text()).toContain('第三条讲解');

    const toggle = w.find('.evaluation-transcript-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain('展开更早的 3 条消息');
    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('点击后在展开/收起之间切换，消息条数随之变化', async () => {
    const w = await mountReady();
    const toggle = w.find('.evaluation-transcript-toggle');

    await toggle.trigger('click');
    expect(w.findAll('.evaluation-transcript-item').length).toBe(5);
    expect(w.find('.evaluation-transcript-toggle').text()).toContain('收起对话');
    expect(w.find('.evaluation-transcript-toggle').attributes('aria-expanded')).toBe('true');

    await w.find('.evaluation-transcript-toggle').trigger('click');
    expect(w.findAll('.evaluation-transcript-item').length).toBe(2);
    expect(w.find('.evaluation-transcript-toggle').text()).toContain('展开更早的 3 条消息');
  });

  it('消息不超过预览条数时不出现折叠开关', async () => {
    getSessionDetailMock.mockResolvedValue({ ...detail, messages: messages.slice(0, 2) });
    const w = await mountReady();
    expect(w.findAll('.evaluation-transcript-item').length).toBe(2);
    expect(w.find('.evaluation-transcript-toggle').exists()).toBe(false);
  });

  it('导出图片前临时展开全部消息，导出结束后恢复折叠态', async () => {
    const w = await mountReady();
    // jsdom 不能真下载 data: URL，替换掉锚点点击以免刷出 navigation 未实现的噪声
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let itemsAtExport = -1;
    html2canvasMock.mockImplementation(async () => {
      itemsAtExport = w.findAll('.evaluation-transcript-item').length;
      return { toDataURL: () => 'data:image/png;base64,AAAA' };
    });

    await w.find('.evaluation-head__actions .btn-ghost').trigger('click');
    await flushPromises();
    anchorClick.mockRestore();

    expect(itemsAtExport).toBe(5);
    expect(w.findAll('.evaluation-transcript-item').length).toBe(2);
  });
});
