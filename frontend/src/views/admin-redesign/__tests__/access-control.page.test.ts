/**
 * 访问与注册独立页（2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」）。
 *
 * 从「模型与接入 · 安全与访问」页签拆出：它管后台谁能进来、谁能注册，
 * 与「模型接哪个上游」没有共享对象或动线。本测试钉住：
 *  ① 两张卡在位（后台访问来源【含出站白名单】/ 注册），左右分列
 *  ② 「保存策略」常驻页头，无改动时禁用，保存只提交策略域
 *  ③ 读取失败不伪装成「未配置」
 *  ④ 注册开关是 MkSwitch（布尔配置不用并排双按钮）
 *  ⑤ 配额数字改动走一次显式提交：状态词在写盘成功前不报新值
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AccessControl from '../AccessControl.vue';
import { liveApiConfig, liveFailures, registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota } from '../live';
import { dataSource } from '../store';
import { confirmState, settleConfirm } from '../useConfirm';

const { updateNetworkPolicyMock, updateRegistrationMock, getRegistrationMock, updateQuotaMock, getRegistrationStatusMock } = vi.hoisted(() => ({
  updateNetworkPolicyMock: vi.fn(),
  updateRegistrationMock: vi.fn(),
  getRegistrationMock: vi.fn(),
  updateQuotaMock: vi.fn(),
  getRegistrationStatusMock: vi.fn(),
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

vi.mock('@/api/auth', () => ({
  authAPI: { getRegistrationStatus: getRegistrationStatusMock },
}));

vi.mock('@/api/adminApi', () => ({
  adminApiConfigApi: apiObject({ updateNetworkPolicy: updateNetworkPolicyMock }),
  adminPlatformSettingsApi: apiObject({
    updateRegistrationSetting: updateRegistrationMock,
    getRegistrationSetting: getRegistrationMock,
  }),
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
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
      adminAllowedIps: [],
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
  return w.find('.mk-pagehead__actions button');
}

describe('访问与注册（拆页后的独立页）', () => {
  beforeEach(() => {
    updateNetworkPolicyMock.mockReset();
    updateRegistrationMock.mockReset();
    updateQuotaMock.mockReset();
    updateNetworkPolicyMock.mockResolvedValue({ data: { data: {} } });
    updateRegistrationMock.mockResolvedValue({ data: { data: {} } });
    updateQuotaMock.mockResolvedValue({ data: { data: { registerIpQuotaEnabled: true, registerIpDailyQuota: 20 } } });
    getRegistrationStatusMock.mockReset();
    getRegistrationStatusMock.mockResolvedValue({ registrationEnabled: true, temporaryUnavailable: false });
    liveFailures.value = {};
    registrationEnabled.value = null;
    registerIpQuotaEnabled.value = null;
    registerIpDailyQuota.value = null;
    seedConfig();
  });

  it('页头只有页名 + 常驻「保存策略」；三张卡各在其位', async () => {
    registrationEnabled.value = true;
    registerIpQuotaEnabled.value = false;
    const w = await mountPage();
    expect(w.find('.mk-pagehead__title').text()).toBe('访问与注册');
    expect(w.find('.mk-pagehead__sub').exists()).toBe(false);
    expect(saveButton(w).text()).toBe('保存策略');

    const titles = w.findAll('.mk-card__title').map((t) => t.text());
    // 入站来源与出站白名单同属「一次保存」的策略组，同卡两段；注册单独一卡在右列
    expect(titles).toEqual(['后台访问来源', '注册']);
    expect(w.text()).toContain('访问来源模式');
    expect(w.text()).toContain('服务端出站白名单');
    expect(w.findAll('.ac-radio')).toHaveLength(3);
    w.unmount();
  });

  it('访问来源模式是 radio 组：选中项 aria-checked=true 且只有它可 Tab 进入', async () => {
    const w = await mountPage();
    const radios = w.findAll('.ac-radio');
    const checked = radios.filter((r) => r.attributes('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].text()).toContain('私有网段');
    expect(radios.map((r) => r.attributes('tabindex'))).toEqual(['-1', '0', '-1']);
    w.unmount();
  });

  it('无改动时「保存策略」禁用；改访问来源后启用，确认后只提交策略域', async () => {
    const w = await mountPage();
    expect(saveButton(w).attributes('disabled')).toBeDefined();

    const anyRadio = w.findAll('.ac-radio').find((r) => r.text().includes('不限制'))!;
    await anyRadio.trigger('click');
    await nextTick();
    expect(saveButton(w).attributes('disabled')).toBeUndefined();

    await saveButton(w).trigger('click');
    await nextTick();
    expect(confirmState.open).toBe(true);
    settleConfirm(true);
    await flushPromises();
    expect(updateNetworkPolicyMock).toHaveBeenCalledTimes(1);
    expect(updateNetworkPolicyMock.mock.calls[0][0]).toMatchObject({ adminAccessMode: 'any' });
    expect(saveButton(w).attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('仅白名单 + 名单为空：禁用保存并写明后果', async () => {
    const w = await mountPage();
    const seg = w.findAll('.mk-seg__item').find((b) => b.text() === '仅白名单')!;
    await seg.trigger('click');
    await nextTick();
    expect(w.text()).toContain('服务端将无法请求任何内网地址');
    expect(saveButton(w).attributes('disabled')).toBeDefined();

    const hosts = w.findAll('.ac-textarea')[1];
    await hosts.setValue('192.168.1.20');
    await nextTick();
    expect(saveButton(w).attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('读取失败：显式提示「为空不代表未配置」，不把空表单当已配置', async () => {
    liveApiConfig.value = null;
    liveFailures.value = { apiConfig: 'boom' };
    const w = await mountPage();
    expect(w.text()).toContain('访问策略读取失败');
    expect(w.text()).toContain('重试');
    w.unmount();
  });

  it('注册开关是 MkSwitch：一枚 role=switch + 状态词，不再并排双按钮', async () => {
    registrationEnabled.value = false;
    registerIpQuotaEnabled.value = false;
    const w = await mountPage();
    const sw = w.find('[role="switch"][aria-label="新用户注册"]');
    expect(sw.exists()).toBe(true);
    expect(sw.attributes('aria-checked')).toBe('false');
    expect(sw.text()).toContain('仅管理员创建');
    expect(w.text()).not.toContain('开放注册');
    // 关闭注册时给出「新建用户」出口
    expect(w.findAll('button').some((b) => b.text().includes('新建用户'))).toBe(true);
    expect(w.find('[role="switch"][aria-label="单 IP 每日注册配额"]').exists()).toBe(true);
    w.unmount();
  });

  it('注册状态词用生效值：配置开但核心服务阻断时如实说暂时无法注册', async () => {
    registrationEnabled.value = true;
    registerIpQuotaEnabled.value = false;
    getRegistrationStatusMock.mockResolvedValue({ registrationEnabled: false, temporaryUnavailable: true });
    const w = await mountPage();
    await flushPromises();
    expect(w.text()).toContain('已开放 · 核心服务异常，暂时无法注册');
    w.unmount();
  });

  it('配额数字改动后出现「保存上限」；写盘成功前状态词仍报旧值', async () => {
    registrationEnabled.value = true;
    registerIpQuotaEnabled.value = true;
    registerIpDailyQuota.value = 5;
    updateRegistrationMock.mockResolvedValue({
      data: { data: { registerIpQuotaEnabled: true, registerIpDailyQuota: 20 } },
    });
    const w = await mountPage();
    expect(w.text()).toContain('已启用 · 每 IP 每日 5 个');

    const input = w.find('.ac-quota-field input');
    (input.element as HTMLInputElement).value = '20';
    await input.trigger('change');
    await nextTick();
    // 未保存：状态词不得先变
    expect(w.text()).toContain('已启用 · 每 IP 每日 5 个');
    const save = w.findAll('button').find((b) => b.text() === '保存上限');
    expect(save, '改上限后应出现保存钮').toBeTruthy();

    await save!.trigger('click');
    await flushPromises();
    expect(updateRegistrationMock).toHaveBeenCalledWith({ registerIpQuotaEnabled: true, registerIpDailyQuota: 20 });
    expect(w.text()).toContain('已启用 · 每 IP 每日 20 个');
    w.unmount();
  });

  it('注册开关与配额在加载完成前不渲染（null = 未加载，不伪装成关）', async () => {
    const w = await mountPage();
    expect(w.findAll('.mk-card__title').map((t) => t.text())).toEqual(['后台访问来源']);
    expect(w.text()).toContain('服务端出站白名单');
    w.unmount();
  });
});
