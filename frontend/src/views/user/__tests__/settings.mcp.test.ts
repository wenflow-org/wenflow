/**
 * Settings「我的 MCP 工具」区块回归：
 * 1. 列表按 transport 区分 MCP / HTTP；
 * 2. 新增工具整表回写 tools（含 transport）；
 * 3. MCP server 测试需带工具名（serverId:toolName 寻址）；
 * 4. 删除后回写不含该工具的 tools。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Settings from '../Settings.vue';

const {
  getUserMcpConfigMock,
  updateUserMcpConfigMock,
  executeMcpToolMock,
  askConfirmMock,
  toastMock
} = vi.hoisted(() => ({
  getUserMcpConfigMock: vi.fn(),
  updateUserMcpConfigMock: vi.fn(),
  executeMcpToolMock: vi.fn(),
  askConfirmMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

vi.mock('@/api/userCustom', () => ({
  getUserApiConfig: vi.fn(async () => ({ data: { enabled: false, endpoint: '', hasApiKey: false } })),
  updateUserApiConfig: vi.fn(async () => ({ data: {} })),
  disableUserApiConfig: vi.fn(async () => ({ data: {} })),
  testApiConnection: vi.fn(async () => ({ data: {} })),
  fetchApiModels: vi.fn(async () => ({ data: { models: [] } })),
  getUserMcpConfig: getUserMcpConfigMock,
  updateUserMcpConfig: updateUserMcpConfigMock,
  executeMcpTool: executeMcpToolMock
}));

vi.mock('@/utils/toast', () => ({ toast: toastMock }));

vi.mock('@/views/admin-redesign/useConfirm', () => ({
  askConfirm: askConfirmMock,
  doneConfirm: vi.fn(),
  failConfirm: vi.fn()
}));

vi.mock('@/components/user/CapabilityShell.vue', () => ({
  default: { template: '<div class="stub-shell"><slot /></div>' }
}));
vi.mock('@/components/user/UcConfirm.vue', () => ({
  default: { template: '<div class="stub-confirm" />' }
}));

async function mountSettings() {
  const w = mount(Settings);
  await flushPromises();
  await flushPromises();
  return w;
}

function toolRow(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper.findAll('.mcp-item').find((r) => r.text().includes(id));
}

const MCP_SERVER = {
  id: 'tavily',
  name: 'Tavily MCP',
  description: '',
  type: 'mcp',
  transport: 'mcp' as const,
  endpoint: 'https://tavily.example/mcp',
  enabled: true
};

const HTTP_TOOL = {
  id: 'my-http',
  name: '我的 HTTP 工具',
  description: '',
  type: 'remote',
  transport: 'http' as const,
  endpoint: 'https://my.example/api',
  enabled: true
};

describe('Settings 我的 MCP 工具', () => {
  beforeEach(() => {
    localStorage.clear();
    getUserMcpConfigMock.mockReset();
    updateUserMcpConfigMock.mockReset();
    executeMcpToolMock.mockReset();
    askConfirmMock.mockReset();
    for (const fn of Object.values(toastMock)) fn.mockReset();

    getUserMcpConfigMock.mockResolvedValue({ data: { data: { tools: [MCP_SERVER, HTTP_TOOL] } } });
    updateUserMcpConfigMock.mockResolvedValue({ data: { data: { tools: [] } } });
    executeMcpToolMock.mockResolvedValue({ data: { data: { ok: true } } });
    askConfirmMock.mockResolvedValue(true);
  });

  it('按 transport 区分 MCP / HTTP 标记', async () => {
    const w = await mountSettings();
    const mcpRow = toolRow(w, 'tavily');
    const httpRow = toolRow(w, 'my-http');

    expect(mcpRow?.find('.mcp-item__kind').text()).toBe('MCP');
    expect(mcpRow?.find('.mcp-item__kind').classes()).toContain('is-mcp');
    expect(httpRow?.find('.mcp-item__kind').text()).toBe('HTTP');
    expect(httpRow?.find('.mcp-item__kind').classes()).not.toContain('is-mcp');
  });

  it('空态提示', async () => {
    getUserMcpConfigMock.mockResolvedValue({ data: { data: { tools: [] } } });
    const w = await mountSettings();
    expect(w.text()).toContain('还没有配置 MCP 工具');
  });

  it('新增工具：整表回写 tools 且带 transport', async () => {
    const w = await mountSettings();
    await w.find('.uc-card__head button.uc-btn--primary').trigger('click');

    const form = w.find('.mcp-form');
    const inputs = form.findAll<HTMLInputElement>('input.uc-field__input');
    await inputs[0].setValue('new-server');      // ID
    await inputs[1].setValue('新服务');           // 名称
    await form.findAll('select')[0].setValue('mcp'); // 连接方式
    await inputs[2].setValue('https://new.example/mcp'); // Endpoint

    await form.find('button.uc-btn--primary').trigger('click');
    await flushPromises();

    expect(updateUserMcpConfigMock).toHaveBeenCalledTimes(1);
    const payload = updateUserMcpConfigMock.mock.calls[0][0];
    const added = payload.tools.find((t: { id: string }) => t.id === 'new-server');
    expect(added).toMatchObject({ id: 'new-server', transport: 'mcp', endpoint: 'https://new.example/mcp' });
    // 既有工具保留
    expect(payload.tools.map((t: { id: string }) => t.id)).toEqual(['tavily', 'my-http', 'new-server']);
  });

  it('新增时重复 ID 被拒绝，不发起写入', async () => {
    const w = await mountSettings();
    await w.find('.uc-card__head button.uc-btn--primary').trigger('click');
    const form = w.find('.mcp-form');
    const inputs = form.findAll<HTMLInputElement>('input.uc-field__input');
    await inputs[0].setValue('tavily');
    await inputs[1].setValue('重复');
    await inputs[2].setValue('https://dup.example/mcp');

    await form.find('button.uc-btn--primary').trigger('click');
    await flushPromises();

    expect(updateUserMcpConfigMock).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining('已存在'));
  });

  it('MCP 未填工具名时测试被拦截，不调用 executeMcpTool', async () => {
    const w = await mountSettings();
    const row = toolRow(w, 'tavily')!;
    const testBtn = row.findAll('button').find((b) => b.text() === '测试')!;
    await testBtn.trigger('click');
    await flushPromises();

    expect(executeMcpToolMock).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining('工具名'));
  });

  it('MCP 填了工具名后以 id:toolName 寻址测试', async () => {
    const w = await mountSettings();
    const row = toolRow(w, 'tavily')!;
    await row.find('input.mcp-item__toolname').setValue('tavily_search');
    const testBtn = row.findAll('button').find((b) => b.text() === '测试')!;
    await testBtn.trigger('click');
    await flushPromises();

    expect(executeMcpToolMock).toHaveBeenCalledWith('tavily:tavily_search', {});
  });

  it('HTTP 工具直接以 id 测试', async () => {
    const w = await mountSettings();
    const row = toolRow(w, 'my-http')!;
    const testBtn = row.findAll('button').find((b) => b.text() === '测试')!;
    await testBtn.trigger('click');
    await flushPromises();

    expect(executeMcpToolMock).toHaveBeenCalledWith('my-http', {});
  });

  it('删除后回写不含该工具的 tools', async () => {
    const w = await mountSettings();
    const row = toolRow(w, 'tavily')!;
    const delBtn = row.findAll('button').find((b) => b.text() === '删除')!;
    await delBtn.trigger('click');
    await flushPromises();

    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(updateUserMcpConfigMock).toHaveBeenCalledTimes(1);
    const payload = updateUserMcpConfigMock.mock.calls[0][0];
    expect(payload.tools.map((t: { id: string }) => t.id)).toEqual(['my-http']);
  });
});
