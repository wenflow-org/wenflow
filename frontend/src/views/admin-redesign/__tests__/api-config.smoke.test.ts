/**
 * ApiConfig.vue P1 修复批冒烟：
 * 1. 能力健康汇总角标（「5 能力 · N 异常」）
 * 2. 脏位分域标注（连接/路由/策略/可靠性/探测 分组列出）
 * 3. 快照过期语义 + 页面进入自动探测（stale → 自动补一次探测）+ 状态条与能力行时间同源
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ApiConfig from '../ApiConfig.vue';
import { dataSource } from '../store';
import { liveApiConfig } from '../live';

const { getConfigMock, getCapabilitiesMock, probeCapabilitiesMock, getProbeSettingsMock, getReliabilityMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getCapabilitiesMock: vi.fn(),
  probeCapabilitiesMock: vi.fn(),
  getProbeSettingsMock: vi.fn(),
  getReliabilityMock: vi.fn(),
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
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject({
    getReliabilitySettings: getReliabilityMock,
    getRegistrationSetting: vi.fn(async () => ({ data: { data: { registrationEnabled: false } } }))
  }),
  adminCapabilityProbeApi: apiObject({
    getSettings: getProbeSettingsMock
  }),
  adminSystemApi: apiObject({
    getCapabilities: getCapabilitiesMock,
    probeCapabilities: probeCapabilitiesMock
  }),
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
  adminApiConfigApi: apiObject({
    getConfig: getConfigMock
  }),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function makeCapability(id: string, status: 'operational' | 'degraded' | 'unavailable' | 'unknown', checkedAt: string | null) {
  return { id, status, checkedAt, latencyMs: status === 'operational' ? 300 : null, message: '服务正常', failureCode: null, retryable: true, lastSuccessAt: null };
}

function makeSnapshot(overrides: Partial<Record<'overall' | 'stale', string | boolean>> = {}) {
  return {
    overall: 'operational',
    checkedAt: '2026-08-13T10:00:00.000Z',
    stale: false,
    capabilities: [
      makeCapability('goal-conversation', 'operational', '2026-08-13T10:00:00.000Z'),
      makeCapability('path-planning', 'operational', '2026-08-13T10:00:00.000Z'),
      makeCapability('stage-designer', 'degraded', '2026-08-13T10:00:00.000Z'),
      makeCapability('teaching-turn', 'operational', '2026-08-13T10:00:00.000Z'),
      makeCapability('session-wrapup', 'operational', '2026-08-13T10:00:00.000Z')
    ],
    ...overrides
  };
}

async function mountApiConfig() {
  dataSource.value = 'live';
  const wrapper = mount(ApiConfig);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('ApiConfig P1 修复批', () => {
  beforeEach(() => {
    getConfigMock.mockReset();
    getCapabilitiesMock.mockReset();
    probeCapabilitiesMock.mockReset();
    getProbeSettingsMock.mockReset();
    getReliabilityMock.mockReset();
    dataSource.value = 'live';
    liveApiConfig.value = null;
    getConfigMock.mockResolvedValue({
      data: {
        data: {
          apiUrl: 'https://api.example.com/v1',
          apiKeyConfigured: true,
          availableModels: ['model-a', 'model-b'],
          defaultModel: 'model-a',
          defaultReasoningModel: 'model-a',
          defaultEvaluationModel: 'model-b',
          connectionStatus: 'connected',
          lastCheckedAt: '2026-08-13T09:00:00.000Z',
          networkPolicy: { adminAccessMode: 'private', adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
        }
      }
    });
    getProbeSettingsMock.mockResolvedValue({ data: { data: { enabled: false, intervalMs: 120000, minIntervalMs: 10000, maxIntervalMs: 86400000 } } });
    getReliabilityMock.mockResolvedValue({ data: { data: { settings: { maxUpstreamAttempts: 3, maxTransportRetries: 1, maxLogicalRetries: 1, defaultRequestTimeoutMs: 600000, retryBaseDelayMs: 2000, maxRetryAfterMs: 30000, jitterEnabled: true } } } });
  });

  it('汇总角标：「5 能力 · 1 异常」（degraded 计异常）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    expect(wrapper.text()).toContain('5 能力 · 1 异常');
    expect(wrapper.find('.ac-sec__title .mk-badge--warn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('全部正常时角标为「全部正常」', async () => {
    getCapabilitiesMock.mockResolvedValue({
      data: {
        data: {
          overall: 'operational', checkedAt: '2026-08-13T10:00:00.000Z', stale: false,
          capabilities: [
            makeCapability('goal-conversation', 'operational', '2026-08-13T10:00:00.000Z'),
            makeCapability('path-planning', 'operational', '2026-08-13T10:00:00.000Z'),
            makeCapability('stage-designer', 'operational', '2026-08-13T10:00:00.000Z'),
            makeCapability('teaching-turn', 'operational', '2026-08-13T10:00:00.000Z'),
            makeCapability('session-wrapup', 'operational', '2026-08-13T10:00:00.000Z')
          ]
        }
      }
    });
    const wrapper = await mountApiConfig();
    expect(wrapper.text()).toContain('5 能力 · 全部正常');
    wrapper.unmount();
  });

  it('页面进入自动探测：快照 stale → 自动补一次探测（含时间语义文案）', async () => {
    getCapabilitiesMock.mockResolvedValue({
      data: { data: makeSnapshot({ overall: 'unknown', stale: true }) }
    });
    // 探测挂起期间断言 stale 语义；resolve 后断言快照刷新
    let resolveProbe: (v: unknown) => void = () => {};
    probeCapabilitiesMock.mockReturnValue(new Promise((r) => { resolveProbe = r; }));
    const wrapper = await mountApiConfig();
    expect(getCapabilitiesMock).toHaveBeenCalled();
    expect(probeCapabilitiesMock).toHaveBeenCalledTimes(1);
    // stale 语义：上次探测时间 + 已过期提示 + 探针关闭副文案 + 探测中
    expect(wrapper.text()).toContain('快照已过期');
    expect(wrapper.text()).toContain('关闭时快照不自动刷新');
    expect(wrapper.text()).toContain('探测中…');
    // 探测完成 → 快照刷新、角标更新、过期提示消失
    resolveProbe({ data: { data: makeSnapshot() } });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('5 能力 · 1 异常');
    expect(wrapper.text()).not.toContain('快照已过期');
    wrapper.unmount();
  });

  it('脏位分域标注：连接 + 策略 分别列出', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    // 修改服务地址 → 连接组
    const urlInput = wrapper.find('input[placeholder="https://api.example.com/v1"]');
    await urlInput.setValue('https://new.example.com/v1');
    await nextTick();
    expect(wrapper.find('.ac-save').text()).toContain('连接 · 1 组未保存变更');
    // 修改安全策略（点「仅白名单」）→ 策略组追加
    const policyButtons = wrapper.findAll('.ac-policy__item .ac-seg__item');
    await policyButtons.find((b) => b.text() === '仅白名单')!.trigger('click');
    await nextTick();
    expect(wrapper.find('.ac-save').text()).toContain('连接 + 策略 · 2 组未保存变更');
    wrapper.unmount();
  });

  it('状态条与能力行时间同源：均为「上次探测」且来自快照 checkedAt', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    expect(wrapper.find('.mk-status').text()).toContain('上次探测');
    expect(wrapper.find('.ac-sec__sub').text()).toContain('最近探测');
    wrapper.unmount();
  });
});
