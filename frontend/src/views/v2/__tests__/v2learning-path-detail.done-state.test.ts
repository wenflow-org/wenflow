/**
 * 路径详情已完成态（2026-11-11 用户侧走查 #5 / #6）
 *
 * ① 「全部任务已完成」原来渲染成 .btn-ghost 的禁用 span——状态被画成控件（原则 5）。
 *    现在是状态说明 + 「查看学习记录 ›」文字链；「调整路径」保留为次按钮。
 * ② 右侧「设计意图」收起时只有标题与箭头，像空卡：补一行实际内容摘要，展开后不复述。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getPathDetail = vi.hoisted(() => vi.fn());
const listPathReplanSnapshots = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@/api/learning', () => ({
  learningAPI: {
    getPathDetail,
    getPathGenerationStatus: vi.fn(),
    listPathReplanSnapshots,
    applyStructuralEdit: vi.fn(),
  },
}));
vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: {} }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'lp_test' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer />' } }));

import V2LearningPathDetail from '../V2LearningPathDetail.vue';

const payload = {
  id: 'lp_test',
  title: '测试路径',
  name: '测试路径',
  description: '描述',
  status: 'completed',
  generationLifecycle: { phase: 'ready' },
  milestones: [
    {
      id: 'm1',
      stageNumber: 1,
      title: '阶段一',
      status: 'active',
      subtasks: [
        { id: 't1', title: '已完成的任务', status: 'completed', estimatedMinutes: 30, order: 0 },
      ],
    },
  ],
  sceneSummary: {
    title: '把客流排班这件事拆开',
    firstDeliverable: '一份下周排班表',
    targetState: '能独立排班',
  },
};

let mounted: ReturnType<typeof mount> | null = null;

async function mountDetail() {
  getPathDetail.mockResolvedValue(payload);
  mounted = mount(V2LearningPathDetail, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return mounted;
}

describe('路径详情 · 已完成态不是禁用按钮（走查 #5）', () => {
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  beforeEach(() => {
    getPathDetail.mockReset();
    listPathReplanSnapshots.mockClear();
  });

  it('状态说明 + 学习记录链，不再有「全部任务已完成」的 btn-ghost', async () => {
    const w = await mountDetail();
    expect(w.find('.hero__done').text()).toContain('全部 1 个任务已完成');
    expect(w.find('.hero__done-link').text()).toContain('查看学习记录');
    expect(w.find('.hero__actions span.btn-ghost').exists()).toBe(false);
    const ghostTexts = w.findAll('.hero__actions .btn-ghost').map((el) => el.text());
    expect(ghostTexts).not.toContain('全部任务已完成');
  });

  it('「调整路径」仍是次按钮（已完成路径上用于续写/重排，不是主行动）', async () => {
    const w = await mountDetail();
    const adjust = w.findAll('.hero__actions .btn-ghost').find((el) => el.text().includes('调整路径'));
    expect(adjust, '调整路径入口被一并删掉了').toBeTruthy();
  });
});

describe('路径详情 · 设计意图收起态给内容摘要（走查 #6）', () => {
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  beforeEach(() => {
    getPathDetail.mockReset();
    listPathReplanSnapshots.mockClear();
  });

  it('收起时显示设计依据字段名，展开后由正文接管、不再复述', async () => {
    const w = await mountDetail();
    const preview = w.find('.sidecard__preview');
    expect(preview.exists(), '收起态又只剩「设计意图 + 箭头」').toBe(true);
    expect(preview.text()).toBe('设计依据：预计产出、目标状态');

    const body = w.find('.sidecard__body');
    expect(body.attributes('style') || '').toContain('display: none');

    await w.find('.sidecard__head').trigger('click');
    expect(w.find('.sidecard__preview').exists()).toBe(false);
    expect(w.find('.sidecard__body').attributes('style') || '').not.toContain('display: none');
  });
});
