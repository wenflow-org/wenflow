/**
 * #64 P-39：路径详情页的任务微调入口（插 / 延 / 缩 / 删）。
 *
 * 只允许进行中的路径与未完成、已解锁的任务；已完成任务必须保持冻结（结算口径）。
 * 每次操作走 `learningAPI.applyStructuralEdit`，成功后静默刷新路径详情。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getPathDetail = vi.hoisted(() => vi.fn());
const applyStructuralEdit = vi.hoisted(() => vi.fn());
const askConfirm = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/api/learning', () => ({
  learningAPI: {
    getPathDetail,
    getPathGenerationStatus: vi.fn(),
    listPathReplanSnapshots: vi.fn(async () => []),
    applyStructuralEdit,
  },
}));
vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: {} }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/views/admin-redesign/useConfirm', () => ({ askConfirm }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'lp_test' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer />' } }));

import V2LearningPathDetail from '../V2LearningPathDetail.vue';

function payload(status = 'active') {
  return {
    id: 'lp_test',
    title: '测试路径',
    name: '测试路径',
    description: '描述',
    status,
    milestones: [
      {
        id: 'm1',
        stageNumber: 1,
        title: '阶段一',
        status: 'active',
        subtasks: [
          { id: 't1', title: '已完成的任务', status: 'completed', estimatedMinutes: 30, order: 0 },
          { id: 't2', title: '待开始的任务', status: 'todo', estimatedMinutes: 40, order: 1 },
        ],
      },
    ],
  };
}

let mounted: ReturnType<typeof mount> | null = null;

async function mountDetail(status = 'active') {
  getPathDetail.mockResolvedValue(payload(status));
  mounted = mount(V2LearningPathDetail, {
    // router 被 mock 掉后 <router-link> 会变成未解析组件并持续打 warning，
    // CI 上会以 EnvironmentTeardownError（console rpc 悬空）把 job 判红。
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return mounted;
}

describe('V2LearningPathDetail 任务微调', () => {
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  beforeEach(() => {
    getPathDetail.mockReset();
    applyStructuralEdit.mockReset();
    applyStructuralEdit.mockResolvedValue({ op: 'extend_task', pathId: 'lp_test', milestoneId: 'm1', tasks: [] });
    askConfirm.mockClear();
  });

  it('只给未完成任务出「微调」，已完成任务没有入口', async () => {
    const w = await mountDetail();
    const rows = w.findAll('.task');
    expect(rows.length).toBe(2);
    expect(rows[0].find('.task__edit').exists()).toBe(false);
    expect(rows[1].find('.task__edit').exists()).toBe(true);
  });

  it('非进行中的路径不出微调入口（已完成路径冻结）', async () => {
    const w = await mountDetail('completed');
    expect(w.findAll('.task__edit').length).toBe(0);
  });

  it('延长 / 缩短走 extend_task / shrink_task，带 10 分钟增量', async () => {
    /* 2026-11-06 重构：啰嗦的「缩短/延长 10 分钟」换成步进器 —— [−10 分] 与 [+10 分] */
    const w = await mountDetail();
    await w.findAll('.task__edit')[0].trigger('click');
    const steps = w.findAll('.task-edit__step');
    expect(steps.length, '步进器应恰好两颗（−10 分 / +10 分）').toBe(2);
    expect(steps[0].attributes('aria-label')).toBe('缩短 10 分钟');
    expect(steps[1].attributes('aria-label')).toBe('延长 10 分钟');

    await steps[1].trigger('click'); // +10 分
    await flushPromises();
    expect(applyStructuralEdit).toHaveBeenCalledWith('lp_test', {
      op: 'extend_task',
      taskId: 't2',
      deltaMinutes: 10,
    });

    applyStructuralEdit.mockClear();
    await w.findAll('.task__edit')[0].trigger('click');
    await w.findAll('.task-edit__step')[0].trigger('click'); // −10 分
    await flushPromises();
    expect(applyStructuralEdit).toHaveBeenCalledWith('lp_test', {
      op: 'shrink_task',
      taskId: 't2',
      deltaMinutes: 10,
    });
  });

  it('插入任务带上阶段与插入位置；删除需确认', async () => {
    const w = await mountDetail();
    await w.findAll('.task__edit')[0].trigger('click');
    const input = w.find('.task-edit__input');
    await input.setValue('补一个练习');
    await w.find('.task-edit__submit').trigger('click'); // 插入
    await flushPromises();
    expect(applyStructuralEdit).toHaveBeenCalledWith('lp_test', {
      op: 'insert_task',
      milestoneId: 'm1',
      afterTaskId: 't2',
      title: '补一个练习',
    });

    applyStructuralEdit.mockClear();
    await w.findAll('.task__edit')[0].trigger('click');
    const dangerButton = w.find('.task-edit__danger');
    await dangerButton.trigger('click');
    await flushPromises();
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(applyStructuralEdit).toHaveBeenCalledWith('lp_test', { op: 'delete_task', taskId: 't2' });
  });
});
