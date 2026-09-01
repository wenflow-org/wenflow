/**
 * 健康中心（巡检工作台 G1）冒烟测试：
 * 1. 组件挂载（demo 模式）：不请求后端，仅状态条
 * 2. live 模式 + summary mock：概要卡四张 / 健康检查高亮分组 + 正常折叠组 / 行内明细展开 / 漂移 / 对账 / 完成度
 * 3. 计数口径：漂移卡只计「需处理」（契约 + W4），运行时遥测为只读观测不计入
 * 4. 网络失败降级：wb-failed + 重试可恢复
 * 5. ?refresh=1 深链强制刷新
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
        makeItem('runtime-prompt', 'warn', 50, Array.from({ length: 25 }, (_, i) => `drift ${i + 1}`)),
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

    // 全局状态条：技能数 / 上线 / 异常（含异常技能）
    const bar = wrapper.find('.mk-status').text();
    expect(bar).toContain('技能 8');
    expect(bar).toContain('上线 2/8');
    expect(bar).toContain('异常 6');

    // 概要卡四张
    const cards = wrapper.findAll('.hc-card');
    expect(cards.length).toBe(4);
    expect(cards[0].text()).toContain('13');      // 健康检查
    expect(cards[0].text()).toContain('4 异常');
    expect(cards[1].text()).toContain('3');       // 漂移：只计契约 1 + W4 2，运行时遥测不计
    expect(cards[1].text()).toContain('需处理');
    expect(cards[2].text()).toContain('8');       // 对账
    expect(cards[2].text()).toContain('5 异常');  // 1+0+2+1+0+1，zombieSkillActive 3 与健康检查同源不计
    expect(cards[3].text()).toContain('2');       // 已上线
    expect(cards[3].text()).toContain('/ 8');

    // 健康检查 13 行全部渲染；异常/关注项默认展开，正常项收进折叠组
    const rows = wrapper.findAll('.hc-check__row');
    expect(rows.length).toBe(13);
    expect(wrapper.findAll('.hc-check--error').length).toBe(2);
    expect(wrapper.findAll('.hc-check--warn').length).toBe(2);
    expect(wrapper.find('.hc-ok__summary').text()).toContain('其余 9 项正常');

    // 漂移区：契约/W4 红标，运行时遥测为信息蓝标（只读观测）
    const driftItems = wrapper.findAll('.hc-drift__item');
    expect(driftItems.length).toBe(3);
    expect(wrapper.find('.hc-drift .mk-badge--info').exists()).toBe(true);

    // 对账卡 tooltip 说明同源不重复计数
    expect(cards[2].attributes('title')).toContain('同源');
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
    const failedBox = wrapper.find('.mk-empty');
    expect(failedBox.exists()).toBe(true);
    expect(failedBox.text()).toContain('加载失败');

    getSummaryMock.mockResolvedValueOnce({ data: { success: true, data: makeReport() } });
    await wrapper.find('.mk-empty__action').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.mk-empty').exists()).toBe(false);
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