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
import { chooseFilter, filterOptions, filterValue } from './filter-controls';
import { chooseMkSelect } from '@/components/mk/__tests__/mkSelect';

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

  it('翻页失败：清空上一页行；导出只剩运营中心数据导出页一个入口', async () => {
    const w = await mountAudit();
    h.getLogs.mockImplementationOnce(async () => { throw new Error('page unavailable'); });
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('审计日志加载失败');
    expect(w.text()).not.toContain('user-op-1-1');
    // 本页不再自出 JSON：导出统一走运营中心数据导出页
    expect(w.findAll('button').some((b) => b.text() === '导出本页')).toBe(false);
    expect(findBtn(w, '导出').exists()).toBe(true);
  });

  it('统计请求失败：失败统计条在主行显示并可重试（不必开筛选弹层）', async () => {
    h.getStats.mockRejectedValue(new Error('stats unavailable'));
    const w = await mountAudit();
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('失败统计不可用');
    expect(findBtn(w, '重试').exists()).toBe(true);
  });

  it('默认时间范围是「全部」：首屏不带 timeRange，空态也不给出口（已是最宽窗口）', async () => {
    h.getLogs.mockImplementation(async () => ({
      data: { data: { logs: [], attempts: [], pagination: { total: 0, page: 1, limit: 30 } } }
    }));
    const w = await mountAudit();
    await nextTick();
    expect(h.getLogs.mock.calls[0][0]).toMatchObject({ page: 1, limit: 30, scope: 'operation' });
    expect((h.getLogs.mock.calls[0][0] as Record<string, unknown>).timeRange).toBeUndefined();
    expect(w.text()).toContain('暂无审计记录');
    expect(w.find('.mk-empty__action').exists()).toBe(false);
  });

  it('目标列可点：用户类型跳 ?view=user&id=，其余类型保持纯文本', async () => {
    h.getLogs.mockResolvedValue({
      data: {
        data: {
          logs: [
            { id: 'a', adminName: 'admin', action: 'user.delete', targetType: 'user', targetId: 'u-123456789012345678', method: 'DELETE', path: '/api/admin/users/u', statusCode: 200, success: true, createdAt: '2026-10-24T06:56:24' },
            { id: 'b', adminName: 'admin', action: 'plugin-toggle', targetType: 'plugin', targetId: 'web', method: 'PUT', path: '/api/admin/plugins/web', statusCode: 200, success: true, createdAt: '2026-10-24T09:23:25' }
          ],
          pagination: { total: 2, page: 1, limit: 30 }
        }
      }
    });
    const w = await mountAudit();
    await nextTick();
    const links = w.findAll('.al-target-link');
    expect(links).toHaveLength(1);
    await links[0].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.path).toBe('/admin/people');
    expect(w.vm.$router.currentRoute.value.query).toMatchObject({ view: 'user', id: 'u-123456789012345678' });
    // 插件类型没有二级页：保持纯文本，不出链接
    expect(w.findAll('.log-target span').some((s) => s.text() === 'web')).toBe(true);
  });

  it('登录审计失败行给「查该用户名」：点击把该用户名写进关键词重查', async () => {
    h.getLogs.mockResolvedValue({
      data: {
        data: {
          logs: [],
          attempts: [{ id: 'l1', scope: 'admin', username: 'alice', ip: '10.0.0.1', success: false, reason: 'invalid_credentials', createdAt: '2026-08-14T09:05:07' }],
          pagination: { total: 1, page: 1, limit: 30 }
        }
      }
    });
    const w = await mountAudit();
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    const btn = findBtn(w, '查该用户名');
    await btn.trigger('click');
    await flushPromises();
    expect(h.getLogs.mock.calls.at(-1)![0]).toMatchObject({ page: 1, keyword: 'alice', scope: 'login' });
  });

  it('KPI 带在页签之上：先读页面统计，再切操作/登录视图', async () => {
    const w = await mountAudit();
    await nextTick();
    const kpi = w.find('.mk-kpi-grid').element;
    const tabs = w.find('.tabs').element;
    expect(kpi.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('KPI 带：总数/失败/失败率/失败动作同屏，失败卡一键下钻，不再有常驻失败胶囊', async () => {
    h.getStats.mockResolvedValue({
      data: { data: { stats: { total: 378, failed: 7 }, failureByAction: [{ action: 'user.delete', count: 5 }] } }
    });
    const w = await mountAudit();
    await flushPromises();
    await nextTick();
    const kpis = w.findAll('.mk-kpi');
    expect(kpis).toHaveLength(4);
    const card = (label: string) => {
      const found = kpis.find((k) => k.find('.mk-kpi__label').text() === label);
      if (!found) throw new Error(`kpi not found: ${label}`);
      return found;
    };
    expect(card('记录总数').text()).toContain('378');
    expect(card('失败记录').text()).toContain('7');
    expect(card('失败率').text()).toContain('2%');
    expect(card('失败动作').find('.mk-kpi__num').text()).toBe('1');
    // 2026-10-27 用户「不要这种说明文字」：KPI 只留 label + 数值，不写脚注
    expect(w.findAll('.mk-kpi__hint')).toHaveLength(0);
    // 常驻失败胶囊退役：计数只在 KPI / 下拉选项里
    expect(w.find('.al-fails').exists()).toBe(false);
    await card('失败记录').trigger('click');
    await flushPromises();
    expect(h.getLogs.mock.calls.at(-1)![0]).toMatchObject({ success: false });
    expect(filterValue(w, '失败动作')).toBe('');
    expect(filterOptions(w, '失败动作')).toEqual(['全部失败', 'user.delete 5']);
  });

  it('失败动作下拉：按动作下钻；清空回「全部失败」而不是退出失败域', async () => {
    h.getStats.mockResolvedValue({
      data: { data: { stats: { total: 378, failed: 7 }, failureByAction: [{ action: 'user.delete', count: 5 }] } }
    });
    const w = await mountAudit();
    await flushPromises();
    await nextTick();
    expect(filterOptions(w, '失败动作')).toEqual(['不过滤', 'user.delete 5']);
    await chooseFilter(w, '失败动作', 'user.delete');
    await flushPromises();
    expect(h.getLogs.mock.calls.at(-1)![0]).toMatchObject({ success: false, keyword: 'user.delete' });
    await chooseFilter(w, '失败动作', '全部失败');
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(last).toMatchObject({ success: false });
    expect(last.keyword).toBeUndefined();
  });

  it('登录审计同样有 KPI 带，但不渲染操作审计专属的「失败动作」卡', async () => {
    const w = await mountAudit();
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    const labels = w.findAll('.mk-kpi .mk-kpi__label').map((x) => x.text());
    expect(labels).toEqual(['记录总数', '失败记录', '失败率']);
  });

  it('动作列：未映射接口不再直出 /api/ 路径，插件启停/卡派生显示中文名', async () => {
    h.getLogs.mockResolvedValue({
      data: {
        data: {
          logs: [
            { id: 'a', adminName: 'admin', action: 'POST /api/admin/virtual-learners/cards/clone', targetType: null, targetId: null, method: 'POST', path: '/api/admin/virtual-learners/cards/clone', statusCode: 200, success: true, createdAt: '2026-10-24T06:56:24' },
            { id: 'b', adminName: 'admin', action: 'plugin-toggle', targetType: 'plugin', targetId: 'web', method: 'PUT', path: '/api/admin/plugins/web', statusCode: 200, success: true, createdAt: '2026-10-24T09:23:25' },
            { id: 'c', adminName: 'admin', action: 'POST /api/admin/mystery/thing', targetType: null, targetId: null, method: 'POST', path: '/api/admin/mystery/thing', statusCode: 200, success: true, createdAt: '2026-10-24T09:10:00' }
          ],
          pagination: { total: 3, page: 1, limit: 30 }
        }
      }
    });
    const w = await mountAudit();
    const text = w.text();
    expect(text).toContain('卡派生虚拟学习者');
    expect(text).toContain('启停插件');
    expect(text).toContain('管理操作');
    expect(text).not.toContain('/api/admin/virtual-learners');
    expect(text).not.toContain('/api/admin/mystery');
  });

  it('每页条数变更：回第 1 页并按新 limit 重查（378/50 → 8 页）', async () => {
    const w = await mountAudit();
    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    await chooseMkSelect(w as never, '每页条数', '50');
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
    const trigger = w.find('.mk-pillselect[aria-label="按动作筛选"]');
    expect(trigger.exists()).toBe(true);
    // 2026-10-27：动作维度从「筛选」弹层提到主栏（Carbon：类别不得藏进菜单/下拉），
    // 收起态直接显示当前值；卡头不再有 .mk-adv 弹层
    expect(trigger.element.closest('.mk-filter')).not.toBeNull();
    expect(w.find('.mk-adv').exists()).toBe(false);
    const options = filterOptions(w as never, '动作');
    expect(options).toHaveLength(4); // 全部动作 + 3 个聚合动作
    expect(options[1]).toContain('21'); // 按计数倒序：推进（21）第一
    expect(options[2]).toContain('3');
    expect(options[3]).toContain('2');
    // 语义名来自 path 兜底映射（尾段 → 中文动作名）
    expect(options[1]).toContain('推进虚拟会话');
    // 切登录 tab：动作维度不存在
    await w.findAll('.tab').find((x) => x.text() === '登录审计')!.trigger('click');
    await flushPromises();
    expect(w.find('.mk-pillselect[aria-label="按动作筛选"]').exists()).toBe(false);
  });

  it('选中动作 → keyword=路径稳定尾段（/teaching-step）回第 1 页重查；手动改搜索框后下拉回落「全部动作」', async () => {
    mockMixedActions();
    const w = await mountAudit();
    await nextTick();
    // 菜单在组件子树里（fixed 定位）；按 listbox 的 aria-label 定位当前维
    const opts = w.findAll('ul.mk-listbox-pop[aria-label="按动作筛选"] .mk-listbox-opt');
    const restartValue = opts[2].attributes('data-value')!;
    await chooseFilter(w as never, '动作', opts[2].text().replace(/（\d+）$/, ''));
    await flushPromises();
    const last = h.getLogs.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ page: 1, keyword: '/restart-learning' });
    // keyword 单源推导：下拉保持选中态
    expect(filterValue(w as never, '动作')).toBe(restartValue);
    // 手动改搜索框（非任何动作的下钻词）→ 下拉回落「全部动作」
    const input = w.find<HTMLInputElement>('.mk-filter__input');
    await input.setValue('admin');
    await input.trigger('keydown.enter');
    await flushPromises();
    expect(filterValue(w as never, '动作')).toBe('');
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
