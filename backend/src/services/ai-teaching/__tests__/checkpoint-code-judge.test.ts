/**
 * 检查点**代码裁决**（独立传感器）与答案键剥离。
 *
 * 背景（审计 §7 P1-1 / §5.3）：此前 `passed` 由 `completionReady || 当前点已判 mastered` 反推——
 * 答案是模型自己的判断，于是"检查点通过率"与"模型认为学习者懂不懂"是同一条序列（自证回路）。
 * 有了答案键，对错由代码判定，才是可用于闭环控制的独立观测量。
 */
import { judgeCheckpointAnswer, stripCheckpointAnswerKeys, checkpointForMessageResult, inheritTeachingState } from '../AITeachingCoordinator';
import { getPendingCheckpoint, normalizeCheckpointShape } from '../teaching-checkpoint';

describe('normalizeCheckpointShape：简答带选项的混合形状', () => {
  const options = [
    { id: 'A', text: 'I am waiting for the server specs' },
    { id: 'B', text: 'I am waiting on the server specs' },
  ];

  it('short_answer + 选项 + 单答案键 → single_choice', () => {
    expect(normalizeCheckpointShape({
      type: 'short_answer',
      options,
      correctOptionIds: ['B'],
      expectedKeywords: ['resolve', 'request'],
    }).type).toBe('single_choice');
  });

  it('short_answer + 选项 + 多答案键 → multi_choice', () => {
    expect(normalizeCheckpointShape({
      type: 'short_answer',
      options,
      correctOptionIds: ['A', 'B'],
    }).type).toBe('multi_choice');
  });

  it('归一后的混合题按选项答案键判分（不再走空 answerText 的简答分支）', () => {
    const mixed = {
      type: 'short_answer' as const,
      question: 'I am ______ on the server specs',
      options,
      correctOptionIds: ['B'],
      expectedKeywords: ['resolve', 'request'],
    };
    expect(judgeCheckpointAnswer(mixed, { selectedOptionIds: ['B'] }))
      .toMatchObject({ judgedBy: 'code', passed: true });
    expect(judgeCheckpointAnswer(mixed, { selectedOptionIds: ['A'] }))
      .toMatchObject({ judgedBy: 'code', passed: false });
  });

  it('无选项的简答保持原样', () => {
    const short = { type: 'short_answer' as const, expectedKeywords: ['事实'] };
    expect(normalizeCheckpointShape(short)).toBe(short);
  });

  it('读取待答检查点时同样归一，旧会话里的混合形状也能恢复', () => {
    const pending = getPendingCheckpoint({
      pendingCheckpoint: {
        id: 'cp-old',
        type: 'short_answer',
        title: '旧题',
        question: '旧题',
        options,
        correctOptionIds: ['B'],
      },
    });
    expect(pending?.type).toBe('single_choice');
  });
});

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

describe('judgeCheckpointAnswer：简答要点同义组（全量测试报告 #14 复盘）', () => {
  it('「甲|乙」任一写法命中即算该要点满足；要点之间仍须全部满足', () => {
    const grouped = { type: 'short_answer' as const, expectedKeywords: ['重新|重填', '复制|拷贝'] };

    expect(judgeCheckpointAnswer(grouped, { answerText: '把上个月的表复制一份，数字重填一遍' }))
      .toMatchObject({ judgedBy: 'code', passed: true });
    // 第二组两种写法都没出现 → 仍判不通过，并原样列出同义组
    const missed = judgeCheckpointAnswer(grouped, { answerText: '把数字重新填一遍就行' });
    expect(missed).toMatchObject({ passed: false });
    expect(missed!.detail).toContain('复制/拷贝');
  });

  it('真实复盘：字面判负的答法在「同义组」下判通过（学生说「还得再…」，非逐字复述「再做」）', () => {
    const checkpoint = {
      type: 'short_answer' as const,
      expectedKeywords: ['重新|重填|再填', '再做|重做|还得'],
    };
    const answerText = '下个月还得把上个月那张表复制一份，产量那列的数重新填一遍。';
    expect(judgeCheckpointAnswer(checkpoint, { answerText })).toMatchObject({ passed: true });
    // 对照组：逐字版要点（旧语义）对同一作答判负——同义组消灭这一类误判
    expect(judgeCheckpointAnswer(
      { type: 'short_answer', expectedKeywords: ['重新', '再做'] },
      { answerText }
    )).toMatchObject({ passed: false });
  });

  it('全角竖线｜同样支持', () => {
    expect(judgeCheckpointAnswer(
      { type: 'short_answer', expectedKeywords: ['重新｜重填'] },
      { answerText: '重填一遍' }
    )).toMatchObject({ passed: true });
  });
});

