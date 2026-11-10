/**
 * 向量 / 重排卡（2026-10-28 用户「全局单例引擎，不要套多模型卡片」；
 * 2026-11-05 模型池上线，「单例」指的是「一条连接」，不是「一个模型」）：
 * 1. 两张卡只回答「配了哪些模型、哪个在用、健不健康」，卡面不铺表单；
 * 2. 一条连接可配多个模型，其中一个是启用态——行内动作与对话卡同序同形（配置 · 测试 · ⋯），
 *    ⋯ 里是「设为启用 / 删除」；
 * 3. 连接默认走全局通道，卡头标签写「独立连接 / 跟随全局」，编辑走「连接配置」弹窗（2026-11-09）；
 * 4. 卡头的徽标只讲连接归属，不讲「配没配好」（2026-11-05 / 2026-11-09）。
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
      labels: {} as Record<string, string>,
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
      labels: {} as Record<string, string>,
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

/** 卡头右组的添加入口（2026-11-09：左邻多了「连接配置」，它不再是右组第一枚） */
function addBtn(wrapper: ReturnType<typeof mountPanel>, index: number) {
  const btn = cards(wrapper)[index]
    .find('.mk-card__head-right')
    .findAll('button')
    .find((b) => b.text() === '＋ 添加模型');
  expect(btn, '卡头应有「＋ 添加模型」').toBeTruthy();
  return btn!;
}

/** 卡头的连接归属标签：[独立连接] / [跟随全局]，完整地址进 title */
function connChip(wrapper: ReturnType<typeof mountPanel>, index: number) {
  return cards(wrapper)[index].find('.mpp-eng__id .mk-badge');
}

