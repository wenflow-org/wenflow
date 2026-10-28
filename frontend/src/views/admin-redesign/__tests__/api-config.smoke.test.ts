/**
 * ApiConfig.vue 冒烟：
 * 1. 供应商面板（连接 / 模型表 / 基础设施行）
 * 2. 脏位分域标注（连接 / 调用策略）
 * 3. 调用策略卡：参数三组（读数已撤出，归健康中心与虚拟学习者页）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ApiConfig from '../ApiConfig.vue';
import { dataSource } from '../store';
import { liveApiConfig } from '../live';
import { confirmState, settleConfirm } from '../useConfirm';

const { getConfigMock, getReliabilityMock, updateReliabilityMock, getModelRegistryMock, getModelProvidersMock, getInfraModelsMock, testConnectionMock, updateConfigMock, resetConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getReliabilityMock: vi.fn(),
  updateReliabilityMock: vi.fn(),
  getModelRegistryMock: vi.fn(),
  getModelProvidersMock: vi.fn(),
  getInfraModelsMock: vi.fn(),
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
    updateReliabilitySettings: updateReliabilityMock,
    getRegistrationSetting: vi.fn(async () => ({ data: { data: { registrationEnabled: false } } }))
  }),
  adminOpsApi: apiObject({
    throughput: vi.fn(async () => ({
      data: {
        data: { windowMinutes: 60, minRpm: 20, avgRpm: 12, worstRpm: 4, lowMinutes: 2, longestLowRun: 1, idle: false, alert: false, alertReason: null }
      }
    }))
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
  /* 基础设施模型（embedding/rerank）：接入页的独立卡在挂载时读取 */
  adminInfraModelsApi: apiObject({ get: getInfraModelsMock }),
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

