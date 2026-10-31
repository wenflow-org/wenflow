/**
 * OpsContent「学习路径」重设计回归（2026-09-05）：
 * 与教学会话/目标对话 tab 同族——状态条为路径自身统计、状态筛选唯一入口 = 表格卡内贴表分布条
 * （2026-10-04 晚：pills 与构成带退役，分段/图例可点下钻）、无独立场景 KPI 大卡、
 * 无学科列（subject 实为长目标文本，改目标摘要单行省略）。
 * 断言 = 视觉骨架（结构类），浏览器人工复核负责像素级细节。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OpsContent from '../OpsContent.vue';
import Confirm from '../Confirm.vue';
import { intent, subPage, closeSubPage } from '../store';
import { toast } from '@/utils/toast';
import { chooseFilter, filterOption, filterOptions } from './filter-controls';

const mkPath = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `路径${id}`,
  subject: '这是一段很长的学习目标描述，用来验证单行省略的显示效果是否正常 work',
  status: 'active',
  difficulty: 'beginner',
  estimatedHours: 6,
  totalMilestones: 4,
  completedMilestones: 1,
  aiGenerated: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  deadline: null,
  user: { id: 'u1', name: '张三', email: 'zs@wenflow.local', isVirtualLearner: false },
  milestoneStatuses: ['completed', 'in_progress', 'todo', 'todo'],
  milestoneCount: 4,
  ...over,
});

const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { success: boolean; data?: { success: boolean; retryType?: string; runId?: string; error?: string }; error?: string } }> => ({
    data: { success: true, data: { success: true, retryType: 'core', runId: 'pgr_1' } },
  }))
);

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    listPaths: listMock,
    getStats: statsMock,
    getPathDetail: vi.fn(async () => ({ data: { data: { title: 'x', subject: '另一主题', milestones: [] } } })),
    archivePath: vi.fn(async () => ({ data: {} })),
    restorePath: vi.fn(async () => ({ data: {} })),
    deletePath: vi.fn(async () => ({ data: {} })),
    retryGeneration: retryMock,
  },
  adminTeachingSessionsApi: { list: vi.fn(async () => ({ data: {} })) },
  adminGoalConversationsApi: { list: vi.fn(async () => ({ data: {} })), getStats: vi.fn(async () => ({ data: {} })) },
  adminAnnouncementsApi: { list: vi.fn(async () => ({ data: {} })) },
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
}));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    isLive: { value: true },
    // 2026-10-04 整组统一口径：includeTest 升为共享 ref（须真 ref 才能驱动 computed/watch）
    liveIncludeVirtual: ref(false),
    liveSetIncludeVirtual: vi.fn(),
    // 顶栏刷新广播（页面 watch 它重拉列表与统计）
    liveRefreshSeq: ref(0),
    timeAgo: (v: string) => v,
    errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id),
    isPageCacheFresh: () => false,
    markPageFetched: () => {},
    // Pagination.vue 从 ../live 导入 totalPagesOf；翻页器改为常驻后本 mock 首次被真实消费
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
  };
});

const rows = [
  mkPath('lp_a', { user: { id: 'u2', name: '虚拟生', email: 'v@wenflow.local', isVirtualLearner: true } }),
  mkPath('lp_b', { status: 'completed', subject: '完成的目标摘要' }),
  mkPath('lp_c', { status: 'failed', subject: '失败路径摘要' }),
];

function mockOk() {
  listMock.mockResolvedValue({ data: { data: { paths: rows, pagination: { total: rows.length, page: 1, limit: 100 } } } });
  statsMock.mockResolvedValue({ data: { data: { total: rows.length, byStatus: { active: 1, completed: 1, failed: 1 }, bySubject: [], totalMilestones: 9, totalTasks: 24 } } });
}

beforeEach(() => {
  intent.scene = 'overview';
  intent.statusFilter = '';
  intent.tab = '';
  mockOk();
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  closeSubPage();
});

describe('OpsContent 学习路径 tab 重设计骨架', () => {
  it('embedded：无状态条（宿主承载）；上报链已退役不发射；卡头含状态 pills + 复合快筛 + 搜索 + 列显隐；表头无学科列', async () => {
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    // embedded 不渲染自己的状态条（合并宿主「学习会话」状态条承载域计数）
    expect(w.find('.mk-status').exists()).toBe(false);
    // count/stats 上报链已随合并宿主退役（2026-10-02 撤 KPI 栅格时一并清除），不再发射
    expect(w.emitted('count')).toBeUndefined();
    expect(w.emitted('stats')).toBeUndefined();

    // 独立页同样无 KPI 卡（2026-10-02 用户拍板：状态条已单源承载 总数/里程碑/任务/已下线）
    expect(w.find('.mk-kpi').exists()).toBe(false);

    // 状态筛选 = 卡头胶囊下拉（2026-10-17 分布带退役后迁回；2026-10-27 单选维度
    // 统一为 MkPillSelect，档位在 listbox 里而不是一排 pill）；
    // 「停滞」快筛 2026-10-22 退役（判据是活跃时钟不是生成状态，真实路径的救援动作无效）
    const statusOptions = filterOptions(w as never, '状态');
    expect(statusOptions.some((t) => t.includes('停滞'))).toBe(false);
    for (const statusWord of ['全部', '学习中', '已完成', '生成失败', '已下线']) {
      expect(statusOptions.some((t) => t.includes(statusWord))).toBe(true);
    }
    expect(w.find('.mk-distband').exists()).toBe(false);

    // 右侧组件（2026-10-04 整组统一：口径开关上收页头，embedded 页头隐藏 → 卡头无 ds-toggle）
    expect(w.find('.mk-card__head input.mk-filter__input').exists()).toBe(true);
    expect(w.find('.ds-toggle').exists()).toBe(false);
    expect(w.find('.mk-cols').exists()).toBe(true);
    // 卡头 meta 只留分页器没有的事实（截断窗口）；口径不再复读（2026-10-19 用户走查
    // 「这个小文案不要」：真实/测试由页头开关自明，embedded 态宿主页头承载）
    expect(w.text()).not.toContain('（真实）');
    expect(w.find('.mk-card--fill .mk-card__meta').exists()).toBe(false);

    // 表头：路径/用户/状态/进度/更新/操作——「主题」独立列已退役（P2-6 2026-10-04 全站评审：
    // 91% 行与路径列同文），subject≠title 时作路径列副行
    const ths = w.findAll('thead th').map((t) => t.text());
    expect(ths).toContain('路径');
    expect(ths).not.toContain('主题');
    expect(ths).toContain('用户');
    expect(ths).toContain('状态');
    expect(ths).toContain('进度');
    expect(ths).toContain('操作');
    // fixture 的 subject 与 title 不同 → 路径列出现主题副行（首行 = lp_a 的长目标文本）
    const pathCell = w.findAll('tbody td')[0];
    expect(pathCell.text()).toContain('这是一段很长的学习目标描述');

    // 虚拟行不再挂逐行徽章（右上角视角开关已表达身份域）；头像 tone 仍按身份着色
    expect(w.find('.oc-tags').exists()).toBe(false);
    expect(w.find('.mk-badge--virtual').exists()).toBe(false);

    w.unmount();
  });

  it('卡头状态下拉 = 状态筛选；选回「全部」恢复；目标摘要列单行省略类存在', async () => {
    const w = mount(OpsContent);
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(3);

    // 选「已完成」→ 1 行；选回「全部」恢复 3 行
    await chooseFilter(w as never, '状态', '已完成');
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(1);
    expect(w.find('tbody').text()).toContain('完成的目标摘要');
    await chooseFilter(w as never, '状态', '全部');
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(3);

    // 摘要列带省略样式（2026-10-03 方言收敛：oc-subject 私有类退役 → 共享 mk-cell-text）
    expect(w.find('.mk-cell-text').exists()).toBe(true);

    w.unmount();
  });

  it('初始预筛：failed（工作台深链）状态下 failed 行可见', async () => {
    const w = mount(OpsContent, { props: { embedded: true, initialStatus: 'failed' } });
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(1);
    expect(w.find('tbody').text()).toContain('失败路径摘要');
    w.unmount();
  });

  /** 拆列回归（2026-09-29）：难度/时长从路径副行拆成独立列
   *  ——原副行 `lp_xxx · 入门 · ~9h` 挤在同一格，且 difficulty 直出英文 unknown。 */
  it('拆列：难度/时长独立成列；难度枚举归一（unknown→未知，不直出英文）', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          paths: [
            mkPath('lp_d1', { difficulty: 'intermediate', estimatedHours: 21 }),
            mkPath('lp_d2', { difficulty: 'unknown', estimatedHours: null }),
            mkPath('lp_d3', { difficulty: '能把 pandas 跑起来但缺失值处理不熟', estimatedHours: 9 }),
          ],
          pagination: { total: 3, page: 1, limit: 100 },
        },
      },
    });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    const ths = w.findAll('thead th').map((t) => t.text());
    // 2026-10-22 默认收起难度（真实数据多为未知、不改变运营动作）；
    // 2026-10-26 预计时长同理默认收起（约数不改变处理动作）
    expect(ths).not.toContain('难度');
    expect(ths).not.toContain('预计时长');
    expect(ths).not.toContain('主题');
    /* 教学组列序统一（2026-10-16）：主体列（路径）→ 用户 → 状态 → 属性/过程（难度、时长、进度）→ 时间（更新）→ 操作。
       原断言是「难度紧跟路径列、用户之前（路径自身属性成组）」，与同组其它页的
       「主体 → 用户 → 状态 → 过程」不一致，也违背 2026-10-03 的「主体列恒在首、用户列随后」。 */
    expect(ths.slice(0, 5)).toEqual(['路径', '用户', '状态', '进度', '最近活动']);
    expect(ths.at(-1)).toBe('操作');

    // 路径列副行 = 主题（仅 subject≠title 时；P2-6），不夹带难度/时长；
    // 2026-10-23 走查后内部短 ID 也撤了（截断后不可读、也不可复制）
    const subs = w.findAll('tbody tr td:first-child .mk-cell-sub').map((s) => s.text());
    expect(subs.every((s) => !/入门|进阶|高阶|~?\d+h/.test(s))).toBe(true);
    expect(subs[0]).toContain('这是一段很长的学习目标描述');
    expect(subs.join(' ')).not.toContain('lp_');

    // 难度 / 时长默认收起：从「列」菜单打开后再验证
    const colsBtn = w.find('.mk-cols__trigger');
    if (!w.find('.mk-cols__menu').exists()) await colsBtn.trigger('click');
    const diffItem = w.findAll('.mk-cols__item').find((l) => l.text().includes('难度'))!;
    await diffItem.find('input').setValue(true);
    const hoursItem = w.findAll('.mk-cols__item').find((l) => l.text().includes('预计时长'))!;
    await hoursItem.find('input').setValue(true);
    await nextTick();
    expect(w.findAll('.oc-diff').map((e) => e.text())).toEqual(['进阶', '未知', '未知']);
    // 2026-10-26 文案收口：难度不再挂解释型悬停
    w.findAll('.oc-diff').forEach((e) => expect(e.attributes('title')).toBeUndefined());

    // 时长：有值带 ~，无值给 —
    expect(w.findAll('td.mk-num').map((e) => e.text())).toEqual(['~21h', '—', '~9h']);
    // 数字列右对齐（表头 mk-th--right + 单元格 mk-num）
    expect(w.findAll('thead th').some((t) => t.text() === '预计时长' && t.classes().includes('mk-th--right'))).toBe(true);

    w.unmount();
  });

  /** 原型对齐（2026-10-01）：行点击 open-path 进 PathDetail 二级页（抽屉退役，
   *  与教学会话行点击进座舱 / UserDetail/LearnerDetail 同一交互习惯）。
   *  2026-10-27 操作列统一：非失败行一级动作=详情（与行点击同一落点），
   *  失败行一级动作=重试生成、详情收进 ⋯。 */
  it('行点击 / Enter → 路径详情二级页（subPage=path）；操作列一级动作按行状态统一', async () => {
    closeSubPage();
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    // 行点击（原型 tr data-action="open-path" → renderPathDetail）
    await w.find('tbody tr').trigger('click');
    await nextTick();
    expect(subPage.value).toMatchObject({ view: 'path', id: 'lp_a' });
    // 不再渲染抽屉（结构详情整体退役）
    expect(document.body.querySelector('.mk-drawer')).toBeNull();
    // 非失败行一级动作 = 详情（文字链，全站统一控制档）
    expect(w.find('tbody tr .mk-actions > .mk-link').text()).toBe('详情');
    expect(w.find('tbody tr .mk-actions .mk-btn').exists()).toBe(false);

    // Enter 键盘可达（同 gc-row/ts-row 判例）
    closeSubPage();
    await w.find('tbody tr').trigger('keydown.enter');
    await nextTick();
    expect(subPage.value).toMatchObject({ view: 'path', id: 'lp_a' });

    closeSubPage();
    w.unmount();
  });

  it('用户格姓名 → 学习者详情（subPage=learner）；不触发整行进路径详情', async () => {
    closeSubPage();
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    // 行序随状态/时间排序变，按姓名定位「张三」那一行（user u1）
    const row = w.findAll('tbody tr').find((tr) => tr.find('.mk-user-link').exists() && tr.find('.mk-user-link').text() === '张三');
    expect(row).toBeTruthy();
    const nameBtn = row!.find('.mk-user-link');
    await nameBtn.trigger('click');
    await nextTick();
    expect(subPage.value).toMatchObject({ view: 'learner', id: 'u1' });

    closeSubPage();
    w.unmount();
  });

  /** P1#9 + P2 顺手（2026-10-02）：口径标注 / 进度条三态 / 失败行入口 / 失败严重度对齐 OpsHub */
  it('口径标注 + 三态 + 失败行入口：状态 pills 带全平台计数；进度条失败红/100% 绿/进行中中性；失败行「去详情」；状态条已退役', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          paths: [
            mkPath('lp_ok', { status: 'completed', completedMilestones: 4 }),
            mkPath('lp_run', { status: 'active' }),
            mkPath('lp_fail', { status: 'failed' }),
          ],
          pagination: { total: 3, page: 1, limit: 100 },
        },
      },
    });
    const w = mount(OpsContent);
    await flushPromises();
    await nextTick();

    // 分布带已退役（2026-10-17）：状态筛选回到卡头 pills，计数取 stats 全平台 byStatus
    expect(w.find('.oc-distband').exists()).toBe(false);
    expect(w.find('.mk-distband').exists()).toBe(false);
    const opt = (label: string) => filterOption(w as never, '状态', label).text();
    expect(opt('学习中')).toBe('学习中（1）');
    expect(opt('已完成')).toBe('已完成（1）');
    expect(opt('生成失败')).toBe('生成失败（1）');
    expect(opt('全部')).toBe('全部状态');

    // 进度条三态：100% = 绿（ok）/ 进行中 = 默认中性（无 warn 琥珀）/ 失败 = 红（bad）
    const tones = w.findAll('tbody .mk-minibar__fill').map((el) => el.attributes('data-tone') || '');
    expect(tones).toEqual(['ok', '', 'bad']);

    // 操作列（2026-10-27 统一）：一级动作是文字链（失败行=重试生成，其它行=详情）；
    // 下线/恢复/删除仍在 ⋯ 菜单；失败行的「详情」也收进菜单，一级位只留最该做的动作。
    const failRow = w.findAll('tbody tr').find((r) => r.text().includes('路径lp_fail'))!;
    const failPrimary = failRow.find('.mk-actions > .mk-link');
    expect(failPrimary.text()).toBe('重试生成');
    expect(failRow.find('.mk-actions .mk-btn').exists()).toBe(false);
    await failRow.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const menuItems = failRow.findAll('.mk-menu__pop .mk-menu__item').map((b) => b.text());
    expect(menuItems).toContain('详情');
    expect(menuItems).not.toContain('重试生成');
    expect(menuItems).toContain('下线');
    // 非失败行的一级动作是「详情」，没有重试
    const okRow = w.findAll('tbody tr').find((r) => r.text().includes('路径lp_ok'))!;
    expect(okRow.find('.mk-actions > .mk-link').text()).toBe('详情');
    expect(okRow.findAll('.mk-actions > .mk-link').map((b) => b.text())).not.toContain('重试生成');

    // 状态条已退役（2026-10-04）：总量读数迁 MkKpi 卡带
    expect(w.find('.mk-status').exists()).toBe(false);
    expect(w.find('.mk-kpi-grid').exists()).toBe(true);
    // 2026-10-26 用户走查「kpi 就一个，不太好看」：单卡扩为五张真实读数
    // （学习中的 / 生成失败两卡可点 = 筛选快捷入口；筛选正式入口仍是卡头胶囊）
    expect(w.findAll('.mk-kpi__label').map((n) => n.text().trim())).toEqual([
      '路径总数', '学习中', '生成失败', '累计里程碑', '累计子任务'
    ]);

    w.unmount();
  });

  /** 停滞信号 2026-10-22 退役（用户「停滞有必要放在这吗」）：判据是活跃时钟不是生成状态，
   *  真实用户数日不学即命中，且其「重试生成」只对虚拟会话可用。救援入口只留给真正的 failed 行。 */
  it('停滞信号退役：active 超 24h 不再标记、也无一级「重试生成」；failed 行才有', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          paths: [
            mkPath('lp_fresh'),
            mkPath('lp_stall', { updatedAt: '2026-09-01T00:00:00Z' }),
            mkPath('lp_failed', { status: 'failed', updatedAt: '2026-09-01T00:00:00Z' }),
          ],
          pagination: { total: 3, page: 1, limit: 100 },
        },
      },
    });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    const trs = w.findAll('tbody tr');
    expect(trs[1].find('.mk-badge--warn').exists()).toBe(false);
    expect(w.text()).not.toContain('停滞');
    // 陈旧 active 行的一级动作是「详情」而不是重试；failed 行才是救援对象
    expect(trs[1].findAll('.mk-actions > .mk-link').map((b) => b.text())).not.toContain('重试生成');
    expect(trs[2].findAll('.mk-actions > .mk-link').map((b) => b.text())).toContain('重试生成');
    w.unmount();
  });

  it('failed 行「重试生成」：busy 确认 → 调用成功 → toast + 列表刷新', async () => {
    // 真实挂载确认框（页面只负责 askConfirm；弹窗由全局单例 Confirm 承载，Teleport 到 body）
    const dialog = mount(Confirm, { attachTo: document.body });
    listMock.mockResolvedValue({
      data: { data: { paths: [mkPath('lp_fail2', { status: 'failed' })], pagination: { total: 1, page: 1, limit: 100 } } },
    });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    const callsBefore = listMock.mock.calls.length;

    // 一级动作（2026-10-27 统一为文字链）
    const row = w.findAll('tbody tr')[0];
    const btn = row.find('.mk-actions > .mk-link');
    expect(btn.text()).toBe('重试生成');
    await btn.trigger('click');
    await nextTick();
    const btns = [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')];
    expect(btns.length).toBe(2); // [0] 取消 / [1] 确认
    btns[1].click();
    await flushPromises();
    await nextTick();

    expect(retryMock).toHaveBeenCalledWith('lp_fail2');
    const last = toast.toasts[toast.toasts.length - 1];
    expect(last?.type).toBe('success');
    expect(last?.message).toContain('已提交重试');
    // 成功后列表刷新 + 弹窗关闭（busy 模式 doneConfirm 收尾）
    expect(listMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.querySelector('.mk-confirm')).toBeNull();
    dialog.unmount();
    w.unmount();
  });

  it('守卫拒绝：HTTP 200 + success:false → 中文原因透传 toast.error（假按钮禁令的对偶：拒因如实上报）', async () => {
    retryMock.mockResolvedValue({ data: { success: false, error: '当前生成任务未失败或未过期，不能重试' } });
    const dialog = mount(Confirm, { attachTo: document.body });
    listMock.mockResolvedValue({
      data: { data: { paths: [mkPath('lp_fail3', { status: 'failed' })], pagination: { total: 1, page: 1, limit: 100 } } },
    });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();

    const row = w.findAll('tbody tr')[0];
    const btn = row.find('.mk-actions > .mk-link');
    await btn.trigger('click');
    await nextTick();
    const btns = [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')];
    btns[1].click();
    await flushPromises();
    await nextTick();

    const last = toast.toasts[toast.toasts.length - 1];
    expect(last?.type).toBe('error');
    expect(last?.message).toContain('未失败或未过期');
    dialog.unmount();
    w.unmount();
  });

  it('统计拉取失败：KPI 带换成「统计加载失败 + 重试」，重试成功后恢复读数', async () => {
    statsMock.mockRejectedValueOnce(new Error('stats boom'));
    const w = mount(OpsContent);
    await flushPromises();
    await nextTick();
    const err = w.find('.oc-stats-error');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('统计加载失败');
    // 不把「—」画成正常读数
    expect(w.find('.mk-kpi').exists()).toBe(false);
    const retry = err.findAll('button').find((b) => b.text() === '重试')!;
    await retry.trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.find('.oc-stats-error').exists()).toBe(false);
    expect(w.find('.mk-kpi__label').text().trim()).toBe('路径总数');
    w.unmount();
  });

  it('搜索框只承诺标题与用户（placeholder 不再含 ID）', async () => {
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    const input = w.find('input.mk-filter__input');
    expect(input.attributes('placeholder')).toBe('搜索标题或用户');
    w.unmount();
  });

  it('空态：没路径时给「去目标对话」出口（不再有教学第二句）', async () => {
    listMock.mockResolvedValue({ data: { data: { paths: [], pagination: { total: 0, page: 1, limit: 100 } } } });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    const empty = w.find('.mk-empty');
    expect(empty.text()).toContain('没有学习路径');
    expect(empty.text()).not.toContain('还没有生成过学习路径');
    expect(empty.findAll('button').some((b) => b.text() === '去目标对话')).toBe(true);
    // 分页器自隐（2026-10-31 三轮评审）：0 行不再挂「共 0 条 · 第 1 / 1 页」
    expect(w.find('.mk-pagination').exists()).toBe(false);
    w.unmount();
  });

  it('「其它」档可筛（枚举外取值的聚合），不再只是展示', async () => {
    statsMock.mockResolvedValue({ data: { data: { byStatus: { active: 0, completed: 0, failed: 0, archived: 0, weird: 2 } } } });
    listMock.mockResolvedValue({
      data: { data: { paths: [mkPath('lp_weird', { status: 'weird' })], pagination: { total: 1, page: 1, limit: 100 } } },
    });
    const w = mount(OpsContent, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    expect(filterOption(w as never, '状态', '其它').text()).toBe('其它（2）');
    await chooseFilter(w as never, '状态', '其它');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(1);
    w.unmount();
  });
});
