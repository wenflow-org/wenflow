/**
 * 向量 / 重排卡（2026-10-28 用户「全局单例引擎，不要套多模型卡片」；
 * 2026-11-05 模型池上线，「单例」指的是「一条连接」，不是「一个模型」）：
 * 1. 两张卡只回答「配了哪些模型、哪个在用、健不健康」，卡面不铺表单；
 * 2. 一条连接可配多个模型，其中一个是启用态——行内动作与对话卡同序同形（配置 · 测试 · ⋯），
 *    ⋯ 里是「设为启用 / 删除」；
 * 3. 连接方式用两枚说明卡（复用对话模型连接 / 独立服务），与模型参数在同一弹层一次保存；
 * 4. 卡头不挂状态徽标（2026-11-05）。
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

/** 删除走二次确认：默认通过（单独用例里再按需改） */
const { askConfirmMock } = vi.hoisted(() => ({ askConfirmMock: vi.fn(async () => true) }));
vi.mock('../useConfirm', () => ({ askConfirm: askConfirmMock }));

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
      models: ['BAAI/bge-m3'],
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
      models: ['BAAI/bge-reranker-v2-m3'],
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

/** 一条连接挂多个模型的样子（用户「我拉去了四个，配置了四个」） */
function pooledView() {
  const data = view();
  data.embedding.models = ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'text-embedding-3-large'];
  data.embedding.model = 'BAAI/bge-large-zh-v1.5';
  return data;
}

function mountPanel() {
  return mount(InfraModelsPanel, { global: { stubs: { teleport: true } } });
}

function cards(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('.mpp-eng');
}

/** 某张卡里的模型行（卡头之外的那些行） */
function rows(wrapper: ReturnType<typeof mountPanel>, index: number) {
  return cards(wrapper)[index].findAll('.mpp-eng__row');
}

async function openConfig(wrapper: ReturnType<typeof mountPanel>, index: number, row = 0) {
  const btn = rows(wrapper, index)[row].findAll('button').find((b) => b.text() === '配置');
  expect(btn).toBeTruthy();
  await btn!.trigger('click');
  await flushPromises();
}

async function openRowMenu(wrapper: ReturnType<typeof mountPanel>, index: number, row = 0) {
  await rows(wrapper, index)[row].find('.mk-menu__btn').trigger('click');
  await flushPromises();
}

