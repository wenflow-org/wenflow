/**
 * OpsContent「学习路径」筛选 ↔ URL（2026-10-13 运营走查 O2）。
 *
 * 实测缺陷：点状态分布条「生成失败1」筛到 1 条，URL 仍是裸 /admin/learning-paths。
 * 原设计是「只读 URL 不回写」（写入权在发起方 OpsHub），代价是**手动筛选刷新 / 分享全丢**；
 * 改为双向同步后：外部深链（?status=failed）照旧可进，页内筛选也能出去。
 * 行内下钻的列表态还原不再依赖模块级快照（URL 是唯一载体）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import OpsContent from '../OpsContent.vue';
import { intent } from '../store';

const mkPath = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `路径${id}`,
  subject: '学习目标',
  status: 'active',
  difficulty: 'beginner',
  estimatedHours: 6,
  totalMilestones: 4,
  completedMilestones: 1,
  aiGenerated: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  deadline: null,
  user: { id: 'u1', name: '张三', email: 'zs@wenflow.local', isVirtualLearner: false },
  milestoneStatuses: ['completed', 'in_progress', 'todo', 'todo'],
  milestoneCount: 4,
  ...over
});

const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    listPaths: listMock,
    getStats: statsMock,
    getPathDetail: vi.fn(async () => ({ data: { data: { title: 'x', subject: 's', milestones: [] } } })),
    archivePath: vi.fn(async () => ({ data: {} })),
    restorePath: vi.fn(async () => ({ data: {} })),
    deletePath: vi.fn(async () => ({ data: {} })),
    retryGeneration: vi.fn(async () => ({ data: { success: true, data: {} } }))
  },
  adminTeachingSessionsApi: { list: vi.fn(async () => ({ data: {} })) },
  adminGoalConversationsApi: { list: vi.fn(async () => ({ data: {} })), getStats: vi.fn(async () => ({ data: {} })) },
  adminAnnouncementsApi: { list: vi.fn(async () => ({ data: {} })) },
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  adminHealthCenterApi: { get: vi.fn(async () => ({ data: {} })) }
}));

async function mountPaths(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div />' } }] });
  await router.push(url);
  await router.isReady();
  const wrapper = mount(OpsContent, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  return { wrapper, router };
}

function bandSeg(wrapper: ReturnType<typeof mount>, label: string) {
  const b = wrapper.findAll('button').find((x) => x.text().includes(label) && x.classes().some((c) => c.includes('band') || c.includes('seg')));
  return b || wrapper.findAll('button').find((x) => x.text().includes(label));
}

beforeEach(() => {
  listMock.mockReset();
  statsMock.mockReset();
  listMock.mockResolvedValue({
    data: {
      data: {
        paths: [mkPath('p1'), mkPath('p2', { status: 'failed' })],
        pagination: { total: 2, page: 1, limit: 100 }
      }
    }
  });
  statsMock.mockResolvedValue({ data: { data: { byStatus: { active: 1, completed: 0, failed: 1, archived: 0 } } } });
  intent.statusFilter = '';
});

describe('OpsContent · 筛选 ↔ URL', () => {
  it('深链 ?status=failed 落位（OpsHub 待办卡既有入口不破）', async () => {
    const { wrapper } = await mountPaths('/admin/learning-paths?status=failed');
    await flushPromises();
    // 行为断言优先于样式类名：筛选真的生效 = 只剩失败那条
    const text = wrapper.text();
    expect(text).toContain('路径p2');
    expect(text).not.toContain('路径p1');
    wrapper.unmount();
  });

  it('点分布条分段 → URL 写上 status（可分享 / 可刷新）', async () => {
    const { wrapper, router } = await mountPaths('/admin/learning-paths');
    await flushPromises();
    const seg = bandSeg(wrapper, '生成失败');
    expect(seg).toBeTruthy();
    await seg!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.status).toBe('failed');
    wrapper.unmount();
  });

  it('再点同一分段 = 取消筛选 → URL 删键', async () => {
    const { wrapper, router } = await mountPaths('/admin/learning-paths?status=failed');
    await flushPromises();
    const seg = bandSeg(wrapper, '生成失败');
    await seg!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.status).toBeUndefined();
    wrapper.unmount();
  });

  it('搜索词进 URL（q）', async () => {
    const { wrapper, router } = await mountPaths('/admin/learning-paths');
    await flushPromises();
    const input = wrapper.find('input[placeholder*="搜索标题"]');
    expect(input.exists()).toBe(true);
    await input.setValue('路径p2');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('路径p2');
    wrapper.unmount();
  });

  it('工作台 intent 深链（生成失败路径）落到 URL —— 下钻结果可再次分享', async () => {
    intent.statusFilter = 'failed';
    const { router } = await mountPaths('/admin/learning-paths');
    await flushPromises();
    expect(intent.statusFilter).toBe('');
    expect(router.currentRoute.value.query.status).toBe('failed');
  });
});