describe('stripCheckpointAnswerKeys：答案键绝不下发', () => {
  const state = {
    pendingCheckpoint: { id: 'cp1', question: 'Q', correctOptionIds: ['B'], expectedKeywords: ['事实'] },
    sessionArtifacts: { pendingCheckpoint: { id: 'cp1', correctOptionIds: ['B'] }, other: 1 },
    checkpointHistory: [
      {
        checkpointId: 'cp0',
        question: '历史题',
        options: [{ id: 'A', text: '选项 A' }, { id: 'B', text: '选项 B' }],
        selectedOptionIds: ['B'],
        correctOptionIds: ['B'],
        passed: true,
      },
    ],
    other: 'kept',
  };

  it('剥离 pendingCheckpoint（含 sessionArtifacts 里的一份），其余字段不动', () => {
    const safe = stripCheckpointAnswerKeys(state)!;
    expect(safe.pendingCheckpoint).toEqual({ id: 'cp1', question: 'Q' });
    expect(safe.sessionArtifacts.pendingCheckpoint).toEqual({ id: 'cp1' });
    expect(safe.sessionArtifacts.other).toBe(1);
    expect(safe.other).toBe('kept');
  });

  it('checkpointHistory 也剥离答案键，但保留选项与学员选择（课后报告需要）', () => {
    const safe = stripCheckpointAnswerKeys(state)!;
    expect(safe.checkpointHistory[0]).toEqual({
      checkpointId: 'cp0',
      question: '历史题',
      options: [{ id: 'A', text: '选项 A' }, { id: 'B', text: '选项 B' }],
      selectedOptionIds: ['B'],
      passed: true,
    });
    expect(safe.checkpointHistory[0].correctOptionIds).toBeUndefined();
  });

  it('不修改原对象（纯函数）', () => {
    stripCheckpointAnswerKeys(state);
    expect(state.pendingCheckpoint.correctOptionIds).toEqual(['B']);
    expect(state.checkpointHistory[0].correctOptionIds).toEqual(['B']);
  });

  it('空/非对象输入原样返回', () => {
    expect(stripCheckpointAnswerKeys(null)).toBeNull();
    expect(stripCheckpointAnswerKeys(undefined)).toBeUndefined();
  });
});

/**
 * #240：`/detail` 的 `state.lastRuntimeEnvelope.artifact.control.checkpoint` 整份未剥。
 * 写侧把**模型原始输出**存进 `teachingState.lastRuntimeEnvelope`（teaching-turn-engine.ts:1316），
 * 而答案键白名单只覆盖了 pendingCheckpoint / checkpointHistory / sessionArtifacts 三处。
 * 下面的 fixture 就是真实行的形状（dev.db 三会话实测：pending 已剥、env 仍为 ["B"]）。
 */
