/**
 * PromptWorkbench（Skill 工作台）loadError 错误态分支：
 * 2026-10-05 审计缺口补测（此前该分支既无真机验证也无单测——CDP route 拦截 500 未生效）。
 * 断言三件事：
 * 1. getCoreList reject → MkEmptyState error 档（mk-empty--error + role=alert +「清单加载失败」）+「重试」钮
 * 2. 重试可达：点击重试重新拉取；成功后错误态退场、表格恢复
 * 3. 重试仍失败：错误态保持、重试钮仍在（不锁死）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import PromptWorkbench from '../PromptWorkbench.vue';
import { toast } from '@/utils/toast';

const { getCoreListMock } = vi.hoisted(() => ({ getCoreListMock: vi.fn() }));

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
  adminPromptWorkbenchApi: apiObject({ getCoreList: getCoreListMock }),
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

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

/** 构造 axios 形态的 500（errMsg 走 response.data.error.message 人话化单源） */
function axios500(message: string): Error {
  return Object.assign(new Error(`Request failed with status code 500`), {
    response: { status: 500, data: { error: { message } } }
  });
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

describe('PromptWorkbench loadError 错误态（审计缺口补测）', () => {
  beforeEach(() => {
    getCoreListMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('getCoreList reject → MkEmptyState error 档渲染 + 重试钮，表格/骨架退场', async () => {
    getCoreListMock.mockRejectedValueOnce(axios500('core-list 炸了'));
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();

    const empty = wrapper.find('.mk-empty');
    expect(empty.exists()).toBe(true);
    expect(empty.classes()).toContain('mk-empty--error');
    expect(empty.attributes('role')).toBe('alert');
    expect(empty.text()).toContain('清单加载失败');
    // 错误详情走 errMsg 人话化单源（response.data.error.message 原样透出）
    expect(empty.text()).toContain('清单加载失败：core-list 炸了');

    const retry = wrapper.find('.mk-empty__action');
    expect(retry.exists()).toBe(true);
    expect(retry.text()).toBe('重试');
    expect(retry.attributes('disabled')).toBeUndefined();

    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.mk-skeleton').exists()).toBe(false);
    expect(getCoreListMock).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('清单加载失败：core-list 炸了');
    wrapper.unmount();
  });

  it('重试可达：点击重试重新拉取，成功后错误态退场、表格恢复', async () => {
    getCoreListMock
      .mockRejectedValueOnce(axios500('core-list 炸了'))
      .mockResolvedValueOnce({
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
      });
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();
    expect(wrapper.find('.mk-empty--error').exists()).toBe(true);

    await wrapper.find('.mk-empty__action').trigger('click');
    await settle();

    expect(getCoreListMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.mk-empty--error').exists()).toBe(false);
    expect(wrapper.find('.mk-empty').exists()).toBe(false);
    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.text()).toContain('existing-skill');
    wrapper.unmount();
  });

  it('重试仍失败：错误态保持、重试钮仍在（不锁死）', async () => {
    getCoreListMock
      .mockRejectedValueOnce(axios500('第一次炸'))
      .mockRejectedValueOnce(axios500('第二次还是炸'));
    const wrapper = mount(PromptWorkbench, { attachTo: document.body });
    await settle();
    expect(wrapper.find('.mk-empty--error').exists()).toBe(true);

    await wrapper.find('.mk-empty__action').trigger('click');
    await settle();

    expect(getCoreListMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.mk-empty--error').exists()).toBe(true);
    expect(wrapper.find('.mk-empty__action').exists()).toBe(true);
    expect(wrapper.text()).toContain('清单加载失败：第二次还是炸');
    wrapper.unmount();
  });
});
