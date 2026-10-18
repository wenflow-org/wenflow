/**
 * 相邻轮低增量重复护栏单测（issue #103 / E-02）。
 * 样本取自真实教学话术形态（讲解 + 布置动作），阈值行为用实测 Jaccard 钉死；
 * 数字由 r6post-eval.mjs 同口径的归一化/三元组算得（见各用例注释）。
 */
import {
  ADJACENT_REPEAT_JACCARD_THRESHOLD,
  ADJACENT_REPEAT_MAX_NOVEL_RATIO,
  ADJACENT_REPEAT_MIN_CHARS,
  assessAdjacentRepetition,
  findPreviousAssistantReply,
  isRetrievalOrConsolidationQuestion,
  normalizeReplyForSimilarity,
  replyTrigrams,
  trigramJaccard,
} from '../teaching-repetition-guard';

const BASE =
  '这一题我们先把分母里的那个二提出来，先看括号内的部分怎么化简，再处理括号外的部分，最后把两段结果合并起来。你按这个顺序走一遍，把每一步都写出来。';
/** 同一信息的换措辞版（Jaccard 0.65 / 新三元组 26%） */
const PARAPHRASE =
  '这一题我换个说法再讲一遍：我们先把分母里的那个二提出来，再看括号内的部分怎么化简，然后处理括号外的部分，最后把两段结果合并起来。你按这个顺序走一遍，每一步都写出来。';
/** 完整复述上一轮、末尾补一句真新增（Jaccard 0.61 / 新三元组 39%） */
const INCREMENT =
  '这一题我们先把分母里的那个二提出来，先看括号内的部分怎么化简，再处理括号外的部分，最后把两段结果合并起来。你按这个顺序走一遍，把每一步都写出来。接着看第二问：如果括号前面是减号，去掉括号以后里面每一项的符号都要变，这一点和刚才不一样。';
/** 同一话题但换了教法、引入新信息（Jaccard 0） */
const DISTINCT =
  '换个角度想：如果两个分数的分母相同，分子就直接相加，分母不用动，最后再看看能不能约分。你先拿这道题试一下，把结果写在下面。';
/** 与 BASE 高度重合但只把收尾改掉（Jaccard 0.4795 → 低于阈值） */
const BELOW_THRESHOLD =
  '这一题我们先把分母里的那个二提出来，先看括号内的部分怎么化简，再处理括号外的部分，看看有没有更快的写法。';
/** 检索/巩固式提问（与 BASE 近乎同文：Jaccard 0.83，但属提示词允许的例外） */
const RETRIEVAL_QUESTION =
  '你先用自己的话复述一遍：这一题我们先把分母里的那个二提出来，先看括号内的部分怎么化简，再处理括号外的部分，最后把两段结果合并起来，你按这个顺序走一遍，把每一步都写出来，好吗？';

describe('teaching-repetition-guard 纯函数判据', () => {
  it('归一化：去 Markdown/标点/空白并小写（与 r6post-eval.mjs normText 同口径）', () => {
    expect(normalizeReplyForSimilarity('**先看** 括号内，再处理（括号外）。')).toBe('先看括号内再处理括号外');
    expect(normalizeReplyForSimilarity(null)).toBe('');
    expect(normalizeReplyForSimilarity(undefined)).toBe('');
  });

  it('三元组与 Jaccard：同一集合为 1、无交集为 0、空集为 0', () => {
    const grams = replyTrigrams('abcde');
    expect([...grams].sort()).toEqual(['abc', 'bcd', 'cde']);
    expect(trigramJaccard(grams, replyTrigrams('abcde'))).toBe(1);
    expect(trigramJaccard(grams, replyTrigrams('xyz'))).toBe(0);
    expect(trigramJaccard(new Set(), grams)).toBe(0);
  });

  it('检索/巩固式提问判据：需同时有问号与检索线索词', () => {
    expect(isRetrievalOrConsolidationQuestion(RETRIEVAL_QUESTION)).toBe(true);
    expect(isRetrievalOrConsolidationQuestion('这道题分母相同的时候，分子怎么处理？')).toBe(false);
    expect(isRetrievalOrConsolidationQuestion('我们回顾一下刚才的结论。')).toBe(false);
  });
});

