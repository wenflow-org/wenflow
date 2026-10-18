/**
 * Skill 详情页·设计能力平铺冒烟（2026-10-15：独立设计页退役，内容就地铺进 SkillDetail）：
 * 1. 双层 tab 压平：6 个单层顶层 tab（运行时/协议/试跑/版本/工程/字段路由），
 *    协议 tab 内不再有「版本历史 / 字段血缘」pill，编译预览直接内嵌
 * 2. 版本单入口：核心文件版本 + Prompt 版本 都挂在顶层「版本」tab
 * 3. 字段血缘并入「字段路由」tab（折叠块懒加载）
 * 4. 发布链 3 步：保存并编译 → 发布 →（409 SEMANTIC_UNCERTAIN）强制发布；
 *    不再有独立「编译预览」步骤
 * 说明：本文件所有断言都跑在**平铺后的 SkillDetail 页**上——挂载 SkillDetail（view=skill），
 *      切换到目标页签后断言设计页子区块（.sdp-*）已就地渲染。脏态守卫也迁进 SkillDetail。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import SkillDetail from '../SkillDetail.vue';
import { coreEditorState } from '../skill-design/sdp-shared';
import { intent, subPage } from '../store';
import { confirmState, settleConfirm } from '../useConfirm';

const { apiMocks } = vi.hoisted(() => {
  const fn = (val?: unknown) => vi.fn(async () => (val === undefined ? { data: {} } : val));
  const publishCore = vi.fn(async () => ({
    data: { agentId: 'skill:test-skill', version: 3, coreHash: 'hash-abcdef-123456' }
  }));
  const saveCoreForm = fn({ data: { classification: { level: 'safe', messages: [] }, inputWarnings: [] } });
  const compileCore = fn({
    data: {
      gates: { structure: [], fieldFreeze: [], semantic: { verdict: 'pass' }, semanticDecision: 'pass', inputHandoff: [] },
      prompt: 'compiled prompt body',
      coreHash: 'hash-abcdef',
      coreVersion: 1
    }
  });
  /** 批 1 只读能力并入的断言目标：模型测试 / 试跑 / core 投影（均需可控返回）。
      平铺后 SkillDetail 自身也调 getCore（回合状态机/终止条件投影）+ ProtocolTab 也调，
      故用**常量函数**（defaultCore）复位，用例要用不同 core 形状时改 mockImplementation；
      mockImplementationOnce 会因两处调用顺序不定而错配。 */
  const defaultCore = () => ({
    data: {
      raw: 'identity: test\nfields: []\n',
      diagnostics: [],
      core: {
        identity: 'test',
        channels: ['dialogue'],
        stateAdvance: false,
        deltaOutput: false,
        outputMedia: 'json',
        inputs: [
          { ref: 'skill:path-planning.milestones' },
          { ref: 'sandbox:teaching.pool' },
          { ref: 'sandbox:teaching.extra' },
          { ref: 'user:latestMessage' }
        ],
        rules: [],
        constraints: [],
        fields: [],
        params: { temperature: 0.5, maxTokens: 8000, failurePolicy: 'retry' }
      }
    }
  });
  const getCore = vi.fn(async (): Promise<{ data: Record<string, unknown> }> => defaultCore());
  const modelProbe = vi.fn(async () => ({
    data: {
      data: {
        durationMs: 1234,
        ttftContentMs: 210,
        jsonOk: 'ok',
        contentChars: 42,
        completionTokens: 7,
        finish: 'stop',
        contentPreview: '{"ok":true}',
        resolved: { model: 'gpt-4o-mini', thinkingMode: 'enabled', reasoningEffort: 'high' }
      }
    }
  }));
  const testSkill = vi.fn(async () => ({
    data: { data: { success: true, duration: 912, output: '预览输出', steps: [{ name: '解析输入', ms: 12 }, { name: '调用模型', ms: 900, ok: false }] } }
  }));
  return {
    apiMocks: { publishCore, saveCoreForm, compileCore, getCore, defaultCore, modelProbe, testSkill }
  };
});

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

