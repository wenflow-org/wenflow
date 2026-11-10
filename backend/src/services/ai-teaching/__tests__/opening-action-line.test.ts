/**
 * 开场「一条行动线」契约（2026-11-02 用户反馈「开场很不舒服 / 快选没什么意义」）
 *
 * 实跑证据：同一账号、同一任务的两次开场生成，一次带 3 个动作选项，一次 quickReplies 为空数组、
 * 却在句尾写着「也可以直接往下走」——页面上没有任何可点控件。全库 610 条开场里 241 条（39.5%）
 * quickReplies 为空。本测试钉住两件事：
 *   1. generateOpening 出参恒有 1-3 个可点动作，且动作承载本课内容（不是「开始吧/继续往下讲」）；
 *   2. question 不配控件，因此出现动作指向词时确定性丢弃（不做残句手术）。
 */
import {
  buildDeterministicOpening,
  buildOpeningActionChips,
  buildRecoveredOpening,
  ensureOpeningActionLine,
} from '../teaching-session-views';
import type { TeachingScenarioContext } from '../TeachingContextBuilder';
import type { TeachingSessionRecord } from '../TeachingSessionRepository';
import type { TeachingOpening } from '../AITeachingCoordinator';

const context = {
  subject: '数据分析',
  topic: '用四列 Excel 跑出月度报告',
  taskTitle: '在 8 行导出样本上认全四列',
  taskType: 'practice',
  taskProfile: { coreConcept: '退款口径', learningObjectives: [] },
} as unknown as TeachingScenarioContext;

const texts = (opening: { quickReplies: Array<{ text: string }> }) => opening.quickReplies.map((q) => q.text);

describe('ensureOpeningActionLine：开场恒有可点动作', () => {
  it('模型省略 quickReplies 时按本课核心概念补齐，并保留无动作词的 question', () => {
    const result = ensureOpeningActionLine({
      message: '你手上那份表就四列。',
      question: '看着这四列，你觉得哪一列最容易被算错？',
      quickReplies: [],
      mode: 'self-assess',
    }, context);

    expect(result.quickReplies.length).toBeGreaterThan(0);
    expect(texts(result)).toContain('先讲「退款口径」');
    expect(result.question).toBe('看着这四列，你觉得哪一列最容易被算错？');
    expect(result.mode).toBe('self-assess');
  });

  it('question 里出现动作指向词（没有对应控件）时整句丢弃', () => {
    const result = ensureOpeningActionLine({
      message: '开场定位。',
      question: '看着这四列，你觉得哪一列最容易被算错？也可以直接往下走。',
      quickReplies: [],
      mode: 'self-assess',
    }, context);

    expect(result.question).toBe('');
    expect(result.quickReplies.length).toBeGreaterThan(0);
  });

  it('模型给了动作时原样保留，且截断到 3 条、兼容 string[] 与空项', () => {
    const result = ensureOpeningActionLine({
      message: '开场定位。',
      quickReplies: ['  拿 8 行样本试一遍 ', '', '先讲「退款口径」', '看一个渠道汇总的例子', '第 4 条应被丢弃'] as unknown as Array<{ text: string }>,
      mode: 'predict',
    }, context);

    expect(result.quickReplies).toEqual([
      { text: '拿 8 行样本试一遍' },
      { text: '先讲「退款口径」' },
      { text: '看一个渠道汇总的例子' },
    ]);
    expect(result.mode).toBe('predict');
  });

  it('mode 非法时回落到 example-first', () => {
    const result = ensureOpeningActionLine(
      { message: 'm', quickReplies: [], mode: 'bogus' as unknown as TeachingOpening['mode'] },
      context,
    );
    expect(result.mode).toBe('example-first');
  });
});

describe('确定性开场不再输出万能空话', () => {
  it('buildDeterministicOpening 的动作带本课核心概念', () => {
    const opening = buildDeterministicOpening(context);
    const actionTexts = texts(opening);
    expect(actionTexts.length).toBeGreaterThan(0);
    expect(actionTexts.join('|')).toContain('退款口径');
    expect(actionTexts).not.toContain('准备好了，开始');
    expect(actionTexts).not.toContain('继续往下讲');
  });

  it('buildRecoveredOpening 的动作带本课主题', () => {
    const opening = buildRecoveredOpening({ topic: '用四列 Excel 跑出月度报告' } as unknown as TeachingSessionRecord);
    expect(texts(opening).join('|')).toContain('用四列');
    expect(texts(opening)).not.toContain('继续上次进度');
  });

  it('补齐动作的文案不超过 14 字（按钮可读性）', () => {
    for (const mode of ['example-first', 'predict', 'self-assess'] as const) {
      for (const chip of buildOpeningActionChips(context, mode)) {
        expect(chip.text.length).toBeLessThanOrEqual(14);
      }
    }
  });
});
/**
 * 开场 question 的「答不了」两形态（2026-11-02 实测，与 test 1 两条并列）。
 *
 * 实跑原样：开场白「这节课拿六个考试句子，把「时间标志词」和「动作性质」变成你排除选项的依据。」
 * 下一行问「「since 2019」和「last Friday」在你眼里是同一类信号吗？」，页面只有三个动作 chip：
 * 先讲「时间标志词」/拿第1句试标信号/跳过自评，直接练六句。
 * 学生：这两个表达式从哪来？这句话要我怎么答？「自评」哪来的？
 */
