/**
 * 「不可观测 ≠ 低理解度」（2026-11-01 走查修复，「为什么一两句就测试」的确定性成因）。
 *
 * 旧口径：模型没有可引用证据时被要求「understanding 取低值」→ 低数字进确定性闸门 →
 * 出题节奏被压到 2 条消息（学生刚说一两句就被测），伴学也按「低理解度窗口」触发。
 * 新口径：无读数解析为 null，闸门按「不加速、不否决」处理。这里锁住三处：
 * 读数解析、出题节奏分档、出题闸门对 null 与「压根没有 analysis」的区分。
 */
import {
  CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS,
  CHECKPOINT_MIN_TURNS,
  checkpointRhythmMinTurns,
  countEvidencedConfusions,
  resolveUnderstandingReading,
} from '../checkpoint-shared';
import { shouldEmitCheckpoint } from '../teaching-checkpoint';
import { normalizeOutput } from '../../../skills/teaching-turn';
import { determineNextStage } from '../teaching-classroom-flow';

describe('resolveUnderstandingReading：只有真正有限的数才算读数', () => {
  it('数字与数字字符串算读数', () => {
    expect(resolveUnderstandingReading(0)).toBe(0);
    expect(resolveUnderstandingReading(0.42)).toBe(0.42);
    expect(resolveUnderstandingReading(' 0.3 ')).toBe(0.3);
  });

  it('null / undefined / 空串 / 非数值 / NaN / Infinity 一律是「无读数」', () => {
    for (const value of [null, undefined, '', '   ', 'abc', Number.NaN, Infinity, -Infinity, {}, [], true]) {
      expect(resolveUnderstandingReading(value)).toBeNull();
    }
  });
});

describe('checkpointRhythmMinTurns：无读数回常规节奏，不加速出题', () => {
  it('无读数（null）＝常规 4 条，而不是低理解度的 2 条', () => {
    expect(checkpointRhythmMinTurns(null)).toBe(CHECKPOINT_MIN_TURNS);
    expect(checkpointRhythmMinTurns(undefined)).toBe(CHECKPOINT_MIN_TURNS);
    expect(checkpointRhythmMinTurns('')).toBe(CHECKPOINT_MIN_TURNS);
    expect(checkpointRhythmMinTurns(Number.NaN)).toBe(CHECKPOINT_MIN_TURNS);
    // 旧实现：Number(null)=0 且有限 → 误判成「低理解度」→ 2
    expect(checkpointRhythmMinTurns(null)).not.toBe(CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS);
  });

  it('真有低读数才加速到 2 条', () => {
    expect(checkpointRhythmMinTurns(0)).toBe(CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS);
    expect(checkpointRhythmMinTurns(0.2)).toBe(CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS);
    expect(checkpointRhythmMinTurns(0.59)).toBe(CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS);
    expect(checkpointRhythmMinTurns('0.3')).toBe(CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS);
  });

  it('0.6 及以上（含边界）维持常规 4 条', () => {
    expect(checkpointRhythmMinTurns(0.6)).toBe(CHECKPOINT_MIN_TURNS);
    expect(checkpointRhythmMinTurns(0.95)).toBe(CHECKPOINT_MIN_TURNS);
  });
});

describe('shouldEmitCheckpoint：区分「没有 analysis」与「有 analysis 但不可观测」', () => {
  const state = { lastCheckpointTurn: 0 };

  it('压根没有 analysis（首个回合/恢复回合）→ 不出题（沿用旧行为）', () => {
    const session = { messages: [{ role: 'assistant' }, { role: 'user' }] };
    expect(shouldEmitCheckpoint(session, state)).toBe(false);
  });

  it('有 analysis 但 understanding 为 null：不是「低理解度」→ 第 2 条消息不加速出题', () => {
    const session = {
      messages: [
        { role: 'assistant' },
        { role: 'user', analysis: { understanding: null } },
      ],
    };
    // 距上次出题 1 条 < 常规 4 条 → 不出题（旧口径下 null→0→2 条，则 1<2 同样不出；
    // 关键区别在下一例：同一条数在低读数下会出题，在无读数下不出）
    expect(shouldEmitCheckpoint(session, state)).toBe(false);
  });

  it('同一条数下「真低读数」会出题，而「无读数」不会——这就是修复的差别', () => {
    const messagesLowReading = [
      { role: 'assistant' },
      { role: 'user' },
      { role: 'user', analysis: { understanding: 0.2 } },
    ];
    const messagesNoReading = [
      { role: 'assistant' },
      { role: 'user' },
      { role: 'user', analysis: { understanding: null } },
    ];
    expect(shouldEmitCheckpoint({ messages: messagesLowReading }, state)).toBe(true);
    expect(shouldEmitCheckpoint({ messages: messagesNoReading }, state)).toBe(false);
  });

  it('无读数等满常规节奏后仍可出题（不否决，只是不加速）', () => {
    const messages = [
      { role: 'assistant' },
      { role: 'user' },
      { role: 'user' },
      { role: 'user' },
      { role: 'user', analysis: { understanding: null } },
    ];
    expect(messages.length - 0).toBeGreaterThanOrEqual(CHECKPOINT_MIN_TURNS);
    expect(shouldEmitCheckpoint({ messages }, state)).toBe(true);
  });
});