const overviewItem = {
  agentId: 'skill:test-skill',
  kind: 'skill',
  displayName: '测试 Skill',
  health: 'good',
  file: { path: 'prompts/skill.test-skill.md', hash: 'file-hash-01' },
  db: { id: 'db-1', version: 2, useCount: 5, model: 'gpt-4o', publishedAt: '2026-08-01T00:00:00Z' },
  drift: 'in-sync'
};

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject({
    getSkillModelConfig: vi.fn(async () => ({
      data: {
        data: {
          enabled: true,
          tier: 'chat',
          model: 'gpt-4o-mini',
          thinkingMode: 'default',
          reasoningEffort: 'default',
          requestTimeoutMs: 30000
        }
      }
    })),
    modelProbe: apiMocks.modelProbe,
    testSkill: apiMocks.testSkill
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject({
    getSkillRoutings: vi.fn(async () => ({
      data: {
        data: {
          stage: 'teaching',
          agentId: 'skill:test-skill',
          routings: [],
          fields: [
            { fieldId: 'learnerMessage', promptRole: 'hard-required', valueType: 'string', description: '学习者本轮消息' },
            { fieldId: 'replyText', promptRole: 'public-reply', valueType: 'string', description: '对外回复文本' }
          ],
          promptRoleMeta: [
            { id: 'hard-required', label: '必填输入' },
            { id: 'public-reply', label: '对外回复' }
          ],
          core: { fields: [], sync: null }
        }
      }
    }))
  }),
  adminPromptWorkbenchApi: apiObject({
    getCore: apiMocks.getCore,
    saveCoreForm: apiMocks.saveCoreForm,
    compileCore: apiMocks.compileCore,
    publishCore: apiMocks.publishCore,
    getCoreVersions: vi.fn(async () => ({
      data: {
        versions: [
          { version: 2, status: 'ACTIVE', coreHash: 'hash-2', coreVersion: 2, createdBy: 'ops', publishedAt: '2026-08-01T00:00:00Z', rollbackable: false },
          { version: 1, status: 'HISTORICAL', coreHash: null, coreVersion: null, createdBy: 'ops', publishedAt: '2026-07-01T00:00:00Z', rollbackable: true }
        ]
      }
    })),
    getCoreLineage: vi.fn(async () => ({
      data: { lineage: [{ field: 'milestones', consumers: ['skill:next-skill'] }] }
    }))
  }),
  adminPromptOpsApi: apiObject({
    getAgentOverview: vi.fn(async () => ({ data: { data: { items: [overviewItem] } } }))
  }),
  adminSkillWorkbenchApi: apiObject({
    getMeta: vi.fn(async () => ({ data: { data: { parentAgent: { id: 'agent-a', name: 'Agent A' }, stats: { totalCalls: 12, successRate: 92, avgDuration: 300 } } } }))
  }),
  adminAgentPromptsApi: apiObject({
    getPromptVersions: vi.fn(async () => ({
      data: {
        data: [
          { id: 'pv-2', version: 2, status: 'ACTIVE', name: 'v2' },
          { id: 'pv-1', version: 1, status: 'HISTORICAL', name: 'v1' }
        ]
      }
    }))
  }),
  adminAgentsApi: apiObject({
    getLogs: vi.fn(async () => ({
      data: {
        data: {
          items: [
            { id: 'log-1', status: 'error', createdAt: new Date().toISOString(), durationMs: 1234, errorMessage: 'upstream 502', traceId: 'trace-abc' }
          ]
        }
      }
    }))
  }),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/** 2026-10-15 设计页平铺：本页 id 取自 store.subPage（view=skill）。
    与其它二级页同源；query 承载页签键 skdTab（与列表 ?tab= 隔离）。 */
async function mountPage(skillId = 'test-skill', query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/skills', name: 'AdminConsole', component: { template: '<div />' } }]
  });
  await router.push({ path: '/admin/skills', query });
  await router.isReady();
  subPage.value = { view: 'skill', id: skillId };
  const wrapper = mount(SkillDetail, { global: { plugins: [router] }, attachTo: document.body });
  await settle();
  return { wrapper, router };
}

/** 顶层 tab 导航：走共享 MkSubTabs 原语（role=tablist/tab + aria-selected，原型 .subtab 语义）。
    平铺后 6 页签是 SkillDetail 的 MkSubTabs（不再有设计页外壳的第二条 tab 条）。 */
function tabButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button.mk-subtab');
}

