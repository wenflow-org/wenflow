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
import { getDeletedUsers } from '@/api/adminApi';
import { chooseFilter, filterOption, filterOptions } from './filter-controls';
import { chooseMkSelect } from '@/components/mk/__tests__/mkSelect';

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
  return {
    liveUsers: ref([]),
    liveUsersTotal: ref(0),
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

  it('37 行 → 总数展示「共 37 个账号」+ 第 1 / 3 页 + 首屏 15 行', async () => {
    const w = await mountUsers();
    await nextTick();
    // 分页器数的是人不是条：unit="个账号"
    expect(w.text()).toContain('共 37 个账号');
    expect(w.text()).toContain('第 1 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(w.text()).toContain('用户1');
    expect(w.text()).not.toContain('用户16');
  });

  /** 2026-10-17 用户走查「这个多选，默认不出来吧」：勾选列默认不出。
   *  2026-10-26：入口不再只藏在「列」菜单里——卡头明面给一枚「批量操作」，点开即显示勾选列。 */
  it('选择框列默认隐藏：首访无全选、无行内勾选；「批量操作」一键打开，列菜单仍可找回', async () => {
    localStorage.removeItem('wf_users_hidden_cols_v5');
    const w = await mountUsers();
    await nextTick();
    expect(w.find('thead input[type="checkbox"][aria-label="全选当前页"]').exists()).toBe(false);
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(0);

    const batch = findBtn(w, '批量操作');
    await batch.trigger('click');
    await nextTick();
    expect(w.find('thead input[type="checkbox"][aria-label="全选当前页"]').exists()).toBe(true);
    expect(w.findAll('tbody input[type="checkbox"]')).toHaveLength(15);
    // 再点一次收起并清空已选
    await batch.trigger('click');
    await nextTick();
    expect(w.find('thead input[type="checkbox"][aria-label="全选当前页"]').exists()).toBe(false);

    await w.find('.mk-cols__trigger').trigger('click');
    await nextTick();
    const labels = w.findAll('.mk-cols__item label, .mk-cols__item').map((x) => x.text());
    expect(labels.some((t) => t.includes('选择框'))).toBe(true);
    w.unmount();
  });

  /** 2026-10-26：这页唯一的处置动作（改昵称 / 邮箱 / 角色、重置密码）从 ⋯ 菜单提到操作列 */
  it('操作列「编辑」打开表单；⋯ 菜单不再有第二个「编辑」入口', async () => {
    localStorage.removeItem('wf_users_hidden_cols_v5');
    const w = await mountUsers();
    await nextTick();
    const firstRow = w.findAll('tbody tr')[0];
    const rowBtns = firstRow.findAll('.mk-actions .mk-btn');
    expect(rowBtns.some((b) => b.text() === '编辑'), '行内应有「编辑」钮').toBe(true);
    // 行点击本来就是详情，操作列不再重复一颗「详情」
    expect(rowBtns.some((b) => b.text() === '详情')).toBe(false);
    // ⋯ 里只剩删除（改角色/改密回到行内）
    await firstRow.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const menuItems = firstRow.findAll('.mk-menu__item').map((b) => b.text());
    expect(menuItems).toEqual(['删除']);
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
    await chooseMkSelect(w as never, '每页条数', '50');
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
    /* 2026-10-27 表头统一：单选维度改为带标签的胶囊下拉，计数进入 option 文案；
       「全部」仍不显计数（总数单源=分页器）。 */
    const opts = filterOptions(w as never, '视图');
    expect(opts.find((t) => t.startsWith('全部'))).toBe('全部用户');
    expect(opts.find((t) => t.startsWith('管理员'))).toMatch(/^管理员（\d+）$/);
    expect(opts.find((t) => t.startsWith('近 7 天活跃'))).toMatch(/^近 7 天活跃（\d+）$/);
    // 计数在用户数据到达后才进入 option（CI 时序下先渲染下拉、count 后至 → 竞态）——waitFor 轮询
    await vi.waitFor(() => expect(filterOption(w as never, '视图', '普通用户').text()).toBe('普通用户（36）'));
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
      { ...makeUser(3), isTestAccount: true, isAdmin: true, lastLoginAt: recent() } // 测试管理员 · 近 7 天
      /* 虚拟学习者不进账号列表（2026-10-21 拍板：它在自己的域），夹具也不再含虚拟行 */
    ];
  }

  function pillOf(w: ReturnType<typeof mount>, label: string) {
    return filterOption(w as never, '视图', label);
  }

  async function badgeOf(w: ReturnType<typeof mount>, label: string) {
    const opt = pillOf(w, label);
    await vi.waitFor(() => expect(opt.text()).toMatch(/（\d+）$/));
    return opt.text().match(/（(\d+)）$/)?.[1] ?? '';
  }

  beforeEach(() => {
    liveUsers.value = mixedRows();
  });

  it('管理员：badge 与点开行数相等（测试管理员也计入——测试只是备注）', async () => {
    const w = await mountUsers();
    expect(await badgeOf(w, '管理员')).toBe('2');
    await chooseFilter(w as never, '视图', '管理员');
    await nextTick();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.text()).join(' ')).toContain('用户1');
    expect(rows.map((r) => r.text()).join(' ')).toContain('用户3');
    w.unmount();
  });

  it('近 7 天活跃：badge 与点开行数相等（测试账号照常计入）', async () => {
    const w = await mountUsers();
    expect(await badgeOf(w, '近 7 天活跃')).toBe('2');
    await chooseFilter(w as never, '视图', '近 7 天活跃');
    await nextTick();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    w.unmount();
  });

  it('全部：测试账号照常列出并在行内标「测试」备注', async () => {
    const w = await mountUsers();
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(3);
    expect(await badgeOf(w, '管理员')).toBe('2');
    // 测试行带备注徽章（不是视角、不是独立分档）
    const testRow = w.findAll('tbody tr').find((r) => r.text().includes('用户3'));
    expect(testRow!.find('.mk-badge').text()).toContain('测试');
    w.unmount();
  });

  /* 2026-10-21 拍板「没有测试，测试只是备注」：角色/活跃 pill 只看该轴本身，
     计数与筛选同一谓词（测试账号也计入）。 */
  it('角色/活跃 pill 计数与筛选同谓词（不再叠加身份域）', async () => {
    const w = await mountUsers();
    await nextTick();
    const labels = filterOptions(w as never, '视图');
    expect(labels.some((t) => t.includes('全部'))).toBe(true);
    expect(labels.some((t) => t.includes('管理员'))).toBe(true);
    expect(labels.some((t) => t.includes('普通用户'))).toBe(true);
    expect(labels.some((t) => t.includes('近 7 天活跃'))).toBe(true);
    w.unmount();
  });

  /* 2026-10-26：宿主页撤掉 4 张 KPI 卡后，「从未登录」「近 7 日新增」必须能筛——
     看到「从未登录 3」却无处点，是这页原本最大的断点。 */
  it('「从未登录」「近 7 日新增」是 pill 且计数与筛选同谓词', async () => {
    liveUsers.value = [
      { ...makeUser(1), lastLoginAt: null },
      { ...makeUser(2), lastLoginAt: recent() }
    ] as unknown as typeof liveUsers.value;
    const w = await mountUsers();
    expect(await badgeOf(w, '从未登录')).toBe('1'); // 用户1（lastLoginAt 为空）
    await chooseFilter(w as never, '视图', '从未登录');
    await nextTick();
    let rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户1');

    await chooseFilter(w as never, '视图', '全部');
    await nextTick();
    // 夹具的 createdAt 都在 7 天外
    expect(await badgeOf(w, '近 7 日新增')).toBe('0');
    liveUsers.value = [
      { ...makeUser(1), createdAt: new Date(Date.now() - 86400000).toISOString() },
      { ...makeUser(2), createdAt: '2026-01-01T10:00:00.000Z' }
    ] as unknown as typeof liveUsers.value;
    await nextTick();
    await vi.waitFor(() => expect(pillOf(w, '近 7 日新增').text()).toBe('近 7 日新增（1）'));
    await chooseFilter(w as never, '视图', '近 7 日新增');
    await nextTick();
    rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户1');
    w.unmount();
  });
});

