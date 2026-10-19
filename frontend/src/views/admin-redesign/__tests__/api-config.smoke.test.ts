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
import { liveApiConfig, registrationEnabled, registerIpQuotaEnabled } from '../live';
import { confirmState, settleConfirm } from '../useConfirm';

const { getConfigMock, getCapabilitiesMock, probeCapabilitiesMock, getProbeSettingsMock, getReliabilityMock, getModelRegistryMock, getModelProvidersMock, testConnectionMock, updateConfigMock, resetConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getCapabilitiesMock: vi.fn(),
  probeCapabilitiesMock: vi.fn(),
  getProbeSettingsMock: vi.fn(),
  getReliabilityMock: vi.fn(),
  getModelRegistryMock: vi.fn(),
  getModelProvidersMock: vi.fn(),
  testConnectionMock: vi.fn(),
  updateConfigMock: vi.fn(),
  resetConfigMock: vi.fn(),
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
    updateConfig: updateConfigMock,
    resetConfig: resetConfigMock
  }),
  /* 供应商与模型编辑（BYOK，2026-10-18）：接入页的供应商面板与平台通道的连接表单都读它 */
  adminModelProvidersApi: apiObject({ get: getModelProvidersMock }),
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

/**
 * 供应商注册表视图（后端 GET /admin/model-providers 的 data）。
 * 2026-10-18 BYOK 重做后，「接入与模型」页签 = 左供应商列表 / 右详情，
 * 平台通道的连接表单嵌在那条通道的详情里，故这些用例都得先喂这份数据。
 */
