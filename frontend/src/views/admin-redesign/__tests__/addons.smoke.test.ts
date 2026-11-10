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

const { mcpListMock, mcpUpdateMock, listMcpToolsMock, pluginListMock, pluginSetMock, pluginConfigMock, pluginSaveMock, pluginProbeMock } = vi.hoisted(() => ({
  mcpListMock: vi.fn(),
  mcpUpdateMock: vi.fn(),
  listMcpToolsMock: vi.fn(),
  pluginListMock: vi.fn(),
  pluginSetMock: vi.fn(),
  pluginConfigMock: vi.fn(),
  pluginSaveMock: vi.fn(),
  pluginProbeMock: vi.fn()
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
    saveConfig: pluginSaveMock,
    testProvider: pluginProbeMock
  }),
  adminApiConfigApi: apiObject({ getModelCatalog: vi.fn(async () => ({ data: { data: { models: [] } } })) })
}));

/**
 * 联网（2026-11-07 契约）：地址与顺序都可改——provider 回三个字段（搜索 / 抓取地址 + 密钥），
 * 字段顺序仍是「地址 → 地址 → 密钥」，弹窗按「密钥在前」重排后展示。
 * 空的地址 = 用官方默认：placeholder 就是当前生效值，保存时与初始值相同则不提交。
 */
