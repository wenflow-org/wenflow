/**
 * 审计日志展开行：两处 2026-10-19 用户走查缺陷的护栏
 *
 * 1) 「旋转后大小不对了」——展开时 rotate(90deg) 原先挂在 <td class="log-arrow"> 上：格子是
 *    36×41.4 的非正方盒，旋转后外接盒实测变 42.1×36（横向撑出列 6px、纵向缩 5px），字形还因为
 *    绕格心而非自身中心旋转右移约 10px。现改转内层 1em 正方盒（.log-arrow__i）。
 *    2026-11-09 审计（图 6）：那枚缩小深灰 ▸ 连表头都没有，已整列换成带「详情」表头的
 *    操作列 + 行内真按钮（aria-expanded），箭头相关的白盒锁随实现一并退役。
 * 2) 「文案位置不对」——展开区口径行原为 justify-content: space-between，把客户端 UA 甩到
 *    块右缘（实测请求行止于 x=1211、UA 起于 x=1748），与它描述的请求行脱开 536px。
 *
 * 前者靠 CSS 白盒锁（同 token-cost-layout.test.ts 的 read/block 手法），后者两种都锁。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import AuditLogs from '../AuditLogs.vue';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, '..', 'AuditLogs.vue'), 'utf8');

/** 取某条规则块的声明体；选择器按「行首」锚定，避免 `.log-arrow__i` 误命中
    `.log-tr--open .log-arrow__i` 这类组合选择器；找不到返回空串 */
function block(css: string, selector: string): string {
  const pattern = new RegExp('^' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  return css.match(pattern)?.[1] ?? '';
}

const h = vi.hoisted(() => ({ getLogs: vi.fn(), getStats: vi.fn() }));

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

/** 一条带 UA 的运维审计（展开后才有 payload 行） */
const row = {
  id: 'a1',
  adminName: 'admin@wenflow.local',
  action: 'virtual-session-step',
  targetType: 'virtual-session',
  targetId: '9ec1696e-38b8-4d7a-8799-5d3829de4a13',
  method: 'POST',
  path: '/api/admin/virtual-learners/sessions/9ec1696e-38b8-4d7a-8799-5d3829de4a13/teaching-step',
  statusCode: 200,
  durationMs: 140300,
  userAgent: 'Python-urllib/3.10',
  success: true,
  createdAt: '2026-10-18T23:23:55'
};

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

describe('审计日志展开行：箭头旋转与展开区口径行位置', () => {
  beforeEach(() => {
    h.getLogs.mockReset();
    h.getStats.mockReset();
    h.getLogs.mockImplementation(async () => ({
      data: { data: { logs: [row], attempts: [row], pagination: { total: 1, page: 1, limit: 30 } } }
    }));
    h.getStats.mockResolvedValue({ data: { data: { stats: { total: 1, failed: 0 } } } });
    window.scrollTo = vi.fn();
  });

  it('箭头列已退役：不再有 .log-arrow / .log-arrow__i 的死样式（2026-11-09 图 6）', () => {
    // 整列换成带「详情」表头的操作列后，箭头相关的样式必须一并删除（否则是死 CSS）
    expect(block(SRC, '.log-arrow')).toBe('');
    expect(block(SRC, '.log-arrow__i')).toBe('');
    expect(SRC).not.toContain('.log-arrow');
    // 末列不再用 36px 的 aria-hidden 空表头
    expect(SRC).not.toContain('th:last-child { width: 36px');
  });

  it('展开区口径行左对齐顺排（UA 不再被甩到块右缘）', () => {
    const meta = block(SRC, '.log-payload-meta');
    expect(meta).toContain('justify-content: flex-start');
    expect(meta).not.toContain('space-between');
    expect(meta).toContain('flex-wrap: wrap'); // 长请求行 + 长 UA 时 UA 折行，不撑破块
  });

  it('展开后：操作列有可见「详情」按钮（aria-expanded），口径行把 UA 紧跟在请求行后（带分隔点）', async () => {
    const w = await mountAudit();
    const tr = w.find('tr.log-tr');
    await tr.trigger('click');
    await nextTick();

    // 2026-11-09 审计（图 6）：末列从 aria-hidden 的深灰 ▸ 换成带「详情」表头、行内真按钮。
    // 表头须是可读的「详情」，按钮 aria-expanded 指向本行详情区。
    const header = w.findAll('th').find((th) => th.text().trim() === '详情');
    expect(header?.exists()).toBe(true);
    const btn = w.find('.al-table .mk-actions button.mk-link');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('收起');
    expect(btn.attributes('aria-expanded')).toBe('true');
    expect(btn.attributes('aria-controls')).toBe('audit-payload-a1');

    // 口径行：请求行 + 带分隔点的 UA，同序相邻（位置由 flex-start 保证，不再靠 space-between）
    const meta = w.find('.log-payload-meta');
    const kids = meta.element.children;
    expect(kids).toHaveLength(2);
    expect(kids[0].textContent).toContain('POST');
    expect(kids[0].textContent).toContain('HTTP 200');
    expect(kids[1].classList.contains('log-ua')).toBe(true);
    expect(kids[1].textContent).toContain('Python-urllib/3.10');
    expect(kids[1].querySelector('.log-meta-sep')?.textContent).toBe('·');
    expect(meta.attributes('title')).toBeUndefined();

    w.unmount();
  });
});
