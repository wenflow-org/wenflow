/**
 * 成就记录页「搜索提交」语义（2026-10-08 走查）：搜索框是 v-model 实时的，但只有
 * 回车/「查询」才提交；翻页必须翻「当前生效的筛选」，不能因为输入框里有未提交的草稿
 * 就换成「新词 + 第 N 页」（那会跳过新结果第一页，甚至落在越界页显示空列表）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OpsAchievements from '../OpsAchievements.vue';

const h = vi.hoisted(() => ({
  getRecords: vi.fn(),
  getDefinitions: vi.fn()
}));

const { apiObject } = vi.hoisted(() => ({
  apiObject: (custom?: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(custom || ({} as Record<string, unknown>), {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
        return vi.fn(async () => ({ data: { data: {} } }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAchievementsApi: apiObject({ getRecords: h.getRecords, getDefinitions: h.getDefinitions }),
  adminUsersApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminAuditApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject()
}));

vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => false), doneConfirm: vi.fn(), failConfirm: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function recordsPage(total = 100, page = 1) {
  return {
    data: {
      data: {
        records: Array.from({ length: 20 }, (_, i) => ({
          id: `r-${page}-${i}`,
          userId: 'user_1',
          achievementId: 'a1',
          achievementName: '首次完成',
          xpReward: 10,
          earnedAt: '2026-10-01T00:00:00Z'
        })),
        pagination: { total, page, limit: 20 }
      }
    }
  };
}

async function mountPane() {
  const w = mount(OpsAchievements, { props: { embedded: true } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return w;
}

/** 切到「记录」页签 */
async function gotoTab(w: Awaited<ReturnType<typeof mountPane>>) {
  const tab = w.findAll('button').find((b) => b.text().includes('记录'))!;
  await tab.trigger('click');
  await flushPromises();
  await nextTick();
}

describe('成就记录页：搜索提交与翻页语义', () => {
  beforeEach(() => {
    h.getRecords.mockReset();
    h.getDefinitions.mockReset();
    // 组件按 `res.data?.data ?? res.data` 直接当数组用（:281），故这里给数组而非包装对象
    h.getDefinitions.mockResolvedValue({ data: { data: [] } });
    h.getRecords.mockResolvedValue(recordsPage());
  });

  it('输入框里改了词但未查询时，翻页仍按已提交的筛选取数（不隐式换词）', async () => {
    const w = await mountPane();
    await gotoTab(w);
    h.getRecords.mockClear();
    // 直接在搜索框输入新词（不回车、不点查询）
    const input = w.find('input[placeholder="搜索用户姓名 / 邮箱…"]');
    await input.setValue('张三');
    await nextTick();
    // 翻到第 2 页
    const next = w.findAll('.mk-pagination__btn').find((b) => b.text() === '下一页')!;
    await next.trigger('click');
    await flushPromises();
    expect(h.getRecords).toHaveBeenCalled();
    const lastParams = h.getRecords.mock.calls[h.getRecords.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastParams.q).toBeUndefined();
    expect(lastParams.page).toBe(2);
    w.unmount();
  });

  it('点「查询」提交当前词并回第 1 页', async () => {
    const w = await mountPane();
    await gotoTab(w);
    const input = w.find('input[placeholder="搜索用户姓名 / 邮箱…"]');
    await input.setValue('张三');
    await nextTick();
    const search = w.findAll('button').find((b) => b.text().trim() === '查询')!;
    await search.trigger('click');
    await flushPromises();
    const lastParams = h.getRecords.mock.calls[h.getRecords.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastParams.q).toBe('张三');
    expect(lastParams.page).toBe(1);
    w.unmount();
  });
});
