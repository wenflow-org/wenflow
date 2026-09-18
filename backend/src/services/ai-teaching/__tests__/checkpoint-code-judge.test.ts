/**
 * 检查点**代码裁决**（独立传感器）与答案键剥离。
 *
 * 背景（审计 §7 P1-1 / §5.3）：此前 `passed` 由 `completionReady || 当前点已判 mastered` 反推——
 * 答案是模型自己的判断，于是"检查点通过率"与"模型认为学习者懂不懂"是同一条序列（自证回路）。
 * 有了答案键，对错由代码判定，才是可用于闭环控制的独立观测量。
 */
import { judgeCheckpointAnswer, stripCheckpointAnswerKeys, checkpointForMessageResult, inheritTeachingState } from '../AITeachingCoordinator';

describe('judgeCheckpointAnswer：选择题按答案键做集合比对', () => {
  const single = { type: 'single_choice' as const, correctOptionIds: ['B'] };

  it('单选：恰好选中正确项 → 通过', () => {
    expect(judgeCheckpointAnswer(single, { selectedOptionIds: ['B'] })).toMatchObject({ judgedBy: 'code', passed: true });
  });

  it('单选：选错 → 不通过（并给出可复核的 detail）', () => {
    const judgement = judgeCheckpointAnswer(single, { selectedOptionIds: ['A'] });
    expect(judgement).toMatchObject({ judgedBy: 'code', passed: false });
    expect(judgement!.detail).toContain('B');
  });

  it('多选：集合相等才通过（多选/少选/错选都不通过）', () => {
    const multi = { type: 'multi_choice' as const, correctOptionIds: ['A', 'C'] };
    expect(judgeCheckpointAnswer(multi, { selectedOptionIds: ['C', 'A'] })).toMatchObject({ passed: true });
    expect(judgeCheckpointAnswer(multi, { selectedOptionIds: ['A'] })).toMatchObject({ passed: false });
    expect(judgeCheckpointAnswer(multi, { selectedOptionIds: ['A', 'B', 'C'] })).toMatchObject({ passed: false });
  });

  it('大小写/空白容错（id 归一化）', () => {
    expect(judgeCheckpointAnswer(single, { selectedOptionIds: [' b '] })).toMatchObject({ passed: true });
  });

  it('没有答案键 → 返回 null（不假装独立，交由调用方标 judgedBy=model-reference）', () => {
    expect(judgeCheckpointAnswer({ type: 'single_choice' }, { selectedOptionIds: ['B'] })).toBeNull();
    expect(judgeCheckpointAnswer({ type: 'short_answer' }, { answerText: '随便' })).toBeNull();
  });
});

describe('judgeCheckpointAnswer：简答按要点做保守包含判定', () => {
  const short = { type: 'short_answer' as const, expectedKeywords: ['事实', '数据', '类比'] };

  it('要点齐全 → 通过（忽略空白与标点、大小写不敏感）', () => {
    const judgement = judgeCheckpointAnswer(short, { answerText: '论据分三类：事实、数据，还有类比。' });
    expect(judgement).toMatchObject({ judgedBy: 'code', passed: true });
  });

  it('缺要点 → 不通过，并点出缺了哪些（宁漏判不误判）', () => {
    const judgement = judgeCheckpointAnswer(short, { answerText: '有事实和数据。' });
    expect(judgement).toMatchObject({ judgedBy: 'code', passed: false });
    expect(judgement!.detail).toContain('类比');
  });

  it('空作答 → 不通过', () => {
    expect(judgeCheckpointAnswer(short, {})).toMatchObject({ passed: false });
  });

  it('空白要点被忽略（不因脏数据把所有人判失败）', () => {
    expect(judgeCheckpointAnswer({ type: 'short_answer', expectedKeywords: ['  ', '事实'] }, { answerText: '事实' }))
      .toMatchObject({ passed: true });
  });
});

describe('stripCheckpointAnswerKeys：答案键绝不下发', () => {
  const state = {
    pendingCheckpoint: { id: 'cp1', question: 'Q', correctOptionIds: ['B'], expectedKeywords: ['事实'] },
    sessionArtifacts: { pendingCheckpoint: { id: 'cp1', correctOptionIds: ['B'] }, other: 1 },
    other: 'kept',
  };

  it('剥离 pendingCheckpoint（含 sessionArtifacts 里的一份），其余字段不动', () => {
    const safe = stripCheckpointAnswerKeys(state)!;
    expect(safe.pendingCheckpoint).toEqual({ id: 'cp1', question: 'Q' });
    expect(safe.sessionArtifacts.pendingCheckpoint).toEqual({ id: 'cp1' });
    expect(safe.sessionArtifacts.other).toBe(1);
    expect(safe.other).toBe('kept');
  });

  it('不修改原对象（纯函数）', () => {
    stripCheckpointAnswerKeys(state);
    expect(state.pendingCheckpoint.correctOptionIds).toEqual(['B']);
  });

  it('空/非对象输入原样返回', () => {
    expect(stripCheckpointAnswerKeys(null)).toBeNull();
    expect(stripCheckpointAnswerKeys(undefined)).toBeUndefined();
  });
});

describe('checkpointForMessageResult：消息响应出口也剥离答案键（18 号报告 N1）', () => {
  it('顶层 pendingCheckpoint 带答案键时，下发版本不含 correctOptionIds/expectedKeywords', () => {
    const out = checkpointForMessageResult({
      pendingCheckpoint: { id: 'cp1', question: 'Q', type: 'single_choice', correctOptionIds: ['B'], expectedKeywords: ['事实'] },
    });
    expect(out).toEqual({ id: 'cp1', question: 'Q', type: 'single_choice' });
    expect(out).not.toHaveProperty('correctOptionIds');
    expect(out).not.toHaveProperty('expectedKeywords');
  });

  it('只在 sessionArtifacts 里存了一份时同样剥离', () => {
    const out = checkpointForMessageResult({
      sessionArtifacts: { pendingCheckpoint: { id: 'cp2', correctOptionIds: ['A'] } },
    });
    expect(out).toEqual({ id: 'cp2' });
  });

  it('无检查点 → null', () => {
    expect(checkpointForMessageResult(null)).toBeNull();
    expect(checkpointForMessageResult({})).toBeNull();
  });
});

describe('inheritTeachingState：跨回合继承顶层状态（18 号报告 N2）', () => {
  it('继承上一回合的 pendingCheckpoint / lastCheckpointTurn / checkpointHistory', () => {
    const prev = {
      pendingCheckpoint: { id: 'cp1', correctOptionIds: ['B'] },
      lastCheckpointTurn: 5,
      checkpointHistory: [{ checkpointId: 'cp0', passed: true }],
      lss: 3,
    };
    const next = inheritTeachingState(prev, { lss: 4, analysis: { understanding: 0.7 } });

    expect(next.pendingCheckpoint).toEqual({ id: 'cp1', correctOptionIds: ['B'] });
    expect(next.lastCheckpointTurn).toBe(5);
    expect(next.checkpointHistory).toHaveLength(1);
    // 本回合字段覆盖旧值
    expect(next.lss).toBe(4);
    expect(next.analysis).toEqual({ understanding: 0.7 });
  });

  it('无上一回合状态时等价于本回合字段', () => {
    expect(inheritTeachingState(null, { a: 1 })).toEqual({ a: 1 });
    expect(inheritTeachingState(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});