describe('ensureOpeningActionLine：开场不出答不了的题', () => {
  const realMessage = '你之前说，选项看着都像对的，最后只能凭语感选。这节课拿六个考试句子，把「时间标志词」和「动作性质」变成你排除选项的依据。';

  it('实测那句判答式 + 引用未展示材料的 question → 丢弃，且 chip 里悬空的「自评」被剥掉', () => {
    const result = ensureOpeningActionLine({
      message: realMessage,
      question: '「since 2019」和「last Friday」在你眼里是同一类信号吗？',
      quickReplies: [
        { text: '先讲「时间标志词」' },
        { text: '拿第1句试标信号' },
        { text: '跳过自评，直接练六句' },
      ],
      mode: 'self-assess',
    }, context);

    expect(result.question).toBe('');
    expect(texts(result)).toEqual(['先讲「时间标志词」', '拿第1句试标信号', '直接练六句']);
  });

  it('问学习者自身习惯的开放性引导（引用他自述的困扰）→ 保留', () => {
    const result = ensureOpeningActionLine({
      message: realMessage,
      question: '你平时做题时，是先看时间词还是先凭语感选？',
      quickReplies: [{ text: '先讲「时间标志词」' }],
      mode: 'self-assess',
    }, context);
    expect(result.question).toBe('你平时做题时，是先看时间词还是先凭语感选？');
  });

  it('引号里的材料若本屏已经出现过 → 保留（不是「未展示材料」）', () => {
    const result = ensureOpeningActionLine({
      message: '这节课拿六个句子，先看第一句 「I have already finished the report」。',
      question: '看到 「I have already finished the report」 里的 already，你想到了什么？',
      quickReplies: [{ text: '先讲「时间标志词」' }],
      mode: 'self-assess',
    }, context);
    expect(result.question).toContain('already');
  });

  it('无引号的判答式提问（是不是/对吗/哪一类）→ 丢弃', () => {
    for (const q of ['这两个信号是不是同一类？', '这样判断对吗？', '它属于哪一类时态？']) {
      const result = ensureOpeningActionLine({
        message: realMessage,
        question: q,
        quickReplies: [{ text: '先讲「时间标志词」' }],
        mode: 'self-assess',
      }, context);
      expect(result.question).toBe('');
    }
  });

  it('question 被丢且模型没给 action 时，确定性自评 chip 也不留悬空的「自评」', () => {
    const result = ensureOpeningActionLine({
      message: realMessage,
      question: '这两个信号是不是同一类？',
      quickReplies: [],
      mode: 'self-assess',
    }, context);
    expect(result.question).toBe('');
    expect(texts(result).join('|')).not.toContain('自评');
    expect(result.quickReplies.length).toBeGreaterThan(0);
  });
});

/**
 * 开场引导的「两种形态」收敛（2026-11-02 走查：同一节课出现两个一样的问题）。
 * 根因两条：① 落库正文曾把 question 拼进 message（面板一行 + 气泡里又一句）；
 * ② message 与 question 同为空/同时有值时，同一句话占了两个渲染位。
 */
describe('ensureOpeningActionLine：message 与 question 不重复承载同一句', () => {
  it('message 缺失时由 question 顶替，question 位清空（同一句只占一个渲染位）', () => {
    const result = ensureOpeningActionLine({
      message: '',
      question: '你平时做这类题，是先找时间词还是先凭语感？',
      quickReplies: [{ text: '先讲「时间标志词」' }],
      mode: 'self-assess',
    }, context);

    expect(result.message).toBe('你平时做这类题，是先找时间词还是先凭语感？');
    expect(result.question).toBe('');
    // 没有 question 时，chip 里悬空的「自评」也一并剥掉
    expect(texts(result).join('|')).not.toContain('自评');
  });

  it('message 与 question 同时在场：各占一位（气泡=定位，面板=引导）', () => {
    const result = ensureOpeningActionLine({
      message: '这节课拿六个句子练一件事。',
      question: '你平时做这类题，是先扫时间词还是先凭语感？',
      quickReplies: [{ text: '先讲「时间标志词」' }],
      mode: 'self-assess',
    }, context);

    expect(result.message).toBe('这节课拿六个句子练一件事。');
    expect(result.question).toBe('你平时做这类题，是先扫时间词还是先凭语感？');
    // 两者互不包含：任何一侧都不该把另一侧抄一遍
    expect(result.message).not.toContain(result.question);
  });

  it('message 与 question 都为空时给出可渲染的空态（不留 undefined 字面量）', () => {
    const result = ensureOpeningActionLine({ message: '', question: '', quickReplies: [], mode: 'self-assess' }, context);
    expect(result.message).toBe('');
    expect(result.question).toBe('');
    expect(result.quickReplies.length).toBeGreaterThan(0);
  });
});
