/**
 * LearningEvaluationPage（当堂对话折叠）回归测试：
 * 2026-11-06 走查改为**默认整块折叠**（此前默认铺开最近两条）：用户进报告是看总结的，
 * 不是把聊天记录再读一遍；长讲解一条就几百字，底部模块仍然占掉小半屏。
 * 展开/收起可切换，且导出图片/打印前会临时全展开（导出的报告不能缺内容）。
 * 同时锁住计数同源：卡头「N 条记录」与展开按钮必须来自同一条时间线
 * （此前卡头数消息、按钮数「消息 + 小测卡」，出现过「47 条消息 / 展开更早的 54 条」）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LearningEvaluationPage from '../LearningEvaluationPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { taskId: 't1', sessionId: 's1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() })
}));

const getSessionDetailMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/aiTeaching', () => ({
  aiTeachingAPI: { getSessionDetail: getSessionDetailMock }
}));

vi.mock('@/utils/api', () => ({
  default: { post: vi.fn(async () => ({ data: {} })) }
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/utils/projection', () => ({
  isProjectionMode: vi.fn(() => false)
}));

vi.mock('@/components/CompletionCard.vue', () => ({ default: { template: '<div class="stub-completion" />' } }));
vi.mock('@/components/learning/SessionFeedbackPanel.vue', () => ({ default: { template: '<div class="stub-feedback" />' } }));
vi.mock('@/components/TeachingFigure.vue', () => ({
  default: { props: ['figure'], template: '<div class="stub-figure" :data-kind="figure && figure.kind" />' }
}));
vi.mock('@/components/TeachingDiagram.vue', () => ({
  default: { props: ['code', 'caption'], template: '<div class="stub-diagram" />' }
}));

const html2canvasMock = vi.hoisted(() => vi.fn());
vi.mock('html2canvas-pro', () => ({ default: html2canvasMock }));

const messages = [
  { role: 'assistant', content: '第一条讲解', timestamp: '2026-09-23T02:51:00.000Z' },
  { role: 'user', content: '我准备好了', timestamp: '2026-09-23T02:55:00.000Z' },
  { role: 'assistant', content: '第二条讲解', timestamp: '2026-09-23T02:56:00.000Z' },
  { role: 'user', content: '这是我的判断', timestamp: '2026-09-23T03:00:00.000Z' },
  { role: 'assistant', content: '第三条讲解', timestamp: '2026-09-23T03:01:00.000Z' }
];

const detail = {
  status: 'completed',
  topic: '拆解一页乱版汇报稿的对齐关系',
  duration: 12,
  knowledgePoints: [],
  messages,
  wrapup: {
    status: 'ready',
    sources: { summary: 'ok', evaluation: 'ok' },
    summary: { topicSummary: '本节总结', knowledgeSummary: '', practiceAdvice: '', learningEvaluation: '' }
  }
};

async function mountReady() {
  const w = mount(LearningEvaluationPage);
  await flushPromises();
  return w;
}

describe('LearningEvaluationPage 当堂对话折叠', () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
    getSessionDetailMock.mockResolvedValue(detail);
  });

  it('默认整块折叠：一条都不渲染，只留标题行与展开入口', async () => {
    const w = await mountReady();
    expect(w.findAll('.evaluation-transcript-item').length).toBe(0);

    const toggle = w.find('.evaluation-transcript-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain('展开对话记录');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    /* 卡头计数与按钮同源：5 条消息 = 5 条记录（不再出现「47 条消息 / 展开 54 条」） */
    expect(w.find('.evaluation-transcript-card__meta').text()).toBe('5 条记录');
  });

  it('点击后在展开/收起之间切换，条目数随之变化', async () => {
    const w = await mountReady();
    const toggle = w.find('.evaluation-transcript-toggle');

    await toggle.trigger('click');
    expect(w.findAll('.evaluation-transcript-item').length).toBe(5);
    expect(w.find('.evaluation-transcript-toggle').text()).toContain('收起对话');
    expect(w.find('.evaluation-transcript-toggle').attributes('aria-expanded')).toBe('true');

    await w.find('.evaluation-transcript-toggle').trigger('click');
    expect(w.findAll('.evaluation-transcript-item').length).toBe(0);
    expect(w.find('.evaluation-transcript-toggle').text()).toContain('展开对话记录');
  });

  it('条目很少也保留展开开关（默认一律折叠，没有「预览条数」例外）', async () => {
    getSessionDetailMock.mockResolvedValue({ ...detail, messages: messages.slice(0, 2) });
    const w = await mountReady();
    expect(w.findAll('.evaluation-transcript-item').length).toBe(0);
    const toggle = w.find('.evaluation-transcript-toggle');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger('click');
    expect(w.findAll('.evaluation-transcript-item').length).toBe(2);
  });

  it('带图消息内联回放课堂结构图与白板图（2026-11-04：此前只回放文字，图全丢）', async () => {
    const visualMessages = [
      { role: 'user', content: '我的回答', timestamp: '2026-09-23T02:55:00.000Z' },
      {
        role: 'assistant',
        content: '这条讲解，配对照图',
        timestamp: '2026-09-23T02:56:00.000Z',
        diagrams: [{ engine: 'mermaid', code: 'graph TD; A-->B' }],
        figures: [{ kind: 'compare', caption: '原问法 vs 改写后' }]
      }
    ];
    getSessionDetailMock.mockResolvedValue({ ...detail, messages: visualMessages });

    const w = await mountReady();
    await w.find('.evaluation-transcript-toggle').trigger('click');
    const items = w.findAll('.evaluation-transcript-item');
    expect(items.length).toBe(2);
    // 图只挂在 assistant 带图消息内：白板图 + 结构图各一
    expect(items[1].findAll('.stub-figure').length).toBe(1);
    expect(items[1].find('.stub-figure').attributes('data-kind')).toBe('compare');
    expect(items[1].findAll('.stub-diagram').length).toBe(1);
    // 无图消息不渲染图节点
    expect(items[0].findAll('.stub-figure, .stub-diagram').length).toBe(0);
  });

  it('导出图片前临时展开全部消息，导出结束后恢复折叠态', async () => {
    const w = await mountReady();
    // jsdom 不能真下载 data: URL，替换掉锚点点击以免刷出 navigation 未实现的噪声
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let itemsAtExport = -1;
    html2canvasMock.mockImplementation(async () => {
      itemsAtExport = w.findAll('.evaluation-transcript-item').length;
      return { toDataURL: () => 'data:image/png;base64,AAAA' };
    });

    await w.find('.evaluation-head__actions .btn-ghost').trigger('click');
    await flushPromises();
    anchorClick.mockRestore();

    expect(itemsAtExport).toBe(5);
    expect(w.findAll('.evaluation-transcript-item').length, '导出后回到折叠态').toBe(0);
  });

  it('小测按 submittedAt 编进时间线（2026-11-04：此前评估页完全不回放小测）', async () => {
    getSessionDetailMock.mockResolvedValue({
      ...detail,
      state: {
        checkpointHistory: [
          {
            checkpointId: 'cp_1',
            title: '下面哪一条更像心理学的问法？',
            question: '下面哪一条更像心理学的问法？',
            type: 'single_choice',
            options: [
              { id: 'A', text: '他是不是根本不重视这份工作？' },
              { id: 'B', text: '在什么条件下，这类迟到更容易出现？' },
              { id: 'C', text: '他这个人到底靠不靠谱？' }
            ],
            selectedOptionIds: ['B'],
            passed: true,
            submittedAt: '2026-09-23T02:55:30.000Z'
          }
        ]
      }
    });

    const w = await mountReady();
    // 5 条消息 + 1 个小测 = 6 条时间线条目；折叠态显最近 2 条：
    // 小测(02:55:30) 晚于「这是我的判断」(03:00 之前最后一条 user 是 03:00)…
    // 时间线升序展开校验，先展开
    await w.find('.evaluation-transcript-toggle').trigger('click');
    const items = w.findAll('.evaluation-transcript-item');
    expect(items.length).toBe(6);

    const cpItem = w.find('.evaluation-transcript-item--checkpoint');
    expect(cpItem.exists()).toBe(true);
    expect(cpItem.text()).toContain('下面哪一条更像心理学的问法？');
    // 三个选项都在，B 高亮为学生所选，判定为通过
    expect(cpItem.findAll('.evaluation-transcript-checkpoint__opt').length).toBe(3);
    const picked = cpItem.findAll('.evaluation-transcript-checkpoint__opt.is-picked');
    expect(picked.length).toBe(1);
    expect(picked[0].text()).toContain('在什么条件下，这类迟到更容易出现？');
    expect(cpItem.find('.evaluation-transcript-checkpoint__verdict.is-pass').exists()).toBe(true);
    // 插入位置：小测(02:55:30) 在 02:55 的用户消息之后、02:56 的讲解之前
    const texts = items.map((i) => i.text());
    const cpIndex = texts.findIndex((t) => t.includes('下面哪一条更像心理学的问法？'));
    expect(texts[cpIndex - 1]).toContain('我准备好了');
    expect(texts[cpIndex + 1]).toContain('第二条讲解');
  });

  it('未通过的小测给「未通过」判定且不高亮正确项（服务端不下发答案键）', async () => {
    getSessionDetailMock.mockResolvedValue({
      ...detail,
      state: {
        checkpointHistory: [
          {
            checkpointId: 'cp_x',
            question: '哪一句无法被证据推翻？',
            type: 'single_choice',
            options: [{ id: 'A', text: '他性格内向' }],
            selectedOptionIds: ['A'],
            passed: false,
            submittedAt: '2026-09-23T03:02:00.000Z'
          }
        ]
      }
    });

    const w = await mountReady();
    await w.find('.evaluation-transcript-toggle').trigger('click');
    const cpItem = w.find('.evaluation-transcript-item--checkpoint');
    expect(cpItem.exists()).toBe(true);
    expect(cpItem.find('.evaluation-transcript-checkpoint__verdict.is-fail').exists()).toBe(true);
    // 答案键被服务端剥离：页面上不该出现「正确答案」字样
    expect(cpItem.text()).not.toContain('正确答案');
  });

  it('同版白板快照回放去重：板变了才画新版（2026-11-04「看图都是一张图」）', async () => {
    const vennRev = (rev: number, firstLeft: string) => ({
      engine: 'svg',
      kind: 'venn',
      board: true,
      boardRevision: rev,
      spec: { left: { head: '常识解释', items: [firstLeft] }, right: { head: '心理学解释', items: ['能测'] }, overlap: { head: '两边都谈', items: ['总迟到'] } }
    });
    getSessionDetailMock.mockResolvedValue({
      ...detail,
      messages: [
        { role: 'assistant', content: '第一次摆板', timestamp: '2026-09-23T02:51:00.000Z', figures: [vennRev(1, '懒、不上心')] },
        { role: 'assistant', content: '同一块板再看一眼', timestamp: '2026-09-23T02:53:00.000Z', figures: [vennRev(1, '懒、不上心')] },
        { role: 'assistant', content: '同版又画一次', timestamp: '2026-09-23T02:54:00.000Z', figures: [vennRev(1, '懒、不上心')] },
        { role: 'user', content: '把这一步画成结构图', timestamp: '2026-09-23T02:55:00.000Z' },
        { role: 'assistant', content: '板更新了', timestamp: '2026-09-23T02:56:00.000Z', figures: [vennRev(2, '懒、不重视')] },
        { role: 'assistant', content: '新版再指一次', timestamp: '2026-09-23T02:57:00.000Z', figures: [vennRev(2, '懒、不重视')] }
      ]
    });

    const w = await mountReady();
    await w.find('.evaluation-transcript-toggle').trigger('click');
    const items = w.findAll('.evaluation-transcript-item');
    expect(items.length).toBe(6);
    // 6 条快照只画 2 次：rev1 首现（第 1 条）、rev2 首现（第 5 条）；重复快照条目零图
    const figCounts = items.map((i) => i.findAll('.stub-figure').length);
    expect(figCounts).toEqual([1, 0, 0, 0, 1, 0]);
    // 新版内容确实画出来（不是把 rev1 留着充数）
    expect(items[4].find('.stub-figure').attributes('data-kind')).toBe('venn');
  });
});
