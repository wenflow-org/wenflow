/**
 * 向量 / 重排卡（2026-10-28 用户「全局单例引擎，不要套多模型卡片」；
 * 2026-11-05 模型池上线，「单例」指的是「一条连接」，不是「一个模型」）：
 * 1. 两张卡只回答「配了哪些模型、哪个在用、健不健康」，卡面不铺表单；
 * 2. 一条连接可配多个模型，其中一个是启用态——行内动作与对话卡同序同形（配置 · 测试 · ⋯），
 *    ⋯ 里是「设为启用 / 删除」；
 * 3. 连接默认走全局通道，勾「使用独立接口地址覆盖全局通道」才展开地址与密钥（2026-11-05）；
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

  /* 2026-11-05 用户「配置里面还有 url，添加模型还有」：同一条连接只能在一处填。
     连接归「＋ 添加模型」那张弹窗（与对话卡同序），配置弹层只剩模型 ID 与参数。 */
  it('配置弹层：模型 ID 只读、只剩参数，连接不在这里', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect(modal.find('.mk-modal__title').text()).toBe('配置向量模型');
    /* 2026-11-05 用户「向量和重排的配置界面要改一下」：模型 ID 只读——
       这一格曾经能改、旁边还挂「拉取」，与卡头「＋ 添加模型」是同一件事的两个出口。 */
    expect(modal.find('.infra-model-name').text()).toBe('BAAI/bge-m3');
    expect(modal.find('.infra-model-row').exists()).toBe(false);
    // 地址与密钥不在这里：改名 / 换模型 / 换连接都归卡头那一颗按钮
    expect(modal.find('.infra-own').exists()).toBe(false);
    expect(modal.find('.infra-conn').exists()).toBe(false);
    expect(modal.findAll('.mk-field__label').map((l) => l.text())).toEqual(['超时（毫秒）', '批量大小', '向量维度']);
    wrapper.unmount();
  });

  it('添加模型弹窗：连接段在里面，摘要一行、点「修改连接」展开，地址填根路径', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    const dialog = wrapper.find('.pmd');
    expect(dialog.find('.pmd-conn__title').text()).toBe('连接');
    // 已配过连接：先给一行摘要（接在哪 + 密钥从哪来），不常驻三个输入框
    expect(dialog.find('.infra-conn-summary').text()).toContain('https://gw.example');
    expect(dialog.find('.infra-own').exists()).toBe(false);
    await dialog.findAll('.pmd-conn__actions button').find((b) => b.text() === '修改连接')!.trigger('click');
    await flushPromises();

    const conn = wrapper.find('.pmd');
    expect((conn.find('.infra-own input').element as HTMLInputElement).checked).toBe(true);
    // 回填成根地址；实际请求地址由这一层拼，和对话卡填根域名的口径一致
    expect((conn.find('.infra-conn input.mk-field__input').element as HTMLInputElement).value)
      .toBe('https://gw.example');
    expect(conn.find('.infra-endpoint').text()).toContain('https://gw.example/v1/embeddings');
    wrapper.unmount();
  });

  it('添加模型弹窗：沿用对话卡时只说明取哪条地址，不给地址与密钥输入', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: [] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[1].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.pmd .infra-conn-summary').text()).toContain('取对话卡');
    await wrapper.find('.pmd .pmd-conn__actions button').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('.pmd');
    expect((dialog.find('.infra-own input').element as HTMLInputElement).checked).toBe(false);
    expect(dialog.find('.infra-conn').exists()).toBe(false);
    expect(dialog.find('.infra-inherit').text()).toContain('https://newapi.wenflow.org');
    wrapper.unmount();
  });

  it('弹窗里「保存连接」：只提交连接字段，不碰池子与参数', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3'] } } });
    updateMock.mockResolvedValue({ data: { data: view({ rerank: 'own' }) } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[1].find('.mk-card__head-right button').trigger('click');
    await flushPromises();
    await wrapper.find('.pmd .pmd-conn__actions button').trigger('click');
    await flushPromises();

    await wrapper.find('.pmd .infra-own input').setValue(true);
    await flushPromises();
    const inputs = wrapper.find('.pmd').findAll('.infra-conn input.mk-field__input');
    // 重排多一列「接口规范」（只读）：服务地址 / 接口规范 / API Key
    expect(inputs.length).toBe(3);
    await inputs[0].setValue('https://api.siliconflow.cn');
    await inputs[2].setValue('sk-live');
    await flushPromises();

    const saveConn = wrapper.find('.pmd').findAll('.pmd-conn__actions button').find((b) => b.text() === '保存连接');
    expect(saveConn, '有未保存改动时才出现「保存连接」').toBeTruthy();
    await saveConn!.trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0]).toEqual({
      rerank: {
        connectionMode: 'own',
        endpoint: 'https://api.siliconflow.cn/v1/rerank',
        apiKey: 'sk-live',
      },
    });
    wrapper.unmount();
  });

  it('弹窗里改了地址：清单标成过期，先「重新获取」再选', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.pmd-list--stale').exists()).toBe(false);

    await wrapper.find('.pmd .pmd-conn__actions button').trigger('click');
    await flushPromises();
    await wrapper.find('.pmd .infra-conn input.mk-field__input').setValue('https://other.example');
    await flushPromises();

    expect(wrapper.find('.pmd-list--stale').exists()).toBe(true);
    expect(wrapper.find('.pmd-list').text()).toContain('先点「重新获取」');
    wrapper.unmount();
  });

  it('清单按用途筛，但留「显示全部」的退路', async () => {
    pullMock.mockResolvedValue({
      data: { data: { models: ['BAAI/bge-m3', 'deepseek-v4.1-flash', 'gpt-4o'] } },
    });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['BAAI/bge-m3']);
    const more = wrapper.findAll('.pmd button').find((b) => b.text().includes('显示全部'))!;
    expect(more.text()).toContain('2 个');
    await more.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.pmd-row')).toHaveLength(3);
    wrapper.unmount();
  });

  it('弹窗里的行内测试走这条能力的连接（不是供应商端点）', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3'] } } });
    testMock.mockResolvedValue({ data: { data: { ok: true, latencyMs: 95, dimensions: 1024 } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    await wrapper.find('.pmd-row__test').trigger('click');
    await flushPromises();
    expect(testMock).toHaveBeenCalledWith('embedding', 'BAAI/bge-m3');
    expect(wrapper.find('.pmd-row__res').text()).toContain('已连通');
    expect(wrapper.find('.pmd-row__res').text()).toContain('95ms');
    wrapper.unmount();
  });

  it('勾选引入时把连接的未保存改动一起落盘', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await cards(wrapper)[0].find('.mk-card__head-right button').trigger('click');
    await flushPromises();

    // 把连接切到「沿用对话卡」→ 旧清单过期，先重新获取
    await wrapper.find('.pmd .pmd-conn__actions button').trigger('click');
    await flushPromises();
    await wrapper.find('.pmd .infra-own input').setValue(false);
    await flushPromises();
    expect(wrapper.find('.pmd-list--stale').exists()).toBe(true);
    await wrapper.findAll('.pmd-toolbar button').find((b) => b.text() === '重新获取')!.trigger('click');
    await flushPromises();

    await wrapper.findAll('.pmd-row').find((r) => r.text().includes('BAAI/bge-large-zh-v1.5'))!
      .find('input').setValue(true);
    await flushPromises();
    await wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0]).toEqual({
      embedding: {
        models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'],
        model: 'BAAI/bge-m3',
        connectionMode: 'inherit',
      },
    });
    wrapper.unmount();
  });

  it('配置弹层保存：只回传参数与模型池，连接一个字段都不发', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect(modal.find('.infra-model-row input').exists()).toBe(false);
    expect(modal.find('.infra-model-name').text()).toBe('BAAI/bge-m3');
    await modal.findAll('.mk-modal__foot button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();

    const patch = updateMock.mock.calls[0][0].embedding;
    expect(patch).toMatchObject({ models: ['BAAI/bge-m3'], model: 'BAAI/bge-m3', timeoutMs: 20000 });
    // 连接字段一律不出现：少传 = 保留库里现值
    expect(patch).not.toHaveProperty('endpoint');
    expect(patch).not.toHaveProperty('apiKey');
    expect(patch).not.toHaveProperty('connectionMode');
    wrapper.unmount();
  });

  it('取消不回传，也不改卡面状态', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);
    const modal = wrapper.find('.mk-modal');
    await modal.find('.infra-formrow input').setValue('60000');
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

  /* 2026-11-05：拉清单只从卡头「＋ 添加模型」一条路走，配置弹层里不再有第二个入口。 */
  it('配置弹层里没有拉取入口：加模型只从卡头走', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect(modal.findAll('button').some((b) => b.text() === '拉取')).toBe(false);
    expect(modal.find('.infra-cands').exists()).toBe(false);
    expect(pullMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
