/**
 * 网络与安全页（2026-11-11 从「访问与注册」收敛）。
 *
 * 原页把三套维度塞进一张卡：入站防火墙（管理后台访问控制）、出站 SSRF 策略、
 * 业务层注册开关。现在：
 *  ① 入站访问控制从界面撤除（仍由部署层 ADMIN_ACCESS_MODE / 反向代理生效，避免 Web 自锁）；
 *  ② 注册设置迁到「用户账号」（见 registration-settings-dialog.test.ts）；
 *  ③ 本页只剩出站网络策略，文案改成「能不能连局域网 Ollama / 本地知识库」的场景说法。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AccessControl from '../AccessControl.vue';
import { liveApiConfig, liveFailures } from '../live';
import { dataSource } from '../store';

const { updateNetworkPolicyMock } = vi.hoisted(() => ({
  updateNetworkPolicyMock: vi.fn(),
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    },
  });
}

vi.mock('@/api/adminApi', () => ({
  adminApiConfigApi: apiObject({ updateNetworkPolicy: updateNetworkPolicyMock }),
  adminPlatformSettingsApi: apiObject(),
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject(),
  adminAgentPromptsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminAchievementsApi: apiObject(),
  adminLearningContentApi: apiObject(),
  adminDevtoolsApi: apiObject(),
  adminApi: apiObject(),
  adminAxios: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} })),
}));

function seedConfig(overrides: Record<string, unknown> = {}) {
  liveApiConfig.value = {
    apiUrl: 'https://api.example.com/v1',
    apiKeyConfigured: true,
    availableModels: ['model-a'],
    defaultModel: 'model-a',
    defaultReasoningModel: 'model-a',
    defaultEvaluationModel: 'model-a',
    defaultThinkingMode: 'default',
    defaultReasoningEffort: 'default',
    connectionStatus: 'connected',
    lastCheckedAt: '2026-08-13T09:00:00.000Z',
    networkPolicy: {
      adminAccessMode: 'private',
      adminAllowedIps: ['203.0.113.10'],
      allowPrivateNetwork: true,
      privateNetworkHosts: [],
    },
    ...overrides,
  } as never;
}

async function mountPage() {
  dataSource.value = 'live';
  const wrapper = mount(AccessControl);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

function saveButton(w: Awaited<ReturnType<typeof mountPage>>) {
  return w.find('.ac-foot button');
}

describe('网络与安全（出站策略）', () => {
  beforeEach(() => {
    updateNetworkPolicyMock.mockReset();
    updateNetworkPolicyMock.mockResolvedValue({ data: { data: {} } });
    liveFailures.value = {};
    seedConfig();
  });

  it('页头只有页名 + 常驻「保存策略」；只剩出站一段，入站与注册不再出现', async () => {
    const w = await mountPage();
    expect(w.find('.mk-pagehead__title').text()).toBe('网络与安全');
    expect(w.find('.mk-pagehead__sub').exists()).toBe(false);
    expect(saveButton(w).text()).toBe('保存策略');

    // 卡头无标题（页签已经在说这一页是什么），只有右侧生效档
    expect(w.findAll('.mk-card__title')).toHaveLength(0);
    expect(w.text()).toContain('本地与内网资源访问');
    expect(w.text()).toContain('Ollama');
    expect(w.text()).not.toContain('管理后台访问控制');
    expect(w.text()).not.toContain('仅本机');
    expect(w.text()).not.toContain('注册设置');
    expect(w.findAll('.ac-opts')).toHaveLength(1);
    expect(w.findAll('.ac-opts')[0].findAll('.ac-opt')).toHaveLength(3);
    w.unmount();
  });

  it('卡头右侧出「当前生效」徽章，改动后补「未保存」', async () => {
    const w = await mountPage();
    const right = () => w.find('.mk-card__head .mk-card__head-right');
    expect(right().text()).toContain('当前生效：允许内网与本地服务');
    expect(right().find('.mk-badge--warn').exists()).toBe(false);

    const deny = w.findAll('.ac-opt').find((r) => r.text().includes('仅限公共互联网'))!;
    await deny.trigger('click');
    await nextTick();
    expect(right().text()).toContain('未保存');
    w.unmount();
  });

  it('三档用场景说法：每张卡自带「这一档意味着什么」，默认档带推荐标记', async () => {
    const w = await mountPage();
    const opts = w.findAll('.ac-opts')[0].findAll('.ac-opt');
    expect(opts.map((o) => o.find('.ac-opt__head b').text())).toEqual([
      '允许内网与本地服务', '仅白名单', '仅限公共互联网',
    ]);
    expect(opts.map((o) => o.find('.ac-opt__desc').text())).toEqual([
      '可连接局域网 / 本机的模型与知识库',
      '公网照常，内网只放行清单里的 Host / IP',
      '禁止向内网 / 本机发请求，公网照常',
    ]);
    expect(opts[0].find('.ac-opt__tag').text()).toBe('推荐');
    // 风险提示只落在选中的那张卡内，屏上没有整条红横幅
    expect(w.findAll('.ac-risk')).toHaveLength(0);
    w.unmount();
  });

  it('脏值只在卡头徽章说一次：卡尾只有主操作', async () => {
    const w = await mountPage();
    await w.findAll('.ac-opt').find((o) => o.text().includes('仅限公共互联网'))!.trigger('click');
    await nextTick();
    expect(w.find('.mk-card__head .mk-card__head-right').text()).toContain('未保存');
    expect(w.findAll('.ac-foot > *')).toHaveLength(1);
    expect(w.find('.ac-foot').text()).toBe('保存策略');
    w.unmount();
  });

  it('radio 契约：选中项 aria-checked=true，只有它可 Tab 进入', async () => {
    const w = await mountPage();
    const radios = w.findAll('.ac-opts')[0].findAll('.ac-opt');
    const checked = radios.filter((r) => r.attributes('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].text()).toContain('允许内网与本地服务');
    expect(radios.map((r) => r.attributes('tabindex'))).toEqual(['0', '-1', '-1']);
    w.unmount();
  });

  it('仅限公共互联网：可直接保存；整域提交时回传入站现值，不悄悄改部署层限制', async () => {
    const w = await mountPage();
    expect(saveButton(w).attributes('disabled')).toBeDefined();

    await w.findAll('.ac-opt').find((o) => o.text().includes('仅限公共互联网'))!.trigger('click');
    await nextTick();
    expect(saveButton(w).attributes('disabled')).toBeUndefined();
    await saveButton(w).trigger('click');
    await flushPromises();

    expect(updateNetworkPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      allowPrivateNetwork: false,
      privateNetworkHosts: [],
      // 入站字段不在本页编辑，但协议是整域提交：必须原样回传服务端现值
      adminAccessMode: 'private',
      adminAllowedIps: ['203.0.113.10'],
    }));
    w.unmount();
  });

  it('仅白名单 + 名单为空：禁用保存，并指路「仅限公共互联网」', async () => {
    const w = await mountPage();
    await w.findAll('.ac-opt').find((b) => b.text().includes('仅白名单'))!.trigger('click');
    await nextTick();
    expect(w.text()).toContain('要禁止内网访问，请直接选「仅限公共互联网」');
    expect(saveButton(w).attributes('disabled')).toBeDefined();

    await w.find('.ac-textarea').setValue('192.168.1.20');
    await nextTick();
    expect(saveButton(w).attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('仅白名单 + 填了清单：保存为不放行全部 + 白名单', async () => {
    const w = await mountPage();
    await w.findAll('.ac-opt').find((b) => b.text().includes('仅白名单'))!.trigger('click');
    await nextTick();
    await w.find('.ac-textarea').setValue('192.168.1.20');
    await nextTick();
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(updateNetworkPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      allowPrivateNetwork: false,
      privateNetworkHosts: ['192.168.1.20'],
    }));
    w.unmount();
  });

  it('读取失败：显式提示「为空不代表未配置」，不把空表单当已配置', async () => {
    liveApiConfig.value = null;
    liveFailures.value = { apiConfig: 'boom' };
    const w = await mountPage();
    expect(w.text()).toContain('网络策略读取失败');
    expect(w.text()).toContain('重试');
    w.unmount();
  });

  it('嵌入系统设置：不出页头，卡头只承载状态，根节点接管页签面板滚动', async () => {
    const w = mount(AccessControl, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    expect(w.find('.mk-pagehead').exists()).toBe(false);
    expect(w.classes()).toContain('acl-host--embedded');
    const head = w.find('.mk-card__head');
    expect(head.find('.mk-card__title').exists()).toBe(false);
    expect(head.find('.mk-badge').text()).toContain('当前生效');
    expect(w.find('.ac-foot button').text()).toBe('保存策略');
    expect(w.find('.ac-foot button').attributes('disabled')).toBeDefined();
    w.unmount();
  });
});