describe('normalizeOutput：无读数一路保留为 null（不再被填成 0.5 冒充中性）', () => {
  const input = {
    scenario: { taskTitle: '读表', topic: '销售明细' },
    messages: [],
    knowledge: { points: [] },
  } as unknown as Parameters<typeof normalizeOutput>[1];

  it('模型输出 null → 保留 null', () => {
    const out = normalizeOutput({ reply: '继续。', analysis: { understanding: null } }, input);
    expect(out.analysis.understanding).toBeNull();
  });

  it('模型没给这个字段 / 给非数值 → null（旧实现填 0.5，与「真的 0.5」无法区分）', () => {
    expect(normalizeOutput({ reply: '继续。', analysis: {} }, input).analysis.understanding).toBeNull();
    expect(normalizeOutput({ reply: '继续。', analysis: { understanding: 'abc' } }, input).analysis.understanding).toBeNull();
  });

  it('模型给了数字 → 原样保留（含 0 与边界）', () => {
    expect(normalizeOutput({ reply: '继续。', analysis: { understanding: 0.2 } }, input).analysis.understanding).toBe(0.2);
    expect(normalizeOutput({ reply: '继续。', analysis: { understanding: 0 } }, input).analysis.understanding).toBe(0);
    expect(normalizeOutput({ reply: '继续。', analysis: { understanding: 1 } }, input).analysis.understanding).toBe(1);
  });
});

describe('countEvidencedConfusions：卡点只认硬口径（原话证据）', () => {
  it('没有误解台账 / 台账项没有 evidence → 0（软通道 confusionPoints 不计入）', () => {
    expect(countEvidencedConfusions({ confusionPoints: ['列名', '日期格式', '金额'] })).toBe(0);
    expect(countEvidencedConfusions({ misconceptions: [{ evidence: '' }, { evidence: '   ' }] })).toBe(0);
    expect(countEvidencedConfusions(null)).toBe(0);
    expect(countEvidencedConfusions(undefined)).toBe(0);
  });

  it('只有带原话证据的条目计数', () => {
    expect(countEvidencedConfusions({
      misconceptions: [
        { evidence: '我以为日期那一列是数值' },
        { evidence: '' },
        { evidence: '合计行也算销量吧' },
      ],
    })).toBe(2);
  });
});

describe('determineNextStage：软卡点不再把课堂推进干预，硬卡点仍然推进', () => {
  type StageParams = Parameters<typeof determineNextStage>[0];
  const baseOutput = (analysis: Record<string, unknown>) => ({
    reply: '继续。',
    analysis: { cognitiveLevel: 'understand', levelScore: 3, understanding: 0.7, confusionPoints: [], ...analysis },
    knowledge: { points: [] },
    pedagogy: {},
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  }) as unknown as StageParams['teachingOutput'];
  const params = (output: StageParams['teachingOutput']): StageParams => ({
    currentStage: 'opening',
    teachingOutput: output,
    peerTriggered: false,
    learnerMessage: '我按列数筛了一遍',
  });

  it('三个软 confuse 点（无证据）→ 不进干预，正常推进', () => {
    const output = baseOutput({ confusionPoints: ['列名', '日期格式', '金额单位'] });
    expect(determineNextStage(params(output)).stage).toBe('teaching');
  });

  it('两个有原话证据的误解 → 进干预（硬信号仍然有效）', () => {
    const output = baseOutput({
      confusionPoints: ['列名', '日期格式'],
      misconceptions: [
        { evidence: '日期那列我当成数值了' },
        { evidence: '合计行我也算进销量了' },
      ],
    });
    expect(determineNextStage(params(output)).stage).toBe('intervention');
  });
});

describe('determineNextStage：不可观测不能凭空释放干预（「卡点已缓解」要有读数）', () => {
  type StageParams = Parameters<typeof determineNextStage>[0];
  const output = (analysis: Record<string, unknown>) => ({
    reply: '继续。',
    analysis: { cognitiveLevel: 'understand', levelScore: 3, understanding: 0.7, confusionPoints: [], ...analysis },
    knowledge: { points: [] },
    pedagogy: {},
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  }) as unknown as StageParams['teachingOutput'];

  it('干预中 + 本轮无读数 → 仍停在干预（旧实现 0.5>=0.5 会放行回授课）', () => {
    const result = determineNextStage({
      currentStage: 'intervention',
      teachingOutput: output({ understanding: null }),
      peerTriggered: false,
      learnerMessage: '嗯，好。',
    });
    expect(result.stage).toBe('intervention');
  });

  it('干预中 + 本轮真有 ≥0.5 的读数 → 回到授课（特性不变）', () => {
    const result = determineNextStage({
      currentStage: 'intervention',
      teachingOutput: output({ understanding: 0.62 }),
      peerTriggered: false,
      learnerMessage: '我按这个规则筛了一遍，剩 987 行。',
    });
    expect(result.stage).toBe('teaching');
  });
});
