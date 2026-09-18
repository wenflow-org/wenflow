/**
 * V2LearningPathDetail Hero 描述回归：
 * - 详情页 Hero 必须优先展示 AI 摘要（path.summary，path-planning 的 1-2 句人话总结），
 *   不得直接把目标原文（path.description，可能几百字）整段铺出来 —— 与列表页
 *   V2LearningPaths（p.summary || p.description）口径一致。
 * - Hero 不再重复出现「内容由 AI 生成…」提示（页脚保留全站统一那条）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getPathDetail = vi.hoisted(() => vi.fn());

vi.mock('@/api/learning', () => ({
  learningAPI: {
    getPathDetail,
    getPathGenerationStatus: vi.fn(),
  },
}));

vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: {} }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'lp_test' }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2LearningPathDetail from '../V2LearningPathDetail.vue';

const SUMMARY = '适合一个人在家复习、计划一崩就熬夜加码的二战考生：把重启动作做成崩溃当下会撞进眼里的收尾。';
const RAW_DESCRIPTION = '偏离后没有「最小重启标准」，且该标准在崩溃当下无法被主动想起、也无法被外部形式有效承载。'.repeat(8);

async function mountDetail() {
  getPathDetail.mockResolvedValue({
    id: 'lp_test',
    title: '二战在家备考偏离重启入门',
    name: '二战在家备考偏离重启入门',
    summary: SUMMARY,
    description: RAW_DESCRIPTION,
    milestones: [],
  });
  const w = mount(V2LearningPathDetail);
  await flushPromises();
  return w;
}

describe('V2LearningPathDetail Hero', () => {
  beforeEach(() => {
    getPathDetail.mockReset();
  });

  it('优先渲染 AI 摘要 summary，不铺原始 description 原文', async () => {
    const w = await mountDetail();
    const desc = w.find('.hero__desc');
    expect(desc.exists()).toBe(true);
    expect(desc.text()).toContain('适合一个人在家复习');
    expect(desc.text()).not.toContain('最小重启标准');
  });

  it('summary 缺失时回落 description（兼容老数据）', async () => {
    getPathDetail.mockResolvedValue({
      id: 'lp_test',
      title: '测试路径',
      name: '测试路径',
      summary: null,
      description: '兜底描述',
      milestones: [],
    });
    const w = mount(V2LearningPathDetail);
    await flushPromises();
    expect(w.find('.hero__desc').text()).toBe('兜底描述');
  });

  it('Hero 不再出现 AI 提示，页脚保留全站统一那条', async () => {
    const w = await mountDetail();
    expect(w.find('.hero .ai-note').exists()).toBe(false);
    expect(w.find('.detail__ai-note .ai-note').exists()).toBe(true);
  });

  it('设计意图卡片标题渲染 sceneSummary.title，并带折叠类（长文不糊屏）', async () => {
    getPathDetail.mockResolvedValue({
      id: 'lp_test',
      title: '二战在家备考偏离重启入门',
      summary: SUMMARY,
      description: RAW_DESCRIPTION,
      sceneSummary: {
        title: RAW_DESCRIPTION,
        firstDeliverable: '第一阶段产出示例',
        targetState: '目标状态示例',
      },
      milestones: [],
    });
    const w = mount(V2LearningPathDetail);
    await flushPromises();
    const title = w.find('.sidecard__intent-title');
    expect(title.exists()).toBe(true);
    expect(title.text()).toContain('最小重启标准');
    expect(title.classes()).toContain('sidecard__intent-title');
    expect(title.classes()).not.toContain('sidecard__intent-title--expanded');
  });

  it('设计意图卡：标题用短目标，问题背景折叠，且不再重复「规划焦点」', async () => {
    getPathDetail.mockResolvedValue({
      id: 'lp_test',
      title: '二战在家备考偏离重启入门',
      summary: SUMMARY,
      description: RAW_DESCRIPTION,
      sceneSummary: {
        title: '二战在家备考不崩',
        problemBackground: RAW_DESCRIPTION,
        firstDeliverable: '一张重启卡',
        targetState: '当天不崩',
        planningFocus: ['阶段一：做卡', '阶段二：跑闭环'],
        timeBudget: '每天 1 小时',
      },
      milestones: [],
    });
    const w = mount(V2LearningPathDetail);
    await flushPromises();
    expect(w.find('.sidecard__intent-title').text()).toBe('二战在家备考不崩');
    expect(w.find('.sidecard__rows').text()).not.toContain('规划焦点');
    expect(w.find('.sidecard__rows').text()).toContain('预计产出');
    // 问题背景默认折叠，点击后展开
    expect(w.find('.sidecard__bg-text').exists()).toBe(false);
    await w.find('.sidecard__bg-head').trigger('click');
    expect(w.find('.sidecard__bg-text').text()).toContain('最小重启标准');
  });

  it('设计意图卡：问题背景与标题相同时不重复展示', async () => {
    getPathDetail.mockResolvedValue({
      id: 'lp_test',
      title: '测试路径',
      summary: SUMMARY,
      description: RAW_DESCRIPTION,
      sceneSummary: { title: RAW_DESCRIPTION, problemBackground: RAW_DESCRIPTION },
      milestones: [],
    });
    const w = mount(V2LearningPathDetail);
    await flushPromises();
    expect(w.find('.sidecard__bg').exists()).toBe(false);
  });
});
