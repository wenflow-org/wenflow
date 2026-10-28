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
import { chooseMkSelect, mkSelectValue } from '@/components/mk/__tests__/mkSelect';

const { mcpListMock, mcpUpdateMock, listMcpToolsMock, pluginListMock, pluginSetMock, pluginConfigMock, pluginSaveMock } = vi.hoisted(() => ({
  mcpListMock: vi.fn(),
  mcpUpdateMock: vi.fn(),
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
  adminMcpApi: apiObject({ list: mcpListMock, listMcpTools: listMcpToolsMock, updateTool: mcpUpdateMock }),
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
  mcpUpdateMock.mockReset();
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
  mcpUpdateMock.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
    data: { data: { id, ...patch } }
  }));
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
  it('独立页形态：三张内置能力卡 + 一张全宽 MCP 卡，刷新跟着顶栏广播走（2026-10-23 全站收口）', async () => {
    const wrapper = await mountLive();
    expect(wrapper.find('.mk-page').exists()).toBe(true);
    const head = wrapper.find('.mk-pagehead');
    expect(head.exists()).toBe(true);
    expect(head.text()).toContain('插件');
    // 页头副文已删；2026-10-27 新建入口跟着 MCP 能力行走，页头不再挂全局动作
    expect(head.find('.mk-pagehead__sub').exists()).toBe(false);
    expect(head.findAll('.mk-pagehead__actions button')).toEqual([]);
    // 三张内置能力卡 + 一张全宽 MCP 卡；MCP 服务不再是并列的第二张卡
    expect(wrapper.findAll('.ac-cap')).toHaveLength(4);
    expect(wrapper.findAll('.ac-cap--wide')).toHaveLength(1);
    expect(wrapper.find('.ac-mcp-card').exists()).toBe(false);
    expect(wrapper.find('.ac-cap--wide .ac-mcp__row').exists()).toBe(true);
    // 顶栏刷新 = liveRefreshSeq 广播 → 本页与旧页头刷新钮同一入口重拉
    const calls = pluginConfigMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    expect(pluginConfigMock.mock.calls.length).toBeGreaterThan(calls);
    wrapper.unmount();
  });

  it('能力卡：名称、成员与最近调用同排，插件说明句不再上列表', async () => {
    const wrapper = await mountLive();
    const rows = wrapper.findAll('.ac-cap');
    expect(rows).toHaveLength(4);
    const text = wrapper.text();
    for (const name of ['联网', '决策', '生图', 'MCP 工具调用', '网页搜索', '网页抓取', '资料采集']) {
      expect(text).toContain(name);
    }
    // 列表只回答「开没开」：成员模型、说明句与路由徽标都不上列表
    expect(text).not.toContain('deepseek-v4-flash');
    expect(text).not.toContain('跟随平台默认');
    expect(text).not.toContain('关闭后');
    expect(text).not.toContain('检索、抓取外部网页');
    const switches = wrapper.findAll('.ac-cap__head .mk-switch');
    expect(switches).toHaveLength(4);
    // 开关不再挂「停用后：…」解释型 title
    expect(switches[0].attributes('title')).toBeUndefined();
    wrapper.unmount();
  });

  it('「查失败」只在有失败调用时出现（零失败的插件不给这颗钮）', async () => {
    const wrapper = await mountLive();
    expect(wrapper.findAll('.ac-cap .mk-link').map((b) => b.text())).not.toContain('查失败');
    wrapper.unmount();
  });

  it('开关直接落库，并跟随返回状态；停用只压信息层', async () => {
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-cap')[0];
    expect(webRow.text()).toContain('启用');
    await webRow.find('.mk-switch').trigger('click');
    await flushPromises();
    expect(pluginSetMock).toHaveBeenCalledWith('web', false);
    expect(wrapper.findAll('.ac-cap')[0].classes()).toContain('is-off');
    expect(wrapper.findAll('.ac-cap')[0].text()).toContain('停用');
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
    const webRow = wrapper.findAll('.ac-cap')[0];
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
    // 2026-10-26：优先级变成可编辑的链（主用 / 备用），不再是一行只读「A → B」
    expect(dialog.findAll('.ac-prio')).toHaveLength(2);
    expect(dialog.text()).toContain('主用');
    expect(dialog.text()).toContain('备用 1');
    // 这是外部服务配置，不是 Skill 的 LLM 模型绑定
    expect(dialog.text()).not.toContain('跟随平台默认');
    expect(dialog.text()).not.toContain('完整运行时');
    wrapper.unmount();
  });

  it('服务配置保存只提交改过的 provider 字段（密钥留空不覆盖）', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-cap')[0].find('.mk-btn').trigger('click');
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

  it('MCP 行不套 provider 配置：新建服务在能力行内，直接打开 MCP 弹窗', async () => {
    const wrapper = await mountLive();
    const mcpRow = wrapper.findAll('.ac-cap').find((r) => r.text().includes('MCP 工具调用'));
    const btn = mcpRow!.findAll('button').find((b) => b.text() === '新建服务');
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"][aria-label="MCP 服务"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="插件服务配置"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('MCP 服务挂在 MCP 全宽能力卡内：同卡子列表，不再另起卡', async () => {
    const wrapper = await mountLive();
    const mcpCard = wrapper.findAll('.ac-cap').find((r) => r.text().includes('MCP 工具调用'))!;
    expect(mcpCard.classes()).toContain('ac-cap--wide');
    expect(mcpCard.findAll('.ac-mcp__row')).toHaveLength(3);
    expect(mcpCard.find('.ac-cap__head .mk-switch').exists()).toBe(true);
    expect(wrapper.findAll('.ac-cap--wide')).toHaveLength(1);
    wrapper.unmount();
  });

  it('MCP 组的服务可用性跟在成员后面，与插件开关是两个维度', async () => {
    const wrapper = await mountLive();
    const mcpRow = wrapper.findAll('.ac-cap').find((r) => r.text().includes('MCP 工具调用'));
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

  it('MCP 行内开关直接落 PUT enabled（不再进编辑弹窗改）', async () => {
    withTools([
      { id: 'tavily', name: 'Tavily MCP', description: '', type: 'http', transport: 'mcp', endpoint: 'https://x/mcp', enabled: true }
    ]);
    const wrapper = await mountLive();
    const sw = wrapper.find('.ac-mcp__row .mk-switch');
    expect(sw.exists()).toBe(true);
    expect(sw.attributes('aria-checked')).toBe('true');
    await sw.trigger('click');
    await flushPromises();
    expect(mcpUpdateMock).toHaveBeenCalledWith('tavily', { enabled: false });
    expect(wrapper.find('.ac-mcp__row .mk-switch').attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('决策配置弹窗：字段只给链上 provider，链外的可「加入备用」再配置', async () => {
    pluginConfigMock.mockResolvedValue({
      data: {
        data: {
          plugins: [
            webConfig(),
            {
              id: 'decision',
              label: '决策',
              channels: [{ id: 'judge', label: '判定', order: ['alibaba'] }],
              providers: [
                { id: 'alibaba', label: '阿里云 MaaS', configured: true, keySource: 'env', keyHint: null, fields: [] },
                { id: 'cloudflare', label: 'Cloudflare', configured: true, keySource: 'db', keyHint: null, fields: [] }
              ]
            },
            { id: 'image', label: '生图', channels: [], providers: [] }
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const decisionRow = wrapper.findAll('.ac-cap').find((r) => r.text().includes('决策'))!;
    await decisionRow.find('.mk-btn').trigger('click');
    await flushPromises();
    // 每次状态变化后重新取：Teleport 子树会重建，旧的 DOMWrapper 会指向已分离的节点
    const dialog = () => wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    // 链上只有主用：不再把 5 家平铺成「都在用」，也不再有「未参与调用」这种负向徽标
    const cards = dialog().findAll('.ac-config-provider');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('阿里云 MaaS');
    expect(dialog().text()).toContain('主用');
    expect(dialog().text()).not.toContain('未参与调用');
    // 链外 provider 仍可加进备用链，加进来后才出现它的字段
    // 2026-10-27 原生 select → MkSelect：按 aria-label 展开并点选 provider
    expect(mkSelectValue(wrapper as never, '把 provider 加入判定备用')).toBe('');
    await chooseMkSelect(wrapper as never, '把 provider 加入判定备用', 'cloudflare');
    await flushPromises();
    expect(dialog().findAll('.ac-config-provider')).toHaveLength(2);
    expect(dialog().text()).toContain('备用 1');
    wrapper.unmount();
  });

  it('优先级可调：上移 / 移出后保存把新顺序一起提交', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-cap')[0].find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = () => wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const searchChain = () => dialog().findAll('.ac-prio')[0];
    const names = () => searchChain().findAll('.ac-prio__name').map((n) => n.text());
    const ops = (label: string) => searchChain().findAll('.ac-prio__op')
      .filter((b) => b.attributes('aria-label') === label);
    // 搜索链：TinyFish（主用）→ Tavily（备用 1）
    expect(names()).toEqual(['TinyFish', 'Tavily']);
    // Tavily 上移成主用
    await ops('上移')[1].trigger('click');
    await flushPromises();
    expect(names()).toEqual(['Tavily', 'TinyFish']);
    // 移出链尾
    await ops('移出链')[1].trigger('click');
    await flushPromises();
    expect(names()).toEqual(['Tavily']);
    // 只剩一个时「移出」禁用（清空会静默回落默认顺序，与界面不一致）
    expect(ops('移出链')[0].attributes('disabled')).toBeDefined();
    // 只改顺序也要能保存，且把 orders 一起提交
    await dialog().findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(pluginSaveMock).toHaveBeenCalledWith('web', {}, {
      search: ['tavily'],
      fetch: ['tinyfish', 'tavily']
    });
    wrapper.unmount();
  });
});
