/**
 * 向量 / 重排单例引擎卡（2026-10-28 用户「全局单例引擎，不要套多模型卡片」）：
 * 1. 两张紧凑卡只回答「挂的哪个模型、走哪条连接、健不健康」，卡面不铺表单；
 * 2. 连接方式用两枚说明卡（复用对话模型连接 / 独立服务），与模型参数在同一弹层一次保存；
 * 3. 未配置时不出现测试动作；卡头的「＋ 添加模型」恒在；卡头不挂状态徽标（2026-11-05）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import InfraModelsPanel from '../InfraModelsPanel.vue';

const { getMock, testMock, updateMock, pullMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  testMock: vi.fn(),
  updateMock: vi.fn(),
  pullMock: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({
  adminInfraModelsApi: {
    get: getMock,
    test: testMock,
    update: updateMock,
    pull: pullMock,
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
    pullMock.mockReset();
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
    // 2026-11-05 用户「已配置这个 pill 不要了」：卡头只有标题 + 类型，没有状态徽标
    expect(list[0].find('.mk-badge').exists()).toBe(false);
    expect(list[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    // 2026-11-04「让布局自己说话」：模型行下不再有维度 / 连接归属这类次级说明行
    expect(wrapper.find('.mpp-eng__params').exists()).toBe(false);
    expect(wrapper.find('.mpp-eng__conn').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('维度由上游返回');
    expect(wrapper.text()).not.toContain('Cohere 兼容');
    expect(wrapper.text()).not.toContain('独立端点');
    // 卡面不裸露表单，也没有「未保存 / 保存连接」
    expect(wrapper.find('.mpp-eng input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未保存');
    expect(wrapper.text()).not.toContain('保存连接');
    // 每张卡自己一枚「＋ 添加模型」（卡头右组），模型行是「测试 / 配置」
    expect(list[0].find('.mk-card__head-right button').text()).toBe('＋ 添加模型');
    /* 2026-11-05 用户「里面的菜单按钮数量不一样啊」：与对话卡同序同形——
       配置在前、测试在后，同为 mk-link 文字链接，且没有 ⋯ 菜单（单例没有设为默认/删除）。 */
    const acts = list[0].find('.mpp-eng__acts').findAll('button');
    expect(acts.map((b) => b.text())).toEqual(['配置', '测试']);
    expect(acts.every((b) => b.classes().includes('mk-link'))).toBe(true);
    expect(list[0].find('.mk-menu').exists()).toBe(false);
    wrapper.unmount();
  });

  /* 2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排的「＋ 添加模型」
     与对话卡共用同一张上游清单弹窗（单选），不再是「配置表单 + 候选小胶囊」。 */
  it('卡头「＋ 添加模型」：开同一张清单弹窗，只列该用途的模型', async () => {
    pullMock.mockResolvedValue({
      data: { data: { models: ['BAAI/bge-m3', 'deepseek-v4.1-flash', 'BAAI/bge-reranker-v2-m3'] } },
    });
    const wrapper = mountPanel();
    await flushPromises();
    const btn = cards(wrapper)[0].find('.mk-card__head-right button');
    await btn.trigger('click');
    await flushPromises();

    // 拉取按用途过滤：向量卡只留 embedding 那一个
    expect(pullMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'embedding' }));
    const dialog = wrapper.find('.pmd');
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('.mk-modal__title').text()).toBe('添加向量模型');
    expect(dialog.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['BAAI/bge-m3']);
    // 单例：单选、没有全选、没有手动录入出口（手填走「配置」）
    expect(dialog.find('input[type="radio"]').exists()).toBe(true);
    expect(dialog.find('.pmd-all').exists()).toBe(false);
    expect(dialog.find('.pmd-manual').exists()).toBe(false);
    wrapper.unmount();
  });

  it('清单里选中即用：只换模型，连接方式与参数沿用当前配置', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-large-zh-v1.5'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    await wrapper.find('.pmd-row input[type="radio"]').trigger('change');
    await flushPromises();
    const confirm = wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!;
    await confirm.trigger('click');
    await flushPromises();

    expect(updateMock).toHaveBeenCalledWith({
      embedding: {
        connectionMode: 'own',
        endpoint: 'https://gw.example/v1/embeddings',
        model: 'BAAI/bge-large-zh-v1.5',
        timeoutMs: 20000,
        batchSize: 32,
        dimensions: 1024,
      },
    });
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
    // 「id」统一写作「ID」，与模型编辑弹窗同一写法（2026-11-02 评审）
    expect(labels).toContain('模型 ID');
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
    expect(cards(wrapper)[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    wrapper.unmount();
  });

  it('未配置时不出现测试动作，只留添加与配置', async () => {
    const data = view();
    data.rerank = { ...data.rerank, configured: false, model: '', keySource: 'none' };
    getMock.mockResolvedValue({ data: { data } });
    const wrapper = mountPanel();
    await flushPromises();
    const rerank = cards(wrapper)[1];

    // 未配置不再靠徽标表达：模型位写「未选择模型」，且没有「测试」动作
    expect(rerank.find('.mk-badge').exists()).toBe(false);
    expect(rerank.find('.mpp-eng__model').text()).toBe('未选择模型');
    const labels = rerank.findAll('button').map((b) => b.text());
    expect(labels).toEqual(['＋ 添加模型', '配置']);
    expect(labels).not.toContain('测试');
    wrapper.unmount();
  });

  it('卡头不再挂状态徽标，也没有「配置来源」的悬停说明', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    for (const card of cards(wrapper)) {
      expect(card.find('.mk-badge').exists()).toBe(false);
      expect(card.text()).not.toContain('配置来源');
    }
    wrapper.unmount();
  });

  /* P1（2026-11-04 用户「它每一个接口都独立的自己去拉就行了」）：向量 / 重排也向上游拉清单再挑，
     不再让人凭记忆手打模型 ID。 */
  it('配置弹层可向上游拉取，候选按用途过滤，点一个填进模型 ID', async () => {
    pullMock.mockResolvedValue({
      data: { data: { kind: 'embedding', models: ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3', 'gpt-4o'] } },
    });
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0); // 向量模型卡（own 模式）

    const pullBtn = wrapper.findAll('.infra-model-pull').find((b) => b.text() === '拉取')!;
    expect(pullBtn.exists()).toBe(true);
    await pullBtn.trigger('click');
    await flushPromises();

    // 独立服务：把弹层里填的地址与密钥一起发过去（还没保存也能拉）
    expect(pullMock).toHaveBeenCalledTimes(1);
    expect(pullMock.mock.calls[0][0]).toMatchObject({ kind: 'embedding', endpoint: 'https://gw.example/v1/embeddings' });

    // 只留向量模型：重排与对话模型不出现在候选里
    const cands = wrapper.findAll('.infra-cand').map((c) => c.text());
    expect(cands).toEqual(['BAAI/bge-m3']);
    await wrapper.find('.infra-cand').trigger('click');
    await flushPromises();
    expect(wrapper.find('.infra-model-row input').element).toHaveProperty('value', 'BAAI/bge-m3');
    wrapper.unmount();
  });

  it('拉不到匹配用途的模型时给一句人话，不铺空清单', async () => {
    pullMock.mockResolvedValue({ data: { data: { kind: 'rerank', models: ['gpt-4o', 'step-3.7-flash'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 1); // 重排模型卡
    await wrapper.findAll('.infra-model-pull').find((b) => b.text() === '拉取')!.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.infra-cand')).toHaveLength(0);
    expect(wrapper.find('.infra-cands__note').text()).toContain('没识别出重排模型');
    wrapper.unmount();
  });
});
