/**
 * 基础设施模型行冒烟（2026-10-28 从独立卡片并入模型表）：
 * 1. 向量化 / 重排作为模型表里的两组行，不再有独立区块与说明文案；
 * 2. 配置来源收进状态徽标 title；
 * 3. 「测试」走真实接口并回显结果。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { h } from 'vue';
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

/** 组件根节点是 <tr>，挂到真实表格里避免浏览器表外节点重排 */
function mountRows() {
  return mount({
    render: () => h('table', [h('tbody', [h(InfraModelsPanel)])]),
  });
}

function bodyRows(wrapper: ReturnType<typeof mountRows>) {
  return wrapper.findAll('tr').filter((r) => !r.classes('mpp-group'));
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

  it('并成模型表里的两行：分组行 + 用途 + 状态 + 编辑/测试，不再有独立区块', async () => {
    const wrapper = mountRows();
    await flushPromises();

    // 独立卡壳、块头与「平台必需」徽标都随区块撤掉
    expect(wrapper.find('.infra-card').exists()).toBe(false);
    expect(wrapper.find('.infra-item').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('基础设施模型');
    expect(wrapper.text()).not.toContain('平台必需');

    const group = wrapper.find('tr.mpp-group');
    expect(group.exists()).toBe(true);
    expect(group.text()).toContain('基础设施');
    expect(group.find('.mpp-group__count').text()).toBe('2 个');

    const rows = bodyRows(wrapper);
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('BAAI/bge-m3');
    expect(rows[0].text()).toContain('向量化');
    expect(rows[0].text()).toContain('已配置');
    expect(rows[1].text()).toContain('BAAI/bge-reranker-v2-m3');
    expect(rows[1].text()).toContain('重排');
    expect(rows[0].find('.mpp-rowacts').findAll('button').map((b) => b.text())).toEqual(['测试', '编辑']);
    wrapper.unmount();
  });

  it('配置来源收进状态徽标 title，不上屏', async () => {
    const wrapper = mountRows();
    await flushPromises();
    const badge = bodyRows(wrapper)[0].find('.mk-badge');
    expect(badge.attributes('title')).toBe('配置来源：平台配置');
    expect(wrapper.text()).not.toContain('配置来源');
    wrapper.unmount();
  });

  it('后端 warnings 不再上屏（未配置的降级说明整段撤掉）', async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          ...view(),
          warnings: ['向量化未配置：资料语义召回会退回结构化路径。'],
        },
      },
    });
    const wrapper = mountRows();
    await flushPromises();
    expect(wrapper.text()).not.toContain('资料语义召回');
    wrapper.unmount();
  });

  it('测试调用接口并在行内回显结果', async () => {
    const wrapper = mountRows();
    await flushPromises();
    const button = bodyRows(wrapper)[0]
      .findAll('button')
      .find((item) => item.text() === '测试');
    expect(button).toBeTruthy();
    await button!.trigger('click');
    await flushPromises();
    expect(testMock).toHaveBeenCalledWith('embedding');
    expect(bodyRows(wrapper)[0].find('.mpp-rowtest').text()).toContain('调用通过');
    expect(bodyRows(wrapper)[0].find('.mpp-rowtest').text()).toContain('120ms');
    wrapper.unmount();
  });
});
