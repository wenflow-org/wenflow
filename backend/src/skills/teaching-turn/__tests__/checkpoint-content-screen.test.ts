/* eslint-disable @typescript-eslint/no-explicit-any -- 检查点出口探针：模型 I/O 载荷形状内在动态（对齐 evidence-verbatim 先例） */
/**
 * 检查点出口内容正确性筛查（内容正确性第二刀，2026-10-08）。
 *
 * 覆盖两道确定性闸门（均在归一化出口 screenCheckpointOutput 接线）：
 * ① 题面/选项算式复算（MODEL_ARITHMETIC_MISMATCH）：命中 → 整题丢弃，本轮回退为不出题
 *    （丢检查点比带错题放行安全——错算式是学生长期可见、会被记住的内容）；
 * ② 简答答案键泄漏（MODEL_ANSWER_LEAK）：要点写法照抄学生可见文本（题干/选项/hint/reply）
 *    即可骗过判分 → 该要点剔除；全部剔除 → 降级为无标准键（expectedKeywords 字段省略，
 *    judgeCheckpointAnswer 返回 null → judgedBy='model-reference'）。
 * 概念名豁免：考点即概念名（每个写法归一后都等于归属概念名）的「说出概念名」型简答不误杀。
 *
 * 遥测 mock：recordDegradation 真实现会落库 degradation_events——测试绝不能碰 dev.db。
 */
const mockRecordDegradation = jest.fn();

jest.mock('../../degradation-telemetry', () => ({ recordDegradation: mockRecordDegradation }));
jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: jest.fn() }));

import {
  filterAnswerLeakingKeywords,
  findCheckpointArithmeticMismatches,
  screenCheckpointOutput,
} from '../index';

beforeEach(() => {
  mockRecordDegradation.mockClear();
});

describe('findCheckpointArithmeticMismatches（题面/选项算式复算）', () => {
  it('题面错式命中：728 ÷ 26 = 130（宽域 A 轨 P0 同型）', () => {
    const ms = findCheckpointArithmeticMismatches('先用 728 ÷ 26 = 130 演示，再回答：商是多少？');
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ stated: 130, actual: 28 });
  });

  it('选项文本错式命中', () => {
    const ms = findCheckpointArithmeticMismatches('每箱 6 个，7 箱一共多少个？', [
      { id: 'A', text: '6 × 7 = 43 个' },
      { id: 'B', text: '6 × 7 = 42 个' },
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0].stated).toBe(43);
  });

  it('正确算式与纯文字题面不报', () => {
    expect(findCheckpointArithmeticMismatches('728 ÷ 26 = 28，这个商说明什么？')).toHaveLength(0);
    expect(findCheckpointArithmeticMismatches('请说出快速排序的核心思想。', [
      { id: 'A', text: '分治' },
      { id: 'B', text: '贪心' },
    ])).toHaveLength(0);
  });
});

describe('filterAnswerLeakingKeywords（答案键泄漏检测，与判分同口径）', () => {
  it('命中剔除：题干里的「手动」照抄即可命中判分 → 整个要点剔除，其余保留', () => {
    const { keptKeywords, leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['手动', '重新|重填'],
      visibleTexts: ['为什么要手动复制粘贴？这样做有什么风险？'],
    });
    expect(leakedKeywords).toEqual(['手动']);
    expect(keptKeywords).toEqual(['重新|重填']);
  });

  it('同义组整组剔除：组内任一写法泄漏即整组出局（判分是「任一写法出现即满足」）', () => {
    const { keptKeywords, leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['重新|重填'],
      visibleTexts: ['可以先重填一遍表单试试。'],
    });
    expect(leakedKeywords).toEqual(['重新|重填']);
    expect(keptKeywords).toEqual([]);
  });

  it('reply 也是泄漏面：老师在讲解里说出答案', () => {
    const { leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['归并排序'],
      visibleTexts: ['我们今天讲归并排序，它先把数组拆到最小……', '归并排序的思路是什么？'],
    });
    expect(leakedKeywords).toEqual(['归并排序']);
  });

  it('与判分同口径：空白/标点差异不构成逃逸（normalizeForKeywordMatch 归一后包含判定）', () => {
    const { leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['重新 保存'],
      visibleTexts: ['修改后要重新、保存文档。'],
    });
    expect(leakedKeywords).toEqual(['重新 保存']);
  });

  it('概念名豁免：考点即概念名（说出概念名型简答），题干/reply 提到概念不误杀', () => {
    const { keptKeywords, leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['快速排序'],
      visibleTexts: ['我们刚学了快速排序。请说出：这种排序方法叫什么名字？'],
      conceptName: '快速排序',
    });
    expect(leakedKeywords).toEqual([]);
    expect(keptKeywords).toEqual(['快速排序']);
  });

  it('豁免是严格版：同义组混入非概念名写法时不豁免（照抄仍可骗过判分）', () => {
    const { keptKeywords, leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['快速排序|快排'],
      visibleTexts: ['我们刚学了快速排序。这种方法的别称叫什么？'],
      conceptName: '快速排序',
    });
    expect(leakedKeywords).toEqual(['快速排序|快排']);
    expect(keptKeywords).toEqual([]);
  });

  it('无归属概念名（conceptName 缺省）时不豁免', () => {
    const { leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: ['快速排序'],
      visibleTexts: ['快速排序适合什么场景？'],
      conceptName: null,
    });
    expect(leakedKeywords).toEqual(['快速排序']);
  });
});

