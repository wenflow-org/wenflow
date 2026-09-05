/**
 * Addons 外挂能力列冒烟（P1 视觉修复）：
 * 1. 能力列主名 + ID 均带 title 全值（截断处可读）
 * 2. 能力列首列最小宽度兜底（原 51px 截断至 1-2 字符）
 * 3. live 模式：后端配置 + MCP 工具列表渲染
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

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(Addons);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  configsMock.mockReset();
  mcpListMock.mockReset();
  configsMock.mockResolvedValue({
    data: {
      data: {
        configs: [
          { skillId: 'mcp-tool', displayName: 'MCP 工具调用', model: 'deepseek-v4-flash' },
          { skillId: 'text-to-image', displayName: '生图', model: 'flux' },
          { skillId: 'web-search', displayName: '网页搜索', model: 'deepseek-v4-flash' }
        ]
      }
    }
  });
  mcpListMock.mockResolvedValue({
    data: {
      data: {
        tools: [
          { id: 'mcp-tool', name: 'MCP 工具调用', description: '调用外部 MCP 服务', type: 'http' },
          { id: 'text-to-image', name: '生图', description: '文生图', type: 'http' },
          { id: 'web-search', name: '网页搜索', description: '实时搜索', type: 'search' }
        ]
      }
    }
  });
  dataSource.value = 'live';
});

afterEach(() => {
  dataSource.value = 'live';
});

describe('Addons 外挂能力列（P1：51px 截断修复）', () => {
  it('live：能力列主名与 ID 均渲染完整值并带 title 全值', async () => {
    const wrapper = await mountLive();
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
