/**
 * Users 客户端分页（P2：37 行单页直排 → mk-pagination 统一分页器）测试：
 * 总数/页码展示 / 首屏 15 行 / 翻页整页切片 / 每页条数变更 / 筛选回第 1 页
 * （mock './live' 与 './store'，liveUsers 提供 37 行客户端全量数据）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Users from '../Users.vue';
import { liveUsers } from '../live';

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

function makeUser(i: number) {
  return {
    id: `u${i}`,
    name: `用户${i}`,
    email: `user${i}@example.com`,
    isAdmin: i === 1,
    isVirtualLearner: false,
    isTestAccount: false,
    lastLoginAt: '2026-08-13T10:00:00',
    createdAt: '2026-07-01T10:00:00',
    paths: 1,
    sessions: 2,
    xp: 100,
    currentLevel: 'L2'
  };
}

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  // 2026-10-04 整组统一口径：共享 ref + set 回写（真实现语义）
  const liveIncludeVirtual = ref(false);
  return {
    liveUsers: ref([]),
    liveUsersTotal: ref(0),
    liveIncludeVirtual,
    liveSetIncludeVirtual: vi.fn((v: boolean) => {
      liveIncludeVirtual.value = v;
    }),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    registrationEnabled: ref<boolean | null>(null),
    liveCreateUser: vi.fn(async () => {}),
    liveDeleteUser: vi.fn(async () => {}),
    liveSetUserRole: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
    openSubPage: vi.fn()
  };
});

vi.mock('@/api/adminApi', () => ({
  adminUsersApi: apiObject(),
  adminAuditApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  getDeletedUsers: vi.fn(async () => ({ data: { data: { users: [] } } })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

async function mountUsers() {
  const w = mount(Users);
  await flushPromises();
  return w;
}

describe('Users 客户端分页（mk-pagination）', () => {
  beforeEach(() => {
    liveUsers.value = Array.from({ length: 37 }, (_, i) => makeUser(i + 1));
  });

  it('37 行 → 总数展示「共 37 条」+ 第 1 / 3 页 + 首屏 15 行', async () => {
    const w = await mountUsers();
    await nextTick();
    expect(w.text()).toContain('共 37 条');
    expect(w.text()).toContain('第 1 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(w.text()).toContain('用户1');
    expect(w.text()).not.toContain('用户16');
  });

  /** 2026-10-17 用户走查「这个多选，默认不出来吧」：勾选列默认不出，
   *  批量入口保留在「列」菜单（选择框（批量操作）），需要时自己打开。 */
  it('选择框列默认隐藏：首访无全选、无行内勾选，列菜单仍可找回', async () => {
    localStorage.removeItem('wf_users_hidden_cols_v5');
    const w = await mountUsers();
    await nextTick();
    expect(w.find('thead input[type="checkbox"][aria-label="全选当前页"]').exists()).toBe(false);
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(0);

    await findBtn(w, '列').trigger('click');
    await nextTick();
    const labels = w.findAll('.mk-cols__item label, .mk-cols__item').map((x) => x.text());
    expect(labels.some((t) => t.includes('选择框'))).toBe(true);
    w.unmount();
  });

  it('翻页：第 2 页整页切片（第 16-30 行，无第 1 页残留）', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    const rows = w.findAll('tbody tr');
    expect(rows[0].text()).toContain('用户16');
    // 第 1 页行（用户1-15）不残留：邮箱唯一可精确判定
    expect(w.text()).not.toContain('user1@example.com');
    expect(w.text()).not.toContain('user15@example.com');
    expect(w.text()).not.toContain('用户31');
  });

  it('末页：第 3 页只含剩余 7 行（37 = 15×2 + 7）', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 3 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(7);
    expect(w.text()).toContain('用户31');
  });

  it('每页条数 50 → 单页展示全部 37 行', async () => {
    const w = await mountUsers();
    await w.find('.mk-pagination__size').setValue('50');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(37);
  });

  it('关键词筛选：结果缩到 1 页且页码回 1', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    await w.find<HTMLInputElement>('.mk-filter__input').setValue('用户36');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.text()).toContain('用户36');
  });

  it('筛选强化：pill 计数 + 搜索清空 ×（卡头不再出「清除筛选」）', async () => {
    const w = await mountUsers();
    // pill 计数（2026-10-11 全站统一判例）：筛选 pill 一律显命中数，唯「全部」不显（总数单源=分页器）；
    // 「30 分钟在线」已随宿主 KPI 换窗为「近 7 天活跃」
    const pills = w.findAll('.mk-pill');
    expect(pills.find((p) => p.text().includes('全部'))?.find('.mk-pill__count').exists()).toBe(false);
    expect(pills.find((p) => p.text().includes('管理员'))?.find('.mk-pill__count').exists()).toBe(true);
    expect(pills.find((p) => p.text().includes('近 7 天活跃'))?.find('.mk-pill__count').exists()).toBe(true);
    // 计数徽章在用户数据到达后才渲染（CI 时序下 pill 先行、count 后至 → 空 DOMWrapper 竞态）——waitFor 轮询
    const normalPill = pills.find((p) => p.text().includes('普通用户'));
    await vi.waitFor(() => expect(normalPill?.find('.mk-pill__count').text()).toBe('36'));
    // 2026-10-17 用户拍板：本页只有 pill（单选）与搜索，二者各自有「全部」与搜索框 ✕，
    // 卡头「清除筛选」是第三个重复入口，已退役
    expect(w.find('.mk-search__clear').exists()).toBe(false);
    expect(w.findAll('button').some((b) => b.text() === '清除筛选')).toBe(false);
    // 输入关键词 → 只出现清空 ×，仍不再出「清除筛选」
    const input = w.find<HTMLInputElement>('.mk-filter__input');
    await input.setValue('用户36');
    await nextTick();
    expect(w.find('.mk-search__clear').exists()).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === '清除筛选')).toBe(false);
    // 点清空 × → 关键词清空，× 消失
    await w.find('.mk-search__clear').trigger('click');
    await nextTick();
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(w.find('.mk-search__clear').exists()).toBe(false);
  });
});