describe('Users 已删除视图：后端分页', () => {
  const deleted = (i: number) => ({
    id: `d${i}`, name: `已删${i}`, email: `d${i}@example.com`, isAdmin: false,
    createdAt: '2026-07-01T10:00:00', lastLoginAt: null, deletedAt: '2026-09-01T10:00:00',
    xp: 0, currentLevel: 'L1', _count: { learning_paths: 0, teaching_sessions: 0 }
  });

  beforeEach(() => {
    liveUsers.value = [makeUser(1)];
    (getDeletedUsers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { users: Array.from({ length: 15 }, (_, i) => deleted(i + 1)), pagination: { total: 120, page: 1, limit: 15 } } }
    });
  });

  it('计数取后端真总数；翻页带 page/limit 回后端（不再「50+」死窗）', async () => {
    const w = await mountUsers();
    await chooseFilter(w as never, '视图', '已删除');
    await flushPromises();
    // 计数是真总数，不是「50+」
    await vi.waitFor(() => expect(filterOption(w as never, '视图', '已删除').text()).toBe('已删除（120）'));
    expect(w.text()).toContain('共 120 个账号');
    expect(w.text()).toContain('第 1 / 8 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(getDeletedUsers).toHaveBeenLastCalledWith({ page: 1, limit: 15, search: undefined });

    await findBtn(w, '下一页').trigger('click');
    await flushPromises();
    expect(getDeletedUsers).toHaveBeenLastCalledWith({ page: 2, limit: 15, search: undefined });
    w.unmount();
  });
});
