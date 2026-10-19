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

describe('Addons 外挂能力页（2026-10-19 从「模型与接入」拆出独立页）', () => {
  it('独立页形态：自带页头（页名 + 刷新钮），根节点是页面容器', async () => {
    const wrapper = await mountLive();
    expect(wrapper.find('.mk-page').exists()).toBe(true);
    const head = wrapper.find('.mk-pagehead');
    expect(head.exists()).toBe(true);
    expect(head.text()).toContain('外挂能力');
    expect(wrapper.findAll('button').some((b) => b.text().includes('刷新'))).toBe(true);
    wrapper.unmount();
  });

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

  /* 2026-10-14 评审：四张能力卡各自复读「模型 继承全局 · 超时 继承」——继承是「本卡没单独配」
     的缺省态，不是读数；常显会把类型徽标与最近调用淹掉。改为只显非继承值（继承态去抽屉看）。 */
  it('继承默认值的 kv 不常显：未单独配置模型/超时时只留类型徽标 + 最近调用', async () => {
    configsMock.mockResolvedValue({
      data: { data: { configs: [{ skillId: 'mcp-tool', displayName: 'MCP 工具调用' }] } }
    });
    const wrapper = await mountLive();
    const kvs = wrapper.findAll('tbody .ac-cap-card__kv').map((s) => s.text());
    expect(kvs.some((t) => t.startsWith('模型'))).toBe(false);
    expect(kvs.some((t) => t.startsWith('超时'))).toBe(false);
    expect(kvs.some((t) => t.startsWith('最近'))).toBe(true);
    wrapper.unmount();
  });

  it('单独配置的模型与超时仍带标签常显（只有继承态隐藏）', async () => {
    configsMock.mockResolvedValue({
      data: {
        data: {
          configs: [
            { skillId: 'mcp-tool', displayName: 'MCP 工具调用', model: 'dsv4.1', requestTimeoutMs: 60000 }
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const kvs = wrapper.findAll('tbody .ac-cap-card__kv').map((s) => s.text());
    expect(kvs).toContain('模型 dsv4.1');
    expect(kvs.some((t) => t.startsWith('超时'))).toBe(true);
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
