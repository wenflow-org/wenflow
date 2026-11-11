/**
 * 调用日志：筛选态进 URL + 表头/空值/Token 口径（2026-11-11 走查）
 *
 * ① 「查询/重置」之前筛选只活在组件 ref：刷新、浏览器返回、把链接发给别人都会回到「全部」。
 *    现在查询过的筛选、页码、每页条数写进 query，进入页面时按 query 还原后再取数。
 * ② 共享 .uc-table th 的 uppercase 把 Agent/Token 拉成全大写，同表其余中文列 → 两种字系；
 *    本页取消转换。
 * ③ 同一张表里时长/Token/错误列用 '-'、时间列用 '—'，且 Token 统计卡裸输出 0 没单位。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const route = { query: {} as Record<string, string> };
const replace = vi.fn(async (_options: { query?: Record<string, unknown> }) => {});

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace })
}));
vi.mock('@/components/user/CapabilityShell.vue', () => ({
  default: { template: '<div class="stub-shell"><slot name="actions" /><slot /></div>' }
}));
vi.mock('@/views/admin-redesign/useEscape', () => ({ useEscape: () => {} }));
vi.mock('@/views/admin-redesign/useOverlay', () => ({ useOverlay: () => {} }));

const getAgentLogs = vi.fn();
vi.mock('@/api/userCustom', () => ({
  getAgentLogs: (...args: unknown[]) => getAgentLogs(...args),
  getAgentLogDetail: vi.fn(async () => ({ data: null })),
  exportAgentLogs: vi.fn(async () => ({}))
}));
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

import AgentLogs from '../AgentLogs.vue';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../AgentLogs.vue'), 'utf8');
const template = source.slice(0, source.indexOf('<script'));
const css = source.slice(source.indexOf('<style'));

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acl_1',
    agentId: 'skill:teaching-turn',
    success: true,
    durationMs: 10_000,
    tokensUsed: null,
    logSource: 'business',
    calledAt: '2026-11-11T09:11:26.000Z',
    ...overrides
  };
}

async function mountLogs() {
  const w = mount(AgentLogs);
  await flushPromises();
  return w;
}

beforeEach(() => {
  route.query = {};
  replace.mockClear();
  getAgentLogs.mockReset();
  getAgentLogs.mockResolvedValue({ data: { logs: [row()], pagination: { total: 1 } } });
});

describe('调用日志：筛选态进 URL', () => {
  it('进入页面时按 query 还原筛选、页码与每页条数后再取数', async () => {
    route.query = {
      agent: 'skill:teaching-turn',
      capability: 'teaching',
      success: 'false',
      system: '1',
      from: '2026-11-01',
      to: '2026-11-11',
      page: '2',
      limit: '50'
    };
    const w = await mountLogs();

    expect(getAgentLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'skill:teaching-turn',
        capabilityType: 'teaching',
        success: false,
        includeSystem: true,
        startDate: '2026-11-01',
        endDate: '2026-11-11',
        page: 2,
        limit: 50
      })
    );
    /* 日期输入框回填，不是空着但结果却按日期筛过 */
    const dates = w.findAll<HTMLInputElement>('input[type="date"]');
    expect(dates[0].element.value).toBe('2026-11-01');
    expect(dates[1].element.value).toBe('2026-11-11');
    w.unmount();
  });

  it('「重置」清掉 URL 里的筛选键并回到默认口径', async () => {
    route.query = { agent: 'skill:teaching-turn', page: '3', limit: '50' };
    const w = await mountLogs();

    await w.findAll('button').find((b) => b.text() === '重置')!.trigger('click');
    await flushPromises();

    expect(replace).toHaveBeenCalled();
    const lastQuery = replace.mock.calls.at(-1)![0].query;
    /* 每页条数是浏览偏好，重置筛选不该改它；只清掉筛选键与页码 */
    expect(lastQuery).toEqual({ limit: '50' });
    expect(getAgentLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 50, includeSystem: false })
    );
    expect(getAgentLogs.mock.calls.at(-1)![0].agentId).toBeUndefined();
    w.unmount();
  });

  it('翻页写入 URL（返回上一页不丢页码）', async () => {
    getAgentLogs.mockResolvedValue({ data: { logs: [row()], pagination: { total: 60 } } });
    const w = await mountLogs();

    await w.findAll('button').find((b) => b.text() === '下一页')!.trigger('click');
    await flushPromises();

    expect(replace.mock.calls.at(-1)![0].query?.page).toBe('2');
    expect(getAgentLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    w.unmount();
  });
});

describe('调用日志：表头与空值口径', () => {
  it('表头不再被共享 uppercase 拉成全大写', () => {
    expect(css).toMatch(/\.logs-table th \{[^}]*text-transform:\s*none/);
  });

  it('缺失时间用 -\x20（与时长/Token/错误列同一个占位符）', () => {
    expect(source).toContain("if (!date) return '-';");
    expect(source).not.toContain("if (!date) return '—';");
  });

  it('Token 统计卡有单位和千分位；本页无 Token 读数时给 — 而不是 0', () => {
    expect(template).toContain('tokens');
    expect(source).toMatch(/const hasTokenSamples = computed\(/);
    expect(source).toContain("if (value == null || !Number.isFinite(value) || value < 0) return '-';");
    expect(template).not.toContain('{{ totalTokens }}');
  });

  it('行内「详情/复制」带对象名，读屏能分清是哪一条', () => {
    expect(template).toContain('查看「${formatAgentId(row)}」的日志详情');
    expect(template).toContain('复制「${formatAgentId(row)}」的排查信息');
  });

  it('0 条且确有筛选时给「清除筛选」出口', () => {
    expect(template).toContain('v-if="hasActiveFilters"');
    expect(source).toContain('const hasActiveFilters = computed(');
  });
});