describe('Skill 详情页·设计能力平铺冒烟', () => {
  beforeEach(() => {
    coreEditorState.dirty = false;
    apiMocks.publishCore.mockClear();
    apiMocks.saveCoreForm.mockClear();
    apiMocks.compileCore.mockClear();
    // B17：发布确认走全局单例（本测试只挂页面，Confirm 弹窗由 App.vue 承载）→ 每例复位
    confirmState.open = false;
    confirmState.busy = false;
    confirmState.busyMode = false;
    confirmState.resolve = null;
    document.body.innerHTML = '';
  });

  it('单层 6 tab 导航，无双层 pill', async () => {
    const { wrapper } = await mountPage();
    const pills = tabButtons(wrapper);
    // 详情页默认落「运行时」（健康+证据先于配置）；页签顺序 = 详情页既有顺序
    expect(pills.map((p) => p.text())).toEqual(['运行时', '协议', '试跑', '版本', '工程', '字段路由']);
    // 切到协议页签（设计页默认档；平铺后需显式切）
    await pills.find((b) => b.text() === '协议')!.trigger('click');
    await settle();
    // 协议区块（.sdp-pw）内不再有「版本历史 / 字段血缘」子 pill（双层导航已压平）
    expect(wrapper.find('.sdp-pw__pills').exists()).toBe(false);
    const protocolBlock = wrapper.find('.sdp-pw');
    expect(protocolBlock.text()).not.toContain('版本历史');
    expect(protocolBlock.text()).not.toContain('字段血缘');
    // 编译预览块直接内嵌在协议页签
    expect(protocolBlock.text()).toContain('编译预览');
    expect(protocolBlock.text()).toContain('保存并编译');
    expect(protocolBlock.text()).toContain('发布');
    // 独立「编译预览」按钮已合并进「保存并编译」
    expect(wrapper.findAll('button').some((b) => b.text() === '编译预览')).toBe(false);
    wrapper.unmount();
  });

  it('版本 tab = 单一入口：核心文件版本 + Prompt 版本 同页分区', async () => {
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '版本')!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('核心文件版本（协议发布）');
    expect(wrapper.text()).toContain('Prompt 版本');
    // 核心版本行（含回滚）与 Prompt 版本行（含对比生效版）都渲染
    expect(wrapper.text()).toContain('回滚');
    expect(wrapper.text()).toContain('对比生效版');
    wrapper.unmount();
  });

  it('字段路由 tab：血缘折叠块 + 向导组件同页', async () => {
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '字段路由')!.trigger('click');
    await settle();
    const lineage = wrapper.find('.sdp-routing__lineage');
    expect(lineage.exists()).toBe(true);
    expect(lineage.find('summary').text()).toContain('影响范围');
    // 懒加载：展开后拉血缘并渲染消费者
    lineage.element.setAttribute('open', '');
    await lineage.trigger('toggle');
    await settle();
    expect(wrapper.text()).toContain('milestones');
    expect(wrapper.text()).toContain('skill:next-skill');
    wrapper.unmount();
  });

  it('发布链第 1 步：保存并编译 = 一次保存 + 一次编译（无独立编译预览步）', async () => {
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '协议')!.trigger('click');
    await settle();
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存并编译')!;
    await saveBtn.trigger('click');
    await settle();
    expect(apiMocks.saveCoreForm).toHaveBeenCalledTimes(1);
    expect(apiMocks.compileCore).toHaveBeenCalledTimes(1);
    expect((apiMocks.compileCore.mock.calls[0] as unknown[])[0]).toEqual({ skillId: 'test-skill', semanticJudge: false });
    wrapper.unmount();
  });

  it('发布链第 2 步：safe 分类先过确认框，确认后才发布（无开发确认步），发布后刷新 overview', async () => {
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '协议')!.trigger('click');
    await settle();
    await wrapper.findAll('button').find((b) => b.text() === '发布')!.trigger('click');
    await settle();
    // B17：单击先弹确认框，未确认不发 POST
    expect(apiMocks.publishCore).not.toHaveBeenCalled();
    expect(confirmState.open).toBe(true);
    settleConfirm(true);
    await settle();
    expect(apiMocks.publishCore).toHaveBeenCalledTimes(1);
    const payload = (apiMocks.publishCore.mock.calls[0] as unknown[])[0] as { skillId?: string; confirmUncertain?: boolean; developerApproval?: unknown };
    expect(payload.skillId).toBe('test-skill');
    expect(payload.confirmUncertain).toBeUndefined();
    expect(payload.developerApproval).toBeUndefined();
    expect(wrapper.text()).toContain('已发布：skill:test-skill v3');
    wrapper.unmount();
  });

  it('发布链第 2 步：确认框取消 → 不发布', async () => {
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '协议')!.trigger('click');
    await settle();
    await wrapper.findAll('button').find((b) => b.text() === '发布')!.trigger('click');
    await settle();
    expect(confirmState.open).toBe(true);
    settleConfirm(false);
    await settle();
    expect(apiMocks.publishCore).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('发布链第 3 步：409 语义不确定 → 人工确认强制发布（confirmUncertain=true）', async () => {
    apiMocks.publishCore
      .mockRejectedValueOnce((() => {
        const err = new Error('semantic uncertain') as Error & { response?: unknown };
        err.response = { status: 409, data: { code: 'SEMANTIC_UNCERTAIN', judgement: { rationale: 'judge 无法确定', findings: [{ severity: 'warn', aspect: 'x', issue: 'y' }] } } };
        return err;
      })());
    const { wrapper } = await mountPage();
    await tabButtons(wrapper).find((b) => b.text() === '协议')!.trigger('click');
    await settle();
    await wrapper.findAll('button').find((b) => b.text() === '发布')!.trigger('click');
    await settle();
    settleConfirm(true);
    await settle();
    expect(wrapper.text()).toContain('含义冻结判定不确定');
    const forceBtn = wrapper.findAll('button').find((b) => b.text().includes('强制发布'))!;
    await forceBtn.trigger('click');
    await settle();
    expect(apiMocks.publishCore).toHaveBeenCalledTimes(2);
    expect(((apiMocks.publishCore.mock.calls[1] as unknown[])[0] as { confirmUncertain?: boolean }).confirmUncertain).toBe(true);
    wrapper.unmount();
  });

  it('F3 回归：路由离开（卸载）复位 coreEditorState.dirty——重入不产生幽灵未保存确认', async () => {
    const { wrapper } = await mountPage();
    // 模拟协议编辑器存在未保存修改后用户确认离开（组件卸载）
    coreEditorState.dirty = true;
    wrapper.unmount();
    expect(coreEditorState.dirty).toBe(false);
    // 重入：卸载无残留 → anyDirty 从零开始（守卫不会带出上一次的脏标记）
    const { wrapper: reentry } = await mountPage();
    coreEditorState.dirty = true; // 本轮即便置脏，离开语义也由本轮守卫负责
    reentry.unmount();
    expect(coreEditorState.dirty).toBe(false);
  });
});