function providersView(): Record<string, unknown> {
  return {
    registry: { path: 'backend/config/llm-providers.json', source: 'file', mtimeMs: 1, lastError: null, readOnly: false },
    providers: [
      {
        id: 'platform', name: '平台',
        description: '平台自带的上游通道：地址与密钥走本页的连接设置，模型在这里登记',
        enabled: true, recommended: true, endpointSource: 'inherit', baseUrl: null, apiKeyEnv: null,
        keySource: 'none', keyHint: null, status: 'inherit',
        models: [
          {
            id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'chat',
            supportsThinking: true, supportsReasoningEffort: true, maxOutputTokens: 131072,
            defaultMaxTokens: 32768, reasoningReserveTokens: 8192, maxParallelRequests: null,
            fallbacks: ['agnes-3.0-flash'], pricing: null, description: null
          },
          {
            id: 'agnes-3.0-flash', label: 'Agnes 3.0 Flash', tier: 'chat',
            supportsThinking: false, supportsReasoningEffort: false, maxOutputTokens: 65536,
            defaultMaxTokens: 32768, reasoningReserveTokens: null, maxParallelRequests: null,
            fallbacks: [], pricing: null, description: null
          }
        ]
      },
      {
        id: 'acme-gateway', name: 'Acme 网关', description: null,
        enabled: true, recommended: false, endpointSource: 'own', baseUrl: 'https://gw.acme.com/v1',
        apiKeyEnv: 'PROVIDER_ACME_GATEWAY_API_KEY', keySource: 'db', keyHint: '····9xQv', status: 'ready',
        models: [
          {
            id: 'acme-chat', label: 'Acme Chat', tier: 'chat',
            supportsThinking: false, supportsReasoningEffort: false, maxOutputTokens: null,
            defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: 8,
            fallbacks: [], pricing: { inputPer1M: 0.3, outputPer1M: 0.6 }, description: null
          }
        ]
      }
    ]
  }
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
  // 模型选择器的候选层 Teleport 到 body；原地渲染，选择器才能从 wrapper 找到
  const wrapper = mount(ApiConfig, { global: { stubs: { teleport: true } } });
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
    getModelProvidersMock.mockReset();
    getModelProvidersMock.mockResolvedValue({ data: { data: providersView() } });
    testConnectionMock.mockReset();
    updateConfigMock.mockReset();
    resetConfigMock.mockReset();
    resetConfigMock.mockResolvedValue({ data: { success: true } });
    getModelRegistryMock.mockResolvedValue({
      data: {
        data: {
          generatedAt: '2026-09-19T12:00:00.000Z',
          providers: [
            {
              id: 'platform', name: '平台', enabled: true, recommended: true,
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
    await gotoTab(wrapper, '路由与调用');
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
    await gotoTab(wrapper, '路由与调用');
    expect(wrapper.text()).toContain('5 能力 · 全部正常');
    wrapper.unmount();
  });

  it('未知档卡头用「待确认」并与汇总角标同词（2026-10-11 走查：原「状态确认中」谎称进行中）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot({ overall: 'unknown' }) } });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '路由与调用');
    expect(wrapper.text()).not.toContain('状态确认中');
    // 卡头徽章（整值即「待确认」；汇总角标是「N 能力 · M 待确认」复合串，不匹配整值）
    const badge = wrapper.findAll('.mk-badge').find((b) => b.text() === '待确认');
    expect(badge, '卡头应渲染「待确认」档').toBeTruthy();
    expect(badge!.attributes('title')).toContain('能力探针关闭或尚未探测');
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
    await gotoTab(wrapper, '路由与调用');
    expect(getCapabilitiesMock).toHaveBeenCalled();
    expect(probeCapabilitiesMock).toHaveBeenCalledTimes(1);
    // stale 语义：上次探测时间 + 已过期提示 + 探测中
    expect(wrapper.text()).toContain('结果已过期');
    expect(wrapper.text()).toContain('探测中…');
    // 探测完成 → 快照刷新、角标更新、过期提示消失
    resolveProbe({ data: { data: makeSnapshot() } });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('5 能力 · 1 异常');
    expect(wrapper.text()).not.toContain('结果已过期');
    wrapper.unmount();
  });

  it('页面进入自动探测：探针关闭且快照 stale → 不自动探测（仅手动「立即探测」）', async () => {
    // beforeEach 已把探测设置 mock 为 enabled:false
    getCapabilitiesMock.mockResolvedValue({
      data: { data: makeSnapshot({ overall: 'unknown', stale: true }) }
    });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '路由与调用');
    expect(getCapabilitiesMock).toHaveBeenCalled();
    expect(probeCapabilitiesMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('结果已过期');
    expect(wrapper.text()).toContain('关闭后不自动探测');
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

  it('新用户注册 / 注册配额是开关（MkSwitch）：布尔配置不再用并排双按钮', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    // 注册开关卡 v-if 要求 registrationEnabled !== null：它是 live.ts 的模块级 ref，
    // 由异步 fetchRegistrationSetting 填充，这里直接播种，免得依赖加载时序
    registrationEnabled.value = false;
    // 配额开关卡同款 v-if 要求 !== null：同一个模块级 ref，一并播种
    registerIpQuotaEnabled.value = false;
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '安全与访问');
    // 2026-10-14 用户评审：原「开放注册 / 关闭注册」并排两段读不出是分段视图还是动作钮
    // （两枚都像按钮、都带选中态，语义靠猜）→ 改 MkSwitch：一枚 role=switch + 一个状态词
    const sw = wrapper.find('[role="switch"][aria-label="允许新用户自助注册"]');
    expect(sw.exists()).toBe(true);
    expect(sw.attributes('aria-checked')).toBe('false');
    expect(sw.text()).toContain('仅管理员创建');
    // 关态不得再出现「开放注册」那对双按钮
    expect(wrapper.text()).not.toContain('开放注册');
    // 同页另一个布尔设置（配额）同形
    expect(wrapper.find('[role="switch"][aria-label="单 IP 每日注册配额"]').exists()).toBe(true);
    // 防回退：本页不允许出现脱离 .mk-seg 父容器的分段器子项（原 bug 就是裸用该类）
    for (const b of wrapper.findAll('.mk-seg__item')) {
      expect(b.element.closest('.mk-seg')).toBeTruthy();
    }
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
    /* 2026-10-14 用户拍板撤掉页首 KPI 带：原来那三块（密钥 / 模型清单 / 默认路由）是把卡里
       已有的读数抄一遍。护栏钉「没有 KPI 带」，同时钉三个读数各有卡内出口——密钥看连接卡的
       API Key 行（已配置时 placeholder 写「留空 = 沿用已配置」）、清单看连接卡的关系句、
       连接状态看连接卡头徽标。 */
    expect(wrapper.findAll('.mk-kpi')).toHaveLength(0);
    expect(wrapper.find('input[type="password"]').attributes('placeholder')).toBe('留空 = 沿用已配置');
    // 2026-10-16 用户走查重排：原 30+ 枚模型胶囊（.ac-model）退役，清单出口改为「上游 N 个」关系句
    expect(wrapper.find('.ac-models__line').text()).toContain('上游返回 2 个模型');
    expect(wrapper.find('.ac-conn-body .mk-card .mk-badge').exists()).toBe(true);
    await gotoTab(wrapper, '路由与调用');
    expect(wrapper.find('.ac-sec__sub').text()).toContain('最近探测');
    wrapper.unmount();
  });

  it('接入与模型 = 供应商两栏面板：左列表平铺一份清单 + 右详情（2026-10-19 去分区）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    // 默认页签即「接入与模型」：供应商面板随默认分支一起挂载（原独立页签需点击才挂）
    expect(wrapper.findAll('.mk-subtab').some((b) => b.text().includes('模型总览'))).toBe(false);
    const tab = wrapper.findAll('.mk-subtab').find((b) => b.text().includes('接入与模型'));
    expect(tab, '应存在「接入与模型」tab').toBeTruthy();
    await flushPromises();
    // 面板读的是可编辑注册表视图（供应商 + 模型 + 文件可写状态）
    expect(getModelProvidersMock).toHaveBeenCalled();
    const panel = wrapper.find('.mpp');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('模型供应商');
    // 2026-10-19 用户「就不分区，不要做什么平台提供…自行接入又是什么意义呢」：
    // 分组标题与来历词都不再出现，只剩一份平铺清单（平台通道排最前）
    expect(wrapper.findAll('.mpp-group__title')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('平台提供');
    expect(wrapper.text()).not.toContain('自行接入');
    const items = wrapper.findAll('.mpp-item__name').map((el) => el.text());
    expect(items).toEqual(['平台', 'Acme 网关']);
    // 默认选中平台通道：它的详情里嵌着连接表单（服务地址 / API Key / 连通性验证）
    expect(wrapper.find('.ac-conn').exists()).toBe(true);
    // 2026-10-20 走查：连接块那句说明改由块头承担（栏头与表单之间不再复读一遍）；
    // 上游模型清单说的是登记关系，已从连接块搬进模型清单块
    expect(wrapper.text()).toContain('服务地址与密钥，改完点「保存连接」');
    expect(wrapper.text()).not.toContain('平台通道的服务地址与密钥在这里配置');
    expect(wrapper.find('.mpp-models .ac-models-meta').exists()).toBe(true);
    expect(wrapper.find('.ac-conn .ac-models-meta').exists()).toBe(false);
    // 平台通道没有自带端点：模型清单只给增改，不给「获取模型列表」（那是自带端点才有的动作）；
    // 连通性验证在连接表单里（上面那段「运行测试」），不在下面再挂第二枚检测钮
    const acts = wrapper.findAll('.mpp-models__acts .mk-btn').map((b) => b.text());
    expect(acts).toEqual(['编辑供应商', '＋ 添加模型']);
    // 只读能力表已从本页签退役
    expect(wrapper.find('.ac-registry').exists()).toBe(false);
    wrapper.unmount();
  });


  it('虚拟学习者通道并入「调用参数」栅格（2026-10-15 用户重组：卡片外壳与三段视图切换退役）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    // 收敛后不再有「虚拟学习者」页签，也不再有独立「压测参数」卡
    expect(wrapper.findAll('.mk-subtab').map((b) => b.text()).some((t) => t.includes('虚拟学习者'))).toBe(false);
    await gotoTab(wrapper, '路由与调用');
    expect(wrapper.find('.vl-settings').exists()).toBe(true);
    // 两项设置内联渲染（速率上限已并入「出站速率」组，与平台全局上限同行）
    const labels = wrapper.findAll('.vl-settings__label').map((b) => b.text());
    expect(labels).toEqual(['最高并发', '日期模拟']);
    expect(wrapper.text()).toContain('出站速率');
    expect(wrapper.text()).toContain('平台全局 RPM 上限（0=不限）');
    expect(wrapper.text()).toContain('虚拟学习者 RPM 上限（0=不限）');
    wrapper.unmount();
  });

  /* 注册表按域切片（2026-10-14；2026-10-15 供应商与能力限额合并；2026-10-18 BYOK 重做）：
     别名映射是路由域事实，仍归「路由与调用」（只读切片，默认收起）；
     「接入与模型」页签改成可编辑的供应商面板，只读能力表整块退役。 */
  it('注册表切片：接入页是供应商编辑面板，路由页只留别名映射（默认收起）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await flushPromises();
    // 接入页：可编辑面板，不再是只读能力表
    expect(wrapper.find('.ac-registry').exists()).toBe(false);
    expect(wrapper.find('.mpp').exists()).toBe(true);
    // 可编辑面板自带写入口（即时保存），与「只读」形态互斥
    expect(wrapper.findAll('.mpp-models__acts .mk-btn').map((b) => b.text())).toContain('＋ 添加模型');

    await gotoTab(wrapper, '路由与调用');
    await flushPromises();
    // 路由页那份只带别名映射一个分区（同一时刻只挂一份注册表切片）
    expect(wrapper.findAll('.ac-registry')).toHaveLength(1);
    const routing = wrapper.find('.ac-registry--routing');
    expect(routing.exists()).toBe(true);
    expect(routing.text()).toContain('别名映射');
    expect(routing.text()).not.toContain('默认路由（解析结果）');
    expect(routing.text()).not.toContain('模型供应商与能力限额');
    // 默认收起的折叠条（details 未开时内容仍在 DOM，但折叠条文案常显）
    const foldBar = wrapper.find('.ac-fold__bar');
    expect(foldBar.exists()).toBe(true);
    expect(foldBar.text()).toContain('内置别名映射表');
    expect(wrapper.find('.ac-fold').attributes('open')).toBeUndefined();
    // 别名切片仍是只读的：本页签不冒出模型/供应商写入口
    expect(wrapper.findAll('.mpp')).toHaveLength(0);
    wrapper.unmount();
  });

  it('路由默认支持逻辑别名：选择器可填 chat（不再受模型清单未拉取限制）', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '路由与调用');
    // 2026-10-20 起默认路由走 MkModelPicker：既能选目录模型，也能把别名直接按输入提交
    const control = wrapper.findAll('.ac-route__inline .mk-mp__control')[0];
    expect(control.exists(), '路由默认应有模型选择器（支持别名）').toBe(true);

    await control.trigger('click');
    await wrapper.find('.mk-mp__search').setValue('chat');
    const aliasRow = wrapper.findAll('.mk-mp__opt').find((o) => o.find('.mk-mp__id').text() === 'chat');
    expect(aliasRow, '输入别名后应给出可选行').toBeTruthy();
    await aliasRow!.trigger('click');
    await nextTick();
    // 选择即标脏 → 出现分段保存入口
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

    /* 2026-10-16 用户走查重排：拉取后的落点从「铺一排模型胶囊」改为「上游 N 个」关系句；
       逐个名字的清单在登记表的「上游未登记」折叠里（本用例的登记表 mock 没有 m-1/m-2，
       故此处断言 0 个对上那支文案——它同时守住「没对上时不能说成对上 0 个就完事」）。 */
    expect(wrapper.find('.ac-models__line').text()).toContain('上游返回 2 个模型');
    expect(wrapper.find('.ac-models__line').text()).toContain('都没有与平台登记的模型对上');
    expect(wrapper.text()).toContain('本次拉取未保存');
    expect(wrapper.find('.ac-models__hint').text()).toContain('仅在本页有效');
    expect(wrapper.find('.ac-models__hint').text()).toContain('保存连接');
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

  /* #13：后端 POST /admin/api-config/reset 能力早已存在却无前端入口——补「重置为默认」入口 + 二次确认 */
  it('#13：配置 tab 有「重置为默认」入口，确认后调用 reset API；取消则不调用', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    const btn = wrapper.findAll('button').find((b) => b.text() === '重置为默认');
    expect(btn, '配置 tab 页头应有重置入口').toBeTruthy();

    // 取消 → 不触发
    await btn!.trigger('click');
    await nextTick();
    expect(confirmState.open).toBe(true);
    expect(confirmState.title).toContain('重置');
    settleConfirm(false);
    await flushPromises();
    expect(resetConfigMock).not.toHaveBeenCalled();

    // 确认 → 调用 reset
    await btn!.trigger('click');
    await nextTick();
    settleConfirm(true);
    await flushPromises();
    await nextTick();
    expect(resetConfigMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('2026-10-19 拆页后：本页只剩三个页签，「外挂能力」页签整块不在', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await flushPromises();
    const tabs = wrapper.findAll('.mk-subtab').map((t) => t.text().trim());
    expect(tabs).toEqual(['接入与模型', '路由与调用', '安全与访问']);
    expect(wrapper.text()).not.toContain('外挂能力');
    expect(wrapper.find('#ac-panel-addons').exists()).toBe(false);
    wrapper.unmount();
  });

  /* #18：探测失败此前被旧快照吃掉（失败分支排在 v-if="health" 之后成死代码），页面无任何失败提示 */
  it('#18：探测失败可见——失败条优先于旧快照 + 「重试」入口', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '路由与调用');
    // 旧快照已渲染；探测 reject；失败后静默补拉返回带 failureCode 的服务端快照
    probeCapabilitiesMock.mockRejectedValue(new Error('timeout of 310000ms exceeded'));
    getCapabilitiesMock.mockResolvedValue({
      data: {
        data: {
          overall: 'unknown', checkedAt: null, stale: true,
          capabilities: [
            { id: 'stage-designer', status: 'unknown', checkedAt: new Date().toISOString(), latencyMs: null, message: '能力状态正在确认', failureCode: 'PROBE_TIMEOUT', retryable: true, lastSuccessAt: null }
          ]
        }
      }
    });
    const probeBtn = wrapper.findAll('button').find((b) => b.text().includes('立即探测'))!;
    await probeBtn.trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('上次探测失败');
    // 服务端记下的失败码仍可见（2026-10-15 能力健康改成紧凑胶囊：结论「待确认」常显在胶囊上，
    // 失败码 / 耗时 / 探测时间收进 title——不再是一行大表）
    const pill = wrapper.find('.ac-hpill');
    expect(pill.exists()).toBe(true);
    expect(pill.attributes('title')).toContain('PROBE_TIMEOUT');
    expect(wrapper.findAll('button').some((b) => b.text() === '重试')).toBe(true);
    wrapper.unmount();
  });

  /* #19：保存请求在途时，实时配置会因这次保存而回显并触发守卫 watch，而脏位要到请求返回才清——
     不把「正在保存」的域排除出「未保存」，就会在保存成功那一刻弹「丢弃未保存的配置修改」，
     把成功呈现成未保存（更坏是点「覆盖」丢改动）。 */
  it('#19：保存路由在途时配置回显不弹「丢弃未保存的配置修改」', async () => {
    getCapabilitiesMock.mockResolvedValue({ data: { data: makeSnapshot() } });
    const baseCfg = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-a',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      defaultResponseFormat: 'none' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    liveApiConfig.value = baseCfg;
    const wrapper = await mountApiConfig();
    await gotoTab(wrapper, '路由与调用');
    await flushPromises();
    expect(confirmState.open).toBe(false);

    // 改动路由 → 出现分段保存入口
    const control = wrapper.findAll('.ac-route__inline .mk-mp__control')[0];
    await control.trigger('click');
    await wrapper.find('.mk-mp__search').setValue('agnes-2.5-flash');
    const row = wrapper.findAll('.mk-mp__opt').find((o) => o.find('.mk-mp__id').text() === 'agnes-2.5-flash');
    expect(row, '输入未登记模型也应能按输入选中').toBeTruthy();
    await row!.trigger('click');
    await nextTick();
    const saveBtn = wrapper.findAll('.ac-sec__save').find((b) => b.text() === '保存路由');
    expect(saveBtn, '改动路由后应出现「保存路由」').toBeTruthy();

    // 保存请求挂起，制造「已发出、响应未回」的窗口
    let release: (v: unknown) => void = () => {};
    updateConfigMock.mockImplementation(() => new Promise((r) => { release = r; }));
    await saveBtn!.trigger('click');
    await nextTick();
    // 窗口内配置回显（这正是保存引起的刷新）→ 守卫不得弹确认框
    liveApiConfig.value = { ...baseCfg, defaultModel: 'agnes-2.5-flash', availableModels: ['agnes-2.5-flash'] };
    await nextTick();
    await flushPromises();
    expect(confirmState.open, '保存在途时不应弹「丢弃未保存的配置修改」').toBe(false);
    // 回显不覆盖正在保存的表单值
    const shown = wrapper.findAll('.ac-route__inline .mk-mp__control')[0].find('.mk-mp__value');
    expect(shown.text()).toBe('agnes-2.5-flash');

    release({ data: { data: {} } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    // 保存完成：脏位清空（不再有「保存路由」分段入口），且全程未弹过丢弃确认
    expect(wrapper.text()).not.toContain('保存路由');
    expect(confirmState.open).toBe(false);
    wrapper.unmount();
  });
});