async function menuItem(wrapper: ReturnType<typeof mountPanel>, label: string) {
  const item = wrapper.findAll('.mk-menu__item').find((b) => b.text() === label);
  expect(item, `菜单里应有「${label}」`).toBeTruthy();
  return item!;
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

  it('两张卡各一行模型，卡面没有输入框，卡头不挂状态徽标', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const list = cards(wrapper);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.find('.mk-card__title').text())).toEqual(['向量模型', '重排模型']);
    expect(list[0].text()).toContain('Embedding');
    expect(list[1].text()).toContain('Reranker');
    // 2026-11-05 用户「已配置这个 pill 不要了」：卡头只有标题 + 类型
    expect(list[0].find('.mk-badge').exists()).toBe(false);
    expect(rows(wrapper, 0)[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    // 2026-11-04「让布局自己说话」：模型行下没有维度 / 连接归属这类次级说明行
    expect(wrapper.find('.mpp-eng__params').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('维度由上游返回');
    expect(wrapper.find('.mpp-eng input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未保存');
    // 每张卡自己一枚「＋ 添加模型」（卡头右组）
    expect(list[0].find('.mk-card__head-right button').text()).toBe('＋ 添加模型');
    wrapper.unmount();
  });

  /* 2026-11-05 用户「为什么没有三个点的默认模型的操作了」：
     一条连接可配多个模型，其中一个启用；⋯ 里切换启用 / 删除。 */
  it('模型池：一行一个模型，启用项挂徽标，行内是 配置 · 测试 · ⋯', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    const wrapper = mountPanel();
    await flushPromises();

    const list = rows(wrapper, 0);
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.find('.mpp-eng__model').text())).toEqual([
      'BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'text-embedding-3-large',
    ]);
    // 只有启用中的那一个带徽标，且写明是「启用」而不是「已配置」
    expect(list.map((r) => r.find('.mpp-eng__on').exists())).toEqual([false, true, false]);
    expect(list[1].find('.mpp-eng__on').text()).toBe('启用');

    // 与对话卡同序同形（2026-11-05 用户「里面的菜单按钮数量不一样啊」）
    const acts = list[0].find('.mpp-eng__acts').findAll('button');
    expect(acts.map((b) => b.text())).toEqual(['配置', '测试', '⋯']);
    expect(acts.slice(0, 2).every((b) => b.classes().includes('mk-link'))).toBe(true);
    wrapper.unmount();
  });

  it('⋯「设为启用」：只切启用项，模型池原样保留', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    updateMock.mockResolvedValue({ data: { data: { ...pooledView(), embedding: { ...pooledView().embedding, model: 'BAAI/bge-m3' } } } });
    const wrapper = mountPanel();
    await flushPromises();

    await openRowMenu(wrapper, 0, 1); // 当前启用的那一行
    // 已经是启用项：这一枚不可点（没有「再设一次」的意义）
    expect((await menuItem(wrapper, '设为启用')).attributes('disabled')).toBeDefined();

    await openRowMenu(wrapper, 0, 2);
    await (await menuItem(wrapper, '设为启用')).trigger('click');
    await flushPromises();

    const payload = updateMock.mock.calls[0][0];
    expect(payload.embedding).toEqual({
      models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'text-embedding-3-large'],
      model: 'text-embedding-3-large',
    });
    wrapper.unmount();
  });

  it('⋯「删除」：删掉当前启用项时自动改用池里下一个；删备选不动启用项', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    updateMock.mockResolvedValue({ data: { data: pooledView() } });
    const wrapper = mountPanel();
    await flushPromises();

    // 确认框默认放行
    askConfirmMock.mockResolvedValue(true);

    await openRowMenu(wrapper, 0, 1); // 启用中的 BAAI/bge-large-zh-v1.5
    await (await menuItem(wrapper, '删除')).trigger('click');
    await flushPromises();
    expect(updateMock.mock.calls[0][0].embedding).toEqual({
      models: ['BAAI/bge-m3', 'text-embedding-3-large'],
      model: 'BAAI/bge-m3',
    });

    await openRowMenu(wrapper, 0, 2); // 备选 text-embedding-3-large
    await (await menuItem(wrapper, '删除')).trigger('click');
    await flushPromises();
    expect(updateMock.mock.calls[1][0].embedding).toEqual({
      models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'],
      model: 'BAAI/bge-large-zh-v1.5',
    });
    wrapper.unmount();
  });

  /* 2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排的「＋ 添加模型」
     与对话卡共用同一张上游清单弹窗，不再是「配置表单 + 候选小胶囊」。 */
  it('卡头「＋ 添加模型」：开同一张清单弹窗，只列该用途的模型', async () => {
    pullMock.mockResolvedValue({
      data: { data: { models: ['BAAI/bge-m3', 'deepseek-v4.1-flash', 'BAAI/bge-reranker-v2-m3'] } },
    });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    expect(pullMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'embedding' }));
    const dialog = wrapper.find('.pmd');
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('.mk-modal__title').text()).toBe('添加向量模型');
    expect(dialog.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['BAAI/bge-m3']);
    // 2026-11-05 模型池：多选（不是单选），已有模型标「已添加」
    expect(dialog.find('input[type="checkbox"]').exists()).toBe(true);
    expect(dialog.find('input[type="radio"]').exists()).toBe(false);
    // 手填走「配置」，弹窗底栏不给手动录入
    expect(dialog.find('.pmd-manual').exists()).toBe(false);
    wrapper.unmount();
  });

  it('清单里勾一个即入池：连接与参数沿用，池子空时它成为启用项', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-large-zh-v1.5'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    await wrapper.find('.pmd-row input[type="checkbox"]').setValue(true);
    await flushPromises();
    const confirm = wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!;
    await confirm.trigger('click');
    await flushPromises();

    // 只发池子与启用项：连接与参数不在这次补丁里，后端按 partial 合并语义保留
    expect(updateMock).toHaveBeenCalledWith({
      embedding: {
        models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'],
        model: 'BAAI/bge-m3',
      },
    });
    wrapper.unmount();
  });

  /* 池子以**最新写回结果**为基准合并（2026-11-05 真页面实测后收紧）：
     弹窗开着期间池子可能已被别的动作改过（切启用 / 删模型 / 上一轮引入），
     拿开窗时的快照合并会把那次改动覆盖掉。这里模拟「先加一个，再开窗加第二个」，
     第二次补丁必须带上第一次的结果。 */
  it('引入以最新池子为基准：不同轮次的加入不会互相覆盖', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-large-zh-v1.5', 'Qwen3-Embedding-0.6B'] } } });
    const afterFirst = { ...view(), embedding: { ...view().embedding, models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'] } };
    const afterSecond = {
      ...view(),
      embedding: { ...view().embedding, models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'Qwen3-Embedding-0.6B'] },
    };
    updateMock.mockResolvedValueOnce({ data: { data: afterFirst } });
    updateMock.mockResolvedValueOnce({ data: { data: afterSecond } });

    const wrapper = mountPanel();
    await flushPromises();

    // 第一轮：加 bge-large-zh-v1.5
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();
    expect(updateMock).toHaveBeenCalledTimes(0);
    await wrapper.findAll('.pmd-row').find((r) => r.text().includes('BAAI/bge-large-zh-v1.5'))!
      .find('input').setValue(true);
    await flushPromises();
    await wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click');
    await flushPromises();
    expect(updateMock.mock.calls[0][0].embedding.models).toEqual(['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5']);

    // 第二轮：重新开窗（此时视图已是最新池子），再加 Qwen3
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();
    await wrapper.findAll('.pmd-row').find((r) => r.text().includes('Qwen3-Embedding-0.6B'))!
      .find('input').setValue(true);
    await flushPromises();
    await wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click');
    await flushPromises();

    // 第二次的池子基于第一次写回的结果，不是最初只有 bge-m3 的那份
    expect(updateMock.mock.calls[1][0].embedding.models)
      .toEqual(['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'Qwen3-Embedding-0.6B']);
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

  it('保存是一次提交：连接方式 + 模型参数 + 模型池一起回传', async () => {
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
      models: ['BAAI/bge-reranker-v2-m3'],
      endpoint: 'https://api.siliconflow.cn/v1/rerank',
      apiKey: 'sk-live',
      timeoutMs: 20000,
    });
    expect(wrapper.find('.mk-modal').exists()).toBe(false);
    wrapper.unmount();
  });

  it('配置里改模型 ID：池里那一项跟着改名，启用项也跟过去', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    await wrapper.find('.infra-model-row input').setValue('BAAI/bge-m3-2026');
    await wrapper.find('.mk-modal__foot').findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0].embedding).toMatchObject({
      models: ['BAAI/bge-m3-2026'],
      model: 'BAAI/bge-m3-2026',
    });
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
    expect(rows(wrapper, 0)[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    wrapper.unmount();
  });

  it('未配置（池子空）时只留添加与配置，没有测试与 ⋯', async () => {
    const data = view();
    data.rerank = { ...data.rerank, configured: false, model: '', models: [], keySource: 'none' as const };
    getMock.mockResolvedValue({ data: { data } });
    const wrapper = mountPanel();
    await flushPromises();
    const rerank = cards(wrapper)[1];

    expect(rerank.find('.mk-badge').exists()).toBe(false);
    expect(rerank.find('.mpp-eng__model').text()).toBe('未选择模型');
    const labels = rerank.findAll('button').map((b) => b.text());
    expect(labels).toEqual(['＋ 添加模型', '配置']);
    wrapper.unmount();
  });

  it('逐行测试：带该行的模型 id 发请求，结果只落那一行', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    testMock.mockResolvedValue({ data: { data: { ok: true, model: 'text-embedding-3-large', latencyMs: 88, dimensions: 3072 } } });
    const wrapper = mountPanel();
    await flushPromises();

    await rows(wrapper, 0)[2].findAll('.mk-link').find((b) => b.text() === '测试')!.trigger('click');
    await flushPromises();

    // 一条连接挂多个模型：测的必须是那一行，否则 B 行会显示 A 的结果
    expect(testMock).toHaveBeenCalledWith('embedding', 'text-embedding-3-large');
    const res = rows(wrapper, 0)[2].find('.mk-rowres');
    expect(res.text()).toContain('调用通过');
    expect(res.text()).toContain('88ms');
    // 别的行没有读数
    expect(rows(wrapper, 0)[0].find('.mk-rowres').exists()).toBe(false);
    wrapper.unmount();
  });

  /* P1（2026-11-04 用户「它每一个接口都独立的自己去拉就行了」）：向量 / 重排也向上游拉清单再挑。 */
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