/** 打开某张卡的连接配置弹窗（2026-11-09：原先是卡内原地展开的表单） */
async function openConn(wrapper: ReturnType<typeof mountPanel>, index: number) {
  const btn = cards(wrapper)[index]
    .find('.mk-card__head-right')
    .findAll('button')
    .find((b) => b.text() === '连接配置');
  expect(btn, '卡头应有「连接配置」').toBeTruthy();
  await btn!.trigger('click');
  await flushPromises();
  expect(wrapper.find('.mpp-conn-dlg').exists(), '点开后应有连接配置弹窗').toBe(true);
  return wrapper.find('.mpp-conn-dlg');
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

  it('两张卡各一行模型，卡面没有输入框，卡头只有连接归属标签', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const list = cards(wrapper);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.find('.mk-card__title').text())).toEqual(['向量模型', '重排模型']);
    expect(list[0].text()).toContain('Embedding');
    expect(list[1].text()).toContain('Reranker');
    /* 2026-11-05 用户「已配置这个 pill 不要了」：卡头不挂**状态**徽标；
       2026-11-09 用户走查：卡头只多一枚**连接归属**标签（它讲的是「接在哪」）。
       （行内的「默认」徽标不算卡头徽标，故限定到 .mk-card__head） */
    expect(list[0].findAll('.mk-card__head .mk-badge').map((b) => b.text())).toEqual(['独立连接']);
    expect(list[1].findAll('.mk-card__head .mk-badge').map((b) => b.text())).toEqual(['跟随全局']);
    expect(list[0].find('.mk-card__head').text()).not.toContain('已配置');
    expect(rows(wrapper, 0)[0].find('.mpp-eng__model').text()).toBe('BAAI/bge-m3');
    // 2026-11-04「让布局自己说话」：模型行下没有维度 / 连接归属这类次级说明行
    expect(wrapper.find('.mpp-eng__params').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('维度由上游返回');
    expect(wrapper.find('.mpp-eng input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未保存');
    // 2026-11-09：连接细节收进卡头「连接配置」弹窗，卡面不再有常驻地址尾栏
    expect(wrapper.find('.mpp-eng__conn').exists()).toBe(false);
    expect(wrapper.find('.mpp-conn-dlg').exists()).toBe(false);
    // 每张卡自己一枚「＋ 添加模型」（卡头右组，左邻是「连接配置」）
    expect(list[0].find('.mk-card__head-right').findAll('button').map((b) => b.text()))
      .toEqual(['连接配置', '＋ 添加模型']);
    wrapper.unmount();
  });

  /* 2026-11-05 用户「为什么没有三个点的默认模型的操作了」：
     一条连接可配多个模型，其中一个启用；⋯ 里切换启用 / 删除。 */
  it('模型池：一行一个模型，默认项挂「默认」徽标，动作与对话卡完全一致', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    const wrapper = mountPanel();
    await flushPromises();

    const list = rows(wrapper, 0);
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.find('.mpp-eng__model').text())).toEqual([
      'BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'text-embedding-3-large',
    ]);
    // 只有默认那一个带徽标，且与对话卡同一枚「默认」（2026-11-07 用户「没标默认」）
    expect(list.map((r) => r.find('.mpp-eng__on').exists())).toEqual([false, true, false]);
    expect(list[1].find('.mpp-eng__on').text()).toBe('默认');
    // 2026-11-09 设计语言收敛：默认徽章走全局原语 .mk-badge--default（此前是各页自造的 mpp-default-chip，
    // 在向量卡里因 scoped 作用域拿不到样式，渲染成裸白字）
    expect(list[1].find('.mpp-eng__on').classes()).toContain('mk-badge--default');

    /* 动作与对话卡同序同形：非默认行四枚平铺，默认行没有「设为默认」、删除置灰。
       ⋯ 菜单整块撤除（2026-11-07 用户「向量/重排没和上面对齐」）。 */
    const acts = (i: number) => list[i].find('.mpp-eng__acts').findAll('button').map((b) => b.text());
    expect(acts(0)).toEqual(['设为默认', '配置', '测试', '删除']);
    expect(acts(1)).toEqual(['配置', '测试', '删除']);
    expect(list[1].findAll('.mpp-eng__acts .mk-link').find((b) => b.text() === '删除')!.attributes('disabled'))
      .toBeDefined();
    expect(wrapper.find('.mk-menu__btn').exists(), '⋯ 菜单已撤').toBe(false);
    wrapper.unmount();
  });

  it('行内「设为默认」：只切默认项，模型池原样保留；默认行不渲染这枚', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    updateMock.mockResolvedValue({ data: { data: { ...pooledView(), embedding: { ...pooledView().embedding, model: 'BAAI/bge-m3' } } } });
    const wrapper = mountPanel();
    await flushPromises();

    const list = rows(wrapper, 0);
    // 已经是默认：这一枚不渲染（没有「再设一次」的意义）
    expect(list[1].findAll('.mpp-eng__acts button').map((b) => b.text())).not.toContain('设为默认');

    await list[2].findAll('.mpp-eng__acts button').find((b) => b.text() === '设为默认')!.trigger('click');
    await flushPromises();

    const payload = updateMock.mock.calls[0][0];
    expect(payload.embedding).toEqual({
      models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'text-embedding-3-large'],
      model: 'text-embedding-3-large',
    });
    wrapper.unmount();
  });

  it('默认项的删除置灰并说明原因；删备选不动默认项', async () => {
    getMock.mockResolvedValue({ data: { data: pooledView() } });
    updateMock.mockResolvedValue({ data: { data: pooledView() } });
    const wrapper = mountPanel();
    await flushPromises();

    // 确认框默认放行
    askConfirmMock.mockResolvedValue(true);

    const list = rows(wrapper, 0);
    // 默认项（BAAI/bge-large-zh-v1.5）：置灰 + 写清要先改默认（与对话卡同一句）
    const delDefault = list[1].findAll('.mpp-eng__acts button').find((b) => b.text() === '删除')!;
    expect(delDefault.attributes('disabled')).toBeDefined();
    expect(delDefault.attributes('title')).toBe('当前为默认模型，请先将其他模型设为默认后再删除');

    // 备选 text-embedding-3-large：可删，默认项不受影响
    await list[2].findAll('.mpp-eng__acts button').find((b) => b.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(updateMock.mock.calls[0][0].embedding).toEqual({
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
    await addBtn(wrapper, 0).trigger('click');
    await flushPromises();

    expect(pullMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'embedding' }));
    expect(wrapper.find('.pmd').exists()).toBe(true);
    // 标题带上文（2026-11-09）：一眼知道在给哪条能力挑模型
    expect(wrapper.find('.pmd .mk-modal__title').text()).toBe('添加向量模型（Embedding）');
    // 2026-11-09：默认只看未添加——上游 3 个里只有一个被识别成向量，而它已经挂上了
    expect(wrapper.findAll('.pmd-row')).toHaveLength(0);
    // 切视图会重建弹窗内的 DOM，切完要从根重新取（别攥着切换前的 wrapper）
    await wrapper.findAll('.pmd-view .mk-seg__item').find((b) => b.text().startsWith('全部'))!.trigger('click');
    expect(wrapper.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['BAAI/bge-m3']);
    // 2026-11-05 模型池：多选（不是单选），已有模型标「已添加」
    expect(wrapper.find('.pmd input[type="checkbox"]').exists()).toBe(true);
    expect(wrapper.find('.pmd input[type="radio"]').exists()).toBe(false);
    // 手填走「配置」，弹窗底栏不给手动录入
    expect(wrapper.find('.pmd-manual').exists()).toBe(false);
    wrapper.unmount();
  });

  it('清单里勾一个即入池：连接与参数沿用，池子空时它成为启用项', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-large-zh-v1.5'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await addBtn(wrapper, 0).trigger('click');
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
    await addBtn(wrapper, 0).trigger('click');
    await flushPromises();
    expect(updateMock).toHaveBeenCalledTimes(0);
    await wrapper.findAll('.pmd-row').find((r) => r.text().includes('BAAI/bge-large-zh-v1.5'))!
      .find('input').setValue(true);
    await flushPromises();
    await wrapper.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click');
    await flushPromises();
    expect(updateMock.mock.calls[0][0].embedding.models).toEqual(['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5']);

    // 第二轮：重新开窗（此时视图已是最新池子），再加 Qwen3
    await addBtn(wrapper, 0).trigger('click');
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
  it('配置弹层：模型 ID 只读、显示名称可填，连接不在这里', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect(modal.find('.mk-modal__title').text()).toBe('配置向量模型');
    /* 2026-11-05 用户「模型id和模型名称不能改吗，为啥不在配置里面靠齐」：
       与模型设置弹层同一对标识——ID 是键（只读），能改的是显示名称。 */
    const idInput = modal.find('.infra-id--locked');
    expect((idInput.element as HTMLInputElement).value).toBe('BAAI/bge-m3');
    expect((idInput.element as HTMLInputElement).disabled).toBe(true);
    const labelInput = modal.findAll('input.mk-field__input')[1];
    expect((labelInput.element as HTMLInputElement).value).toBe('');
    expect(labelInput.attributes('placeholder')).toBe('默认跟随模型 ID');
    // 地址与密钥不在这里：改名 / 换模型 / 换连接都归卡头那一颗按钮
    expect(modal.find('.infra-own').exists()).toBe(false);
    expect(modal.find('.infra-conn').exists()).toBe(false);
    expect(modal.findAll('.mk-field__label').map((l) => l.text()))
      .toEqual(['模型 ID', '显示名称', '超时（毫秒）', '批量大小', '向量维度']);
    wrapper.unmount();
  });

  it('显示名称可改：保存按池子整体回传，卡行显示这个名字', async () => {
    const labeled = view();
    labeled.embedding.labels = { 'BAAI/bge-m3': '主向量模型' };
    updateMock.mockResolvedValue({ data: { data: labeled } });
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    const labelInput = modal.findAll('input.mk-field__input')[1];
    expect((labelInput.element as HTMLInputElement).value).toBe('');
    await labelInput.setValue('主向量模型');
    await modal.findAll('.mk-modal__foot button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0].embedding.labels).toEqual({ 'BAAI/bge-m3': '主向量模型' });
    // 起过名的行在 ID 下面多一行名称；没起名的行不硬编一句
    expect(rows(wrapper, 0)[0].find('.mpp-eng__label').text()).toBe('主向量模型');
    wrapper.unmount();
  });

  /* 2026-11-09 用户走查（图 1）：卡片底部那条「连接：独立地址 https://… [修改连接]」尾栏
     和点开后原地展开的表单一起撤掉——卡头一枚轻量标签说接在哪，编辑走「连接配置」弹窗。 */
  it('连接归属：卡头标签说接在哪，点「连接配置」在弹窗里改地址（地址填根路径）', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3'] } } });
    const wrapper = mountPanel();
    await flushPromises();

    // 收起态：卡头一枚标签，完整地址进 title，弹窗不渲染
    expect(connChip(wrapper, 0).text()).toBe('独立连接');
    expect(connChip(wrapper, 0).attributes('title')).toBe('独立地址 https://gw.example/v1/embeddings');
    expect(wrapper.find('.mpp-conn-dlg').exists()).toBe(false);

    const dlg = await openConn(wrapper, 0);
    expect(dlg.find('.mk-modal__title').text()).toBe('配置向量模型连接');
    expect((dlg.find('.infra-own input').element as HTMLInputElement).checked).toBe(true);
    // 回填成根地址；实际请求地址由这一层拼，和对话卡填根域名的口径一致
    expect((dlg.find('.infra-conn input.mk-field__input').element as HTMLInputElement).value)
      .toBe('https://gw.example');
    expect(dlg.find('.infra-endpoint').text()).toContain('https://gw.example/v1/embeddings');
    wrapper.unmount();
  });

  it('连接归属：沿用对话卡时标签是「跟随全局」，弹窗里只说明取哪条地址', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    // 重排默认 inherit
    expect(connChip(wrapper, 1).text()).toBe('跟随全局');
    expect(connChip(wrapper, 1).attributes('title')).toBe('沿用对话模型');
    const dlg = await openConn(wrapper, 1);

    expect((dlg.find('.infra-own input').element as HTMLInputElement).checked).toBe(false);
    expect(dlg.find('.infra-conn').exists()).toBe(false);
    expect(dlg.find('.infra-inherit').text()).toContain('https://newapi.wenflow.org');
    wrapper.unmount();
  });

  it('弹窗里「保存连接」：只提交连接字段，不碰池子与参数；存完自动关窗', async () => {
    const saved = view({ rerank: 'own' });
    saved.rerank.endpoint = 'https://api.siliconflow.cn/v1/rerank';
    updateMock.mockResolvedValue({ data: { data: saved } });
    const wrapper = mountPanel();
    await flushPromises();

    const dlg = await openConn(wrapper, 1);
    await dlg.find('.infra-own input').setValue(true);
    await flushPromises();
    const inputs = wrapper.findAll('.mpp-conn-dlg .infra-conn input.mk-field__input');
    // 地址 + API Key 两列（接口规范那列只读展示已撤）
    expect(inputs.length).toBe(2);
    await inputs[0].setValue('https://api.siliconflow.cn');
    await inputs[1].setValue('sk-live');
    await flushPromises();

    const saveConn = wrapper.find('.mpp-conn-dlg .mk-modal__foot button.mk-btn--primary');
    expect(saveConn.text()).toBe('保存连接');
    expect(saveConn.attributes('disabled'), '有改动才可保存').toBeUndefined();
    await saveConn.trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0]).toEqual({
      rerank: {
        connectionMode: 'own',
        endpoint: 'https://api.siliconflow.cn/v1/rerank',
        apiKey: 'sk-live',
      },
    });
    // 存成功即关窗（没改动留着弹窗没有意义）
    expect(wrapper.find('.mpp-conn-dlg').exists()).toBe(false);
    expect(connChip(wrapper, 1).text()).toBe('独立连接');
    wrapper.unmount();
  });

  it('弹窗里改回「沿用对话卡」并保存：卡头标签换成「跟随全局」', async () => {
    const inherited = view({ embedding: 'inherit' });
    inherited.embedding.endpoint = 'https://newapi.wenflow.org/v1/embeddings';
    updateMock.mockResolvedValue({ data: { data: inherited } });
    const wrapper = mountPanel();
    await flushPromises();

    const dlg = await openConn(wrapper, 0);
    await dlg.find('.infra-own input').setValue(false);
    await flushPromises();
    await wrapper.find('.mpp-conn-dlg .mk-modal__foot button.mk-btn--primary').trigger('click');
    await flushPromises();

    expect(updateMock.mock.calls[0][0]).toEqual({ embedding: { connectionMode: 'inherit' } });
    expect(connChip(wrapper, 0).text()).toBe('跟随全局');
    expect(connChip(wrapper, 0).attributes('title')).toBe('沿用对话模型');
    wrapper.unmount();
  });

  it('连接弹窗改脏后关窗：先问一句「放弃改动」，拒绝则留在弹窗里', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const dlg = await openConn(wrapper, 0);
    await dlg.find('.infra-own input').setValue(false);
    await flushPromises();

    askConfirmMock.mockResolvedValueOnce(false);
    await wrapper.find('.mpp-conn-dlg .mk-modal__close').trigger('click');
    await flushPromises();
    expect(askConfirmMock).toHaveBeenCalled();
    expect(wrapper.find('.mpp-conn-dlg').exists(), '拒绝放弃后弹窗保持打开').toBe(true);

    askConfirmMock.mockResolvedValueOnce(true);
    await wrapper.find('.mpp-conn-dlg .mk-modal__close').trigger('click');
    await flushPromises();
    expect(wrapper.find('.mpp-conn-dlg').exists(), '确认放弃后关窗').toBe(false);
    wrapper.unmount();
  });

  it('清单按用途筛，但留「显示全部」的退路', async () => {
    pullMock.mockResolvedValue({
      data: { data: { models: ['BAAI/bge-m3', 'deepseek-v4.1-flash', 'gpt-4o'] } },
    });
    const wrapper = mountPanel();
    await flushPromises();
    await addBtn(wrapper, 0).trigger('click');
    await flushPromises();

    // 未添加视图里没有可挂的（唯一被识别成向量的那个已经挂上了）
    expect(wrapper.findAll('.pmd-row')).toHaveLength(0)
    const more = wrapper.findAll('.pmd button').find((b) => b.text().includes('显示全部'))!;
    // 2026-11-07：指路文案换成「显示全部模型（N）」——⋯ 菜单已经不存在，不再讲「⋯ 里挑一个」
    expect(more.text()).toBe('显示全部模型（3）');
    expect(wrapper.find('.pmd').text()).toContain('已自动筛选匹配的向量模型');
    expect(wrapper.find('.pmd').text()).not.toContain('向量模型模型');
    await more.trigger('click');
    await flushPromises();
    // 放开的两个（对话模型）都还没挂上；已挂上的 bge-m3 仍在「未添加」之外
    expect(wrapper.findAll('.pmd-row .pmd-row__id').map((r) => r.text()))
      .toEqual(['deepseek-v4.1-flash', 'gpt-4o']);
    wrapper.unmount();
  });

  it('弹窗里的行内测试走这条能力的连接（不是供应商端点）', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-large-zh-v1.5'] } } });
    testMock.mockResolvedValue({ data: { data: { ok: true, latencyMs: 95, dimensions: 1024 } } });
    const wrapper = mountPanel();
    await flushPromises();
    await addBtn(wrapper, 0).trigger('click');
    await flushPromises();

    await wrapper.find('.pmd-row__test').trigger('click');
    await flushPromises();
    expect(testMock).toHaveBeenCalledWith('embedding', 'BAAI/bge-large-zh-v1.5');
    expect(wrapper.find('.pmd-row__res').text()).toContain('已连通');
    expect(wrapper.find('.pmd-row__res').text()).toContain('95ms');
    wrapper.unmount();
  });

  it('勾选引入只写模型池：没动连接就不带任何连接字段', async () => {
    pullMock.mockResolvedValue({ data: { data: { models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'] } } });
    const wrapper = mountPanel();
    await flushPromises();
    await addBtn(wrapper, 0).trigger('click');
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
      },
    });
    wrapper.unmount();
  });

  it('配置弹层保存：只回传参数、显示名称与模型池，连接一个字段都不发', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openConfig(wrapper, 0);

    const modal = wrapper.find('.mk-modal');
    expect((modal.find('.infra-id--locked').element as HTMLInputElement).value).toBe('BAAI/bge-m3');
    await modal.findAll('.mk-modal__foot button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();

    const patch = updateMock.mock.calls[0][0].embedding;
    expect(patch).toMatchObject({ models: ['BAAI/bge-m3'], model: 'BAAI/bge-m3', timeoutMs: 20000 });
    // 没起名就是空表（后端按池子裁剪后落库），不是 undefined
    expect(patch.labels).toEqual({});
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

  it('未配置（池子空）时只留添加与配置，没有设为默认 / 测试 / 删除', async () => {
    const data = view();
    data.rerank = { ...data.rerank, configured: false, model: '', models: [], keySource: 'none' as const };
    getMock.mockResolvedValue({ data: { data } });
    const wrapper = mountPanel();
    await flushPromises();
    const rerank = cards(wrapper)[1];

    // 卡头只有连接归属标签（它讲「接在哪」，不是「配没配好」）
    expect(rerank.findAll('.mk-card__head .mk-badge').map((b) => b.text())).toEqual(['跟随全局']);
    expect(rerank.find('.mk-card__head').text()).not.toContain('已配置');
    expect(rerank.find('.mpp-eng__model').text()).toBe('未选择模型');
    const labels = rerank.findAll('button').map((b) => b.text());
    expect(labels).toEqual(['连接配置', '＋ 添加模型', '配置']);
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
