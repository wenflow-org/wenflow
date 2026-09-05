/**
 * SkillDrawer 阶段 2E 去编辑化冒烟：
 * 1. 页签只剩 概览 / Prompt（移除「运行」「协议」tab）
 * 2. 无试跑 / 运行配置 / 版本对比 / 协议规则 编辑入口
 * 3. 保留只读 Prompt 速览 + 「打开 Prompt 设计页」跳转 CTA
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import SkillDrawer from '../SkillDrawer.vue';
import { intent, dataSource, closeSkillDrawer } from '../store';
import { liveSkillProfiles, liveExtraProfiles } from '../live';

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
    getEffectiveSkillPrompt: vi.fn(async () => ({
      data: { data: { prompt: { id: 'p-1', version: 2, name: 'v2', systemPrompt: 'system prompt body' } } }
    }))
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject({
    getMeta: vi.fn(async () => ({
      data: {
        data: {
          parentAgent: { id: 'agent-a', name: 'Agent A' },
          skill: { id: 'skill-a', name: 'Skill A', category: 'analysis' },
          modelConfig: { model: 'gpt-4o', llmRequest: { model: 'gpt-4o', source: 'active-prompt' } },
          stats: { source: 'agent_call_logs', range: 'all' }
        }
      }
    }))
  }),
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

async function mountDrawer() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(SkillDrawer, { global: { plugins: [router] }, attachTo: document.body });
  await settle();
  return { wrapper, router };
}

/** 抽屉 Teleport 到 body：断言需查 document.body 而非 wrapper 子树 */
function bodyTabs() {
  return Array.from(document.body.querySelectorAll('.msk__tabs .mk-pill')).map((el) => (el.textContent || '').trim());
}

let activeWrapper: ReturnType<typeof mount> | null = null;

describe('SkillDrawer 去编辑化冒烟', () => {
  beforeEach(() => {
    closeSkillDrawer();
    liveSkillProfiles.value = [];
    liveExtraProfiles.value = [];
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    activeWrapper?.unmount();
    activeWrapper = null;
    closeSkillDrawer();
    await nextTick();
    document.body.innerHTML = '';
  });

  it('只读速览：仅 概览 / Prompt 两个页签，无运行/协议 tab', async () => {
    dataSource.value = 'live';
    liveSkillProfiles.value = [{ id: 'skill-a', name: 'Skill A', category: 'analysis', agentId: 'agent-a', agentName: 'Agent A' }];
    intent.skillDrawerId = 'skill-a';
    const { wrapper } = await mountDrawer();
    activeWrapper = wrapper;
    expect(bodyTabs()).toEqual(['概览', 'Prompt']);
    expect(document.body.textContent).not.toContain('运行配置');
    expect(document.body.textContent).not.toContain('试跑');
    expect(document.body.textContent).not.toContain('协议规则');
  });

  it('Prompt tab 保留只读内容与设计页 CTA，无版本对比入口', async () => {
    dataSource.value = 'live';
    liveSkillProfiles.value = [{ id: 'skill-a', name: 'Skill A', category: 'analysis', agentId: 'agent-a', agentName: 'Agent A' }];
    intent.skillDrawerId = 'skill-a';
    const { wrapper } = await mountDrawer();
    activeWrapper = wrapper;
    const promptPill = Array.from(document.body.querySelectorAll('.msk__tabs .mk-pill')).find((el) => (el.textContent || '').includes('Prompt')) as HTMLElement;
    promptPill.click();
    await settle();
    expect(document.body.textContent).toContain('system prompt body');
    expect(document.body.textContent).toContain('打开 Prompt 设计页 →');
    expect(document.body.textContent).toContain('编辑协议 / 发布 →');
    // 版本对比已收敛到设计页「版本」tab
    expect(document.body.textContent).not.toContain('对比生效版');
    expect(document.body.textContent).not.toContain('历史版本');
  });
});
