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
    // 2026-10-01 设计语言对齐：视图切换由胶囊改原型 .tabs 下划线页签，按 .tab 定位
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
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
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
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

/* ---------- 2026-10-05 重设计：动作快筛（当前页聚合 → keyword 尾段下钻）+ 负载美化 ----------
   刷屏根因：调试期自动化调用与人工操作混排（「推进虚拟会话」单动作占当前页 70%）。
   下拉选项=当前页动作聚合（口径 title 披露），下钻词取 path 稳定尾段（/teaching-step 等，
   同资源前缀 /virtual-learners 区分不了动作）；选中态由 keyword 单源推导，手动改搜索框自动回落。 */
describe('AuditLogs 动作快筛 + 负载美化（2026-10-05 重设计）', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    window.scrollTo = vi.fn();
  });

  function opRow(i: number, tail: string) {
    return {
      id: `op-${tail}-${i}`,
      adminName: 'admin',
      action: `raw:${tail}`,
      targetType: '虚拟会话',
      targetId: `vs-${i}`,
      method: 'POST',
      path: `/api/admin/virtual-learners/sessions/s-${i}/${tail}`,
      statusCode: 200,
      success: true,
      createdAt: `2026-10-05T10:00:${String(i % 60).padStart(2, '0')}`,
    };
  }

  function mockMixedActions() {
    const logs = [
      ...Array.from({ length: 21 }, (_, i) => opRow(i, 'teaching-step')),
      ...Array.from({ length: 3 }, (_, i) => opRow(100 + i, 'restart-learning')),
      ...Array.from({ length: 2 }, (_, i) => opRow(200 + i, 'start-learning')),
    ];
    h.getLogs.mockImplementation(async () => ({
      data: { data: { logs, attempts: [], pagination: { total: logs.length, page: 1, limit: 30 } } },
    }));
    h.getStats.mockResolvedValue({ data: { data: { stats: { total: logs.length } } } });
  }

  it('动作下拉：当前页聚合计数排序（21/3/2），登录 tab 不渲染', async () => {
    mockMixedActions();
    const w = await mountAudit();
    await nextTick();
    const sel = w.find('select[aria-label="按动作筛选"]');
    expect(sel.exists()).toBe(true);
    const options = sel.findAll('option').map((o) => o.text());
    expect(options).toHaveLength(4); // 全部动作 + 3 个聚合动作
    expect(options[1]).toContain('21'); // 按计数倒序：推进（21）第一
    expect(options[2]).toContain('3');
    expect(options[3]).toContain('2');
    // 语义名来自 path 兜底映射（尾段 → 中文动作名）
    expect(options[1]).toContain('推进虚拟会话');
    // 切登录 tab：动作维度不存在
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    expect(w.find('select[aria-label="按动作筛选"]').exists()).toBe(false);
  });

  it('选中动作 → keyword=路径稳定尾段（/teaching-step）回第 1 页重查；手动改搜索框后下拉回落「全部动作」', async () => {
    mockMixedActions();
    const w = await mountAudit();
    await nextTick();
    const sel = w.find('select[aria-label="按动作筛选"]');
    const restartValue = sel.findAll('option')[2].element.getAttribute('value')!;
    await sel.setValue(restartValue);
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ page: 1, keyword: '/restart-learning' });
    // keyword 单源推导：下拉保持选中态
    expect((w.find('select[aria-label="按动作筛选"]').element as HTMLSelectElement).value).toBe(restartValue);
    // 手动改搜索框（非任何动作的下钻词）→ 下拉回落「全部动作」
    const input = w.find<HTMLInputElement>('.mk-filter__input');
    await input.setValue('admin');
    await input.trigger('keydown.enter');
    await flushPromises();
    expect((w.find('select[aria-label="按动作筛选"]').element as HTMLSelectElement).value).toBe('');
  });

  it('展开行负载美化：紧凑 JSON 两格缩进（与执行日志同款 prettyPayload）', async () => {
    h.getLogs.mockImplementation(async () => ({
      data: {
        data: {
          logs: [{
            id: 'op-1', adminName: 'admin', action: 'user.update', targetType: 'user', targetId: 'u-1',
            method: 'POST', path: '/x', statusCode: 200, success: true, createdAt: '2026-08-13T10:00:00',
            requestJson: '{"a":1,"b":{"c":2}}',
          }],
          attempts: [],
          pagination: { total: 1, page: 1, limit: 30 },
        },
      },
    }));
    const w = await mountAudit();
    await w.find('.log-tr').trigger('click');
    await nextTick();
    const pre = w.find('.log-payload pre');
    expect(pre.exists()).toBe(true);
    expect(pre.text()).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });
});
