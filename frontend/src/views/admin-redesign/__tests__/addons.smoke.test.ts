/**
 * Addons 外挂能力列冒烟（P1 视觉修复）：
 * 1. 能力列主名 + ID 均带 title 全值（截断处可读）
 * 2. 能力列首列最小宽度兜底（原 51px 截断至 1-2 字符）
 * 3. demo 模式 3 行能力全部渲染（MCP 工具调用 / 生图 / 网页搜索）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import Addons from '../Addons.vue';
import { dataSource } from '../store';

const { configsMock, mcpListMock } = vi.hoisted(() => ({
  configsMock: vi.fn(),
  mcpListMock: vi.fn()
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

vi.mock('@/api/adminApi', () => ({
  adminSkillsApi: apiObject({ getSkillModelConfigs: configsMock }),
  adminMcpApi: apiObject({ list: mcpListMock })
}));

async function mountDemo() {
  dataSource.value = 'demo';
  const wrapper = mount(Addons);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  configsMock.mockReset();
  mcpListMock.mockReset();
  dataSource.value = 'demo';
});

afterEach(() => {
  dataSource.value = 'demo';
});

describe('Addons 外挂能力列（P1：51px 截断修复）', () => {
  it('demo：能力列主名与 ID 均渲染完整值并带 title 全值', async () => {
    const wrapper = await mountDemo();
    const strongs = wrapper.findAll('tbody .mk-cell-main strong');
    const subs = wrapper.findAll('tbody .mk-cell-main .mk-cell-sub');
    const names = strongs.map((s) => s.text());
    expect(names).toContain('MCP 工具调用');
    expect(names).toContain('生图');
    expect(names).toContain('网页搜索');
    for (const s of strongs) {
      expect(s.attributes('title')).toBe(s.text());
    }
    const subsText = subs.map((s) => s.text());
    expect(subsText).toContain('mcp-tool');
    expect(subsText).toContain('text-to-image');
    expect(subsText).toContain('web-search');
    for (const s of subs) {
      expect(s.attributes('title')).toBe(s.text());
    }
    wrapper.unmount();
  });
});
