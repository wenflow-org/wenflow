/**
 * 反馈首句必须与代码裁决同向（2026-11-26）。
 *
 * 实录 caseA：代码判对（passed=true），老师回复却以「这块还没对上——你选的是…」开头。
 * 既有的对称护栏只认「不对/错了/答错…」8 个词，「还没对上」不在词表里 → 原样放行。
 * 学生两次正确作答都被告知错了，随后改口成错误答案、又被表扬。
 */
import { describeCorrectAnswer, ensureVerdictOpening, repairContradictedPassedVerdict } from '../checkpoint-feedback-guard';

describe('repairContradictedPassedVerdict：中文自然否定的变体', () => {
  it('实录 caseA：「这块还没对上」开头 + passed=true → 换成确定性确认', () => {
    const reply = '这块还没对上——你选的是「只到第一阶段」，但题目说检测不到 [H] 生成。你再想想第二阶段。';
    const out = repairContradictedPassedVerdict(reply);
    expect(out).toContain('对，这道答对了');
    expect(out).not.toContain('还没对上');
  });

  it('「差一步」「没接住」等同向否定也拦', () => {
    expect(repairContradictedPassedVerdict('这块还差一步——再看看第三阶段。')).toContain('对，这道答对了');
    expect(repairContradictedPassedVerdict('这个没接住——你再看一眼场所。')).toContain('对，这道答对了');
  });

  it('正常确认不误改；「差一点就对了」这类接近语不在首句否决之列时不改', () => {
    const ok = '对，这道答对了——你把碳的去向说清了。';
    expect(repairContradictedPassedVerdict(ok)).toBe(ok);
  });
});

describe('ensureVerdictOpening：首句没有裁决就补一句', () => {
  it('passed=true、首句没说对错 → 补「这题答对了。」，保留原话术', () => {
    const out = ensureVerdictOpening('你把碳的去向说清楚了，我们往下走。', true);
    expect(out).toBe('这题答对了。你把碳的去向说清楚了，我们往下走。');
  });

  it('passed=false、首句没说对错 → 补「这题还没对。」', () => {
    expect(ensureVerdictOpening('你选了 A，我们来看看第二阶段发生了什么。', false)).toBe('这题还没对。你选了 A，我们来看看第二阶段发生了什么。');
  });

  it('首句已明确给裁决 → 原样返回（肯定与否定各种说法）', () => {
    expect(ensureVerdictOpening('对，这道答对了——这一步你走稳了。', true)).toBe('对，这道答对了——这一步你走稳了。');
    expect(ensureVerdictOpening('没错，就是 B。', true)).toBe('没错，就是 B。');
    expect(ensureVerdictOpening('完全正确。接下来看一个新情境。', true)).toBe('完全正确。接下来看一个新情境。');
    expect(ensureVerdictOpening('这块还没对上——你选的是 A。', false)).toBe('这块还没对上——你选的是 A。');
    expect(ensureVerdictOpening('这题不对，正确的是 B。', false)).toBe('这题不对，正确的是 B。');
  });

  it('首句是问句 → 问句不是裁决，照样补', () => {
    expect(ensureVerdictOpening('你是怎么判断的？', false)).toBe('这题还没对。你是怎么判断的？');
  });

  it('裁决不在首句、而在后面 → 仍然补（裁决必须第一眼就看到）', () => {
    expect(ensureVerdictOpening('我们来看看第二阶段。这题其实还没对。', false)).toBe('这题还没对。我们来看看第二阶段。这题其实还没对。');
  });

  it('空回复原样返回', () => {
    expect(ensureVerdictOpening('', true)).toBe('');
    expect(ensureVerdictOpening(undefined, false)).toBe('');
  });
});

describe('describeCorrectAnswer：给老师的正确答案文本', () => {
  it('选择题：「B. 选项原文」；多选分号分隔；找不到选项原文时退回 id', () => {
    expect(describeCorrectAnswer({
      type: 'single_choice',
      options: [{ id: 'A', text: '只到第一阶段' }, { id: 'B', text: '至少第二阶段' }],
      correctOptionIds: ['B'],
    })).toBe('B. 至少第二阶段');
    expect(describeCorrectAnswer({
      type: 'multi_choice',
      options: [{ id: 'A', text: '甲' }, { id: 'C', text: '丙' }],
      correctOptionIds: ['A', 'C'],
    })).toBe('A. 甲；C. 丙');
    expect(describeCorrectAnswer({ type: 'single_choice', correctOptionIds: ['B'] })).toBe('B');
  });

  it('简答题给要点；没有答案键时 null', () => {
    expect(describeCorrectAnswer({ type: 'short_answer', expectedKeywords: ['线粒体基质|基质', '第二阶段'] })).toBe('线粒体基质|基质；第二阶段');
    expect(describeCorrectAnswer({ type: 'short_answer' })).toBeNull();
    expect(describeCorrectAnswer(null)).toBeNull();
  });
});
