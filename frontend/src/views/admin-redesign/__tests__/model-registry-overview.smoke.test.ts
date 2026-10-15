/**
 * ModelRegistryOverview 冒烟（只读总览；2026-10-15 用户重组后三分片）：
 * 1. 别名映射 / 模型供应商 / 能力限额（含状态列）三段渲染 + 表头列数自洽
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

  it('渲染供应商 / 别名映射 / 能力限额三段，限额表表头列数 === 数据行格数', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    const text = wrapper.text();

    // ① 别名映射：light 在 requireThinking 下降级
    expect(text).toContain('别名映射');
    expect(text).toContain('chat');
    expect(text).toContain('降级');

    // ② 供应商
    expect(text).toContain('DeepSeek');

    // ③ 能力与限额
    expect(text).toContain('不支持');
    expect(text).toContain('不限');

    // 限额表：表头 11 列（含状态列）必须与数据行格数一致——曾表头 10 列 / 行 9 格，
    // 从「档位」起整列右移、备用模型列恒空；只断言文本包含抓不到这种错位
    const limitTable = wrapper.findAll('table').find((t) => t.text().includes('推理预留'));
    expect(limitTable).toBeTruthy();
    const thCount = limitTable!.findAll('thead th').length;
    const firstRowTds = limitTable!.find('tbody tr')?.findAll('td').length ?? 0;
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
    expect(text).not.toContain('模型供应商');
    expect(text).not.toContain('模型能力与限额');
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
});
