/**
 * Addons 插件页冒烟：
 * 1. 独立页页头（插件），刷新走顶栏广播、不再有第二颗刷新钮
 * 2. 一行一个插件：名称、成员 Skill、开关与配置入口
 * 3. 开关直接落库（adminPluginsApi.setEnabled），停用只压信息层
 * 4. 「配置」打开的是外部服务 provider（密钥 / 入口 / 模型），不是 Skill 的 LLM 模型
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import Addons from '../Addons.vue';
import { dataSource } from '../store';
import { liveRefreshSeq } from '../live';

const { mcpListMock, listMcpToolsMock, pluginListMock, pluginSetMock, pluginConfigMock, pluginSaveMock } = vi.hoisted(() => ({
  mcpListMock: vi.fn(),
  listMcpToolsMock: vi.fn(),
  pluginListMock: vi.fn(),
  pluginSetMock: vi.fn(),
  pluginConfigMock: vi.fn(),
  pluginSaveMock: vi.fn()
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
  adminMcpApi: apiObject({ list: mcpListMock, listMcpTools: listMcpToolsMock }),
  adminPluginsApi: apiObject({
    list: pluginListMock,
    setEnabled: pluginSetMock,
    getConfig: pluginConfigMock,
    saveConfig: pluginSaveMock
  }),
  adminApiConfigApi: apiObject({ getModelCatalog: vi.fn(async () => ({ data: { data: { models: [] } } })) })
}));

function webConfig() {
  return {
    id: 'web',
    label: '联网',
    channels: [
      { id: 'search', label: '搜索', order: ['tinyfish', 'tavily'] },
      { id: 'fetch', label: '抓取', order: ['tinyfish', 'tavily'] }
    ],
    providers: [
      {
        id: 'tinyfish',
        label: 'TinyFish',
        configured: true,
        keySource: 'env',
        keyHint: '····abcd',
        fields: [
          { key: 'searchEndpoint', label: '搜索地址', type: 'text', value: '', placeholder: 'https://api.search.tinyfish.ai', secret: false },
          { key: 'fetchEndpoint', label: '抓取地址', type: 'text', value: '', placeholder: 'https://api.fetch.tinyfish.ai', secret: false },
          { key: 'apiKey', label: '密钥', type: 'password', value: '', placeholder: '已配置 ····abcd', secret: true }
        ]
      },
      {
        id: 'tavily',
        label: 'Tavily',
        configured: false,
        keySource: 'none',
        keyHint: null,
        fields: [
          { key: 'searchEndpoint', label: '搜索地址', type: 'text', value: '', placeholder: 'https://api.tavily.com/search', secret: false },
          { key: 'fetchEndpoint', label: '抓取地址', type: 'text', value: '', placeholder: 'https://api.tavily.com/extract', secret: false },
          { key: 'apiKey', label: '密钥', type: 'password', value: '', placeholder: '未配置', secret: true }
        ]
      }
    ]
  };
}

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(Addons, { global: { stubs: { teleport: true } }, attachTo: document.body });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mcpListMock.mockReset();
  listMcpToolsMock.mockReset();
  pluginListMock.mockReset();
  pluginSetMock.mockReset();
  pluginConfigMock.mockReset();
  pluginSaveMock.mockReset();
  pluginListMock.mockResolvedValue({
    data: { data: { states: { web: true, decision: true, image: true, mcp: true }, groups: [] } }
  });
  pluginSetMock.mockResolvedValue({
    data: { data: { states: { web: false, decision: true, image: true, mcp: true } } }
  });
  pluginConfigMock.mockResolvedValue({
    data: {
      data: {
        plugins: [
          webConfig(),
          { id: 'decision', label: '决策', channels: [], providers: [] },
          { id: 'image', label: '生图', channels: [], providers: [] }
        ]
      }
    }
  });
  pluginSaveMock.mockImplementation(async (pluginId: string) => ({
    data: { data: { plugin: { ...webConfig(), id: pluginId } } }
  }));
  listMcpToolsMock.mockResolvedValue({
    data: { data: { tools: [{ name: 'tavily_search' }, { name: 'tavily_map' }] } }
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

describe('Addons 插件页（2026-10-20 定名：原「外挂能力」）', () => {
  it('独立页形态：页头只有标题，刷新跟着顶栏广播走（2026-10-23 全站收口）', async () => {
    const wrapper = await mountLive();
    expect(wrapper.find('.mk-page').exists()).toBe(true);
    const head = wrapper.find('.mk-pagehead');
    expect(head.exists()).toBe(true);
    expect(head.text()).toContain('插件');
    // 站内已有顶栏刷新，页头不再出第二颗钮（用户「已经有刷新，为什么还有独立刷新」）
    expect(head.findAll('button')).toHaveLength(0);
    // 顶栏刷新 = liveRefreshSeq 广播 → 本页与旧页头刷新钮同一入口重拉
    const calls = pluginConfigMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    expect(pluginConfigMock.mock.calls.length).toBeGreaterThan(calls);
    wrapper.unmount();
  });

  it('一行一个插件：名称、说明、成员与最近调用同排，模型细节不出现在列表里', async () => {
    const wrapper = await mountLive();
    const rows = wrapper.findAll('.ac-plugin');
    expect(rows).toHaveLength(4);
    const text = wrapper.text();
    for (const name of ['联网', '决策', '生图', 'MCP 工具调用', '网页搜索', '网页抓取', '资料采集']) {
      expect(text).toContain(name);
    }
    // 列表只回答「开没开」：成员模型与路由徽标收进配置弹窗
    expect(text).not.toContain('deepseek-v4-flash');
    expect(text).not.toContain('跟随平台默认');
    expect(text).not.toContain('关闭后');
    const switches = wrapper.findAll('.ac-plugin .mk-switch');
    expect(switches).toHaveLength(4);
    expect(switches[0].attributes('title')).toContain('停用后：');
    wrapper.unmount();
  });

  it('开关直接落库，并跟随返回状态；停用只压信息层', async () => {
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-plugin')[0];
    expect(webRow.text()).toContain('启用');
    await webRow.find('.mk-switch').trigger('click');
    await flushPromises();
    expect(pluginSetMock).toHaveBeenCalledWith('web', false);
    expect(wrapper.findAll('.ac-plugin')[0].classes()).toContain('is-off');
    expect(wrapper.findAll('.ac-plugin')[0].text()).toContain('停用');
    wrapper.unmount();
  });

  it('启停状态拉取失败时给出可见提示，不把默认值伪装成真实状态', async () => {
    pluginListMock.mockRejectedValue(new Error('network down'));
    const wrapper = await mountLive();
    expect(wrapper.text()).toContain('启停状态未读取');
    wrapper.unmount();
  });

  it('配置弹窗：联网展示搜索/抓取 provider 的密钥与入口，不再是模型选择', async () => {
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-plugin')[0];
    await webRow.find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('联网 · 服务配置');
    expect(dialog.text()).toContain('TinyFish');
    expect(dialog.text()).toContain('Tavily');
    expect(dialog.text()).toContain('搜索');
    expect(dialog.text()).toContain('抓取');
    expect(dialog.text()).toContain('密钥');
    expect(dialog.findAll('.ac-config-provider')).toHaveLength(2);
    // 这是外部服务配置，不是 Skill 的 LLM 模型绑定
    expect(dialog.text()).not.toContain('跟随平台默认');
    expect(dialog.text()).not.toContain('完整运行时');
    wrapper.unmount();
  });

  it('服务配置保存只提交改过的 provider 字段（密钥留空不覆盖）', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-plugin')[0].find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const tavily = dialog.findAll('.ac-config-provider').find((p) => p.text().includes('Tavily'));
    expect(tavily).toBeTruthy();
    const inputs = tavily!.findAll('input');
    // 搜索地址 / 抓取地址 / 密钥
    expect(inputs).toHaveLength(3);
    await inputs[2].setValue('tvly-new-key');
    await dialog.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(pluginSaveMock).toHaveBeenCalledTimes(1);
    expect(pluginSaveMock).toHaveBeenCalledWith('web', { tavily: { apiKey: 'tvly-new-key' } });
    wrapper.unmount();
  });

  it('MCP 行不套 provider 配置：按钮是「管理服务」，滚到本页服务登记', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const wrapper = await mountLive();
    const mcpRow = wrapper.findAll('.ac-plugin').find((r) => r.text().includes('MCP 工具调用'));
    const btn = mcpRow!.findAll('button').find((b) => b.text() === '管理服务');
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    expect(scrollSpy).toHaveBeenCalled();
    expect(wrapper.find('[aria-label="插件服务配置"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('MCP 组的服务可用性跟在成员后面，与插件开关是两个维度', async () => {
    const wrapper = await mountLive();
    const mcpRow = wrapper.findAll('.ac-plugin').find((r) => r.text().includes('MCP 工具调用'));
    expect(mcpRow).toBeTruthy();
    expect(mcpRow!.text()).toContain('3 个服务启用');
    expect(mcpRow!.find('.mk-switch').exists()).toBe(true);
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