describe('assessAdjacentRepetition 相邻轮判定', () => {
  it('两轮几乎同文 → 低增量重复（Jaccard 1、新三元组 0）', () => {
    const result = assessAdjacentRepetition(BASE, BASE);
    expect(result.lowIncrement).toBe(true);
    expect(result.reason).toBe('low-increment-repeat');
    expect(result.jaccard).toBe(1);
    expect(result.novelRatio).toBe(0);
  });

  it('换措辞复述同一信息 → 仍判低增量重复（措辞变化不构成豁免）', () => {
    const result = assessAdjacentRepetition(BASE, PARAPHRASE);
    expect(result.jaccard).toBeGreaterThanOrEqual(ADJACENT_REPEAT_JACCARD_THRESHOLD);
    expect(result.novelRatio).toBeLessThanOrEqual(ADJACENT_REPEAT_MAX_NOVEL_RATIO);
    expect(result.lowIncrement).toBe(true);
    expect(result.reason).toBe('low-increment-repeat');
  });

  it('复述上一轮但末尾补了真新增 → 不告警（新三元组占比超上限）', () => {
    const result = assessAdjacentRepetition(BASE, INCREMENT);
    expect(result.jaccard).toBeGreaterThanOrEqual(ADJACENT_REPEAT_JACCARD_THRESHOLD);
    expect(result.novelRatio).toBeGreaterThan(ADJACENT_REPEAT_MAX_NOVEL_RATIO);
    expect(result.lowIncrement).toBe(false);
    expect(result.reason).toBe('distinct');
  });

  it('同一话题换成新教法 → 不告警', () => {
    const result = assessAdjacentRepetition(BASE, DISTINCT);
    expect(result.lowIncrement).toBe(false);
    expect(result.reason).toBe('distinct');
    expect(result.jaccard).toBe(0);
  });

  it('阈值边界：Jaccard 恰为 0.5 判重复，0.4795 不判（闭区间、低增量双条件）', () => {
    // 0.5 恰好在阈值上（闭区间）→ 命中；样本实测值由同口径三元组算得
    const atThreshold = BASE.replace(
      '最后把两段结果合并起来。你按这个顺序走一遍，把每一步都写出来。',
      '剩下的下次再说。'
    );
    const boundary = assessAdjacentRepetition(BASE, atThreshold);
    expect(boundary.jaccard).toBeCloseTo(ADJACENT_REPEAT_JACCARD_THRESHOLD, 4);
    expect(boundary.novelRatio).toBeLessThanOrEqual(ADJACENT_REPEAT_MAX_NOVEL_RATIO);
    expect(boundary.lowIncrement).toBe(true);

    const below = assessAdjacentRepetition(BASE, BELOW_THRESHOLD);
    expect(below.jaccard).toBeLessThan(ADJACENT_REPEAT_JACCARD_THRESHOLD);
    expect(below.lowIncrement).toBe(false);
    expect(below.reason).toBe('distinct');
  });

  it('检索/巩固式提问豁免：即使近乎同文也不告警（提示词允许的唯一例外）', () => {
    const result = assessAdjacentRepetition(BASE, RETRIEVAL_QUESTION);
    expect(result.jaccard).toBeGreaterThanOrEqual(ADJACENT_REPEAT_JACCARD_THRESHOLD);
    expect(result.novelRatio).toBeLessThanOrEqual(ADJACENT_REPEAT_MAX_NOVEL_RATIO);
    expect(result.lowIncrement).toBe(false);
    expect(result.reason).toBe('exempt-retrieval-question');
  });

  it('Markdown/标点差异不改变判定（仍是同一段话）', () => {
    const decorated = `**这一题** 我们先把分母里的那个二提出来，先看括号内的部分怎么化简，再处理括号外的部分，最后把两段结果合并起来。\n\n- 你按这个顺序走一遍，把每一步都写出来。`;
    const result = assessAdjacentRepetition(BASE, decorated);
    expect(result.jaccard).toBe(1);
    expect(result.lowIncrement).toBe(true);
  });

  it('短回复不判（长度低于下限，避免噪声告警）', () => {
    const result = assessAdjacentRepetition('好，你试试。', '对，继续。');
    expect(result.currentChars).toBeLessThan(ADJACENT_REPEAT_MIN_CHARS);
    expect(result.lowIncrement).toBe(false);
    expect(result.reason).toBe('too-short');
  });

  it('缺基准（首轮/空内容）不判', () => {
    const first = assessAdjacentRepetition(null, BASE);
    expect(first.lowIncrement).toBe(false);
    expect(first.reason).toBe('no-baseline');
    const empty = assessAdjacentRepetition(BASE, '   ');
    expect(empty.lowIncrement).toBe(false);
    expect(empty.reason).toBe('no-baseline');
  });
});

describe('findPreviousAssistantReply 取上一轮教师回复', () => {
  it('跳过末尾学生消息与空内容，取最近一条教师回复', () => {
    const messages = [
      { role: 'assistant', content: '第一轮讲解' },
      { role: 'user', content: '学生作答' },
      { role: 'assistant', content: '第二轮讲解' },
      { role: 'user', content: '学生再答' },
    ];
    expect(findPreviousAssistantReply(messages)).toBe('第二轮讲解');
  });

  it('跳过教师空内容行；无教师回复/非数组入参返回 null', () => {
    expect(findPreviousAssistantReply([{ role: 'assistant', content: '   ' }, { role: 'user', content: 'x' }])).toBeNull();
    expect(findPreviousAssistantReply([])).toBeNull();
    expect(findPreviousAssistantReply(null)).toBeNull();
  });
});