function infraView(): Record<string, unknown> {
  return {
    required: true,
    platformBaseUrl: 'https://newapi.wenflow.org',
    warnings: [],
    embedding: {
      kind: 'embedding', provider: 'bge', connectionMode: 'own', endpoint: 'https://gw.example/v1/embeddings',
      model: 'BAAI/bge-m3', apiKeyEnv: 'EMBEDDING_API_KEY', timeoutMs: 20000,
      batchSize: 32, dimensions: 1024, configured: true, configSource: 'env',
      keySource: 'env', keyHint: '····test'
    },
    rerank: {
      kind: 'rerank', provider: 'bge', connectionMode: 'inherit', endpoint: 'https://newapi.wenflow.org/v1/rerank',
      model: 'BAAI/bge-reranker-v2-m3', apiKeyEnv: 'RERANK_API_KEY', timeoutMs: 20000,
      batchSize: null, dimensions: null, configured: true, configSource: 'env',
      keySource: 'platform', keyHint: null
    }
  }
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

/** 平台连接表单（2026-10-25 撤掉「平台设置」浮窗后内联在平台详情里）：
    表单常驻 DOM，平台详情不再有「设置」钮（点了画面几乎不动），helper 直接等一拍。 */
async function openPlatformSettings(wrapper: Awaited<ReturnType<typeof mountApiConfig>>) {
  expect(
    wrapper.findAll('.mpp .mk-card__head .mk-btn').some((b) => b.text() === '设置'),
    '平台详情不再有「设置」'
  ).toBe(false);
  await nextTick();
  await flushPromises();
}

/** 卡面只留摘要；地址 / 密钥 / 重试都在「连接设置」弹层里。 */
async function openConnSettings(wrapper: Awaited<ReturnType<typeof mountApiConfig>>) {
  const btn = wrapper.findAll('button').find((b) => b.text() === '连接设置');
  expect(btn, '连接摘要里应有「连接设置」').toBeTruthy();
  await btn!.trigger('click');
  await nextTick();
  await flushPromises();
}

describe('ApiConfig P1 修复批', () => {
  beforeEach(() => {
    getConfigMock.mockReset();
    getReliabilityMock.mockReset();
    updateReliabilityMock.mockReset();
    updateReliabilityMock.mockResolvedValue({ data: { data: {} } });
    getModelRegistryMock.mockReset();
    getModelProvidersMock.mockReset();
    getModelProvidersMock.mockResolvedValue({ data: { data: providersView() } });
    getInfraModelsMock.mockReset();
    getInfraModelsMock.mockResolvedValue({ data: { data: infraView() } });
    testConnectionMock.mockReset();
    updateConfigMock.mockReset();
    resetConfigMock.mockReset();
    resetConfigMock.mockResolvedValue({ data: { success: true } });
    getModelRegistryMock.mockResolvedValue({
      data: {
        data: {
          generatedAt: '2026-09-19T12:00:00.000Z',
          rateLimit: { windowMinutes: 60, count429: 4, coolingDown: 2 },
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
    // 直接播种已加载态：连接摘要 / 弹层字段在首帧就有值，不依赖 live TTL 缓存是否命中
    liveApiConfig.value = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-b',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
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
    getReliabilityMock.mockResolvedValue({ data: { data: { settings: { maxUpstreamAttempts: 3, maxTransportRetries: 1, maxLogicalRetries: 1, defaultRequestTimeoutMs: 600000, retryBaseDelayMs: 2000, maxRetryAfterMs: 30000, jitterEnabled: true } } } });
  });

  /* 2026-10-28 用户「这个直接不要了，调用健康没必要在这里出现，后台跑在虚拟学习者那边已经实现了」：
     调用策略卡只留参数；429 读数归健康中心，跑批读数归虚拟学习者页。 */
  it('调用策略卡只留参数：不再出现调用健康 / 后台跑批读数', async () => {
    const { adminOpsApi } = await import('@/api/adminApi');
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.find('.ac-policy__side').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('调用健康');
    expect(wrapper.text()).not.toContain('后台跑批');
    expect(adminOpsApi.throughput).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  /* 2026-10-28 用户「这一块彻底不要了」：平台默认与别名整块撤出，
     分段保存只覆盖「连接」与「全站策略」。 */
  it('生成参数整块退役：默认思考 / 结构化输出 / 别名映射都不再上屏', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.text()).not.toContain('平台默认与别名');
    expect(wrapper.text()).not.toContain('默认思考');
    expect(wrapper.text()).not.toContain('思考模式');
    expect(wrapper.text()).not.toContain('结构化输出');
    expect(wrapper.text()).not.toContain('输出格式');
    expect(wrapper.text()).not.toContain('内置别名映射表');
    expect(wrapper.find('.ac-registry--aliases').exists()).toBe(false);
    expect(wrapper.find('#mpp-platform-panel-generation').exists()).toBe(false);
    wrapper.unmount();
  });

  /* 2026-10-28 用户「运营不知道先点哪个保存」：连接与调用策略共用弹层里的一颗「保存」。 */
  it('连接设置弹层：一次保存连接与调用策略，取消回滚', async () => {
    const wrapper = await mountApiConfig();
    await openConnSettings(wrapper);
    expect(wrapper.find('.ac-conn-modal').exists()).toBe(true);

    await wrapper.find('.ac-conn-modal input[placeholder="https://api.example.com/v1"]').setValue('https://new.example.com/v1');
    await wrapper.find('.ac-conn-modal input[type="password"]').setValue('sk-new');
    const retry = wrapper.find('.ac-conn-modal__policy input[type="number"]');
    await retry.setValue('6');
    await nextTick();
    // 页面上没有底部保存条，也没有第二颗保存钮
    expect(wrapper.find('.ac-save').exists()).toBe(false);

    const save = wrapper.findAll('.ac-conn-modal__foot button').find((b) => b.text() === '保存')!;
    await save.trigger('click');
    await flushPromises();
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(updateReliabilityMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.ac-conn-modal').exists()).toBe(false);
    wrapper.unmount();
  });

  it('取消连接设置会回滚未保存的地址与策略', async () => {
    const wrapper = await mountApiConfig();
    await openConnSettings(wrapper);
    await wrapper.find('.ac-conn-modal input[placeholder="https://api.example.com/v1"]').setValue('https://new.example.com/v1');
    const cancel = wrapper.findAll('.ac-conn-modal__foot button').find((b) => b.text() === '取消')!;
    await cancel.trigger('click');
    await flushPromises();
    expect(updateConfigMock).not.toHaveBeenCalled();
    expect(wrapper.find('.ac-conn-summary__url').text()).toBe('https://api.example.com/v1');
    wrapper.unmount();
  });

  it('探测时间单源：页头状态条已退役（2026-10-04），读数迁页首 KPI 带；能力行同源快照 checkedAt', async () => {
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
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private', adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    const wrapper = await mountApiConfig();
    await openPlatformSettings(wrapper);
    // 护栏（判例 buckets-band.test.ts）：页头状态条整块下线，「上次探测」复读随之消失
    expect(wrapper.find('.mk-status').exists()).toBe(false);
    /* 2026-10-14 用户拍板撤掉页首 KPI 带：原来那三块（密钥 / 模型清单 / 默认路由）是把卡里
       已有的读数抄一遍。护栏钉「没有 KPI 带」，同时钉三个读数各有卡内出口——密钥看连接卡的
       API Key 行（已配置时 placeholder 写「留空 = 沿用已配置」）、清单看连接卡的关系句、
       连接状态看连接卡头徽标。 */
    expect(wrapper.findAll('.mk-kpi')).toHaveLength(0);
    // 密钥在「连接设置」弹层里：已配置时占位写「留空 = 沿用已配置」
    await openConnSettings(wrapper);
    expect(wrapper.find('.ac-conn-modal input[type="password"]').attributes('placeholder')).toBe('留空 = 沿用已配置');
    // 2026-10-16 用户走查重排：原 30+ 枚模型胶囊（.ac-model）退役；2026-10-28 上游读数文案整行撤掉
    expect(wrapper.find('.ac-models-meta').exists()).toBe(false);
    expect(wrapper.find('.ac-conn-body .mk-card .mk-badge').exists()).toBe(true);
    wrapper.unmount();
  });

  it('接入与模型 = 单通道详情（2026-10-27 撤掉左栏清单）', async () => {
    const wrapper = await mountApiConfig();
    await openPlatformSettings(wrapper);
    // 单页：供应商面板随页面一起挂载（原一级页签需点击才挂）
    expect(wrapper.find('.ac-tabs').exists()).toBe(false);
    await flushPromises();
    // 面板读的是可编辑注册表视图（供应商 + 模型 + 文件可写状态）
    expect(getModelProvidersMock).toHaveBeenCalled();
    const panel = wrapper.find('.mpp');
    expect(panel.exists()).toBe(true);
    // 2026-10-28 三卡重构：本卡标题是能力角色，不再是通道名
    expect(panel.find('.mk-card__head .mk-card__title').text()).toBe('对话与推理模型');
    // 2026-10-27 用户「这个区域不要了」：左栏通道清单整块撤掉，页面直接是平台通道详情
    expect(wrapper.find('.mpp-list').exists()).toBe(false);
    expect(wrapper.findAll('.mpp-item')).toHaveLength(0);
    expect(panel.text()).not.toContain('Acme 网关');
    const detail = wrapper.find('.mpp .mk-card__head');
    expect(detail.text()).toContain('对话与推理模型');
    expect(detail.find('.mpp-type').text()).toBe('LLM');
    // 连接编辑收进弹层：卡面只留一行摘要，不再裸露地址 / 密钥表单
    expect(wrapper.find('.ac-conn').exists()).toBe(false);
    expect(wrapper.find('.ac-conn-summary').exists()).toBe(true);
    expect(wrapper.find('.ac-conn-summary__url').text()).toBe('https://api.example.com/v1');
    expect(wrapper.find('.ac-ps').exists()).toBe(false);
    expect(wrapper.find('.ac-conn-summary input').exists()).toBe(false);
    // 上游读数文案撤掉（2026-10-28）：无异常、无未保存时不占卡头
    expect(wrapper.find('.mpp-head__id .ac-models-meta').exists()).toBe(false);
    // 模型是否可用由行内「测试」回答；通道测试在连接设置弹层里
    const acts = wrapper.findAll('.mpp-models__acts .mk-btn').map((b) => b.text());
    expect(acts[0]).toContain('＋ 添加模型');
    expect(acts[0]).toContain('上游有 2 个待选');
    await openConnSettings(wrapper);
    expect(wrapper.findAll('.ac-conn-modal__test button').map((b) => b.text())).toEqual(['测试连通性']);
    // 只读能力表与别名映射都已从本页退役
    expect(wrapper.find('.ac-registry--aliases').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('接入通道与能力限额');
    wrapper.unmount();
  });


  it('虚拟学习者容量已搬回它自己的页面（本页不再有该页签）', async () => {
    const wrapper = await mountApiConfig();
    // 2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」：容量配置回 /admin/virtual-learners
    expect(wrapper.find('.vl-settings').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('虚拟学习者 RPM 上限');
    wrapper.unmount();
  });

  /* 2026-10-27 用户「把 tab 解散了」：平台详情不再分二级页签，按接入顺序平铺；
     2026-10-28 基础设施并入模型表、平台默认整块撤出。 */
  it('单页三卡：连接 / 挂载模型 / 向量与重排能力卡常驻', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    // 一级页签已撤；供应商面板与调用策略同屏
    expect(wrapper.find('.ac-tabs').exists()).toBe(false);
    expect(wrapper.find('.mpp').exists()).toBe(true);
    // 2026-10-28 用户「表单不要直接裸露」：参数在连接设置弹层，卡面只有摘要
    expect(wrapper.text()).not.toContain('全站调用策略');
    expect(wrapper.findAll('.ac-policy__num')).toHaveLength(0);
    expect(wrapper.find('.ac-conn-summary').text()).toContain('https://api.example.com/v1');
    // 2026-10-28 用户「按能力角色拆成三个独立卡片」：对话卡 + 向量卡 + 重排卡
    expect(wrapper.findAll('#ac-panel-access .mk-card')).toHaveLength(3);
    expect(wrapper.find('.mpp #mpp-platform-panel-models').exists()).toBe(true);
    expect(wrapper.find('.mpp-config').exists()).toBe(false);
    // 添加入口在挂载模型区标题行，不再塞回卡头
    const head = wrapper.find('.mpp > .mk-card__head');
    expect(head.find('.mpp-models__acts').exists()).toBe(false);
    const sectionHead = wrapper.find('.mpp-models__head');
    expect(sectionHead.find('.mpp-models__acts').exists()).toBe(true);
    // 二级页签也撤了：没有 tab 控件，内容常驻
    expect(wrapper.findAll('.mpp-subtabs').length).toBe(0);
    expect(wrapper.findAll('.mk-subtab').length).toBe(0);
    expect(wrapper.find('#mpp-platform-panel-conn').exists()).toBe(true);
    expect(wrapper.find('#mpp-platform-panel-models').exists()).toBe(true);
    expect(wrapper.find('#mpp-platform-panel-infra').exists()).toBe(true);
    expect(wrapper.find('#mpp-platform-panel-generation').exists()).toBe(false);
    for (const id of ['conn', 'models', 'infra']) {
      expect((wrapper.find(`#mpp-platform-panel-${id}`).attributes('style') || '')).not.toContain('display: none');
    }
    // 三张卡各有能力角色标签
    expect(wrapper.text()).toContain('对话与推理模型');
    expect(wrapper.text()).toContain('挂载模型');
    expect(wrapper.text()).toContain('向量模型');
    expect(wrapper.text()).toContain('重排模型');
    expect(wrapper.text()).not.toContain('基础设施');
    const listText = wrapper.find('.mpp-models__list').text();
    expect(listText).toContain('deepseek-v4-flash');
    expect(listText).not.toContain('BAAI/bge-m3');
    const areas = wrapper.findAll('.mpp-eng');
    expect(areas).toHaveLength(2);
    expect(areas[0].text()).toContain('BAAI/bge-m3');
    expect(areas[1].text()).toContain('BAAI/bge-reranker-v2-m3');
    // 单例卡只留一句连接归属：复用的卡不重复平台地址，地址在对话卡摘要里
    expect(areas[1].text()).toContain('复用对话模型的连接');
    expect(areas[1].text()).not.toContain('https://newapi.wenflow.org');
    expect(wrapper.text()).not.toContain('基础设施模型');
    expect(wrapper.text()).not.toContain('平台必需');
    expect(wrapper.text()).not.toContain('资料语义召回');
    // 旧的独立基础设施卡、「平台默认生成参数」与平台默认块都已撤
    expect(wrapper.find('#ac-infra').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('平台默认生成参数');
    expect(wrapper.text()).not.toContain('平台默认与别名');
    expect(wrapper.text()).not.toContain('默认思考');
    expect(wrapper.text()).not.toContain('结构化输出');
    expect(wrapper.findAll('.ac-registry')).toHaveLength(0);
    expect(wrapper.find('.ac-fold').exists()).toBe(false);
    wrapper.unmount();
  });

  /** F8-2（运营走查）+ 2026-10-27 接入流程：
   *  ① 已保存过清单时「已拉取 N 个」直接可见（不要求进页先拉一次）；
   *  ② 获取模型即把地址/密钥/清单一起落盘（流程第 2 步），不再要求先点「保存连接」；
   *  ③ 落盘后不出现「未保存」徽标。 */
  it('F8-2：已保存清单直接可见；获取模型即保存连接，不残留未保存徽标', async () => {
    const savedCfg = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-b',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    // ① 已保存清单（liveApiConfig 播种）：读数行不出现，无未保存提示
    liveApiConfig.value = savedCfg;
    const saved = await mountApiConfig();
    await openPlatformSettings(saved);
    expect(saved.find('.ac-models-meta').exists()).toBe(false);
    saved.unmount();

    // ② 未保存清单：获取模型即落盘（不再有独立保存步骤）
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
    await openPlatformSettings(wrapper);
    const fetchBtn = wrapper.findAll('.mk-btn').find((b) => b.text().includes('获取模型'))!;
    await fetchBtn.trigger('click');
    await flushPromises();
    await nextTick();
    await flushPromises();

    // 获取即保存：请求带上了地址/密钥/清单与连接状态
    expect(updateConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      availableModels: ['m-1', 'm-2'],
      // 拉取结果随连接域落盘，刷新后「连接正常 · N 前」不再回退到旧时间
      connectionStatus: 'connected',
      lastCheckedAt: expect.any(String)
    }));
    // ③ 不再有「保存连接」分段按钮与「未保存」徽标
    expect(wrapper.find('.ac-sec__save').exists()).toBe(false);
    expect(wrapper.find('.ac-models-meta').exists()).toBe(false);
    wrapper.unmount();
  });

  /* 2026-10-27 流程：第 1 步要求「填链接和 key」。换了地址却没重填密钥时，
     不能拿旧密钥去试新端点，也不能把旧密钥存到新地址上。 */
  it('流程：换地址但没重填 API Key 时，连接设置不允许保存', async () => {
    liveApiConfig.value = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['model-a'],
      defaultModel: 'model-a',
      defaultReasoningModel: 'model-a',
      defaultEvaluationModel: 'model-a',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    const wrapper = await mountApiConfig();
    await flushPromises();
    await openConnSettings(wrapper);
    await wrapper.find('.ac-conn-modal input[placeholder="https://api.example.com/v1"]').setValue('https://new.example.com/v1');
    await nextTick();
    const save = wrapper.findAll('.ac-conn-modal__foot button').find((b) => b.text() === '保存')!;
    await save.trigger('click');
    await flushPromises();
    expect(testConnectionMock).not.toHaveBeenCalled();
    expect(updateConfigMock).not.toHaveBeenCalled();
    // 弹层保持打开，运营可以看到「更换服务地址需重新输入密钥」
    expect(wrapper.find('.ac-conn-modal').exists()).toBe(true);
    wrapper.unmount();
  });

  /* 2026-10-27 用户「不再做独立连通性验证」的原始约束是：不维护测试用模型下拉。
     2026-10-28 起连接测试回归，但只验证地址与密钥，模型测试仍在行内。 */
  it('连接测试只验证通道，不出现测试用模型下拉', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.text()).not.toContain('测试用模型');
    expect(wrapper.find('.ac-test').exists()).toBe(false);
    await openConnSettings(wrapper);
    expect(wrapper.find('.ac-conn-modal__test button').text()).toBe('测试连通性');
    expect(wrapper.text()).not.toContain('运行测试');
    wrapper.unmount();
  });

  /* 2026-10-27 P1：获取与重置都绑定到当前通道，页头只保留注册表刷新；
     2026-10-28：连接类动作全部收进「连接设置」弹层。 */
  it('P1：页头只留刷新；获取模型在卡头，重置在连接设置里', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    const headBtns = wrapper.findAll('.mk-pagehead__actions > button').map((b) => b.text())
    expect(headBtns).toEqual(['刷新注册表'])
    expect(wrapper.text()).not.toContain('连接并拉取')
    expect(wrapper.find('.ac-conn__acts').text()).toContain('获取模型')
    // 卡头不再有第二颗保存 / 重置，避免「先点哪个」的分裂
    expect(wrapper.find('.ac-conn__acts').text()).not.toContain('重置此通道')
    expect(wrapper.find('.ac-conn__acts').text()).not.toContain('保存')
    await openConnSettings(wrapper)
    expect(wrapper.find('.ac-conn-modal__foot').text()).toContain('重置此通道')
    expect(wrapper.find('.ac-conn__danger').exists()).toBe(false)
    wrapper.unmount()
  })

  /* #13：后端 POST /admin/api-config/reset 能力早已存在；2026-10-27 P1 从页头收进通道详情 */
  it('#13：重置入口在连接设置弹层，确认后调用 reset API；取消则不调用', async () => {
    const wrapper = await mountApiConfig();
    await openConnSettings(wrapper)
    const btn = wrapper.findAll('button').find((b) => b.text() === '重置此通道');
    expect(btn, '连接设置里应有重置入口').toBeTruthy();

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

  it('已迁出的域整块不在：外挂能力 / 虚拟学习者容量 / 安全与访问', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.text()).not.toContain('外挂能力');
    expect(wrapper.find('#ac-panel-addons').exists()).toBe(false);
    expect(wrapper.find('.vl-settings').exists()).toBe(false);
    wrapper.unmount();
  });

  /* 2026-10-21 用户走查：「平台现在没有这三类分了吧其实，都是按 skill 配置的模型」。
     2026-10-28 用户「这一块彻底不要了」：生成参数整块也撤出，本页不再有默认模型三行。 */
  it('默认路由三行与平台默认块都已退役', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.find('.ac-route').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('对话默认');
    expect(wrapper.text()).not.toContain('推理默认');
    expect(wrapper.text()).not.toContain('评估默认');
    expect(wrapper.text()).not.toContain('平台默认与别名');
    expect(wrapper.text()).not.toContain('默认思考');
    expect(wrapper.text()).not.toContain('结构化输出');
    wrapper.unmount();
  });

  /* 2026-10-20 用户「这个 tab 重新思考」；2026-10-26 探针下线；2026-10-28 读数整块撤出；
     2026-10-28 用户「表单不要直接裸露」：连接与调用策略一起收进弹层，卡面只留摘要。 */
  it('连接与调用策略收进弹层：卡面只有摘要，参数在弹层里', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();

    // 页面上只有对话能力这一张业务卡
    const cards = wrapper.findAll('#ac-panel-access > .mk-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].classes()).toContain('mpp');
    // 卡面没有输入框，只有一行摘要
    expect(wrapper.find('.mpp .ac-conn-form').exists()).toBe(false);
    expect(wrapper.find('.mpp input[placeholder="https://api.example.com/v1"]').exists()).toBe(false);
    expect(wrapper.find('.ac-conn-summary').text()).toContain('https://api.example.com/v1');
    expect(wrapper.find('.ac-conn-summary').text()).toContain('重试 3 次');
    expect(wrapper.find('.mpp .ac-policy--inline').exists()).toBe(false);

    await openConnSettings(wrapper);
    const modal = wrapper.find('.ac-conn-modal');
    const policy = modal.findAll('.ac-conn-modal__policy .mk-field');
    expect(policy).toHaveLength(3);
    const labels = policy.map((f) => f.find('.mk-field__label').text());
    expect(labels).toEqual(['最大重试', '重试间隔（毫秒）', 'RPM 上限']);
    // 2026-10-28 用户「文案不要」：必要语义收进标签 title，屏上不再有解释句
    expect(policy[0].find('.mk-field__label').attributes('title')).toContain('总尝试上限');
    expect(policy[2].find('.mk-field__label').attributes('title')).toContain('0 = 不限');
    expect(modal.text()).not.toContain('所有供应商共用');
    expect(modal.text()).not.toContain('传输重试');
    expect(modal.text()).not.toContain('Retry-After');
    expect(modal.text()).not.toContain('随机抖动');
    // 2026-10-28 读数整块撤出：健康读数归健康中心，跑批读数归虚拟学习者页
    expect(wrapper.find('.ac-policy__side').exists()).toBe(false);
    expect(wrapper.find('.ac-stat').exists()).toBe(false);
    // 探针与能力胶囊整块下线
    expect(wrapper.text()).not.toContain('能力探针');
    expect(wrapper.text()).not.toContain('立即探测');
    expect(wrapper.find('.ac-hpills').exists()).toBe(false);
    // 虚拟学习者容量在它自己的页面，本页不挂
    expect(wrapper.find('.vl-settings').exists()).toBe(false);
    wrapper.unmount();
  });

  /* 收掉细项后，保存仍要把库里现值的整组字段回传——否则后端 partial 合并会把
     没露出的传输重试 / 超时重置成默认值，等于悄悄改了策略。
     也不得把「最大重试」联动到同模型重试数：执行器只在还有上游余量时才降级，
     把同模型重试顶到 上游-1 会让降级永远不触发。 */
  it('只露三个字段时，保存回传完整策略（隐藏项与同模型重试均沿用现值）', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    await openConnSettings(wrapper);
    const retryInput = wrapper.find('.ac-conn-modal__policy input[type="number"]');
    await retryInput.setValue(6);
    await nextTick();
    const saveBtn = wrapper.findAll('.ac-conn-modal__foot button').find((b) => b.text() === '保存')!;
    await saveBtn.trigger('click');
    await flushPromises();
    expect(updateReliabilityMock).toHaveBeenCalledTimes(1);
    expect(updateReliabilityMock.mock.calls[0][0]).toMatchObject({
      maxUpstreamAttempts: 6,
      // 不联动：保留现值 1，降级才有余量可用
      maxTransportRetries: 1,
      // 其余细项同样沿用 beforeEach 里的现值
      maxLogicalRetries: 1,
      defaultRequestTimeoutMs: 600000,
      retryBaseDelayMs: 2000,
      maxRetryAfterMs: 30000,
      jitterEnabled: true,
    });
    wrapper.unmount();
  });
});