describe('Users 角色 / 活跃 pill：计数与筛选同谓词（2026-10-11 走查）', () => {
  /* 走查实测缺陷：计数取真实域（realActive）而筛选取全量行——含测试档下
     「管理员」badge 0 却点出 1 行测试管理员、「近 7 天活跃」badge 0 却点出 3 行。
     本组用例把两套分母钉在同一谓词上：badge 数字必须等于点开后的行数。 */
  const recent = () => new Date(Date.now() - 86400000).toISOString();
  const old = '2026-01-01T10:00:00.000Z';

  function mixedRows() {
    return [
      { ...makeUser(1), isAdmin: true, lastLoginAt: recent() }, // 真实 · 管理员 · 7 天内登录
      { ...makeUser(2), isAdmin: false, lastLoginAt: old }, // 真实 · 普通用户 · 久未登录
      { ...makeUser(3), isTestAccount: true, isAdmin: true, lastLoginAt: recent() }, // 测试管理员 · 近 7 天
      { ...makeUser(4), isVirtualLearner: true, isAdmin: false, lastLoginAt: recent() } // 虚拟学习者 · 近 7 天
    ];
  }

  function pillOf(w: ReturnType<typeof mount>, label: string) {
    const p = w.findAll('.mk-pill').find((x) => x.text().includes(label));
    if (!p) throw new Error(`pill not found: ${label}`);
    return p;
  }

  async function badgeOf(w: ReturnType<typeof mount>, label: string) {
    const p = pillOf(w, label);
    await vi.waitFor(() => expect(p.find('.mk-pill__count').exists()).toBe(true));
    return p.find('.mk-pill__count').text();
  }

  beforeEach(() => {
    liveUsers.value = mixedRows();
  });

  it('管理员：badge 只数真实管理员，点开行数与之相等（测试管理员不入列）', async () => {
    const w = await mountUsers();
    expect(await badgeOf(w, '管理员')).toBe('1');
    await pillOf(w, '管理员').trigger('click');
    await nextTick();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户1');
    expect(w.text()).not.toContain('用户3'); // 测试管理员被挡在真实域之外
  });

  it('近 7 天活跃：badge 只数真实账号，点开行数与之相等（虚拟 / 测试行不入列）', async () => {
    const w = await mountUsers();
    expect(await badgeOf(w, '近 7 天活跃')).toBe('1');
    await pillOf(w, '近 7 天活跃').trigger('click');
    await nextTick();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户1');
    expect(w.text()).not.toContain('用户3');
    expect(w.text()).not.toContain('用户4');
  });

  it('全部：含虚拟 / 测试行（4 行），且「管理员」行 badge 与「测试」行的管理员徽章不矛盾', async () => {
    const w = await mountUsers();
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(4);
    // 行内徽章仍如实显「管理员」（那是行的事实）；pill 的是「真实域有几个管理员」，title 已披露口径
    expect(await badgeOf(w, '管理员')).toBe('1');
    expect(pillOf(w, '管理员').attributes('title')).toContain('仅统计真实账号');
  });
});
