/**
 * 健康中心（巡检工作台 G1）冒烟测试：
 * 1. 组件挂载（live 模式）：不请求真实后端（2026-10-04 状态条退役，页头仅剩轮询注记）
 * 2. live 模式 + summary mock：概要卡四张 / 四域页签 / 健康检查高亮分组 + 正常折叠组 / 行内明细展开 / 漂移 / 对账 / 完成度
 * 3. 计数口径：漂移卡只计「需处理」（契约 + W4），运行时遥测为只读观测不计入
 * 4. 网络失败降级：wb-failed + 重试可恢复
 * 5. ?refresh=1 深链强制刷新；?tab= 深链直达对应域页签
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import HealthCenter from '../HealthCenter.vue';
import { dataSource } from '../store';
import type {
  HealthCenterItem,
  HealthCenterSummaryReport,
} from '@/api/adminApi';

const { getSummaryMock } = vi.hoisted(() => ({
  getSummaryMock: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({
  adminHealthCenterApi: {
    get: vi.fn(),
    getSummary: getSummaryMock,
    fix: vi.fn(),
  },
  // 健康中心内嵌「技能对账」子组件会调用此 API；返回空报告即可（本套件不校验对账内容）
  adminSkillsApi: {
    getReconciliation: vi.fn(async () => ({ data: { data: null } })),
  },
}));

function makeItem(
  id: HealthCenterItem['id'],
  severity: HealthCenterItem['severity'],
  count = 0,
  detail: string[] = [],
): HealthCenterItem {
  return {
    id, label: `检查项 ${id}`, base: 'bidirectional', semantics: 'consistency',
    severity, status: severity === 'ok' ? 'clean' : severity === 'warn' ? 'drifted' : 'drifted',
    count, detail, cause: `cause ${id}`, action: 'none', fixHint: '', source: 'test',
  };
}

function makeReport(overrides: Partial<HealthCenterSummaryReport> = {}): HealthCenterSummaryReport {
  const base: HealthCenterSummaryReport = {
    generatedAt: '2026-08-13T08:00:00.000Z',
    health: {
      summary: { total: 13, baselineDrift: 2, consistency: 1, overrideRecord: 0, fixable: 1 },
      items: [
        makeItem('w4-corehash', 'error', 2, ['core.yaml → products 哈希不一致', 'products → DB 哈希不一致']),
        makeItem('field-routing-contract', 'error', 1),
        makeItem('contract-parity', 'warn', 1),
        makeItem('field-routing', 'ok'),
        makeItem('snapshots', 'ok'),
        makeItem('yaml-crosscheck', 'ok'),
        makeItem('params-consistency', 'ok'),
        makeItem('fields-sync', 'ok'),
        makeItem('w1-active', 'ok'),
        makeItem('w2-registration', 'ok'),
        makeItem('w3-wiring', 'ok'),
        makeItem('override-record', 'info'),
        makeItem('runtime-prompt', 'warn', 50, Array.from({ length: 25 }, (_, i) => i === 0
          ? 'skill:teaching-opening-generator ×12 @ 2026-09-06T02:14:04.671Z'
          : `drift ${i + 1}`)),
      ],
      abnormal: 4,
    },
    drift: { contract: 1, hash: 2, runtime: 50 },
    reconciliation: {
      total: 8, missingRegistration: 1, zombieRegistration: 0,
      missingActive: 2, zombieActive: 1, zombieSkillActive: 3, unwired: 1,
    },
    completion: {
      distribution: { draft: 2, 'handler-ready': 1, 'core-ready': 1, 'fields-synced': 2, live: 2 },
      live: 2,
    },
    global: { total: 8, aux: 3, mainline: 5, handlerOnly: 0, abnormalSkills: 2 },
  };
  // P1#28/#30 夹具：不同 base（观察服务卡按 tone 排序）+ fixHint（常驻展示在检查行动作区）。
  // base 分配 = manifest(error items0/1) → core.yaml(warn item2) → 双向 ok（items3 起）→
  // runtime(warn item12 runtime-prompt)：ok 卡插入序先于 warn 卡，排序后必须反超。
  base.health.items[0].base = 'file:manifest';
  base.health.items[0].fixHint = '点此一键修复：自动重新编译产物并同步数据库；若产物是代码库跟踪文件，完成后需提交代码';
  base.health.items[1].base = 'file:manifest';
  base.health.items[2].base = 'file:core.yaml';
  base.health.items[2].fixHint = '需开发处理：定位差异后执行契约同步';
  base.health.items[12].base = 'runtime';
  return { ...base, ...overrides };
}

async function mountWorkbench() {
  dataSource.value = 'live';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/health-center');
  await router.isReady();
  const wrapper = mount(HealthCenter, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('健康中心（G1）', () => {
  beforeEach(() => {
    getSummaryMock.mockReset();
    dataSource.value = 'live';
  });

  it('live + summary mock：概要卡四张 + 计数口径 + 健康检查分组', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountWorkbench();
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
    expect(getSummaryMock).toHaveBeenCalledWith(false);

    // 2026-10-04 状态条退役（原断言读全局条「技能 8 / 异常 6」）：条下线后技能总数并入完成度卡
    // hint、异常计数由概要 KPI 承载（检查异常 4 + 完成度未达标 2 = 原徽章「异常 6」同源拆解）、
    // 「更新于」并入页头注记；「上线」旧用词不回归（统一「已上线」，见下方 cards[3] 断言）
    expect(wrapper.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    expect(wrapper.find('.hc-refresh-note').text()).toContain('更新于');

    // 概要 KPI 四张（P1#30 语义统一：value = 需处理数（0=好），总数/达成数下沉 hint，
    // tone 只挂真正异常卡——修复「登记总数 8 被着成警示琥珀」）
    const cards = wrapper.findAll('.mk-kpi');
    expect(cards.length).toBe(4);
    expect(cards[0].text()).toContain('4');                    // 检查异常（value=异常数）
    expect(cards[0].text()).toContain('健康检查共 13 项');       // 总数下沉 hint
    expect(cards[1].text()).toContain('3');                    // 漂移需处理：契约 1 + W4 2
    expect(cards[1].text()).toContain('契约 1 + 哈希 2');
    expect(cards[2].text()).toContain('3');                    // 对账异常：登记缺项 1 + 无生效版本 2 + 失效注册 0（zombieActive/unwired 不计入）
    expect(cards[2].text()).toContain('登记 8 项');
    expect(cards[3].text()).toContain('2');                    // 完成度未达标
    expect(cards[3].text()).toContain('已上线 2/8');           // 达成数下沉 hint + 用词统一「已上线」
    // 2026-10-06 审核 #102：本卡 hint 的「共 N 个技能」与相邻对账卡 hint「登记 N 项」同值同屏
    // 复读且两种叫法，已撤（登记总数单源住在页头注记 title 与对账卡 title）。
    expect(cards[3].text()).not.toContain('共 8 个技能');
    expect(cards[3].attributes('title')).toContain('未达 live');

    // 健康检查 13 行全部渲染；异常/关注项默认展开，正常项收进折叠组
    const rows = wrapper.findAll('.hc-check__row');
    expect(rows.length).toBe(13);
    expect(wrapper.findAll('.hc-check--error').length).toBe(2);
    expect(wrapper.findAll('.hc-check--warn').length).toBe(2);
    // 2026-10-06 审核 #100：组头不再一律写「正常」——组内含 info 只读观测项（如「运行时漂移（遥测）」），
    // 改「无异常」+ 观测条数披露口径。审核 #99：展开/收起文案状态化（点击展开 / 点击收起）。
    const okSummary = wrapper.find('.hc-ok__summary').text();
    expect(okSummary).toContain('其余 9 项无异常');
    expect(okSummary).toContain('点击展开');

    // 四域页签（2026-10-04 平铺改页签）：四枚与概要 KPI 一一对应，默认落在健康检查
    const tabs = wrapper.findAll('.hc-tabs .tab');
    expect(tabs.map((t) => t.text())).toEqual(['健康检查', '漂移', '对账', '完成度']);
    expect(tabs[0].attributes('aria-selected')).toBe('true');

    // 漂移页签：点概要卡「漂移」切入（原锚点滚动改为切页签）；契约/W4 红标，运行时遥测为信息蓝标
    await cards[1].trigger('click');
    await nextTick();
    expect(wrapper.find('.hc-tabs .tab[aria-selected="true"]').text()).toBe('漂移');
    const driftItems = wrapper.findAll('.hc-drift__item');
    expect(driftItems.length).toBe(3);
    expect(wrapper.find('.hc-drift .mk-badge--info').exists()).toBe(true);

    // 对账卡 tooltip 说明同源不重复计数
    expect(cards[2].attributes('title')).toContain('同源');
  });

  it('漂移页签空态：无漂移时显「全部一致」ok 卡（页签常驻，不再整段隐匿）', async () => {
    getSummaryMock.mockResolvedValue({
      data: { success: true, data: makeReport({ drift: { contract: 0, hash: 0, runtime: 0 } }) },
    });
    const wrapper = await mountWorkbench();
    await wrapper.findAll('.hc-tabs .tab').find((t) => t.text() === '漂移')!.trigger('click');
    await nextTick();
    expect(wrapper.find('.hc-drift-none').exists()).toBe(true);
    expect(wrapper.text()).toContain('全部一致');
    wrapper.unmount();
  });

  it('?tab= 深链直达对应域页签（刷新/分享可还原）', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    dataSource.value = 'live';
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push('/admin/health-center?tab=recon');
    await router.isReady();
    const wrapper = mount(HealthCenter, { global: { plugins: [router] } });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.hc-tabs .tab[aria-selected="true"]').text()).toBe('对账');
    wrapper.unmount();
  });

  it('P2 顺手 + P1#28：服务卡按 tone 排序（error→warn→ok）；fixHint 常驻在检查行动作区', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountWorkbench();

    // 夹具插入序里 ok 卡（双向对账，items[3]）先于 warn 卡（运行时遥测，items[11]）；
    // 排序后 warn 卡必须排在 ok 卡之前（修复前服务卡按 base 首次出现序渲染）
    const names = wrapper.findAll('.hc-services .service__name').map((el) => el.text());
    expect(names[0]).toBe('契约清单（manifest）');
    expect(names.indexOf('运行时遥测')).toBeLessThan(names.indexOf('双向对账'));

    // fixHint 常驻（P1#28）：修复说明渲染在检查行动作区（此前只在 409 错误 toast 里透出）
    const hints = wrapper.findAll('.hc-check__fixhint');
    expect(hints.length).toBe(2);
    expect(hints[0].text()).toContain('一键修复');
    expect(hints[0].attributes('title')).toContain('一键修复');
  });

  it('行内明细展开：异常项默认展开，点击收起；明细截断提示', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountWorkbench();

    // 高亮区内带 detail 的项默认展开（w4-corehash 2 条 + runtime-prompt 截断 20 条）
    const details = wrapper.findAll('.hc-check__detail');
    expect(details.length).toBe(2);
    expect(details[0].text()).toContain('core.yaml → products 哈希不一致');

    // 明细截断：runtime-prompt 25 条 → 显示 20 + 提示
    const more = wrapper.find('.hc-check__detail-more');
    expect(more.exists()).toBe(true);
    expect(more.text()).toContain('共 25 条明细，仅显示前 20 条');

    // 运行时遥测本地化：后端 `agent ×N @ ISO` → 前端 `agent ×N｜最近 本地时间`
    expect(details[1].text()).toContain('skill:teaching-opening-generator ×12｜最近');
    expect(details[1].text()).not.toContain('@ 2026-');

    // 点击行收起明细
    const w4Row = wrapper.findAll('.hc-check__row')[0];
    await w4Row.trigger('click');
    await nextTick();
    expect(wrapper.findAll('.hc-check__detail').length).toBe(1);

    // 正常项折叠组展开后可见 override-record
    await wrapper.find('.hc-ok__summary').trigger('click');
    await nextTick();
    expect(wrapper.find('.hc-ok .hc-check--info').exists()).toBe(true);
  });

  it('网络失败降级：失败空态 + 重试成功后恢复', async () => {
    getSummaryMock.mockRejectedValueOnce(new Error('network down'));
    const wrapper = await mountWorkbench();
    const failedBox = wrapper.find('.mk-empty--min');
    expect(failedBox.exists()).toBe(true);
    expect(failedBox.text()).toContain('加载失败');

    getSummaryMock.mockResolvedValueOnce({ data: { success: true, data: makeReport() } });
    await wrapper.find('.mk-empty--min .mk-empty__action').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.mk-empty--min').exists()).toBe(false);
    expect(wrapper.findAll('.hc-check__row').length).toBe(13);
    expect(getSummaryMock).toHaveBeenCalledWith(true); // 重试走强制刷新
  });

  it('live 模式请求携带 refresh=1（?refresh=1 深链）', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    dataSource.value = 'live';
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push('/admin/health-center?refresh=1');
    await router.isReady();
    mount(HealthCenter, { global: { plugins: [router] } });
    await flushPromises();
    expect(getSummaryMock).toHaveBeenCalledWith(true);
  });
});