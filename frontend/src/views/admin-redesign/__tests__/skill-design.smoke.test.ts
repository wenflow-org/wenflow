/**
 * SkillDesignPage 阶段 2E 拆分冒烟：
 * 1. 双层 tab 压平：6 个单层顶层 tab（协议/试跑/版本/运行时/工程/字段路由），
 *    协议 tab 内不再有「版本历史 / 字段血缘」pill，编译预览直接内嵌
 * 2. 版本单入口：核心文件版本 + Prompt 版本 都挂在顶层「版本」tab
 * 3. 字段血缘并入「字段路由」tab（折叠块懒加载）
 * 4. 发布链 3 步：保存并编译 → 发布 →（409 SEMANTIC_UNCERTAIN）强制发布；
 *    不再有独立「编译预览」步骤
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import SkillDesignPage from '../SkillDesignPage.vue';
import { coreEditorState } from '../skill-design/sdp-shared';

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
  return {
    apiMocks: { publishCore, saveCoreForm, compileCore }
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
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject({
    getCore: vi.fn(async () => ({
      data: {
        raw: 'identity: test\nfields: []\n',
        diagnostics: [],
        core: { identity: 'test', channels: ['dialogue'], stateAdvance: false, deltaOutput: false, outputMedia: 'json', inputs: [], rules: [], constraints: [], fields: [], params: { temperature: 0.5, maxTokens: 8000, failurePolicy: 'retry' } }
      }
    })),
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
    getAgentOverview: vi.fn(async () => ({ data: { data: { items: [overviewItem] } } })),
    getPromptCompileInfo: vi.fn(async () => ({ data: { data: { promptVersion: 2, sourceHash: 'src-hash', status: 'ok', source: 'source text', compiled: 'compiled text' } } }))
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
    getLogs: vi.fn(async () => ({ data: { data: { items: [] } } }))
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

async function mountPage(initialPath = '/admin/skills/test-skill') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/skills/:agentId+', name: 'SkillDesign', component: SkillDesignPage }]
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(SkillDesignPage, { global: { plugins: [router] }, attachTo: document.body });
  await settle();
  return { wrapper, router };
}

/** 顶层 tab 导航（页面第一个 nav.mk-pills；试跑 pane 内另有 mk-pills 视图切换，需排除） */
function tabButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('nav.mk-pills')[0].findAll('button.mk-pill');
}

describe('SkillDesignPage 阶段 2E 拆分冒烟', () => {
  beforeEach(() => {
    coreEditorState.dirty = false;
    apiMocks.publishCore.mockClear();
    apiMocks.saveCoreForm.mockClear();
    apiMocks.compileCore.mockClear();
    document.body.innerHTML = '';
  });

  it('单层 6 tab 导航，无双层 pill', async () => {
    const { wrapper } = await mountPage();
    const pills = tabButtons(wrapper);
    expect(pills.map((p) => p.text())).toEqual(['协议', '试跑', '版本', '运行时', '工程', '字段路由']);
    // 协议 pane 内不再有「版本历史 / 字段血缘」子 pill（双层导航已压平）
    expect(wrapper.find('.sdp-pw__pills').exists()).toBe(false);
    const protocolPane = wrapper.findAll('.sdp-pane')[0];
    expect(protocolPane.text()).not.toContain('版本历史');
    expect(protocolPane.text()).not.toContain('字段血缘');
    // 编译预览块直接内嵌在协议 tab
    expect(wrapper.text()).toContain('编译预览');
    expect(wrapper.text()).toContain('保存并编译');
    expect(wrapper.text()).toContain('发布');
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
    expect(lineage.find('summary').text()).toContain('字段血缘');
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
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存并编译')!;
    await saveBtn.trigger('click');
    await settle();
    expect(apiMocks.saveCoreForm).toHaveBeenCalledTimes(1);
    expect(apiMocks.compileCore).toHaveBeenCalledTimes(1);
    expect((apiMocks.compileCore.mock.calls[0] as unknown[])[0]).toEqual({ skillId: 'test-skill', semanticJudge: false });
    wrapper.unmount();
  });

  it('发布链第 2 步：safe 分类直接发布（无开发确认步），发布后刷新 overview', async () => {
    const { wrapper } = await mountPage();
    await wrapper.findAll('button').find((b) => b.text() === '发布')!.trigger('click');
    await settle();
    expect(apiMocks.publishCore).toHaveBeenCalledTimes(1);
    const payload = (apiMocks.publishCore.mock.calls[0] as unknown[])[0] as { skillId?: string; confirmUncertain?: boolean; developerApproval?: unknown };
    expect(payload.skillId).toBe('test-skill');
    expect(payload.confirmUncertain).toBeUndefined();
    expect(payload.developerApproval).toBeUndefined();
    expect(wrapper.text()).toContain('已发布：skill:test-skill v3');
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
    await wrapper.findAll('button').find((b) => b.text() === '发布')!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('含义冻结判定不确定');
    const forceBtn = wrapper.findAll('button').find((b) => b.text().includes('强制发布'))!;
    await forceBtn.trigger('click');
    await settle();
    expect(apiMocks.publishCore).toHaveBeenCalledTimes(2);
    expect(((apiMocks.publishCore.mock.calls[1] as unknown[])[0] as { confirmUncertain?: boolean }).confirmUncertain).toBe(true);
    wrapper.unmount();
  });
});