describe('screenCheckpointOutput（归一化出口接线）', () => {
  const base = {
    question: '请说出：循环里忘了更新条件会导致什么问题？',
    type: 'short_answer' as const,
    expectedKeywords: ['死循环', '退出|跳出'],
  };

  it('算式命中 → 丢弃检查点（返回 null）+ MODEL_ARITHMETIC_MISMATCH 遥测（source 标 checkpoint 出口）', () => {
    const result = screenCheckpointOutput({
      ...base,
      question: '先看 728 ÷ 26 = 130 的例子，再回答：循环里忘了更新条件会导致什么问题？',
    }, '我们继续往下看。');
    expect(result).toBeNull();
    expect(mockRecordDegradation).toHaveBeenCalledTimes(1);
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-teaching/teaching-turn-checkpoint',
      faultCategory: 'MODEL_ARITHMETIC_MISMATCH',
      mitigationApplied: 'drop-checkpoint-skip-question-this-turn',
    }));
  });

  it('部分要点泄漏 → 剔除泄漏要点保留其余 + MODEL_ANSWER_LEAK 遥测', () => {
    const result = screenCheckpointOutput({
      ...base,
      question: '死循环是什么？循环里忘了更新条件会导致什么问题？',
    }, '我们继续往下看。');
    expect(result).not.toBeNull();
    expect(result?.expectedKeywords).toEqual(['退出|跳出']);
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-teaching/teaching-turn-checkpoint',
      faultCategory: 'MODEL_ANSWER_LEAK',
      mitigationApplied: 'strip-leaked-keywords',
    }));
  });

  it('全部要点泄漏 → 降级为无标准键（expectedKeywords 字段省略 = model-reference 形态）', () => {
    const result = screenCheckpointOutput({
      ...base,
      hint: '想想死循环，以及怎么退出循环。',
    }, '我们聊聊死循环和怎么退出循环。');
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('expectedKeywords');
    expect(result?.question).toBe(base.question);
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      faultCategory: 'MODEL_ANSWER_LEAK',
      mitigationApplied: 'drop-answer-key-model-reference',
    }));
  });

  it('概念名豁免 + 干净题面 → 原样保留、零遥测', () => {
    const checkpoint = {
      question: '请说出：这种排序方法叫什么名字？',
      type: 'short_answer' as const,
      expectedKeywords: ['快速排序'],
    };
    const result = screenCheckpointOutput(checkpoint, '我们刚学了快速排序的思想。', '快速排序');
    expect(result).toEqual({ ...checkpoint });
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  });

  it('选择题题面干净 → 原样透传（答案键筛查看不见、不干预 correctOptionIds）', () => {
    const checkpoint = {
      question: '6 × 7 = 多少？',
      type: 'single_choice' as const,
      options: [{ id: 'A', text: '42' }, { id: 'B', text: '43' }],
      correctOptionIds: ['A'],
    };
    const result = screenCheckpointOutput(checkpoint, '我们来算一算。');
    expect(result).toEqual(checkpoint);
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  });
});
