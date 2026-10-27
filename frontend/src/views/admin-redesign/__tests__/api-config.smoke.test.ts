/**
 * ApiConfig.vue 冒烟：
 * 1. 供应商面板（模型 / 连接 / 基础设施 / 生成参数四个二级页签）
 * 2. 脏位分域标注（连接 / 生成参数 / 调用策略）
 * 3. 调用策略卡：参数三组 + 右栏近 1 小时读数（429 / 冷却模型）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ApiConfig from '../ApiConfig.vue';
import { dataSource } from '../store';
import { liveApiConfig, pickChatTestModel } from '../live';
import { confirmState, settleConfirm } from '../useConfirm';
import { chooseMkSelect, mkSelectLabels, mkSelectValue } from '@/components/mk/__tests__/mkSelect';

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
    warnings: [],
    embedding: {
      kind: 'embedding', provider: 'bge', endpoint: 'https://gw.example/v1/embeddings',
      model: 'BAAI/bge-m3', apiKeyEnv: 'EMBEDDING_API_KEY', timeoutMs: 20000,
      batchSize: 32, dimensions: 1024, configured: true, configSource: 'env',
      keySource: 'env', keyHint: '····test'
    },
    rerank: {
      kind: 'rerank', provider: 'bge', endpoint: 'https://gw.example/v1/rerank',
      model: 'BAAI/bge-reranker-v2-m3', apiKeyEnv: 'RERANK_API_KEY', timeoutMs: 20000,
      batchSize: null, dimensions: null, configured: true, configSource: 'env',
      keySource: 'inherit', keyHint: '····test'
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
  expect(wrapper.find('.mpp-detail__acts .mk-btn').exists(), '平台详情不再有「设置」').toBe(false);
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
    getReliabilityMock.mockResolvedValue({ data: { data: { settings: { maxUpstreamAttempts: 3, maxTransportRetries: 1, maxLogicalRetries: 1, defaultRequestTimeoutMs: 600000, retryBaseDelayMs: 2000, maxRetryAfterMs: 30000, jitterEnabled: true } } } });
  });

  /** 2026-10-26 单页后本页不再有一级页签：调用策略常驻屏上，
   *  「连接 / 生成参数」收进平台详情的二级页签，按 .mpp-subtabs .mk-subtab 定位。 */
  async function gotoPlatformTab(wrapper: ReturnType<typeof mountApiConfig> extends Promise<infer W> ? W : never, label: string) {
    const tab = wrapper.findAll('.mpp-subtabs .mk-subtab').find((b) => b.text().includes(label));
    expect(tab, `应存在平台详情「${label}」页签`).toBeTruthy();
    await tab!.trigger('click');
    await flushPromises();
  }

  /* D12：429 / 冷却读数从原「调用健康」卡搬进调用策略卡的右栏——
     参数与它造成的结果同一视平线；读数非零时数字上警示色。
     2026-10-28 右栏并入跑批读数：前两格是近 1 小时调用，后四格是后台跑批。 */
  it('D12：调用策略右栏显示近 1 小时 429 与冷却模型读数', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    const side = wrapper.find('.ac-policy__side');
    expect(side.exists(), '调用策略卡应有读数右栏').toBe(true);
    expect(side.text()).toContain('近 1 小时');
    const stats = side.findAll('.ac-stat');
    expect(stats.map((s) => s.text())).toEqual([
      '4上游 429',
      '2冷却中模型',
      '12平均 条/分',
      '4最低单分钟',
      '2低于下限分钟',
      '1最长连续低于下限'
    ]);
    // 非零即警示：4 次 429 / 2 个冷却模型都要看得出来（跑批 mock 未告警）
    expect(side.findAll('.ac-stat--alert')).toHaveLength(2);
    expect(side.find('.ac-policy__link').text()).toContain('健康中心');
    wrapper.unmount();
  });

  /* 2026-10-28 用户「批量吞吐可以和模型与接入合到一起」→「自由设计一下」：
     跑批读数并入调用策略卡的读数带，与近 1 小时调用同排（虚线分隔），不再单独成卡。 */
  it('后台跑批读数并入调用策略读数带：四格读数 + 一句口径说明', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    await flushPromises();
    const side = wrapper.find('.ac-policy__side');
    expect(side.text()).toContain('后台跑批');
    expect(side.text()).toContain('后台批处理每分钟实际处理多少条');
    const stats = side.findAll('.ac-stat');
    expect(stats.map((s) => s.text())).toEqual([
      '4上游 429',
      '2冷却中模型',
      '12平均 条/分',
      '4最低单分钟',
      '2低于下限分钟',
      '1最长连续低于下限'
    ]);
    expect(side.text()).toContain('刷新读数');
    wrapper.unmount();
  });

  /* 后端告警句是 rpm 口径；页面读数统一用「条/分」，告警句不能又冒出 rpm。 */
  it('跑批告警句把 rpm 口径换成条/分', async () => {
    const { adminOpsApi } = await import('@/api/adminApi');
    vi.mocked(adminOpsApi.throughput).mockResolvedValueOnce({
      data: {
        data: {
          windowMinutes: 60, minRpm: 20, avgRpm: 0.03, worstRpm: 0, lowMinutes: 60,
          longestLowRun: 60, idle: false, alert: true,
          alertReason: '连续 60 分钟低于 20 rpm（窗口均值 0.03 rpm）'
        }
      }
    } as never);
    const wrapper = await mountApiConfig();
    await flushPromises();
    await flushPromises();
    const alert = wrapper.find('.ac-policy__side .ac-side__alert');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('20 条/分');
    expect(alert.text()).not.toContain('rpm');
    wrapper.unmount();
  });

  /* 输出格式是生成参数的一部分：改完保存必须随 route 组提交并回显，否则刷新后静默回默认值。 */
  it('输出格式随生成参数保存与回显', async () => {
    const wrapper = await mountApiConfig();
    await gotoPlatformTab(wrapper, '生成参数');
    // 2026-10-27 原生 select → MkSelect：闭合态无 option，按 aria-label 展开后点选
    await chooseMkSelect(wrapper as never, '输出格式', 'json_object');
    expect(mkSelectValue(wrapper as never, '输出格式')).toBe('json_object');
    await nextTick();
    const saveBtn = wrapper.findAll('.ac-sec__save').find((b) => b.text() === '保存生成参数');
    expect(saveBtn, '改输出格式后应出现「保存生成参数」').toBeTruthy();
    updateConfigMock.mockResolvedValue({ data: { data: {} } });
    await saveBtn!.trigger('click');
    await flushPromises();
    expect(updateConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultResponseFormat: 'json_object'
    }));
    wrapper.unmount();
  });

  /* 读数读不到时不能让右栏空着——那会被读成「近 1 小时没有限流」。 */
  it('限流读数读取失败：右栏报失败并给重试，不静默消失', async () => {
    getModelRegistryMock.mockRejectedValue(new Error('boom'));
    const wrapper = await mountApiConfig();
    await flushPromises();
    const side = wrapper.find('.ac-policy__side');
    expect(side.find('.ac-policy__readout-fail').text()).toContain('读数读取失败');
    const retry = side.find('.ac-policy__readout-fail .mk-link');
    expect(retry.exists()).toBe(true);
    getModelRegistryMock.mockResolvedValue({
      data: { data: { rateLimit: { windowMinutes: 60, count429: 4, coolingDown: 2 }, aliases: [], models: [] } }
    });
    await retry.trigger('click');
    await flushPromises();
    expect(wrapper.find('.ac-policy__side').text()).toContain('4上游 429');
    wrapper.unmount();
  });

  /* 读数右栏给出处理页出口（本页只报读数，排查在健康中心） */
  it('读数右栏给出「健康中心」出口', async () => {
    const wrapper = await mountApiConfig();
    expect(wrapper.find('.ac-policy__side .ac-policy__link').text()).toContain('健康中心');
    wrapper.unmount();
  });

  /* 2026-10-26 单页后「连接 / 生成参数」藏在平台详情的二级页签里：单组脏时，
     只有停在该页签（分段保存钮在屏）才不出底部条；切走后必须由底部条接手。 */
  it('脏位分域：单组脏且分段保存钮在屏时不出底部条，切走页签后由底部条接手', async () => {
    const wrapper = await mountApiConfig();
    // 停在默认的「模型」页签改服务地址 → 连接组脏，但「保存连接」不在屏 → 底部条接手
    const urlInput = wrapper.find('input[placeholder="https://api.example.com/v1"]');
    await urlInput.setValue('https://new.example.com/v1');
    await nextTick();
    const bar = wrapper.find('.ac-save');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain('连接');
    expect(bar.text()).toContain('放弃');

    // 切到「连接」页签：分段保存钮在屏，底部条收起（不叠两颗保存钮）
    await gotoPlatformTab(wrapper, '连接');
    expect(wrapper.find('.ac-save').exists()).toBe(false);
    expect(wrapper.text()).toContain('保存连接');
    expect(wrapper.text()).not.toContain('保存生成参数');

    // 再改生成参数 → 两组脏，底部条恒出并列出两组
    await gotoPlatformTab(wrapper, '生成参数');
    expect(wrapper.find('.ac-cols__side .mk-select').exists(), '生成参数页签应有「输出格式」下拉').toBe(true);
    await chooseMkSelect(wrapper as never, '输出格式', 'json_object');
    await nextTick();
    expect(wrapper.find('.ac-save').text()).toContain('连接 + 生成参数 · 2 组未保存变更');
    expect(wrapper.text()).toContain('保存生成参数');
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
    expect(wrapper.find('input[type="password"]').attributes('placeholder')).toBe('留空 = 沿用已配置');
    // 2026-10-16 用户走查重排：原 30+ 枚模型胶囊（.ac-model）退役；2026-10-21 只报数字
    expect(wrapper.find('.ac-models__line').text()).toContain('已拉取 2 个');
    expect(wrapper.find('.ac-conn-body .mk-card .mk-badge').exists()).toBe(true);
    wrapper.unmount();
  });

  it('接入与模型 = 供应商两栏面板：左列表平铺一份清单 + 右详情（2026-10-19 去分区）', async () => {
    const wrapper = await mountApiConfig();
    await openPlatformSettings(wrapper);
    // 单页：供应商面板随页面一起挂载（原一级页签需点击才挂）
    expect(wrapper.find('.ac-tabs').exists()).toBe(false);
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
    // 平台连接表单内联在详情里（2026-10-25 撤掉「平台设置」浮窗）
    expect(wrapper.find('.ac-conn').exists()).toBe(true);
    expect(wrapper.find('.ac-ps').exists()).toBe(false);
    expect(wrapper.find('.ac-conn input[placeholder="https://api.example.com/v1"]').exists()).toBe(true);
    // 上游清单状态与「模型 N 个」同一行，不再在表头之上单起一行（2026-10-24）
    expect(wrapper.find('.mpp-models__head .ac-models-meta').exists()).toBe(true);
    expect(wrapper.find('.ac-conn .ac-models-meta').exists()).toBe(false);
    // 平台通道没有自带端点：模型清单只给增改，不给「获取模型列表」（那是自带端点才有的动作）；
    // 连通性验证在连接表单里（上面那段「运行测试」），不在下面再挂第二枚检测钮
    const acts = wrapper.findAll('.mpp-models__acts .mk-btn').map((b) => b.text());
    expect(acts).toEqual(['＋ 添加模型']);
    // 只读能力表已从本页退役；别名映射在「生成参数」页签内（默认页签下不可见）
    expect(wrapper.find('.ac-registry--aliases').exists()).toBe(true);
    expect((wrapper.find('#mpp-platform-panel-generation').attributes('style') || '')).toContain('display: none');
    expect(wrapper.text()).not.toContain('模型供应商与能力限额');
    wrapper.unmount();
  });


  it('虚拟学习者容量已搬回它自己的页面（本页不再有该页签）', async () => {
    const wrapper = await mountApiConfig();
    // 2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」：容量配置回 /admin/virtual-learners
    expect(wrapper.find('.vl-settings').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('虚拟学习者 RPM 上限');
    wrapper.unmount();
  });

  /* 2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得可以和
     前面的合并了」：一级页签「接入 / 调用」撤除；「平台默认生成参数」并进平台详情第四个
     页签（生成参数），与模型表同一个对象。 */
  it('单页：无一级页签，生成参数是平台详情的第四页签', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    // 一级页签已撤；供应商面板与调用策略同屏
    expect(wrapper.find('.ac-tabs').exists()).toBe(false);
    expect(wrapper.find('.mpp').exists()).toBe(true);
    expect(wrapper.text()).toContain('调用策略');
    expect(wrapper.find('.ac-policy').exists()).toBe(true);
    // 平台详情四个二级页签，默认「模型」
    expect(wrapper.findAll('.mpp-subtabs .mk-subtab').map((b) => b.text())).toEqual([
      '模型2', '连接', '基础设施', '生成参数',
    ]);
    expect(wrapper.find('.mpp-subtabs .mk-subtab[aria-selected="true"]').text()).toBe('模型2');
    // 连接 / 基础设施 / 生成参数的内容都在 DOM 里（v-show 保留），但只有「模型」可见
    expect(wrapper.find('#mpp-platform-panel-conn').exists()).toBe(true);
    expect(wrapper.find('#mpp-platform-panel-infra').exists()).toBe(true);
    expect(wrapper.find('#mpp-platform-panel-generation').exists()).toBe(true);
    expect((wrapper.find('#mpp-platform-panel-generation').attributes('style') || '')).toContain('display: none');
    // 旧的独立基础设施卡与「平台默认生成参数」卡都已撤
    expect(wrapper.find('#ac-infra').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('平台默认生成参数');

    await gotoPlatformTab(wrapper, '生成参数');
    expect(wrapper.text()).toContain('默认思考');
    expect(wrapper.text()).toContain('结构化输出');
    expect(wrapper.findAll('.ac-registry')).toHaveLength(1);
    expect(wrapper.find('.ac-registry--aliases').text()).toContain('别名映射');
    const foldBar = wrapper.find('.ac-fold__bar');
    expect(foldBar.exists()).toBe(true);
    expect(foldBar.text()).toContain('内置别名映射表');
    expect(wrapper.find('.ac-fold').attributes('open')).toBeUndefined();
    wrapper.unmount();
  });

  /** F8-2（运营走查）：「连通性验证」拉取结果只写本页内存——
   *  ① 已保存过清单时下拉应直接可用（不要求进页先拉一次）；
   *  ② 未保存的本次拉取必须显式说明「仅本页有效，保存后其他页面/下次进入才可见」；
   *  ③ 保存连接后说明消失（清单已落盘，且请求携带 availableModels）。 */
  it('F8-2：已保存清单下拉直接可用；拉取未保存给出「仅本页有效」说明，保存后消失', async () => {
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
    // ① 已保存清单（liveApiConfig 播种）：下拉直接可用，无未保存提示
    liveApiConfig.value = savedCfg;
    const saved = await mountApiConfig();
    await openPlatformSettings(saved);
    expect((saved.find('.ac-test__model .mk-select__trigger').element as HTMLButtonElement).disabled).toBe(false);
    expect(mkSelectLabels(saved as never, '测试模型')).toEqual(['model-a', 'model-b']);
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
    await openPlatformSettings(wrapper);
    expect((wrapper.find('.ac-test__model .mk-select__trigger').element as HTMLButtonElement).disabled).toBe(true);

    const fetchBtn = wrapper.findAll('.mk-btn').find((b) => b.text().includes('连接并拉取'))!;
    await fetchBtn.trigger('click');
    await flushPromises();
    await nextTick();

    /* 2026-10-21：清单块只报数字；本次拉取是否落盘由块头的「未保存」徽标承担 */
    expect(wrapper.find('.ac-models__line').text()).toContain('已拉取 2 个');
    expect(wrapper.find('.ac-models-meta').text()).toContain('未保存');
    // 拉取后下拉立即可用（本页内联动不回归）
    expect((wrapper.find('.ac-test__model .mk-select__trigger').element as HTMLButtonElement).disabled).toBe(false);

    const saveBtn = wrapper.find('.ac-sec__save');
    expect(saveBtn.text()).toBe('保存连接');
    await saveBtn.trigger('click');
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(updateConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      availableModels: ['m-1', 'm-2'],
      // 拉取结果随连接域落盘，刷新后「连接正常 · N 前」不再回退到旧时间
      connectionStatus: 'connected',
      lastCheckedAt: expect.any(String)
    }));
    expect(wrapper.find('.ac-models-meta').text()).not.toContain('未保存');
    wrapper.unmount();
  });

  /* 回归（2026-10-22 走查）：上游清单按字母排序，首个是向量模型 BAAI/bge-large-en-v1.5；
     默认选它再点「运行测试」，chat 端点只会回「Model does not exist」，看着像配置错了。 */
  it('测试模型默认选配置里的对话模型，而不是清单第一个（向量/重排序模型）', async () => {
    liveApiConfig.value = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['BAAI/bge-large-en-v1.5', 'Qwen3-Reranker-0.6B', 'deepseek-v4.1-flash'],
      defaultModel: 'deepseek-v4.1-flash',
      defaultReasoningModel: 'deepseek-v4.1-flash',
      defaultEvaluationModel: 'deepseek-v4.1-flash',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      defaultResponseFormat: 'none' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    const wrapper = await mountApiConfig();
    await openPlatformSettings(wrapper);
    expect(mkSelectValue(wrapper as never, '测试模型')).toBe('deepseek-v4.1-flash');
    // D7（2026-10-22 拍板 B）：非对话模型保留在下拉里，但必须自带「不适用」标注。
    const optionTexts = mkSelectLabels(wrapper as never, '测试模型');
    expect(optionTexts).toContain('BAAI/bge-large-en-v1.5（向量模型 · chat 测试不适用）');
    expect(optionTexts).toContain('Qwen3-Reranker-0.6B（重排模型 · chat 测试不适用）');
    expect(optionTexts).toContain('deepseek-v4.1-flash');
    wrapper.unmount();
  });

  it('配置里的默认模型不在清单里时，退到第一个非嵌入/重排序模型', async () => {
    liveApiConfig.value = {
      apiUrl: 'https://api.example.com/v1',
      apiKeyConfigured: true,
      availableModels: ['BAAI/bge-m3', 'agnes-3.0-flash'],
      defaultModel: '已下线的模型',
      defaultReasoningModel: '已下线的模型',
      defaultEvaluationModel: '已下线的模型',
      defaultThinkingMode: 'default' as const,
      defaultReasoningEffort: 'default' as const,
      defaultResponseFormat: 'none' as const,
      connectionStatus: 'connected',
      lastCheckedAt: '2026-08-13T09:00:00.000Z',
      networkPolicy: { adminAccessMode: 'private' as const, adminAllowedIps: [], allowPrivateNetwork: true, privateNetworkHosts: [] }
    };
    const wrapper = await mountApiConfig();
    await openPlatformSettings(wrapper);
    expect(mkSelectValue(wrapper as never, '测试模型')).toBe('agnes-3.0-flash');
    wrapper.unmount();
  });

  /* #13：后端 POST /admin/api-config/reset 能力早已存在却无前端入口——补「重置为默认」入口 + 二次确认 */
  it('#13：接入页有「重置接入配置」入口（范围写明），确认后调用 reset API；取消则不调用', async () => {
    const wrapper = await mountApiConfig();
    const btn = wrapper.findAll('button').find((b) => b.text() === '重置接入配置');
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

  it('已迁出的域整块不在：外挂能力 / 虚拟学习者容量 / 安全与访问', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    expect(wrapper.text()).not.toContain('外挂能力');
    expect(wrapper.find('#ac-panel-addons').exists()).toBe(false);
    expect(wrapper.find('.vl-settings').exists()).toBe(false);
    wrapper.unmount();
  });

  /* #19：保存请求在途时，实时配置会因这次保存而回显并触发守卫 watch，而脏位要到请求返回才清——
     不把「正在保存」的域排除出「未保存」，就会在保存成功那一刻弹「丢弃未保存的配置修改」，
     把成功呈现成未保存（更坏是点「覆盖」丢改动）。 */
  it('#19：保存生成参数在途时配置回显不弹「丢弃未保存的配置修改」', async () => {
    const baseCfg = {
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
    liveApiConfig.value = baseCfg;
    const wrapper = await mountApiConfig();
    await flushPromises();
    await gotoPlatformTab(wrapper, '生成参数');
    expect(confirmState.open).toBe(false);

    // 改动默认思考 → 出现分段保存入口
    await chooseMkSelect(wrapper as never, '思考模式', 'enabled');
    await nextTick();
    const saveBtn = wrapper.findAll('.ac-sec__save').find((b) => b.text() === '保存生成参数');
    expect(saveBtn, '改生成参数后应出现「保存生成参数」').toBeTruthy();

    // 保存请求挂起，制造「已发出、响应未回」的窗口
    let release: (v: unknown) => void = () => {};
    updateConfigMock.mockImplementation(() => new Promise((r) => { release = r; }));
    await saveBtn!.trigger('click');
    await nextTick();
    // 窗口内配置回显（这正是保存引起的刷新）→ 守卫不得弹确认框
    liveApiConfig.value = { ...baseCfg, defaultThinkingMode: 'enabled' };
    await nextTick();
    await flushPromises();
    expect(confirmState.open, '保存在途时不应弹「丢弃未保存的配置修改」').toBe(false);
    // 回显不覆盖正在保存的表单值
    expect(mkSelectValue(wrapper as never, '思考模式')).toBe('enabled');

    release({ data: { data: {} } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    // 保存完成：脏位清空（不再有「保存生成参数」分段入口），且全程未弹过丢弃确认
    expect(wrapper.text()).not.toContain('保存生成参数');
    expect(confirmState.open).toBe(false);
    wrapper.unmount();
  });

  /* 2026-10-21 用户走查：「平台现在没有这三类分了吧其实，都是按 skill 配置的模型」。
     默认路由三行退役，生成参数收进平台详情的二级页签。 */
  it('默认路由三行已退役：不再出现对话/推理/评估默认模型选择器', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();
    await gotoPlatformTab(wrapper, '生成参数');
    expect(wrapper.find('.ac-route').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('对话默认');
    expect(wrapper.text()).not.toContain('推理默认');
    expect(wrapper.text()).not.toContain('评估默认');
    expect(wrapper.text()).toContain('生成参数');
    expect(wrapper.text()).toContain('默认思考');
    expect(wrapper.text()).toContain('结构化输出');
    wrapper.unmount();
  });

  /* 2026-10-20 用户「这个 tab 重新思考」；2026-10-26 探针下线；2026-10-28 跑批读数并入
     调用策略右栏（不再单独成卡），调用面 = 供应商卡 + 一张策略与读数卡。 */
  it('调用面只剩一张策略卡（跑批读数并入右栏），探针与细项都已下线', async () => {
    const wrapper = await mountApiConfig();
    await flushPromises();

    const cards = wrapper.findAll('#ac-panel-access > .mk-card').filter((c) => !c.classes('mpp'));
    expect(cards.map((c) => c.find('.mk-card__title').text())).toEqual(['调用策略']);

    const card = cards[0];
    /* 2026-10-26 用户「不用写那么详细，分那么多，就最大重试、间隔、rpm 就够了」：
       三个字段一行，单位跟在输入框后面；细项（传输重试 / 逻辑重试 / Retry-After /
       单次超时 / 随机抖动）不再占版面。 */
    expect(card.findAll('.ac-policy__fields > .mk-field')).toHaveLength(3);
    expect(card.findAll('.ac-policy__unit').map((u) => u.text())).toEqual(['次', '毫秒', '次/分']);
    const labels = card.findAll('.ac-policy__fields .mk-field__label').map((l) => l.text());
    expect(labels).toEqual(['最大重试', '重试间隔', 'RPM 上限 全站共享']);
    // 2026-10-28 用户「rpm 全站共享，虚拟学习者单独设置最高 rpm 就行了」：
    // 本页只说清共享口径并给出虚拟学习者出口，不再把两套上限摆在一起。
    expect(card.find('.ac-policy__fields').text()).toContain('所有供应商共用');
    expect(card.find('.ac-policy__fields a.mk-link').attributes('href')).toBe('/admin/virtual-learners');
    expect(wrapper.text()).not.toContain('传输重试');
    expect(wrapper.text()).not.toContain('Retry-After');
    expect(wrapper.text()).not.toContain('随机抖动');
    // 读数在被参数影响的同一张卡里
    expect(card.find('.ac-policy__side .ac-stat').exists()).toBe(true);
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
    const retryInput = wrapper.find('.ac-policy__fields .mk-field__input');
    await retryInput.setValue(6);
    await nextTick();
    const saveBtn = wrapper.findAll('.ac-sec__save').find((b) => b.text() === '保存参数');
    expect(saveBtn, '改最大重试后应出现「保存参数」').toBeTruthy();
    await saveBtn!.trigger('click');
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

describe('pickChatTestModel（#131 连通性测试默认模型）', () => {
  const upstreamList = [
    'BAAI/bge-large-en-v1.5',
    'BAAI/bge-reranker-v2-m3',
    'agnes-3.0-flash',
    'deepseek-v4.1-flash',
  ];

  it('配置默认对话模型在清单里 → 直接选中它', () => {
    expect(pickChatTestModel(upstreamList, 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash');
  });

  it('默认模型不在/为空 → 退到第一个非嵌入/重排序模型，不再选 BAAI 向量模型', () => {
    expect(pickChatTestModel(upstreamList, 'not-in-list')).toBe('agnes-3.0-flash');
    expect(pickChatTestModel(upstreamList)).toBe('agnes-3.0-flash');
  });
});