/**
 * 批 1（A→B 只读能力并入）：把 SkillDetail（二级技能详情页）独有的只读块搬进设计页，
 * 每块一条 B 侧断言 —— 保证搬过来的不是「长得像」而是真读到了数据/真发了请求。
 */
describe('SkillDetail 设计能力平铺：只读区块就地渲染', () => {
  beforeEach(() => {
    coreEditorState.dirty = false;
    // 复位为默认 core 形状（上一例可能用 mockImplementation 换过）
    apiMocks.getCore.mockReset();
    apiMocks.getCore.mockImplementation(async () => apiMocks.defaultCore());
    apiMocks.modelProbe.mockClear();
    apiMocks.testSkill.mockClear();
    confirmState.open = false;
    confirmState.busy = false;
    confirmState.busyMode = false;
    confirmState.resolve = null;
    intent.traceId = '';
    intent.scene = 'overview';
    intent.traceFocus = false;
    document.body.innerHTML = '';
  });

  async function gotoTab(wrapper: ReturnType<typeof mount>, label: string) {
    await tabButtons(wrapper).find((b) => b.text() === label)!.trigger('click');
    await settle();
  }

  it('运行时 tab：运行时限制 kv 用真实生效值（不是硬编码展示）', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '运行时');
    const limits = wrapper.findAll('.sdp-limits__row');
    expect(limits.length).toBe(1);
    expect(limits[0].text()).toContain('请求超时');
    expect(limits[0].text()).toContain('30000 ms');
    wrapper.unmount();
  });

  it('运行时 tab：模型测试直发 model-probe，返回的延迟/JSON/token 落到读数格', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '运行时');
    // 平铺后本页有两处「开始探测」（SkillDetail 只读概览的模型测试 + 设计区块 RuntimeTab 的模型测试）；
    // 断言目标是设计区块（RuntimeTab，根 .sdp-pane），故按容器定位其探测钮。
    const probeBtn = wrapper.find('.sdp-pane').findAll('button').find((b) => b.text() === '开始探测')!;
    await probeBtn.trigger('click');
    await settle();
    expect(apiMocks.modelProbe).toHaveBeenCalledTimes(1);
    expect((apiMocks.modelProbe.mock.calls[0] as unknown[])[0]).toBe('test-skill');
    expect((apiMocks.modelProbe.mock.calls[0] as unknown[])[1]).toEqual({ thinkingMode: 'default', reasoningEffort: 'default' });
    const grid = wrapper.find('.sdp-probe__grid');
    expect(grid.exists()).toBe(true);
    expect(grid.text()).toContain('1.2s'); // 1234ms → 档
    expect(grid.text()).toContain('210ms'); // TTFT
    expect(grid.text()).toContain('42'); // 输出字符
    expect(wrapper.find('.sdp-probe__resolved').text()).toContain('gpt-4o-mini');
    wrapper.unmount();
  });

  it('试跑 tab：执行链路渲染逐步明细（OK/ERR + 步骤名 + ms）', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '试跑');
    const steps = wrapper.find('.sdp-steps');
    expect(steps.exists()).toBe(true);
    expect(steps.find('h4').text()).toBe('执行链路');
    const runBtn = wrapper.findAll('button').find((b) => b.text() === '运行预览')!;
    await runBtn.trigger('click');
    await settle();
    expect(apiMocks.testSkill).toHaveBeenCalledTimes(1);
    const rows = wrapper.findAll('.sdp-step');
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain('OK');
    expect(rows[0].text()).toContain('解析输入');
    expect(rows[0].text()).toContain('12 ms');
    expect(rows[1].text()).toContain('ERR');
    wrapper.unmount();
  });

  it('试跑 tab：最近调用加「看 Trace」——点行跳执行日志 Trace tab（openTrace 动线）', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '试跑');
    const traceBtn = wrapper.findAll('button').find((b) => b.text() === '看 Trace');
    expect(traceBtn).toBeTruthy();
    expect(traceBtn!.attributes('disabled')).toBeUndefined();
    await traceBtn!.trigger('click');
    expect(intent.traceId).toBe('trace-abc');
    expect(intent.scene).toBe('execution-logs');
    expect(intent.traceFocus).toBe(true);
    wrapper.unmount();
  });

  it('协议 tab：输入/输出契约卡按 promptRole 方向拆分，角色词表来自后端下发', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '协议');
    const proj = wrapper.find('.sdp-proj');
    expect(proj.exists()).toBe(true);
    const cols = proj.findAll('.sdp-proj__col');
    // 输入契约只收非产出角色（hard-required），输出契约只收 OUT_ROLES
    expect(cols[0].text()).toContain('输入契约');
    expect(cols[0].text()).toContain('learnerMessage');
    expect(cols[0].text()).not.toContain('replyText');
    expect(cols[0].text()).toContain('必填输入');
    expect(cols[1].text()).toContain('输出契约');
    expect(cols[1].text()).toContain('replyText');
    expect(cols[1].text()).toContain('对外回复');
    wrapper.unmount();
  });

  it('协议 tab：回合状态机/终止条件无声明即空态（不硬造状态）', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '协议');
    const proj = wrapper.find('.sdp-proj');
    expect(proj.text()).toContain('该 Skill 未声明回合状态机。');
    expect(proj.text()).toContain('该 Skill 未声明终止条件。');
    expect(wrapper.find('.sdp-proj__step').exists()).toBe(false);
    wrapper.unmount();
  });

  it('协议 tab：core 声明了状态机/终止条件就按序列渲染（防御式读取）', async () => {
    // 平铺后 getCore 被本页与 ProtocolTab 两处调用 → 用 mockImplementation（非 Once），afterEach 复位默认
    apiMocks.getCore.mockImplementation(async () => ({
      data: {
        raw: 'identity: test\n',
        diagnostics: [],
        core: {
          identity: 'test',
          channels: ['dialogue'],
          inputs: [],
          rules: [],
          constraints: [],
          fields: [],
          stateMachine: ['idle', 'asking', 'wrapping'],
          termination: ['达成目标', '轮次超限']
        }
      }
    }));
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '协议');
    const steps = wrapper.findAll('.sdp-proj__step');
    expect(steps.map((s) => s.text())).toEqual(['1idle', '2asking', '3wrapping']);
    expect(wrapper.findAll('.sdp-proj__rank').map((r) => r.text())).toEqual(['达成目标', '轮次超限']);
    wrapper.unmount();
  });

  it('工程 tab：依赖与发布取 core inputs 的 skill:/sandbox: 引用（全量不截断、去重）', async () => {
    const { wrapper } = await mountPage();
    await gotoTab(wrapper, '工程');
    const deps = wrapper.findAll('.sdp-deps .mk-badge');
    const texts = deps.map((d) => d.text());
    // 依赖标签取完整 ref（到空白为止）—— 旧正则在首个「.」截断过，此处即回归位
    expect(texts).toContain('skill:path-planning.milestones');
    // #132 回归：同前缀不同后缀的 sandbox 引用不得被截断合并
    expect(texts).toContain('sandbox:teaching.pool');
    expect(texts).toContain('sandbox:teaching.extra');
    // user: 前缀不是依赖（平台注入）→ 不收
    expect(texts.length).toBe(3);
    wrapper.unmount();
  });
});
