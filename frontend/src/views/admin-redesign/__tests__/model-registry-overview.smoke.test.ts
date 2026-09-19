/**
 * ModelRegistryOverview 冒烟（P2⑤ 只读总览）：
 * 1. 默认路由解析 / 别名映射 / 能力与限额 / 部署冷却 / 配置提示 五段渲染
 * 2. requireThinking 降级标记（light → agnes）
 * 3. 无冷却 / 无告警时展示健康空态
 * 4. 加载失败展示错误 + 重试
 * 5. 加载成功向宿主上报 { models, warnings }
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ModelRegistryOverview from '../ModelRegistryOverview.vue';

const { getModelRegistryMock } = vi.hoisted(() => ({ getModelRegistryMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminApiConfigApi: { getModelRegistry: getModelRegistryMock }
}));

const OVERVIEW = {
  generatedAt: '2026-09-19T12:00:00.000Z',
  models: [
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      tier: 'chat',
      provider: 'deepseek',
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
    { key: 'platform|https://gw.example/v1|deepseek-v4-pro', providerId: 'platform', endpoint: 'https://gw.example/v1', model: 'deepseek-v4-pro', remainingMs: 21000 }
  ],
  warnings: ['别名「chat」的 DB 覆盖含未注册模型（已忽略）：not-registered'],
  deprecatedPromptModelCount: 30
};

async function mountOverview() {
  const wrapper = mount(ModelRegistryOverview);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('ModelRegistryOverview（只读模型总览）', () => {
  beforeEach(() => {
    getModelRegistryMock.mockReset();
  });

  it('渲染默认解析 / 别名 / 能力限额 / 冷却 / 告警五段', async () => {
    getModelRegistryMock.mockResolvedValue({ data: { data: OVERVIEW } });
    const wrapper = await mountOverview();
    const text = wrapper.text();

    // ① 默认路由解析：配置值是别名，解析为具体模型
    expect(text).toContain('chat');
    expect(text).toContain('deepseek-v4-flash');
    expect(text).toContain('别名');

    // ② 别名：light 在 requireThinking 下降级
    expect(text).toContain('降级');

    // ③ 能力与限额
    expect(text).toContain('不支持');
    expect(text).toContain('不限');

    // ④ 冷却剩余（21s）
    expect(text).toContain('21s');

    // ⑤ 告警
    expect(text).toContain('未注册模型');

    expect(wrapper.findAll('table').length).toBeGreaterThanOrEqual(4);
    wrapper.unmount();
  });

  it('无冷却 / 无告警时展示健康空态', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: { data: { ...OVERVIEW, cooldowns: [], warnings: [] } }
    });
    const wrapper = await mountOverview();
    expect(wrapper.text()).toContain('当前没有冷却中的部署');
    expect(wrapper.text()).toContain('没有发现配置漂移');
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
    expect(emitted?.at(-1)?.[0]).toEqual({ models: 2, warnings: 1 });
    wrapper.unmount();
  });
});
