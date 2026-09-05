/**
 * PromptWorkbench（Skill 工作台）阶段 2E 去重冒烟：
 * 1. 文件视角清单渲染（核心文件表：结构/输出/coreHash/状态）
 * 2. scaffold 弹窗：结果态只保留文件视角（生成文件/注册片段），
 *    移除与 Skill 目录重复的「完成度（completion）」清单
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import PromptWorkbench from '../PromptWorkbench.vue';
import { intent } from '../store';

const { scaffoldMock } = vi.hoisted(() => ({
  scaffoldMock: vi.fn(async () => ({
    data: {
      data: {
        skillId: 'my-new-skill',
        kind: 'mainline',
        status: 'created',
        note: '骨架已生成',
        generated: ['prompts/core/my-new-skill.yaml', 'prompts/skill.my-new-skill.md'],
        completion: { status: 'draft', items: [{ id: 'c1', label: 'core-ready', ok: false }] },
        snippets: [{ title: '注册片段', content: 'await register(...)' }]
      }
    }
  }))
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject({
    getScaffoldMeta: vi.fn(async () => ({
      data: { data: { kinds: ['mainline', 'aux', 'handler-only'], stages: ['goal'], agents: [{ id: 'agent-a', name: 'Agent A' }] } }
    })),
    scaffold: scaffoldMock
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject({
    getCoreList: vi.fn(async () => ({
      data: {
        items: [
          {
            skillId: 'existing-skill',
            fields: 2,
            channels: ['dialogue'],
            stateAdvance: false,
            deltaOutput: false,
            outputMedia: 'json',
            coreHash: 'core-hash-abcdef',
            publishedHash: 'pub-hash',
            status: 'synced'
          }
        ]
      }
    }))
  }),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject(),
  adminAgentPromptsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
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

describe('Skill 工作台去重冒烟', () => {
  beforeEach(() => {
    intent.quickAction = '';
    scaffoldMock.mockClear();
  });

  it('文件视角核心文件表渲染（Skill/结构/输出/coreHash/状态）', async () => {
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();
    expect(wrapper.text()).toContain('核心文件');
    expect(wrapper.text()).toContain('existing-skill');
    expect(wrapper.text()).toContain('2 字段 · 1 通道');
    expect(wrapper.text()).toContain('已同步');
    wrapper.unmount();
  });

  it('scaffold 结果态：保留文件视角（生成文件），移除完成度清单', async () => {
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();
    await wrapper.findAll('button').find((b) => b.text().includes('新建 Skill'))!.trigger('click');
    await settle();
    // Teleport 后 modal 在 document.body，用全局查询
    const inputs = Array.from(document.body.querySelectorAll('input'));
    const kbInput = inputs.find((i) => i.getAttribute('placeholder')?.includes('kebab-case'));
    if (kbInput) { (kbInput as HTMLInputElement).value = 'my-new-skill'; kbInput.dispatchEvent(new Event('input', { bubbles: true })); }
    // kind 默认 mainline：补 stage + parentAgent
    const selects = Array.from(document.body.querySelectorAll('select'));
    if (selects[0]) { selects[0].value = 'goal'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); }
    if (selects[1]) { selects[1].value = 'agent-a'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); }
    const genBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('生成骨架'));
    if (genBtn) genBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await settle();
    expect(scaffoldMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('生成文件（2）');
    expect(document.body.textContent).toContain('prompts/core/my-new-skill.yaml');
    expect(document.body.textContent).toContain('注册片段');
    // 完成度（skill 视角，与 Skill 目录对账重复）已移除
    expect(document.body.textContent).not.toContain('完成度');
    expect(document.body.textContent).not.toContain('core-ready');
    const btns = Array.from(document.body.querySelectorAll('button'));
    expect(btns.some((b) => b.textContent?.includes('打开设计页'))).toBe(true);
    wrapper.unmount();
  });
});
