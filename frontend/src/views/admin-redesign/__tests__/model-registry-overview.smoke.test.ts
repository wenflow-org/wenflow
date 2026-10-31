/**
 * ModelRegistryOverview 冒烟（只读总览；2026-10-15 供应商与能力限额合并后两分片）：
 * 1. 别名映射 / 供应商与能力限额（含状态列）两段渲染；合并块按供应商分组、表头列数自洽
 * 2. 状态列：命中部署冷却 → 冷却徽标（providerId + model 双键）；未命中 → 健康
 * 3. 行级 ⚠（模型级提示）与表尾注（非模型级提示 / 无则不渲染）
 * 4. 分片裁剪（parts）：只渲染指定分片，但 defaults/aliases 照常回传宿主
 * 5. 加载失败展示错误 + 重试；加载成功向宿主上报 { models, warnings }
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ModelRegistryOverview from '../ModelRegistryOverview.vue';

const { getModelRegistryMock } = vi.hoisted(() => ({ getModelRegistryMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminApiConfigApi: { getModelRegistry: getModelRegistryMock }
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const OVERVIEW = {
  generatedAt: '2026-09-19T12:00:00.000Z',
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      recommended: true,
      endpointSource: 'inherit',
      baseUrl: null,
      apiKeyEnv: null,
      keyConfigured: true,
      modelIds: ['deepseek-v4-flash']
    },
    {
      id: 'agnes',
      name: 'Agnes',
      enabled: true,
      recommended: false,
      endpointSource: 'inherit',
      baseUrl: null,
      apiKeyEnv: null,
      keyConfigured: true,
      modelIds: ['agnes-3.0-flash']
    }
  ],
  registry: { path: 'config/llm-providers.json', source: 'file', mtimeMs: null, lastError: null, fileDefaults: { chat: 'deepseek-v4-flash', reasoning: 'deepseek-v4-pro' } },
  models: [
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      tier: 'chat',
      provider: 'deepseek',
      providerId: 'deepseek',
      hasOwnEndpoint: false,
      keyConfigured: true,
      capabilities: { supportsThinking: true, supportsReasoningEffort: true },
      limits: { maxOutputTokens: 131072, defaultMaxTokens: 32768, reasoningReserveTokens: 8192, maxParallelRequests: null },
      fallbacks: ['agnes-3.0-flash'],
      pricingConfigured: false
    },
    {
      id: 'agnes-3.0-flash',
      label: 'Agnes 3.0 Flash',
      tier: 'chat',
      provider: 'agnes',
      providerId: 'agnes',
      hasOwnEndpoint: false,
      keyConfigured: true,
      capabilities: { supportsThinking: false, supportsReasoningEffort: false },
      limits: { maxOutputTokens: 65536, defaultMaxTokens: 32768, reasoningReserveTokens: 0, maxParallelRequests: null },
      fallbacks: [],
      pricingConfigured: false
    }
  ],
  aliases: [
    {
      alias: 'chat',
      source: 'code',
      members: ['deepseek-v4-flash', 'agnes-3.0-flash'],
      dbMembers: null,
      selected: 'deepseek-v4-flash',
      selectedWhenRequiringThinking: 'deepseek-v4-flash',
      degradedWhenRequiringThinking: false
    },
    {
      alias: 'light',
      source: 'code',
      members: ['agnes-3.0-flash'],
      dbMembers: null,
      selected: 'agnes-3.0-flash',
      selectedWhenRequiringThinking: 'agnes-3.0-flash',
      degradedWhenRequiringThinking: true
    }
  ],
  defaults: {
    defaultModelConfigured: 'chat',
    defaultModelResolved: 'deepseek-v4-flash',
    defaultModelSource: 'alias',
    defaultReasoningModelConfigured: 'reasoning',
    defaultReasoningModelResolved: 'deepseek-v4-pro',
    defaultReasoningModelSource: 'alias'
  },
  fallbackChains: [{ model: 'deepseek-v4-flash', fallbacks: ['agnes-3.0-flash'] }],
  cooldowns: [
    { key: 'deepseek|https://gw.example/v1|deepseek-v4-flash', providerId: 'deepseek', endpoint: 'https://gw.example/v1', model: 'deepseek-v4-flash', remainingMs: 21000 }
  ],
  warnings: [
    '模型「agnes-3.0-flash」未配置价格，成本统计会缺失',
    '别名「chat」的 DB 覆盖含未注册模型（已忽略）：not-registered'
  ],
  deprecatedPromptModelCount: 30
};

async function mountOverview(props: Record<string, unknown> = {}) {
  const wrapper = mount(ModelRegistryOverview, { props });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('ModelRegistryOverview（只读模型总览）', () => {
  beforeEach(() => {
    getModelRegistryMock.mockReset();
  });

  it('渲染别名映射 + 供应商与能力限额两块；合并块按供应商分组、表头列数 === 数据行格数', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    const text = wrapper.text();

    // ① 别名映射：light 在 requireThinking 下降级
    expect(text).toContain('别名映射');
    expect(text).toContain('chat');
    expect(text).toContain('降级');

    // ② 供应商与能力限额（合并块）：供应商作组头 + 其模型作组内行
    expect(text).toContain('模型供应商与能力限额');
    expect(text).toContain('DeepSeek');
    expect(text).toContain('不支持');
    expect(text).toContain('不限');
    // 两个供应商（deepseek / agnes）各成一个组头行
    expect(wrapper.findAll('.ac-mr-pgroup')).toHaveLength(2);
    // 组内模型行归属其供应商：deepseek 组的行数 = OVERVIEW.models 中 providerId==='deepseek' 的条数
    const groups = wrapper.findAll('.ac-mr-pgroup');
    expect(groups[0].text()).toContain('DeepSeek');

    // 限额表：表头 10 列（去掉独立「供应商」列，供应商已升为组头）必须与数据行格数一致；
    // 只断言文本包含抓不到列错位
    const limitTable = wrapper.findAll('table').find((t) => t.text().includes('推理预留'));
    expect(limitTable).toBeTruthy();
    const thCount = limitTable!.findAll('thead th').length;
    const firstDataRow = limitTable!.find('tbody tr.ac-mr-mmodel');
    const firstRowTds = firstDataRow?.findAll('td').length ?? 0;
    expect(thCount).toBeGreaterThan(0);
    expect(firstRowTds).toBe(thCount);

    wrapper.unmount();
  });

  it('状态列：命中部署冷却显示剩余秒数，未命中显示健康', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    const text = wrapper.text();
    // 冷却按 providerId + model 双键匹配：deepseek-v4-flash 命中 21s，agnes 无冷却
    expect(text).toContain('冷却中');
    expect(text).toContain('21s');
    expect(text).toContain('● 健康');
    wrapper.unmount();
  });

  it('无冷却时状态列全绿，非模型级告警落表尾注', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: { ...OVERVIEW, cooldowns: [] } } });
    const wrapper = await mountOverview();
    const text = wrapper.text();
    expect(text).not.toContain('冷却中');
    // 非模型级提示（别名类）→ 表尾注
    expect(text).toContain('未注册模型');
    wrapper.unmount();
  });

  it('模型级提示落行内 ⚠ 徽标（title 承载全串），不进表尾注', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: { ...OVERVIEW, warnings: ['模型「agnes-3.0-flash」未配置价格，成本统计会缺失'] } } });
    const wrapper = await mountOverview();
    const rowWarn = wrapper.find('.ac-mr-rowwarn');
    expect(rowWarn.exists()).toBe(true);
    expect(rowWarn.attributes('title')).toContain('未配置价格');
    wrapper.unmount();
  });

  it('分片裁剪：只渲染指定分片，但 defaults / aliases 仍回传宿主', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview({ parts: ['aliases'] });
    const text = wrapper.text();
    expect(text).toContain('别名映射');
    // 合并块（供应商与能力限额）不渲染
    expect(text).not.toContain('模型供应商与能力限额');
    expect(wrapper.findAll('.ac-mr-pgroup')).toHaveLength(0);
    // 解析结果由宿主行内展示，切片再窄也要回传（同一份 getModelRegistry 数据）
    expect(wrapper.emitted('defaults')?.at(-1)?.[0]).toMatchObject({
      defaults: { defaultModelResolved: 'deepseek-v4-flash' }
    });
    expect(wrapper.emitted('aliases')?.at(-1)?.[0]).toEqual(['chat', 'light']);
    wrapper.unmount();
  });

  it('加载失败展示错误与重试入口', async () => {
    getModelRegistryMock.mockRejectedValue(new Error('boom'));
    const wrapper = await mountOverview();
    expect(wrapper.text()).toContain('模型总览加载失败');
    expect(wrapper.text()).toContain('重试');
    wrapper.unmount();
  });

  it('加载成功向宿主上报 { models, warnings }', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    const emitted = wrapper.emitted('count');
    expect(emitted?.at(-1)?.[0]).toEqual({ models: 2, warnings: 2 });
    wrapper.unmount();
  });

  /* 2026-10-22 用户裁定：卡首定义句整类撤除，只留「只读」状态与登记表本身。 */
  it('卡首不再摆定义句（档位/限额/降级机制的说明已撤）', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    expect(wrapper.find('.ac-mr-lead').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('平台会路由的模型只有下面登记的这些');
    wrapper.unmount();
  });

  it('上游未登记清单收进表尾折叠，且与登记侧同口径（vendor 前缀孪生名算命中）', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview({
      upstream: ['deepseek-v4-flash', 'deepseek/deepseek-v4-flash', 'BAAI/bge-m3', 'openai/gpt-6-luna']
    });
    const fold = wrapper.find('.ac-mr-upstream');
    expect(fold.exists(), '上游有未登记模型时应出现折叠').toBe(true);
    // 两个写法都是同一个已登记模型，只剩 2 个真未登记
    expect(fold.find('summary').text()).toContain('上游还有 2 个未登记');
    expect(fold.findAll('.ac-mr-upstream__item').map((e) => e.text())).toEqual(['BAAI/bge-m3', 'openai/gpt-6-luna']);
    // 默认收起（只在排查「某模型为什么用不了」时才展开）
    expect(fold.element.hasAttribute('open')).toBe(false);
    wrapper.unmount();
  });

  it('未传上游清单（或全已登记）时不渲染折叠，不给一个恒为 0 的入口', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const none = await mountOverview();
    expect(none.find('.ac-mr-upstream').exists()).toBe(false);
    none.unmount();

    const all = await mountOverview({ upstream: ['deepseek-v4-flash', 'agnes-3.0-flash'] });
    expect(all.find('.ac-mr-upstream').exists()).toBe(false);
    all.unmount();
  });
});
