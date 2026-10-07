/**
 * ApiConfig.vue P1 修复批冒烟：
 * 1. 能力健康汇总角标（「5 能力 · N 异常」）
 * 2. 脏位分域标注（连接/路由/策略/可靠性/探测 分组列出）
 * 3. 快照过期语义 + 页面进入自动探测（仅探针开启时 stale → 自动补一次探测）+ 页首读数带（2026-10-04 状态条退役后为 KPI 卡）与能力行时间同源
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ApiConfig from '../ApiConfig.vue';
import { dataSource } from '../store';
import { liveApiConfig } from '../live';

const { getConfigMock, getCapabilitiesMock, probeCapabilitiesMock, getProbeSettingsMock, getReliabilityMock, getModelRegistryMock, testConnectionMock, updateConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getCapabilitiesMock: vi.fn(),
  probeCapabilitiesMock: vi.fn(),
  getProbeSettingsMock: vi.fn(),
  getReliabilityMock: vi.fn(),
  getModelRegistryMock: vi.fn(),
  testConnectionMock: vi.fn(),
  updateConfigMock: vi.fn(),
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
    getConfig: getConfigMock,
    getModelRegistry: getModelRegistryMock,
    testConnection: testConnectionMock,
    updateConfig: updateConfigMock
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
    getModelRegistryMock.mockReset();
    testConnectionMock.mockReset();
    updateConfigMock.mockReset();
    getModelRegistryMock.mockResolvedValue({
      data: {
        data: {
          generatedAt: '2026-09-19T12:00:00.000Z',
          providers: [
            {
              id: 'platform', name: '平台通道（继承）', enabled: true, recommended: true,
              endpointSource: 'inherit', baseUrl: null, apiKeyEnv: null, keyConfigured: null,
              modelIds: ['deepseek-v4-flash', 'agnes-3.0-flash']
            }
          ],
          registry: {
            path: 'backend/config/llm-providers.json', source: 'file', mtimeMs: 1, lastError: null,
            fileDefaults: { chat: 'deepseek-v4-flash', reasoning: 'deepseek-v4-pro' }
          },
          models: [
            {
              id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'chat', provider: 'deepseek',
              capabilities: { supportsThinking: true, supportsReasoningEffort: true },
              limits: { maxOutputTokens: 131072, defaultMaxTokens: 32768, reasoningReserveTokens: 8192, maxParallelRequests: null },
              fallbacks: ['agnes-3.0-flash'], pricingConfigured: false
            },
            {
              id: 'agnes-3.0-flash', label: 'Agnes 3.0 Flash', tier: 'chat', provider: 'agnes',
              capabilities: { supportsThinking: false, supportsReasoningEffort: false },
              limits: { maxOutputTokens: 65536, defaultMaxTokens: 32768, reasoningReserveTokens: 0, maxParallelRequests: null },
              fallbacks: [], pricingConfigured: false
            }
          ],
          aliases: [
            {
              alias: 'chat', source: 'code', members: ['deepseek-v4-flash', 'agnes-3.0-flash'], dbMembers: null,
              selected: 'deepseek-v4-flash', selectedWhenRequiringThinking: 'deepseek-v4-flash', degradedWhenRequiringThinking: false
            }
          ],
          defaults: {
            defaultModelConfigured: 'chat', defaultModelResolved: 'deepseek-v4-flash', defaultModelSource: 'alias',
            defaultReasoningModelConfigured: null, defaultReasoningModelResolved: null, defaultReasoningModelSource: 'unset'
          },
          fallbackChains: [{ model: 'deepseek-v4-flash', fallbacks: ['agnes-3.0-flash'] }],
          cooldowns: [],
          warnings: ['示例告警'],
          deprecatedPromptModelCount: 0
        }
      }
    });
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

  /** 2026-09-29 拆 tab 后：能力健康/调用参数在「调用与健康」tab，路由在「模型路由」tab
   *  （2026-10-05 CM1：视图切换收敛到共享 MkSubTabs，按 .mk-subtab 定位） */
  async function gotoTab(wrapper: ReturnType<typeof mountApiConfig> extends Promise<infer W> ? W : never, label: string) {
    const tab = wrapper.findAll('.mk-subtab').find((b) => b.text().includes(label));
    expect(tab, `应存在「${label}」tab`).toBeTruthy();
    await tab!.trigger('click');
    await flushPromises();
  }

  it('汇总角标：「5 能力 · 1 异常」（degraded 计异常）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '调用与健康');
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
    await gotoTab(wrapper, '调用与健康');
    expect(wrapper.text()).toContain('5 能力 · 全部正常');
    wrapper.unmount();
  });

  it('页面进入自动探测：探针开启且快照 stale → 自动补一次探测（含时间语义文案）', async () => {
    getProbeSettingsMock.mockResolvedValue({ data: { data: { enabled: true, intervalMs: 120000, minIntervalMs: 10000, maxIntervalMs: 86400000 } } });
    getCapabilitiesMock.mockResolvedValue({
      data: { data: makeSnapshot({ overall: 'unknown', stale: true }) }
    });
    // 探测挂起期间断言 stale 语义；resolve 后断言快照刷新
    let resolveProbe: (v: unknown) => void = () => {};
    probeCapabilitiesMock.mockReturnValue(new Promise((r) => { resolveProbe = r; }));
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '调用与健康');
    expect(getCapabilitiesMock).toHaveBeenCalled();
    expect(probeCapabilitiesMock).toHaveBeenCalledTimes(1);
    // stale 语义：上次探测时间 + 已过期提示 + 探测中
    expect(wrapper.text()).toContain('快照已过期');
    expect(wrapper.text()).toContain('探测中…');
    // 探测完成 → 快照刷新、角标更新、过期提示消失
    resolveProbe({ data: { data: makeSnapshot() } });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('5 能力 · 1 异常');
    expect(wrapper.text()).not.toContain('快照已过期');
    wrapper.unmount();
  });

  it('页面进入自动探测：探针关闭且快照 stale → 不自动探测（仅手动「立即探测」）', async () => {
    // beforeEach 已把探测设置 mock 为 enabled:false
    getCapabilitiesMock.mockResolvedValue({
      data: { data: makeSnapshot({ overall: 'unknown', stale: true }) }
    });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '调用与健康');
    expect(getCapabilitiesMock).toHaveBeenCalled();
    expect(probeCapabilitiesMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('快照已过期');
    expect(wrapper.text()).toContain('关闭时快照不自动刷新');
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
    // 分段保存：只在该段有脏位时出现（连接段出现，路由段不出现）
    expect(wrapper.text()).toContain('保存连接');
    expect(wrapper.text()).not.toContain('保存路由');
    // 修改安全策略（点「仅白名单」）→ 策略组追加（拆 tab 后策略在「安全与访问」tab；
    // 底部保存条在四个配置 tab 常驻，跨 tab 不丢脏位）
    await gotoTab(wrapper, '安全与访问');
    const policyButtons = wrapper.findAll('.ac-policy__item .mk-seg__item');
    await policyButtons.find((b) => b.text() === '仅白名单')!.trigger('click');
    await nextTick();
    expect(wrapper.find('.ac-save').text()).toContain('连接 + 策略 · 2 组未保存变更');
    expect(wrapper.text()).toContain('保存策略');
    wrapper.unmount();
  });

  it('探测时间单源：页头状态条已退役（2026-10-04），读数迁页首 KPI 带；能力行同源快照 checkedAt', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    // KPI 读数取自 live 配置域（applyLiveConfig 在挂载 watch 即消费）：挂载前播种，
    // 得「密钥已配置 + 2 模型 + 3 路由」的已加载态（不播种则如实显初始 未配置/未拉取/0/3）
    liveApiConfig.value = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-b',
      defaultThinkingMode: 'default',
      defaultReasoningEffort: 'default',
      defaultResponseFormat: 'none',
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private', adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    const wrapper = await mountApiConfig();
    // 护栏（判例 buckets-band.test.ts）：页头状态条整块下线，「上次探测」复读随之消失
    expect(wrapper.find('.mk-status').exists()).toBe(false);
    // 原状态条三读数由 KPI 卡承接（连接 tab 默认分支：beforeeach 已 mock 已配置密钥 + 2 模型 + 3 路由）
    const kpiTexts = wrapper.findAll('.mk-kpi').map((k) => k.text());
    expect(kpiTexts).toHaveLength(3);
    expect(kpiTexts[0]).toContain('API 密钥');
    expect(kpiTexts[0]).toContain('已配置');
    expect(kpiTexts[1]).toContain('模型清单');
    expect(kpiTexts[1]).toContain('2 个');
    expect(kpiTexts[2]).toContain('默认路由');
    expect(kpiTexts[2]).toContain('3/3');
    await gotoTab(wrapper, '调用与健康');
    expect(wrapper.find('.ac-sec__sub').text()).toContain('最近探测');
    wrapper.unmount();
  });

  it('模型总览 tab：切换后渲染只读总览，页首 KPI 带显示注册模型与漂移提示（2026-10-04 状态条退役迁入）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    const tab = wrapper.findAll('.mk-subtab').find((b) => b.text().includes('模型总览'));
    expect(tab, '应存在「模型总览」tab').toBeTruthy();

    await tab!.trigger('click');
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(getModelRegistryMock).toHaveBeenCalled();
    // 原状态条读数迁 KPI 卡：「模型：2 个 / 提示：1 条 / 只读」→ 注册模型 2（hint 只读视图）+ 漂移提示 1
    const kpiTexts = wrapper.findAll('.mk-kpi').map((k) => k.text());
    expect(kpiTexts).toHaveLength(2);
    expect(kpiTexts[0]).toContain('注册模型');
    expect(kpiTexts[0]).toContain('2');
    expect(kpiTexts[0]).toContain('能力注册表只读视图');
    expect(kpiTexts[1]).toContain('漂移提示');
    expect(kpiTexts[1]).toContain('1');
    // 漂移 > 0 → warn 档；总览仍无保存按钮（只读语义不变）
    expect(wrapper.find('.mk-kpi--warn').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('保存连接');
    wrapper.unmount();
  });

  it('路由默认支持逻辑别名：输入框可填 chat（不再受模型清单未拉取限制）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '模型路由');
    const input = wrapper.find('input[list="ac-model-options"]');
    expect(input.exists(), '路由默认应为可输入（支持别名）').toBe(true);

    await input.setValue('chat');
    await nextTick();
    // 输入即标脏 → 出现分段保存入口
    expect(wrapper.text()).toContain('保存路由');
    wrapper.unmount();
  });

  /** F8-2（运营走查）：「连通性验证」拉取结果只写本页内存——
   *  ① 已保存过清单时下拉应直接可用（不要求进页先拉一次）；
   *  ② 未保存的本次拉取必须显式说明「仅本页有效，保存后其他页面/下次进入才可见」；
   *  ③ 保存连接后说明消失（清单已落盘，且请求携带 availableModels）。 */
  it('F8-2：已保存清单下拉直接可用；拉取未保存给出「仅本页有效」说明，保存后消失', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const savedCfg = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-b',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      defaultResponseFormat: 'none' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    // ① 已保存清单（liveApiConfig 播种）：下拉直接可用，无未保存提示
    liveApiConfig.value = savedCfg;
    const saved = await mountApiConfig();
    expect((saved.find('.ac-test__model select').element as HTMLSelectElement).disabled).toBe(false);
    expect(saved.findAll('.ac-test__model select option').map((o) => o.text())).toEqual(['model-a', 'model-b']);
    expect(saved.find('.ac-models__hint').exists()).toBe(false);
    expect(saved.text()).not.toContain('本次拉取未保存');
    saved.unmount();

    // ② 未保存清单：拉取后出现说明；③ 保存连接后说明消失且请求携带清单
    liveApiConfig.value = { ...savedCfg, availableModels: [] };
    let persisted: string[] = [];
    getConfigMock.mockImplementation(async () => ({
      data: { data: { ...savedCfg, availableModels: [...persisted] } }
    }));
    testConnectionMock.mockResolvedValue({
      data: { data: { connected: true, modelsCount: 2, models: ['m-1', 'm-2'] } }
    });
    updateConfigMock.mockImplementation(async (payload: { availableModels?: string[] }) => {
      if (payload?.availableModels) persisted = [...payload.availableModels];
      return { data: { data: {} } };
    });

    const wrapper = await mountApiConfig();
    expect((wrapper.find('.ac-test__model select').element as HTMLSelectElement).disabled).toBe(true);
    expect(wrapper.find('.ac-models__hint').exists()).toBe(false);

    const fetchBtn = wrapper.findAll('.mk-btn').find((b) => b.text().includes('连接并拉取'))!;
    await fetchBtn.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.findAll('.ac-model').map((e) => e.text())).toEqual(['m-1', 'm-2']);
    expect(wrapper.text()).toContain('本次拉取未保存');
    expect(wrapper.find('.ac-models__hint').text()).toContain('仅在本页有效');
    expect(wrapper.find('.ac-models__hint').text()).toContain('保存后');
    // 拉取后下拉立即可用（本页内联动不回归）
    expect((wrapper.find('.ac-test__model select').element as HTMLSelectElement).disabled).toBe(false);

    const saveBtn = wrapper.find('.ac-sec__save');
    expect(saveBtn.text()).toBe('保存连接');
    await saveBtn.trigger('click');
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(updateConfigMock).toHaveBeenCalledWith(expect.objectContaining({ availableModels: ['m-1', 'm-2'] }));
    expect(wrapper.find('.ac-models__hint').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('本次拉取未保存');
    wrapper.unmount();
  });
});
