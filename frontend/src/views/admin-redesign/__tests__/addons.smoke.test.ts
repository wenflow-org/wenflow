/**
 * Addons 插件页冒烟：
 * 1. 独立页页头（插件），刷新走顶栏广播、不再有第二颗刷新钮
 * 2. 按用户可见能力分组：联网 / 决策 / 生图 / MCP，成员 Skill id 可见
 * 3. 路由状态只说「有没有单独配置」，`enabled=false` 不写成「能力已关闭」
 * 4. live 模式：后端配置 + MCP 工具列表渲染
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import Addons from '../Addons.vue';
import { dataSource } from '../store';
import { liveRefreshSeq } from '../live';

const { configsMock, mcpListMock, listMcpToolsMock, updateConfigMock } = vi.hoisted(() => ({
  configsMock: vi.fn(),
  mcpListMock: vi.fn(),
  listMcpToolsMock: vi.fn(),
  updateConfigMock: vi.fn()
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
  adminSkillsApi: apiObject({ getSkillModelConfigs: configsMock, updateSkillModelConfig: updateConfigMock }),
  adminMcpApi: apiObject({ list: mcpListMock, listMcpTools: listMcpToolsMock }),
  adminApiConfigApi: apiObject({ getModelCatalog: vi.fn(async () => ({ data: { data: { models: [] } } })) })
}));

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(Addons, { global: { stubs: { teleport: true } } });
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
    const calls = configsMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    expect(configsMock.mock.calls.length).toBeGreaterThan(calls);
    wrapper.unmount();
  });

  it('能力表：一行一组，成员 Skill 显示中文名、内部 id 进悬停；降级行为只在行悬停里', async () => {
    const wrapper = await mountLive();
    const rows = wrapper.findAll('.ac-pi-table tbody tr');
    expect(rows).toHaveLength(4);
    const text = wrapper.text();
    for (const name of ['联网', '决策', '生图', 'MCP 工具调用', '网页搜索', '网页抓取']) {
      expect(text).toContain(name);
    }
    // 2026-10-23 运营视角：chip 上不再并排印内部 id（读作「网页搜索web-search」），id 退到悬停
    const memberTitles = wrapper.findAll('.ac-pi__member').map((m) => m.attributes('title') || '').join(' | ');
    for (const id of ['web-search', 'web-fetch', 'material-collector', 'decision-gate', 'text-to-image', 'mcp-tool']) {
      expect(memberTitles).toContain(id);
    }
    expect(text).not.toContain('web-search');
    // 2026-10-21 重设计：原「关闭后」段落与「停用插件 ≠ 停用流程」说明条撤出正文，降级行为进行悬停
    expect(text).not.toContain('关闭后');
    expect(text).not.toContain('停用插件 ≠ 停用流程');
    expect(rows[0].attributes('title')).toContain('停用后：');
    wrapper.unmount();
  });

  it('路由状态落到成员行：已配置的成员给实际模型，未配置的显示跟随平台默认', async () => {
    configsMock.mockResolvedValue({
      data: { data: { configs: [{ skillId: 'web-search', displayName: '网页搜索', model: 'deepseek-v4.1-flash' }] } }
    });
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-pi-table tbody tr').find((r) => r.text().includes('联网'));
    expect(webRow).toBeTruthy();
    // 组级「已单独配置」徽标撤除后，状态与动作同处：每个成员自己带路由标签 + 配置入口
    expect(webRow!.text()).toContain('deepseek-v4.1-flash');
    expect(webRow!.text()).toContain('跟随平台默认');
    const members = webRow!.findAll('.ac-pi__member');
    expect(members.map((m) => m.text())).toEqual(['网页搜索', '网页抓取', '资料采集']);
    expect(members[0].attributes('title')).toContain('web-search');
    expect(members[0].attributes('title')).toContain('deepseek-v4.1-flash');
    expect(members[1].attributes('title')).toContain('平台默认路由');
    expect(webRow!.findAll('.ac-pi__cfg')).toHaveLength(3);
    wrapper.unmount();
  });

  it('enabled=false 只表示自定义路由停用，不写成能力已关闭', async () => {
    configsMock.mockResolvedValue({
      data: { data: { configs: [{ skillId: 'web-search', displayName: '网页搜索', enabled: false }] } }
    });
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-pi-table tbody tr').find((r) => r.text().includes('联网'));
    expect(webRow).toBeTruthy();
    expect(webRow!.text()).toContain('路由停用');
    expect(webRow!.text()).not.toContain('能力已关闭');
    wrapper.unmount();
  });

  it('成员「配置」打开模型路由快配，保存走单 Skill 接口（只改模型与层级）', async () => {
    updateConfigMock.mockResolvedValue({ data: { data: {} } });
    const wrapper = await mountLive();
    const webRow = wrapper.findAll('.ac-pi-table tbody tr').find((r) => r.text().includes('联网'));
    const cfg = webRow!.findAll('.ac-pi__cfg')[0];
    expect(cfg.attributes('aria-label')).toContain('网页搜索');
    await cfg.trigger('click');
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('配置模型路由');
    // 当前配置的模型回填（web-search = deepseek-v4-flash）
    expect(dialog.text()).toContain('deepseek-v4-flash');
    await dialog.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(updateConfigMock).toHaveBeenCalledWith('web-search', { model: 'deepseek-v4-flash', tier: 'chat' });
    wrapper.unmount();
  });

  it('MCP 组同时显示服务可用性与模型路由，两个维度不混成一个词', async () => {
    const wrapper = await mountLive();
    const mcpRow = wrapper.findAll('.ac-pi-table tbody tr').find((r) => r.text().includes('MCP 工具调用'));
    expect(mcpRow).toBeTruthy();
    expect(mcpRow!.text()).toContain('deepseek-v4-flash'); // 成员路由
    expect(mcpRow!.text()).toContain('3 个服务启用');      // 服务可用性
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
