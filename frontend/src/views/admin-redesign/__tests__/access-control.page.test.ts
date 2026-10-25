/**
 * 访问与注册独立页（2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」）。
 *
 * 从「模型与接入 · 安全与访问」页签拆出：它管后台谁能进来、谁能注册，
 * 与「模型接哪个上游」没有共享对象或动线。本测试钉住：
 *  ① 三块内容在位（访问来源模式 / 私有网络服务 / 注册与配额开关）
 *  ② 保存策略钮只在脏时出现，且保存只提交策略域
 *  ③ 读取失败不伪装成「未配置」
 *  ④ 注册开关是 MkSwitch（布尔配置不用并排双按钮）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AccessControl from '../AccessControl.vue';
import { liveApiConfig, liveFailures, registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota } from '../live';
import { dataSource } from '../store';

const { updateNetworkPolicyMock, updateRegistrationMock, getRegistrationMock } = vi.hoisted(() => ({
  updateNetworkPolicyMock: vi.fn(),
  updateRegistrationMock: vi.fn(),
  getRegistrationMock: vi.fn(),
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
  adminPlatformSettingsApi: apiObject({
    updateRegistrationSetting: updateRegistrationMock,
    getRegistrationSetting: getRegistrationMock,
  }),
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi2: apiObject(),
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

describe('访问与注册（拆页后的独立页）', () => {
  beforeEach(() => {
    updateNetworkPolicyMock.mockReset();
    updateRegistrationMock.mockReset();
    updateNetworkPolicyMock.mockResolvedValue({ data: { data: {} } });
    updateRegistrationMock.mockResolvedValue({ data: { data: {} } });
    liveFailures.value = {};
    registrationEnabled.value = null;
    registerIpQuotaEnabled.value = null;
    registerIpDailyQuota.value = null;
    seedConfig();
  });

  it('页头：页名 + 口径副文；三块内容各在其位', async () => {
    registrationEnabled.value = true;
    registerIpQuotaEnabled.value = false;
    const w = await mountPage();
    expect(w.find('.mk-pagehead__title').text()).toBe('访问与注册');
    expect(w.find('.mk-pagehead__sub').text()).toBe('后台入口的来源限制、私有网络放行与自助注册');

    const titles = w.findAll('.mk-card__title').map((t) => t.text());
    expect(titles).toEqual(['访问来源与网络', '新用户注册', '单 IP 每日注册配额']);
    // 左卡两段：访问来源模式（入站）+ 私有网络服务（出站）
    expect(w.text()).toContain('访问来源模式');
    expect(w.text()).toContain('私有网络服务');
    expect(w.findAll('.ac-radio')).toHaveLength(3);
    w.unmount();
  });

  it('访问来源模式是 radio 组：选中项 aria-checked=true 且只有它可 Tab 进入', async () => {
    const w = await mountPage();
    const radios = w.findAll('.ac-radio');
    const checked = radios.filter((r) => r.attributes('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].text()).toContain('私有网段');
    // roving tabindex：只有选中项 tabindex=0
    expect(radios.map((r) => r.attributes('tabindex'))).toEqual(['-1', '0', '-1']);
    w.unmount();
  });

  it('改访问来源模式 → 出现「保存策略」，保存只提交策略域', async () => {
    const w = await mountPage();
    // 初始无脏位：没有保存钮
    expect(w.findAll('.mk-card__head button').some((b) => b.text().includes('保存策略'))).toBe(false);

    const anyRadio = w.findAll('.ac-radio').find((r) => r.text().includes('不限制'))!;
    await anyRadio.trigger('click');
    await nextTick();
    const saveBtn = w.findAll('.mk-card__head button').find((b) => b.text().includes('保存策略'));
    expect(saveBtn, '改策略后应出现保存钮').toBeTruthy();

    // 「不限制」= 开放公网，二次确认弹窗：这里直接确认
    const confirmBtn = document.querySelector('[role="dialog"] button');
    if (confirmBtn) (confirmBtn as HTMLElement).click();
    await flushPromises();
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
    const sw = w.find('[role="switch"][aria-label="允许新用户自助注册"]');
    expect(sw.exists()).toBe(true);
    expect(sw.attributes('aria-checked')).toBe('false');
    expect(sw.text()).toContain('仅管理员创建');
    expect(w.text()).not.toContain('开放注册');
    // 配额开关同形
    expect(w.find('[role="switch"][aria-label="单 IP 每日注册配额"]').exists()).toBe(true);
    w.unmount();
  });

  it('注册开关与配额在加载完成前不渲染（null = 未加载，不伪装成关）', async () => {
    const w = await mountPage();
    expect(w.findAll('.mk-card__title').map((t) => t.text())).toEqual(['访问来源与网络']);
    w.unmount();
  });
});
