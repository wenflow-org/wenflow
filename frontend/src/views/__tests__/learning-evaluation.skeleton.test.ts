/**
 * LearningEvaluationPage（P3-6：评估页加载态骨架）回归测试：
 * 首帧必须渲染可见骨架（evaluation-loading），不允许空白等待。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() })
}));

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();
  return {
    ...actual,
    ElMessageBox: { alert: vi.fn(), confirm: vi.fn() }
  };
});

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
vi.mock('@/components/MarkdownRenderer.vue', () => ({ default: { template: '<div class="stub-md" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));

function mountEval() {
  return mount(LearningEvaluationPage);
}

describe('LearningEvaluationPage 加载骨架（P3-6）', () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
    // 请求挂起：加载态期间骨架必须保持可见
    getSessionDetailMock.mockImplementation(() => new Promise(() => {}));
  });

  it('数据加载中：渲染可见骨架区块（非空白）', () => {
    const w = mountEval();
    const skeleton = w.find('.evaluation-loading');
    expect(skeleton.exists()).toBe(true);
    expect(skeleton.text()).toContain('正在整理本次学习反馈');
    expect(skeleton.findAll('.sk-bar').length).toBeGreaterThan(0);
    expect(skeleton.findAll('.evaluation-loading__summary i').length).toBe(4);
  });

  it('骨架包含导出/返回操作占位按钮形态', () => {
    const w = mountEval();
    expect(w.findAll('.evaluation-loading__head .sk-bar--btn').length).toBe(2);
  });
});
