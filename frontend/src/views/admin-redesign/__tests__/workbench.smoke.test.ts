/**
 * PromptWorkbench（Skill 工作台）冒烟：
 * 1. 文件视角清单渲染（核心文件表：结构/输出/coreHash/状态）
 * 2. 定位收敛（2026-09 拍板）：管理台限轻运营调整——「新建 Skill」scaffold 入口已迁出
 *    （走 CLI backend/scripts/scaffold-skill.ts），页面不得再出现新建入口
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import PromptWorkbench from '../PromptWorkbench.vue';

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

describe('Skill 工作台冒烟（轻运营定位）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('新建入口已迁出管理台：无「新建 Skill」按钮，指引走 CLI', async () => {
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();
    const btns = wrapper.findAll('button').map((b) => b.text());
    expect(btns.some((t) => t.includes('新建 Skill'))).toBe(false);
    expect(btns.some((t) => t.includes('生成骨架'))).toBe(false);
    // 指引文案：从 0 新建走 CLI
    expect(wrapper.text()).toContain('scaffold-skill.ts');
    wrapper.unmount();
  });
});