describe('stripCheckpointAnswerKeys：结构无关剥离（#240 泄漏回归）', () => {
  interface OptionShape { id: string; text: string }
  /** 检查点（含答案键）在状态树里出现处的通用形状。 */
  type CheckpointShape = Record<string, unknown> & {
    id?: string;
    question?: string;
    options?: OptionShape[];
    hint?: string;
    correctOptionIds?: string[];
    expectedKeywords?: string[];
  };
  interface HistoryShape extends CheckpointShape {
    checkpointId?: string;
    selectedOptionIds?: string[];
    submittedOptionIds?: string[];
    passed?: boolean;
    skipped?: boolean;
  }
  interface EnvelopeShape {
    businessState: { phase: string; isTerminal: boolean };
    artifact: { control: { checkpoint: CheckpointShape } & CheckpointShape; reply: string };
  }
  interface LeakedStateShape extends Record<string, unknown> {
    pendingCheckpoint: CheckpointShape;
    checkpointHistory: HistoryShape[];
    sessionArtifacts: { pendingCheckpoint: CheckpointShape; other: number };
    lastRuntimeEnvelope: EnvelopeShape;
    lastPeerRuntimeEnvelope: { artifact: { control: { checkpoint: CheckpointShape } } };
    lastBusinessPhase: string;
  }

  const checkpoint: CheckpointShape = {
    id: 'cp1',
    question: '执行 a = 5、b = 2.5、c = "3" 后…',
    options: [{ id: 'A', text: '选项 A' }, { id: 'B', text: '选项 B' }],
    correctOptionIds: ['B'],
    expectedKeywords: ['值本身的写法'],
    hint: '看值本身的写法…',
  };

  const runtimeEnvelope: EnvelopeShape = {
    businessState: { phase: 'in-progress', isTerminal: false },
    artifact: { control: { checkpoint }, reply: '老师回复' },
  };

  const leakedState: LeakedStateShape = {
    pendingCheckpoint: { ...checkpoint },
    checkpointHistory: [
      {
        checkpointId: 'cp0',
        question: '历史题',
        options: [{ id: 'A', text: '选项 A' }, { id: 'B', text: '选项 B' }],
        selectedOptionIds: ['B'],
        submittedOptionIds: ['B'],
        correctOptionIds: ['B'],
        expectedKeywords: ['旧要点'],
        passed: true,
        skipped: false,
      },
    ],
    sessionArtifacts: { pendingCheckpoint: { ...checkpoint }, other: 1 },
    lastRuntimeEnvelope: runtimeEnvelope,
    lastPeerRuntimeEnvelope: { artifact: { control: { checkpoint: { ...checkpoint } } } },
    lastBusinessPhase: 'in-progress',
  };

  /** 穷举式断言：整棵 JSON 里不得残留答案键名（不受路径白名单影响）。 */
  const countAnswerKeys = (value: unknown): number => {
    const text = JSON.stringify(value);
    return (text.match(/correctOptionIds|expectedKeywords/g) || []).length;
  };

  it('lastRuntimeEnvelope.artifact.control.checkpoint 也剥离（#240 主路径）', () => {
    const safe = stripCheckpointAnswerKeys(leakedState);
    const envCheckpoint = safe.lastRuntimeEnvelope.artifact.control.checkpoint;
    expect(envCheckpoint.question).toBe(checkpoint.question);
    expect(envCheckpoint.options).toEqual(checkpoint.options);
    expect(envCheckpoint).not.toHaveProperty('correctOptionIds');
    expect(envCheckpoint).not.toHaveProperty('expectedKeywords');
  });

  it('穷举式：剥离后整棵树里 correctOptionIds / expectedKeywords 出现次数为 0', () => {
    expect(countAnswerKeys(leakedState)).toBeGreaterThan(0);
    expect(countAnswerKeys(stripCheckpointAnswerKeys(leakedState))).toBe(0);
  });

  it('json 序列化后全量 grep 也为 0（含嵌套 envelope、历史、消息）', () => {
    const detailPayload = stripCheckpointAnswerKeys({
      state: leakedState,
      messages: [
        {
          role: 'assistant',
          content: '作答吧',
          // 存量行：promptDebug 停写前的历史调试信封（dev.db 84 条 payload / 10 会话实测）
          promptDebug: { normalizedOutput: { control: { checkpoint: { ...checkpoint } } } },
        },
      ],
    });
    const text = JSON.stringify(detailPayload);
    expect(text).not.toMatch(/correctOptionIds/);
    expect(text).not.toMatch(/expectedKeywords/);
  });

  it('只删答案键：学员作答、对错、选项、题面全部保留（评估页回放依赖）', () => {
    const safe = stripCheckpointAnswerKeys(leakedState);
    expect(safe.checkpointHistory[0]).toEqual({
      checkpointId: 'cp0',
      question: '历史题',
      options: [{ id: 'A', text: '选项 A' }, { id: 'B', text: '选项 B' }],
      selectedOptionIds: ['B'],
      submittedOptionIds: ['B'],
      passed: true,
      skipped: false,
    });
    expect(safe.pendingCheckpoint).toEqual({
      id: 'cp1',
      question: checkpoint.question,
      options: checkpoint.options,
      hint: checkpoint.hint,
    });
    // envelope 里与答案无关的字段原样保留
    expect(safe.lastRuntimeEnvelope.businessState).toEqual(runtimeEnvelope.businessState);
    expect(safe.lastRuntimeEnvelope.artifact.reply).toBe('老师回复');
  });

  it('纯函数：入参不被修改', () => {
    stripCheckpointAnswerKeys(leakedState);
    expect(leakedState.pendingCheckpoint.correctOptionIds).toEqual(['B']);
    expect(leakedState.lastRuntimeEnvelope.artifact.control.checkpoint.correctOptionIds).toEqual(['B']);
  });

  /**
   * 真实库里还有两种形状，递归实现天然覆盖、白名单不覆盖——锁住它们，
   * 防止将来有人把递归改回路径白名单而这条用例抓不住：
   *  - `sessionArtifacts.pendingCheckpoint` 独立存在（顶层 pending 已消费，简答题带 expectedKeywords）；
   *  - 历史行的 `attempts` 里嵌着当时出题用的检查点快照。
   */
  it('独立存在的 sessionArtifacts.pendingCheckpoint（顶层已消费）也剥离', () => {
    const shortAnswer = {
      id: 'cp-short',
      type: 'short_answer',
      question: '说说你判断的依据',
      expectedKeywords: ['\\d{1,2}', '因为'],
    };
    const safe: Record<string, any> = stripCheckpointAnswerKeys({
      // 顶层 pending 已被消费 → 不存在
      sessionArtifacts: { pendingCheckpoint: shortAnswer },
    });
    expect(safe.sessionArtifacts.pendingCheckpoint).toEqual({
      id: 'cp-short',
      type: 'short_answer',
      question: '说说你判断的依据',
    });
  });

  it('历史行 attempts 里嵌的检查点快照也剥离', () => {
    const safe: Record<string, any> = stripCheckpointAnswerKeys({
      checkpointHistory: [
        {
          checkpointId: 'cp-0',
          question: '历史题',
          selectedOptionIds: ['B'],
          passed: false,
          attempts: [{ at: '2026-10-01T10:00:00.000Z', checkpoint: { ...checkpoint } }],
        },
      ],
    });
    expect(safe.checkpointHistory[0].attempts[0].checkpoint).not.toHaveProperty('correctOptionIds');
    // attempts 本身（作答次数与时间）保留
    expect(safe.checkpointHistory[0].attempts[0].at).toBe('2026-10-01T10:00:00.000Z');
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