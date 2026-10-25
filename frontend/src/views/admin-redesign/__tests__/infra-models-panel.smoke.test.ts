/**
 * 基础设施模型卡冒烟：
 * 1. 平台必需标识与 embedding/rerank 两卡渲染；
 * 2. 配置来源与密钥来源可读；
 * 3. 「测试连接」走真实接口并回显结果。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import InfraModelsPanel from '../InfraModelsPanel.vue';

const { getMock, testMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  testMock: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({
  adminInfraModelsApi: {
    get: getMock,
    test: testMock,
    update: vi.fn(),
  },
}));

function view() {
  return {
    required: true,
    warnings: [],
    embedding: {
      kind: 'embedding',
      provider: 'bge',
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
      endpoint: 'https://gw.example/v1/rerank',
      model: 'BAAI/bge-reranker-v2-m3',
      apiKeyEnv: 'RERANK_API_KEY',
      timeoutMs: 20000,
      batchSize: null,
      dimensions: null,
      configured: true,
      configSource: 'db',
      keySource: 'inherit',
      keyHint: '····test',
    },
  };
}

describe('InfraModelsPanel', () => {
  beforeEach(() => {
    getMock.mockReset();
    testMock.mockReset();
    getMock.mockResolvedValue({ data: { data: view() } });
    testMock.mockResolvedValue({
      data: { data: { ok: true, model: 'BAAI/bge-m3', latencyMs: 120, dimensions: 1024 } },
    });
  });

  it('渲染平台必需标识、两卡与密钥来源', async () => {
    const wrapper = mount(InfraModelsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain('基础设施模型');
    expect(wrapper.text()).toContain('平台必需');
    expect(wrapper.text()).toContain('向量化');
    expect(wrapper.text()).toContain('重排');
    expect(wrapper.text()).toContain('BAAI/bge-m3');
    expect(wrapper.text()).toContain('沿用向量化密钥');
    expect(wrapper.text()).toContain('配置来源：平台配置');
    wrapper.unmount();
  });

  it('embedded 模式不套第二层卡壳，只留紧凑块头', async () => {
    const wrapper = mount(InfraModelsPanel, { props: { embedded: true } });
    await flushPromises();
    expect(wrapper.find('.mk-card').exists()).toBe(false);
    expect(wrapper.find('.infra-embedded__head').exists()).toBe(true);
    expect(wrapper.text()).toContain('基础设施模型');
    expect(wrapper.text()).toContain('平台必需');
    expect(wrapper.findAll('.infra-item')).toHaveLength(2);
    wrapper.unmount();
  });

  it('测试连接调用接口并回显结果', async () => {
    const wrapper = mount(InfraModelsPanel);
    await flushPromises();
    const button = wrapper.findAll('button').find((item) => item.text().includes('测试连接'));
    expect(button).toBeTruthy();
    await button!.trigger('click');
    await flushPromises();
    expect(testMock).toHaveBeenCalledWith('embedding');
    expect(wrapper.text()).toContain('测试通过');
    wrapper.unmount();
  });
});
