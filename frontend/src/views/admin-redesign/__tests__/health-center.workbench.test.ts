/**
 * G1 一页式巡检工作台冒烟测试（阶段 2C）：
 * 1. 组件挂载（demo 模式）：渲染五分区布局，不依赖后端
 * 2. live 模式 + summary mock：渲染五分区真实数据（健康 13 项 / 漂移三卡 / 对账六卡 / 完成度五档 / 全局统计）
 * 3. 异常计数显眼标注：计数>0 的漂移/对账卡带 mk-badge--bad/warn + wb-stat--alert
 * 4. 网络失败降级：getSummary reject → wb-failed 重试可恢复
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

function makeItem(id: HealthCenterItem['id'], severity: HealthCenterItem['severity'], count = 0): HealthCenterItem {
  return {
    id, label: `检查项 ${id}`, base: 'bidirectional', semantics: 'consistency',
    severity, status: severity === 'ok' ? 'clean' : severity === 'warn' ? 'drifted' : 'drifted',
    count, detail: [], cause: `cause ${id}`, action: 'none', fixHint: '', source: 'test',
  };
}

function makeReport(overrides: Partial<HealthCenterSummaryReport> = {}): HealthCenterSummaryReport {
  const base: HealthCenterSummaryReport = {
    generatedAt: '2026-08-13T08:00:00.000Z',
    health: {
      summary: { total: 13, baselineDrift: 2, consistency: 1, overrideRecord: 0, fixable: 1 },
      items: [
        makeItem('w4-corehash', 'error', 2),
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
        makeItem('runtime-prompt', 'warn', 1),
      ],
      abnormal: 4,
    },
    drift: { contract: 1, hash: 2, runtime: 1 },
    reconciliation: {
      total: 8, missingRegistration: 1, zombieRegistration: 0,
      missingActive: 2, zombieActive: 1, zombieSkillActive: 0, unwired: 1,
    },
    completion: {
      distribution: { draft: 2, 'handler-ready': 1, 'core-ready': 1, 'fields-synced': 2, live: 2 },
      live: 2,
    },
    global: { total: 8, aux: 3, mainline: 5, handlerOnly: 0, abnormalSkills: 2 },
  };
  return { ...base, ...overrides };
}

async function mountWorkbench(live: boolean) {
  dataSource.value = live ? 'live' : 'demo';
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

describe('巡检工作台（G1）', () => {
  beforeEach(() => {
    getSummaryMock.mockReset();
    dataSource.value = 'demo';
  });

  it('demo 模式降级：展示演示数据五分区，不请求后端', async () => {
    const wrapper = await mountWorkbench(false);
    expect(wrapper.find('.wb-demo').exists()).toBe(true);
    expect(getSummaryMock).not.toHaveBeenCalled();
    expect(wrapper.find('.mk-status__title').text()).toBe('巡检工作台');
    expect(wrapper.findAll('.wb-card').length).toBe(4);
    expect(wrapper.findAll('.hc-item').length).toBe(13);
    expect(wrapper.findAll('.wb-stats').length).toBe(3);
    expect(wrapper.findAll('.wb-stat--rec').length).toBe(5);
    expect(wrapper.find('.mk-badge--rec-live').exists()).toBe(true);
  });

  it('live + summary mock：五分区渲染 + 异常计数显眼标注', async () => {
    getSummaryMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountWorkbench(true);
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
    expect(getSummaryMock).toHaveBeenCalledWith(false);

    // 全局统计条
    const bar = wrapper.find('.mk-status').text();
    expect(bar).toContain('Skill');
    expect(bar).toContain('8');
    expect(bar).toContain('异常 6');

    // a. 健康 13 项
    expect(wrapper.findAll('.hc-item').length).toBe(13);
    expect(wrapper.findAll('.hc-item--error').length).toBe(2);
    expect(wrapper.findAll('.hc-item--warn').length).toBe(2);

    // a2. 健康检查分类计数（P3 对账）：客户端按 semantics 实计，分类之和恒等于总项数
    const hcHead = wrapper.findAll('.wb-card')[0].find('.mk-card__head');
    expect(hcHead!.text()).toContain('13 项检查');
    const catMeta = hcHead!.findAll('.mk-card__meta')[1].text();
    const catNums = catMeta.match(/\d+/g)?.map(Number) ?? [];
    expect(catNums.reduce((a, b) => a + b, 0)).toBe(13);

    // b. 漂移三卡：计数>0 → 红色/琥珀显眼标注
    const driftStats = wrapper.findAll('.wb-stats')[0].findAll('.wb-stat');
    expect(driftStats.length).toBe(3);
    expect(driftStats[0].find('.mk-badge--bad').exists()).toBe(true);
    expect(driftStats[0].classes('wb-stat--alert')).toBe(true);
    expect(driftStats[2].find('.mk-badge--warn').exists()).toBe(true);

    // c. 对账六卡：缺注册/幽灵 ACTIVE 红、接线差集琥珀、计数 0 的幽灵注册绿
    const reconStats = wrapper.findAll('.wb-stats')[1].findAll('.wb-stat');
    expect(reconStats.length).toBe(6);
    expect(reconStats[0].find('.mk-badge--bad').exists()).toBe(true);
    expect(reconStats[1].find('.mk-badge--ok').exists()).toBe(true);
    expect(reconStats[3].find('.mk-badge--bad').exists()).toBe(true);
    expect(reconStats[5].find('.mk-badge--warn').exists()).toBe(true);

    // d. 完成度五档：live 卡绿色高亮
    const recStats = wrapper.findAll('.wb-stats')[2].findAll('.wb-stat');
    expect(recStats.length).toBe(5);
    expect(recStats[4].find('.mk-badge--rec-live').exists()).toBe(true);
    expect(recStats[4].classes('wb-stat--live')).toBe(true);

    // 跳转入口可达
    expect(wrapper.findAll('.wb-stat__go').length).toBe(3);
    expect(wrapper.find('.mk-card__head .mk-status__action').exists()).toBe(true);
  });

  it('网络失败降级：wb-failed + 重试成功后恢复五分区', async () => {
    getSummaryMock.mockRejectedValueOnce(new Error('network down'));
    const wrapper = await mountWorkbench(true);
    expect(wrapper.find('.wb-failed').exists()).toBe(true);
    expect(wrapper.find('.wb-failed').text()).toContain('加载失败');

    getSummaryMock.mockResolvedValueOnce({ data: { success: true, data: makeReport() } });
    await wrapper.find('.wb-failed .mk-status__action').trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.wb-failed').exists()).toBe(false);
    expect(wrapper.findAll('.hc-item').length).toBe(13);
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
