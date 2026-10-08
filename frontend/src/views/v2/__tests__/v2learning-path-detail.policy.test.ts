/**
 * V2LearningPathDetail 调整策略门控 + 调整历史（replanLineage）回归：
 * - 调整弹窗三场景按 path.adjustmentPolicy.allowedModes 门控：不在集合内的入口禁用并给原因；
 *   旧路径无策略（undefined/null）= 全放行；recommendedMode 默认选中并给「推荐」引导标记。
 * - 侧栏「调整历史」折叠卡只在 replanLineage 有内容时渲染（无 lineage 不出空态卡）。
 * 口径：后端 learning.helpers.parsePathAdjustmentPolicy（无策略 null = 不限制；数组即允许集合）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getPathDetail = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('@/api/learning', () => ({
  learningAPI: {
    getPathDetail,
    getPathGenerationStatus: vi.fn(),
    listPathReplanSnapshots: vi.fn(async () => []),
  },
}));

vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: {} }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'lp_test' }, query: routeQuery }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2LearningPathDetail from '../V2LearningPathDetail.vue';

function pathPayload(extra: Record<string, unknown> = {}) {
  return {
    id: 'lp_test',
    title: '测试路径',
    name: '测试路径',
    description: '测试描述',
    milestones: [],
    ...extra,
  };
}

async function mountDetail(extra: Record<string, unknown> = {}) {
  getPathDetail.mockResolvedValue(pathPayload(extra));
  const w = mount(V2LearningPathDetail);
  await flushPromises();
  return w;
}

async function openDialog(w: ReturnType<typeof mount>) {
  await w.find('.hero__actions .btn-ghost').trigger('click');
  await flushPromises();
}

describe('V2LearningPathDetail 调整策略门控', () => {
  beforeEach(() => {
    getPathDetail.mockReset();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  });

  it('旧路径无 adjustmentPolicy：三个场景入口全部可点', async () => {
    const w = await mountDetail();
    await openDialog(w);
    const modes = w.findAll('.adjust-mode');
    expect(modes.length).toBe(3);
    for (const btn of modes) expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('allowedModes 仅 expand/compress：rebuild 与 auto 禁用带原因，reshape 可点', async () => {
    const w = await mountDetail({
      adjustmentPolicy: { allowedModes: ['expand', 'compress'], recommendedMode: null, triggerSource: 'system' },
    });
    await openDialog(w);
    const [rebuild, reshape, auto] = w.findAll('.adjust-mode');
    expect(rebuild.attributes('disabled')).toBeDefined();
    expect(rebuild.text()).toContain('这条路径当前仅开放：扩展内容、压缩内容');
    expect(reshape.attributes('disabled')).toBeUndefined();
    expect(auto.attributes('disabled')).toBeDefined();
    expect(auto.text()).toContain('仅开放');
  });

  it('allowedModes 仅 replan：reshape 禁用，rebuild/auto 可点', async () => {
    const w = await mountDetail({
      adjustmentPolicy: { allowedModes: ['replan'], recommendedMode: null, triggerSource: 'ai-teaching' },
    });
    await openDialog(w);
    const [rebuild, reshape, auto] = w.findAll('.adjust-mode');
    expect(rebuild.attributes('disabled')).toBeUndefined();
    expect(reshape.attributes('disabled')).toBeDefined();
    expect(auto.attributes('disabled')).toBeUndefined();
  });

  it('recommendedMode=replan：打开弹窗默认落到 AI 诊断填写步并带推荐标记，换一种方式后场景卡带「推荐」角标', async () => {
    const w = await mountDetail({
      adjustmentPolicy: { allowedModes: ['expand', 'compress', 'replan'], recommendedMode: 'replan', triggerSource: null },
    });
    await openDialog(w);
    // 默认选中：直接进入 auto 场景的填写步（模式选择页被跳过）
    expect(w.find('.adjust-modes').exists()).toBe(false);
    expect(w.find('.adjust-form__mode-hint').text()).toContain('AI 学习情况诊断');
    expect(w.find('.adjust-form__rec').text()).toBe('按你的情况推荐');
    // 换一种方式：场景选择页里 auto 卡带「推荐」角标
    await w.find('.adjust-form__back').trigger('click');
    await flushPromises();
    const [rebuild, reshape, auto] = w.findAll('.adjust-mode');
    expect(rebuild.find('.adjust-mode__rec').exists()).toBe(false);
    expect(reshape.find('.adjust-mode__rec').exists()).toBe(false);
    expect(auto.find('.adjust-mode__rec').text()).toBe('推荐');
  });
});

describe('V2LearningPathDetail 调整历史（replanLineage）', () => {
  beforeEach(() => {
    getPathDetail.mockReset();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  });

  it('无 lineage 的存量路径：不渲染调整历史卡（不出空态卡）', async () => {
    const w = await mountDetail();
    const lineageCard = w.findAll('.sidecard').find((c) => c.text().includes('调整历史'));
    expect(lineageCard).toBeUndefined();
  });

  it('有 lineage：折叠卡默认收起，展开后展示方式/来源/原因，源路径与当前不同才给链接', async () => {
    const w = await mountDetail({
      replanLineage: {
        sourcePathId: 'lp_prev',
        replanMode: 'overwrite',
        triggerSource: 'ai-teaching',
        reason: '第二阶段太难，先补基础再推进',
      },
    });
    const card = w.findAll('.sidecard').find((c) => c.text().includes('调整历史'));
    expect(card).toBeDefined();
    const body = card!.find('.sidecard__body');
    // 默认折叠（v-show → 内联 display:none）
    expect(body.attributes('style')).toContain('none');
    await card!.find('.sidecard__head').trigger('click');
    expect(body.attributes('style')).not.toContain('none');
    expect(card!.text()).toContain('覆盖原路径');
    expect(card!.text()).toContain('AI 教学建议');
    expect(card!.text()).toContain('第二阶段太难');
    const link = card!.find('.lineage-link');
    expect(link.exists()).toBe(true);
    expect(link.attributes('to')).toBe('/learning-path/lp_prev');
  });

  it('overwrite 自指（sourcePathId=当前路径）：不给「查看来源」链接', async () => {
    const w = await mountDetail({
      replanLineage: { sourcePathId: 'lp_test', replanMode: 'overwrite', triggerSource: 'api', reason: null },
    });
    const card = w.findAll('.sidecard').find((c) => c.text().includes('调整历史'));
    expect(card).toBeDefined();
    await card!.find('.sidecard__head').trigger('click');
    expect(card!.find('.lineage-link').exists()).toBe(false);
    expect(card!.text()).not.toContain('调整原因');
  });
});
