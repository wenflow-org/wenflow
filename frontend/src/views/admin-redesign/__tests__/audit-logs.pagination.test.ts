/**
 * AuditLogs 传统分页（方案 A）测试：首屏参数 / 翻页整页替换 / 每页条数变更回第 1 页 /
 * tab 切换回第 1 页 / 总数展示
 * （mock '@/api/adminApi'，getAuditLogs 按 page/limit 返回受控分页响应）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import AuditLogs from '../AuditLogs.vue';

const h = vi.hoisted(() => ({
  getLogs: vi.fn(),
  getStats: vi.fn()
}));

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAuditApi: { getAuditLogs: h.getLogs, getAuditStats: h.getStats },
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject()
}));

function auditPage(params: { page?: number; limit?: number; scope?: string }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 30;
  const total = 378;
  const items =
    params.scope === 'login'
      ? [{ id: `login-${page}-1`, scope: 'admin', username: 'admin', ip: `10.0.0.${page}`, success: true, createdAt: '2026-08-13T10:00:00' }]
      : [{ id: `op-${page}-1`, adminName: 'admin', action: 'user.update', targetType: 'user', targetId: `user-op-${page}-1`, method: 'POST', path: '/x', statusCode: 200, success: true, createdAt: '2026-08-13T10:00:00' }];
  return { data: { data: { logs: items, attempts: items, pagination: { total, page, limit } } } };
}

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

async function mountAudit() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/audit-logs');
  await router.isReady();
  const w = mount(AuditLogs, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return w;
}

describe('AuditLogs 传统分页（方案 A）', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    h.getLogs.mockImplementation((params: Record<string, unknown>) => Promise.resolve(auditPage(params)));
    h.getStats.mockResolvedValue({ data: { data: { stats: { total: 378, failed: 7 } } } });
    window.scrollTo = vi.fn();
  });

  it('首屏：page=1 & limit=30 & scope=operation，总数/页码展示', async () => {
    const w = await mountAudit();
    expect(h.getLogs).toHaveBeenCalledTimes(1);
    expect(h.getLogs.mock.calls[0][0]).toMatchObject({ page: 1, limit: 30, scope: 'operation' });
    await nextTick();
    expect(w.text()).toContain('378 条');
    expect(w.text()).toContain('第 1 / 13 页');
  });

  it('翻页：请求 page=2 且列表整体替换为第 2 页内容（无累加）', async () => {
    const w = await mountAudit();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    expect(h.getLogs.mock.calls.at(-1)![0]).toMatchObject({ page: 2 });
    await nextTick();
    expect(w.text()).toContain('第 2 / 13 页');
    expect(w.text()).toContain('user-op-2-1');
    expect(w.text()).not.toContain('user-op-1-1');
  });

  it('每页条数变更：回第 1 页并按新 limit 重查（378/50 → 8 页）', async () => {
    const w = await mountAudit();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    await w.find('.mk-pagination__size').setValue('50');
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ page: 1, limit: 50 });
    await nextTick();
    expect(w.text()).toContain('第 1 / 8 页');
  });

  it('tab 切换（登录审计）：回第 1 页 & scope=login & 列表替换', async () => {
    const w = await mountAudit();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    await w.findAll('.mk-pill').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ page: 1, scope: 'login' });
    await nextTick();
    expect(w.text()).toContain('10.0.0.1');
  });

  it('登录审计时间（P3）：当天记录也带日期（MM-DD HH:MM:SS）', async () => {
    h.getLogs.mockImplementation(async () => ({
      data: {
        data: {
          logs: [],
          attempts: [{ id: 'l1', scope: 'admin', username: 'admin', ip: '10.0.0.1', success: true, createdAt: '2026-08-14T09:05:07' }],
          pagination: { total: 1, page: 1, limit: 30 }
        }
      }
    }));
    const w = await mountAudit();
    await w.findAll('.mk-pill').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('08-14 09:05:07');
  });

  it('目标类型列（P3）：当前页记录全部未写入 targetType 时隐藏该列', async () => {
    h.getLogs.mockImplementation(async () => ({
      data: {
        data: {
          logs: [{ id: 'op-1-1', adminName: 'admin', action: 'user.update', targetType: null, targetId: 'user-op-1-1', method: 'POST', path: '/x', statusCode: 200, success: true, createdAt: '2026-08-13T10:00:00' }],
          attempts: [],
          pagination: { total: 1, page: 1, limit: 30 }
        }
      }
    }));
    const w = await mountAudit();
    await nextTick();
    // 重做（F11）：tline div 网格 → mk-table 标准表格；目标类型列隐藏 = thead 中无该 th
    const ths = w.findAll('thead th').map((x) => x.text());
    expect(ths.includes('目标类型')).toBe(false);
    expect(w.find('table.mk-table').exists()).toBe(true);
    expect(w.text()).toContain('user-op-1-1');
  });

  it('关键词回车筛选：回第 1 页并携带 keyword', async () => {
    const w = await mountAudit();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    const input = w.find<HTMLInputElement>('.mk-filter__input');
    await input.setValue('admin');
    await input.trigger('keydown.enter');
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ page: 1, keyword: 'admin' });
  });
});
