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

const { configsMock, mcpListMock, listMcpToolsMock } = vi.hoisted(() => ({
  configsMock: vi.fn(),
  mcpListMock: vi.fn(),
  listMcpToolsMock: vi.fn()
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
  adminMcpApi: apiObject({ list: mcpListMock, listMcpTools: listMcpToolsMock })
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
  listMcpToolsMock.mockReset();
  listMcpToolsMock.mockResolvedValue({
    data: { data: { tools: [{ name: 'tavily_search' }, { name: 'tavily_map' }] } }
  });
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

describe('Addons MCP 服务（transport 支持）', () => {
  function withTools(tools: Array<Record<string, unknown>>) {
    mcpListMock.mockResolvedValue({ data: { data: { tools } } });
  }

  it('transport=mcp 行显示 MCP 标记与「发现工具」入口；普通行不显示', async () => {
    withTools([
      { id: 'tavily', name: 'Tavily MCP', description: '', type: 'http', transport: 'mcp', endpoint: 'https://x/mcp', enabled: true },
      { id: 'plain', name: '普通 HTTP', description: '', type: 'search', endpoint: 'https://y/api', enabled: true }
    ]);
    const wrapper = await mountLive();
    const rows = wrapper.findAll('.ac-mcp__row');
    expect(rows).toHaveLength(2);

    expect(rows[0].find('.mk-badge--info').exists()).toBe(true);
    expect(rows[0].text()).toContain('发现工具');
    expect(rows[0].text()).toContain('MCP');

    expect(rows[1].find('.mk-badge--info').exists()).toBe(false);
    expect(rows[1].text()).not.toContain('发现工具');
    expect(rows[1].text()).toContain('搜索');

    wrapper.unmount();
  });

  it('点击「发现工具」调用 listMcpTools 并显示数量', async () => {
    withTools([
      { id: 'tavily', name: 'Tavily MCP', description: '', type: 'http', transport: 'mcp', endpoint: 'https://x/mcp', enabled: true }
    ]);
    const wrapper = await mountLive();
    const button = wrapper.findAll('.ac-mcp__row .mk-link').find((b) => b.text().includes('发现工具'));
    expect(button, '应存在「发现工具」按钮').toBeTruthy();

    await button!.trigger('click');
    await flushPromises();

    expect(listMcpToolsMock).toHaveBeenCalledWith('tavily', true);
    expect(wrapper.find('.ac-mcp__row').text()).toContain('工具 2');

    wrapper.unmount();
  });
});
