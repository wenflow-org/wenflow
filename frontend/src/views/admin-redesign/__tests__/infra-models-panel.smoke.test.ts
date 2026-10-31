/**
 * 向量 / 重排单例引擎卡（2026-10-28 用户「全局单例引擎，不要套多模型卡片」）：
 * 1. 两张紧凑卡只回答「挂的哪个模型、走哪条连接、健不健康」，卡面不铺表单；
 * 2. 连接方式用两枚说明卡（复用对话模型连接 / 独立服务），与模型参数在同一弹层一次保存；
 * 3. 未配置时只给配置入口；配置来源收进状态徽标 title。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import InfraModelsPanel from '../InfraModelsPanel.vue';

const { getMock, testMock, updateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  testMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({
  adminInfraModelsApi: {
    get: getMock,
    test: testMock,
    update: updateMock,
  },
}));

function view(mode: { embedding?: 'inherit' | 'own'; rerank?: 'inherit' | 'own' } = {}) {
  return {
    required: true,
    platformBaseUrl: 'https://newapi.wenflow.org',
    warnings: [],
    embedding: {
      kind: 'embedding',
      provider: 'bge',
      connectionMode: mode.embedding ?? 'own',
      endpoint: 'https://gw.example/v1/embeddings',
      model: 'BAAI/bge-m3',
      apiKeyEnv: 'EMBEDDING_API_KEY',
      timeoutMs: 20000,
      batchSize: 32,
      dimensions: 1024,
      configured: true,
      configSource: 'db',
      keySource: 'db',
      keyHint: '····test',
    },
    rerank: {
      kind: 'rerank',
      provider: 'bge',
      connectionMode: mode.rerank ?? 'inherit',
      endpoint: 'https://newapi.wenflow.org/v1/rerank',
      model: 'BAAI/bge-reranker-v2-m3',
      apiKeyEnv: 'RERANK_API_KEY',
      timeoutMs: 20000,
      batchSize: null,
      dimensions: null,
      configured: true,
      configSource: 'db',
      keySource: 'platform',
      keyHint: null,
    },
  };
}

function mountPanel() {
  return mount(InfraModelsPanel, { global: { stubs: { teleport: true } } });
}

function cards(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('.mpp-eng');
}

async function openConfig(wrapper: ReturnType<typeof mountPanel>, index: number) {
  const card = cards(wrapper)[index];
  const btn = card.findAll('button').find((b) => b.text() === '配置');
  expect(btn).toBeTruthy();
  await btn!.trigger('click');
  await flushPromises();
}

describe('InfraModelsPanel', () => {
  beforeEach(() => {
    getMock.mockReset();
    testMock.mockReset();
    updateMock.mockReset();
    getMock.mockResolvedValue({ data: { data: view() } });
    testMock.mockResolvedValue({
      data: { data: { ok: true, model: 'BAAI/bge-m3', latencyMs: 120, dimensions: 1024 } },
    });
    updateMock.mockResolvedValue({ data: { data: view() } });
  });

  it('两张单例卡只有摘要与「测试 / 配置」，卡面没有输入框', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const list = cards(wrapper);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.find('.mk-card__title').text())).toEqual(['向量模型', '重排模型']);
    expect(list[0].text()).toContain('Embedding');
    expect(list[1].text()).toContain('Reranker');
    expect(list[0].find('.mk-badge').text()).toBe('已配置');
    expect(list[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    expect(list[0].find('.mpp-eng__conn').text()).toBe('独立端点 · gw.example');
    expect(list[1].find('.mpp-eng__conn').text()).toBe('复用对话模型的连接');
    // 卡面不裸露表单，也没有「未保存 / 保存连接」
    expect(wrapper.find('.mpp-eng input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未保存');
    expect(wrapper.text()).not.toContain('保存连接');
    expect(list[0].findAll('button').map((b) => b.text())).toEqual(['测试', '配置']);
    wrapper.unmount();
  });

  it('配置弹层：连接方式用两枚说明卡，独立服务展开地址与密钥', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect(modal.find('.mk-modal__title').text()).toBe('配置向量模型');
    expect(modal.findAll('.infra-choice__opt')).toHaveLength(2);
    expect((modal.find('input[value="own"]').element as HTMLInputElement).checked).toBe(true);
    const labels = modal.findAll('.mk-field__label').map((l) => l.text());
    expect(labels).toContain('模型 id');
    expect(labels).toContain('服务地址');
    expect(labels).toContain('API Key');
    expect(labels).toContain('超时（毫秒）');
    expect((modal.find('.infra-conn input.mk-field__input').element as HTMLInputElement).value)
      .toBe('https://gw.example/v1/embeddings');
    wrapper.unmount();
  });

  it('复用连接时不展示地址/密钥，只说明复用的是哪条地址', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 1);

    const modal = wrapper.find('.mk-modal');
    expect((modal.find('input[value="inherit"]').element as HTMLInputElement).checked).toBe(true);
    expect(modal.find('.infra-conn').exists()).toBe(false);
    expect(modal.find('.infra-inherit').text()).toContain('https://newapi.wenflow.org');
    wrapper.unmount();
  });

  it('保存是一次提交：连接方式 + 模型参数一起回传', async () => {
    updateMock.mockResolvedValue({ data: { data: view({ rerank: 'own' }) } });
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 1);

    const modal = wrapper.find('.mk-modal');
    // 切到独立服务（重绘后重新取弹层 DOM）
    await modal.find('input[value="own"]').setValue(true);
    await flushPromises();
    const own = wrapper.find('.mk-modal');
    const inputs = own.findAll('.infra-conn input.mk-field__input');
    expect(inputs.length).toBe(3);
    await inputs[0].setValue('https://api.siliconflow.cn/v1/rerank');
    await inputs[2].setValue('sk-live');
    await own.findAll('.mk-modal__foot button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();

    const payload = updateMock.mock.calls[0][0];
    expect(payload.rerank).toMatchObject({
      connectionMode: 'own',
      model: 'BAAI/bge-reranker-v2-m3',
      endpoint: 'https://api.siliconflow.cn/v1/rerank',
      apiKey: 'sk-live',
      timeoutMs: 20000,
    });
    expect(wrapper.find('.mk-modal').exists()).toBe(false);
    wrapper.unmount();
  });

  it('取消不回传，也不改卡面状态', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);
    const modal = wrapper.find('.mk-modal');
    await modal.find('input[value="inherit"]').setValue(true);
    await modal.findAll('.mk-modal__foot button').find((b) => b.text() === '取消')!.trigger('click');
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    expect(cards(wrapper)[0].find('.mpp-eng__conn').text()).toBe('独立端点 · gw.example');
    wrapper.unmount();
  });

  it('未配置时只给配置入口，不出现测试动作', async () => {
    const data = view();
    data.rerank = { ...data.rerank, configured: false, model: '', keySource: 'none' };
    getMock.mockResolvedValue({ data: { data } });
    const wrapper = mountPanel();
    await flushPromises();
    const rerank = cards(wrapper)[1];

    expect(rerank.find('.mk-badge').text()).toBe('未配置');
    expect(rerank.findAll('button').map((b) => b.text())).toEqual(['配置']);
    wrapper.unmount();
  });

  it('状态徽标的 title 区分复用的连接与平台配置', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const [embedding, rerank] = cards(wrapper);
    expect(embedding.find('.mk-badge').attributes('title')).toBe('配置来源：平台配置');
    expect(rerank.find('.mk-badge').attributes('title')).toBe('配置来源：对话模型的连接');
    wrapper.unmount();
  });
});