function webConfig() {
  const keyField = (placeholder: string) =>
    ({ key: 'apiKey', label: '密钥', type: 'password', value: '', placeholder, secret: true });
  const apiUrl = (key: string, label: string, placeholder: string) =>
    ({ key, label, type: 'text', value: '', placeholder, secret: false });
  const order = ['tinyfish', 'tavily', 'exa'];
  return {
    id: 'web',
    label: '联网',
    channels: [
      // 搜索不做链式降级（与后端 single 对齐），抓取仍是降级链
      { id: 'search', label: '搜索', order: [order[0]], single: true },
      { id: 'fetch', label: '抓取', order }
    ],
    providers: [
      {
        id: 'tinyfish', label: 'TinyFish', configured: true, keySource: 'env', keyHint: '····abcd',
        fields: [
          apiUrl('searchEndpoint', '搜索地址', 'https://api.search.tinyfish.ai'),
          apiUrl('fetchEndpoint', '抓取地址', 'https://api.fetch.tinyfish.ai'),
          keyField('已配置 ····abcd')
        ]
      },
      {
        id: 'tavily', label: 'Tavily', configured: false, keySource: 'none', keyHint: null,
        fields: [
          apiUrl('searchEndpoint', '搜索地址', 'https://api.tavily.com/search'),
          apiUrl('fetchEndpoint', '抓取地址', 'https://api.tavily.com/extract'),
          keyField('未配置')
        ]
      },
      {
        id: 'exa', label: 'Exa', configured: false, keySource: 'none', keyHint: null,
        fields: [
          apiUrl('searchEndpoint', '搜索地址', 'https://api.exa.ai/search'),
          apiUrl('fetchEndpoint', '抓取地址', 'https://api.exa.ai/contents'),
          keyField('未配置')
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
  pluginProbeMock.mockReset();
  pluginProbeMock.mockResolvedValue({
    data: { data: { ok: true, detail: '搜索可达，返回 1 条', latencyMs: 320 } }
  });
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
  it('独立页形态：三种内置能力 1 行 3 列、MCP 通栏，刷新跟着顶栏广播走', async () => {
    const wrapper = await mountLive();
    expect(wrapper.find('.mk-page').exists()).toBe(true);
    const head = wrapper.find('.mk-pagehead');
    expect(head.exists()).toBe(true);
    expect(head.text()).toContain('插件');
    // 页头副文已删；2026-10-27 新建入口跟着 MCP 能力行走，页头不再挂全局动作
    expect(head.find('.mk-pagehead__sub').exists()).toBe(false);
    expect(head.findAll('.mk-pagehead__actions button')).toEqual([]);
    /* 2026-11-07 用户「四根拉长的扁担」：单列四卡在新版卡面（说明 + 配置摘要 + 卡脚）
       下更浪费纵向——三种内置能力改 1 行 3 列，MCP 因带服务子列表独占整行。
       列数只在内置能力之间统一，MCP 的宽度由内容决定。 */
    expect(wrapper.findAll('.ac-cap')).toHaveLength(4);
    expect(wrapper.find('.ac-list').exists()).toBe(true);
    expect(wrapper.findAll('.ac-cap--mcp')).toHaveLength(1);
    expect(wrapper.find('.ac-cap-grid').exists()).toBe(false);
    expect(wrapper.find('.ac-cap--wide').exists()).toBe(false);
    // 每张卡都是 .mk-card：卡头 / 切面样式与「系统设置」里那三张模型卡同源
    expect(wrapper.findAll('.ac-cap.mk-card')).toHaveLength(4);
    expect(wrapper.findAll('.ac-cap .mk-card__head')).toHaveLength(4);
    expect(wrapper.findAll('.ac-cap .mk-card__title')).toHaveLength(4);
    expect(wrapper.find('.ac-mcp-card').exists()).toBe(false);
    expect(wrapper.find('.ac-cap .ac-mcp__row').exists()).toBe(true);
    /* 2026-11-05 用户「这种说明文案不要」：区头那行「4 项能力 · 6 个 Skill」是把下方
       四张卡再数一遍，撤除；区头只剩区名（读失败的徽标才保留）。 */
    const sectionHead = wrapper.find('.ac-section__head');
    expect(sectionHead.text()).toBe('可选能力');
    expect(sectionHead.find('.mk-badge').exists()).toBe(false);
    expect(wrapper.find('.ac-section__meta').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('项能力 ·');
    // 顶栏刷新 = liveRefreshSeq 广播 → 本页与旧页头刷新钮同一入口重拉
    const calls = pluginConfigMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    expect(pluginConfigMock.mock.calls.length).toBeGreaterThan(calls);
    wrapper.unmount();
  });

  it('能力卡：说明、成员、配置摘要与累计调用都在卡上，入口在卡脚', async () => {
    const wrapper = await mountLive();
    const rows = wrapper.findAll('.ac-cap');
    expect(rows).toHaveLength(4);
    const text = wrapper.text();
    for (const name of ['联网', '决策与核验 (JEV)', '生图', 'MCP 工具调用', '网页搜索', '网页抓取', '资料采集']) {
      expect(text).toContain(name);
    }
    /* 2026-11-07 用户「四张卡只有名字，得点进配置才知道在用谁」：
       目录里的能力说明重新上卡（此前按「不要说明文案」整句撤除），
       配置摘要直接读已保存的服务配置。 */
    expect(wrapper.findAll('.ac-cap__desc')).toHaveLength(4);
    expect(text).toContain('在目标对话与资料采集时检索、抓取外部网页。');
    const webFacts = rows[0].find('.ac-cap__facts').text();
    expect(webFacts).toContain('主用');
    expect(webFacts).toContain('TinyFish');
    // 搜索已改单档（无备选），抓取仍是降级链：摘要里用「→」列出备选顺序
    expect(webFacts).toContain('抓取');
    expect(webFacts).toContain('→');
    // 抓取链的备选按降级顺序列出（TinyFish → Tavily → Exa）
    expect(webFacts).toContain('Tavily → Exa');
    // 没有配置数据的卡（决策 / 生图 fixture 里为空）不渲染空摘要
    expect(rows[1].find('.ac-cap__facts').exists()).toBe(false);
    expect(rows[0].find('.ac-cap__calls').text()).toContain('累计 0 次调用');
    // 列表仍不回答 Skill 的 LLM 路由问题
    expect(text).not.toContain('deepseek-v4-flash');
    expect(text).not.toContain('跟随平台默认');
    expect(text).not.toContain('关闭后');
    const switches = wrapper.findAll('.ac-cap__head .mk-switch');
    expect(switches).toHaveLength(4);
    expect(switches[0].attributes('title')).toBeUndefined();
    /* 入口从卡头（与绿开关并排）下移到卡脚，并降为次要描边按钮——
       本页没有唯一主操作，实心主色不在这里和开关抢视觉。 */
    const entries = wrapper.findAll('.ac-cap__foot button');
    expect(entries.map((b) => b.text())).toEqual(['配置', '配置', '配置', '新建服务']);
    expect(entries.every((b) => b.classes().includes('mk-btn'))).toBe(true);
    expect(entries.some((b) => b.classes().includes('mk-btn--primary'))).toBe(false);
    expect(wrapper.findAll('.ac-cap__head .mk-btn').length).toBe(0);
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

  /* 2026-11-07 用户「联网的地址要能换成第三方兼容端点，顺序也要能排」：
     2026-11-04 那版把地址与顺序锁成只读（弹窗只剩三只密钥框），现在三个能力共用一套弹窗。 */
  it('配置弹窗：联网三家的端点与顺序都可改，密钥排第一列', async () => {
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-cap')[0];
    await webRow.find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('联网 · 服务配置');
    // 搜索 / 抓取两条链都在界面上，主用可换（不再是一行只读的「尝试顺序」）
    expect(dialog.findAll('.ac-row')).toHaveLength(2);
    // 搜索：不做链式降级 → 只有一个选择位（无「主用/备用」）
    expect(dialog.findAll('.ac-row')[0].text()).not.toContain('备用');
    /* 2026-11-10 重设计：单选通道只留一个选择器——此前左侧还挂一枚同名胶囊，
       与下拉里的服务名重复。 */
    expect(dialog.findAll('.ac-row')[0].findAll('.ac-prio__item')).toHaveLength(0);
    expect(dialog.findAll('.ac-row')[0].findAll('.mk-select')).toHaveLength(1);
    // 抓取：仍是降级链，第一枚是主用
    expect(dialog.findAll('.ac-row')[1].text()).toContain('主用');
    expect(dialog.find('.ac-config-order').exists()).toBe(false);
    const cards = dialog.findAll('.ac-config-provider');
    expect(cards.map((c) => c.find('.ac-config-provider__name').text())).toEqual(['TinyFish', 'Tavily', 'Exa']);
    // 每家 3 个字段：密钥第一列（用户「API key 在左」），两个地址在后
    expect(cards.every((c) => c.findAll('input').length === 3)).toBe(true);
    expect(cards[0].findAll('input')[0].attributes('type')).toBe('password');
    expect(cards[0].text()).toContain('搜索地址');
    expect(cards[0].text()).toContain('抓取地址');
    // 地址框带出当前生效值：留空 = 官方默认，不需要手抄一遍
    expect((cards[1].findAll('input')[1].element as HTMLInputElement).value).toBe('https://api.tavily.com/search');
    // 「设为主用」只给非首位 provider
    expect(cards[0].find('.ac-config-provider__primary').exists()).toBe(false);
    expect(cards[1].find('.ac-config-provider__primary').exists()).toBe(true);
    /* 2026-11-05 用户「这种文案不要…注释型文案不要出现」：弹窗里不再有整句说明。 */
    expect(dialog.text()).not.toContain('资料采集不单独配密钥');
    expect(dialog.text()).not.toContain('依次尝试');
    expect(dialog.text()).not.toContain('跟随平台默认');
    wrapper.unmount();
  });

  it('联网：改端点、设为主用都能落盘（顺序与地址一起提交）', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-cap')[0].find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = () => wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const tavily = () => dialog().findAll('.ac-config-provider')[1];
    await tavily().findAll('input')[1].setValue('https://proxy.example/search');
    await tavily().find('.ac-config-provider__primary').trigger('click');
    await flushPromises();
    // 设为主用 = 把它提到所在链的第一位；搜索已是单档（不参与主用/备用），只有抓取链会变
    // 2026-11-10：搜索行只剩选择器（不再有同名胶囊），断言读选择器当前值
    expect(dialog().findAll('.ac-row')[0].find('.mk-select__value').text()).toBe('TinyFish');
    expect(dialog().findAll('.ac-row')[1].find('.ac-prio__name').text()).toBe('Tavily');
    await dialog().findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(pluginSaveMock).toHaveBeenCalledWith(
      'web',
      { tavily: { searchEndpoint: 'https://proxy.example/search' } },
      // 搜索单档只提交选中的那一家；抓取按「设为主用」提到 Tavily
      { search: ['tinyfish'], fetch: ['tavily', 'tinyfish', 'exa'] }
    );
    wrapper.unmount();
  });

  it('每个 provider 可单独测试：只探这一家，结果写在这张卡上', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-cap')[0].find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = () => wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const tavily = () => dialog().findAll('.ac-config-provider')[1];
    await tavily().find('.ac-config-provider__test').trigger('click');
    await flushPromises();
    expect(pluginProbeMock).toHaveBeenCalledWith('web', 'tavily');
    const probe = tavily().find('.ac-config-provider__probe');
    expect(probe.text()).toContain('搜索可达，返回 1 条');
    expect(probe.text()).toContain('320ms');
    expect(probe.classes()).toContain('is-ok');
    // 失败时展示上游原文（不包装、不截断）
    pluginProbeMock.mockResolvedValue({ data: { data: { ok: false, detail: '401 Unauthorized', latencyMs: 88 } } })
    await tavily().find('.ac-config-provider__test').trigger('click');
    await flushPromises();
    expect(tavily().find('.ac-config-provider__probe').text()).toBe('401 Unauthorized');
    expect(tavily().find('.ac-config-provider__probe').classes()).toContain('is-bad');
    wrapper.unmount();
  });

  it('服务配置保存只提交改过的 provider 字段（密钥留空不覆盖）', async () => {
    const wrapper = await mountLive();
    await wrapper.findAll('.ac-cap')[0].find('.mk-btn').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const tavily = dialog.findAll('.ac-config-provider').find((p) => p.text().includes('Tavily'));
    expect(tavily).toBeTruthy();
    // 密钥排第一列
    await tavily!.findAll('input')[0].setValue('tvly-new-key');
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

  it('MCP 服务挂在 MCP 能力卡内：同卡子列表，不再另起卡', async () => {
    const wrapper = await mountLive();
    const mcpCard = wrapper.findAll('.ac-cap').find((r) => r.text().includes('MCP 工具调用'))!;
    // 2026-11-05：与其他三张同宽同形（不再有 --wide 修饰类）
    expect(mcpCard.classes()).toContain('mk-card');
    expect(mcpCard.findAll('.ac-mcp__row')).toHaveLength(3);
    expect(mcpCard.find('.ac-cap__head .mk-switch').exists()).toBe(true);
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

  /* 2026-11-07：入口从卡头下移到卡脚后，卡头的右组只剩开关；
     MCP 服务行仍是「读数 + 开关 + 定宽动作列」。 */
  it('右组：卡头只留开关，MCP 服务行是「读数 + 开关 + 动作列」', async () => {
    const wrapper = await mountLive();
    for (const cap of wrapper.findAll('.ac-cap')) {
      const head = cap.find('.ac-cap__head');
      expect(head.find('.mk-switch').exists()).toBe(true);
      expect(head.find('.ac-ctl').exists()).toBe(false);
      expect(head.find('.ac-ctl__acts').exists()).toBe(false);
    }

    const row = wrapper.find('.ac-mcp__row');
    expect(row.find('.ac-mcp__main .ac-mcp__meta').exists()).toBe(true);
    const ctl = row.find('.ac-ctl');
    expect(ctl.find('.mk-switch').exists()).toBe(true);
    expect(ctl.find('.mk-actions').classes()).toContain('ac-ctl__acts');
    // 配置在行内（启用 | 测试 | 配置），删除留在 ⋯ 菜单
    const acts = ctl.findAll('.ac-ctl__acts .mk-link').map((b) => b.text());
    expect(acts).toContain('测试');
    expect(acts).toContain('配置');
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

  /* 联网的顺序 2026-11-04 起内置，这条改用决策通道验证同一套排序机制 */
  it('优先级可调：上移 / 移出后保存把新顺序一起提交', async () => {
    pluginConfigMock.mockResolvedValue({
      data: {
        data: {
          plugins: [
            webConfig(),
            {
              id: 'decision',
              label: '决策',
              channels: [{ id: 'judge', label: '判定', order: ['alibaba', 'cloudflare'], orderFixed: false }],
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
    const dialog = () => wrapper.find('[role="dialog"][aria-label="插件服务配置"]');
    const chain = () => dialog().findAll('.ac-row')[0];
    const names = () => chain().findAll('.ac-prio__name').map((n) => n.text());
    const ops = (label: string) => chain().findAll('.ac-prio__op')
      .filter((b) => b.attributes('aria-label') === label);
    expect(names()).toEqual(['阿里云 MaaS', 'Cloudflare']);
    await ops('上移')[1].trigger('click');
    await flushPromises();
    expect(names()).toEqual(['Cloudflare', '阿里云 MaaS']);
    await ops('移出链')[1].trigger('click');
    await flushPromises();
    expect(names()).toEqual(['Cloudflare']);
    // 只剩一个时排序与移出整体隐藏（清空会静默回落默认顺序，与界面不一致）
    expect(ops('移出链')).toHaveLength(0);
    expect(ops('上移')).toHaveLength(0);
    // 只改顺序也要能保存，且把 orders 一起提交
    await dialog().findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(pluginSaveMock).toHaveBeenCalledWith('decision', {}, { judge: ['cloudflare'] });
    wrapper.unmount();
  });
});
