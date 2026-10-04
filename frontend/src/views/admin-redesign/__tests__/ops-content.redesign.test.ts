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
import { intent, subPage, closeSubPage } from '../store';

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
  updatedAt: '2026-09-04T00:00:00Z',
  deadline: null,
  user: { id: 'u1', name: '张三', email: 'zs@wenflow.local', isVirtualLearner: false },
  milestoneStatuses: ['completed', 'in_progress', 'todo', 'todo'],
  milestoneCount: 4,
  ...over,
});

const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    listPaths: listMock,
    getStats: statsMock,
    getPathDetail: vi.fn(async () => ({ data: { data: { title: 'x', subject: '另一主题', milestones: [] } } })),
    archivePath: vi.fn(async () => ({ data: {} })),
    restorePath: vi.fn(async () => ({ data: {} })),
    deletePath: vi.fn(async () => ({ data: {} })),
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
    timeAgo: (v: string) => v,
    errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id),
    isPageCacheFresh: () => false,
    markPageFetched: () => {},
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
  it('embedded：无状态条（宿主承载）；上报链已退役不发射；卡头含搜索+列显隐（状态筛选已迁贴表分布条且 embedded 隐藏）；表头无学科列', async () => {
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

    // 状态筛选唯一入口 = 贴表分布条（2026-10-04 晚）：卡头不再有状态 pill；embedded 时分布条隐藏
    expect(w.find('.mk-card__head .mk-filter .mk-pill').exists()).toBe(false);
    expect(w.find('.mk-distband').exists()).toBe(false);

    // 右侧组件（2026-10-04 整组统一：口径开关上收页头，embedded 页头隐藏 → 卡头无 ds-toggle）
    expect(w.find('.mk-card__head input.mk-filter__input').exists()).toBe(true);
    expect(w.find('.ds-toggle').exists()).toBe(false);
    expect(w.find('.mk-cols').exists()).toBe(true);
    expect(w.text()).toContain('条（仅真实）');

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

    // 虚拟行标记
    expect(w.find('.oc-tags .mk-badge--virtual').exists()).toBe(true);

    w.unmount();
  });

  it('贴表分布条点击 = 状态筛选（原 pills 的接棒者）；目标摘要列单行省略类存在', async () => {
    const w = mount(OpsContent);
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(3);

    // 点图例「已完成」→ 1 行；再点取消恢复 3 行
    const doneBtn = w.findAll('.stageband__legend .sbl').find((b) => b.text().includes('已完成'))!;
    await doneBtn.trigger('click');
    await nextTick();
    expect(w.findAll('tbody tr').length).toBe(1);
    expect(w.find('tbody').text()).toContain('完成的目标摘要');
    await doneBtn.trigger('click');
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
    expect(ths).toContain('难度');
    expect(ths).toContain('时长');
    // 「主题」列已退役（P2-6 2026-10-04）：难度紧跟路径列、用户之前（路径自身属性成组）
    expect(ths).not.toContain('主题');
    expect(ths.indexOf('难度')).toBe(ths.indexOf('路径') + 1);

    // 路径列副行 = 主题（仅 subject≠title 时；P2-6）+ 短 ID，不夹带难度/时长
    const subs = w.findAll('tbody tr td:first-child .mk-cell-sub').map((s) => s.text());
    expect(subs.every((s) => !/入门|进阶|高阶|~?\d+h/.test(s))).toBe(true);
    expect(subs[0]).toContain('这是一段很长的学习目标描述');
    expect(subs[1]).toContain('lp_d1');
    expect(subs[3]).toContain('lp_d2');

    // 难度三态：枚举归一为中文、英文 unknown 与自述整句都收敛为「未知」
    expect(w.findAll('.oc-diff').map((e) => e.text())).toEqual(['进阶', '未知', '未知']);
    // 未知态把原因/原文放进 title，不把半句自述当难度展示
    const diffTitles = w.findAll('.oc-diff').map((e) => e.attributes('title') || '');
    expect(diffTitles[1]).toContain('未归入任何难度档');
    expect(diffTitles[2]).toContain('原始记录');

    // 时长：有值带 ~，无值给 —
    expect(w.findAll('td.mk-num').map((e) => e.text())).toEqual(['~21h', '—', '~9h']);
    // 数字列右对齐（表头 mk-th--right + 单元格 mk-num）
    expect(w.findAll('thead th').some((t) => t.text().includes('时长') && t.classes().includes('mk-th--right'))).toBe(true);

    w.unmount();
  });

  /** 原型对齐（2026-10-01）：行点击 open-path 进 PathDetail 二级页（抽屉退役，
   *  与教学会话行点击进座舱 / UserDetail/LearnerDetail 同一交互习惯）。
   *  落点断言走共享 store：subPage.view='path' + 页面内不再渲染抽屉。 */
  it('行点击 / Enter → 路径详情二级页（subPage=path）；操作列「详情」钮同目标；不再开抽屉', async () => {
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

    // 操作列「详情」文字钮 = 同一下钻目标
    closeSubPage();
    await w.find('tbody tr .mk-actions .mk-btn').trigger('click');
    await nextTick();
    expect(subPage.value).toMatchObject({ view: 'path', id: 'lp_a' });

    // Enter 键盘可达（同 gc-row/ts-row 判例）
    closeSubPage();
    await w.find('tbody tr').trigger('keydown.enter');
    await nextTick();
    expect(subPage.value).toMatchObject({ view: 'path', id: 'lp_a' });

    closeSubPage();
    w.unmount();
  });

  /** P1#9 + P2 顺手（2026-10-02）：口径标注 / 进度条三态 / 失败行入口 / 失败严重度对齐 OpsHub */
  it('口径标注 + 三态 + 失败行入口：分布条副标带全平台口径；进度条失败红/100% 绿/进行中中性；失败行「去详情」；状态条抬红但红链已由分布条红段接棒', async () => {
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

    // 口径单源迁分布条副标（pills 已退役）：全平台计数口径就地披露
    expect(w.find('.mk-distband__sub').text()).toContain('全平台计数');

    // 进度条三态：100% = 绿（ok）/ 进行中 = 默认中性（无 warn 琥珀）/ 失败 = 红（bad）
    const tones = w.findAll('tbody .mk-minibar__fill').map((el) => el.attributes('data-tone') || '');
    expect(tones).toEqual(['ok', '', 'bad']);

    // 失败行：动作钮改「去详情」并在 title 指路详情页重规划（重规划端点在后端不做）
    const failRow = w.findAll('tbody tr').find((r) => r.text().includes('路径lp_fail'))!;
    expect(failRow.find('.mk-actions .mk-btn').text()).toBe('去详情');
    expect(failRow.find('.mk-actions .mk-btn').attributes('title')).toContain('重规划');

    // 状态条已退役（2026-10-04）：失败抬红由分布条红段单源承载；总量读数迁 MkKpi 卡带
    expect(w.find('.mk-status').exists()).toBe(false);
    expect(w.find('.mk-kpi-grid').exists()).toBe(true);
    const failSeg = w.findAll('.mk-distband__seg').find((seg) => (seg.attributes('title') || '').includes('生成失败'))!;
    expect(failSeg.attributes('title')).toContain('重规划');
    expect(failSeg.attributes('title')).toContain('点击只看');

    w.unmount();
  });
});
