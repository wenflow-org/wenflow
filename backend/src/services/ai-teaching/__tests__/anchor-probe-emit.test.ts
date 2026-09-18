/**
 * 独立锚题探针 · 运行时装配（Q13/B4）：纯函数 + 接线形状。
 *
 * 目的：把这些确定性逻辑从难以端到端测试的 coordinator 里抽出来单测——
 * 候选映射（数据来源 + fragile 排除）、证据聚合（lastProbeAt/退避计数）、
 * 幂等证据行形状、提示词注入形状，以及锚题字段在答案键剥离后的存续。
 */
import {
  ANCHOR_MASTERED_SCORE,
  ANCHOR_STRUGGLING_SCORE,
  anchorResultEvidenceKey,
  buildAnchorCandidatesFromLearnerSignals,
  buildAnchorPromptTarget,
  buildAnchorResultEvidence,
  buildAnchorSignalSource,
  deriveTurnsSinceLastProbe,
  summarizeAnchorEvidence,
} from '../anchor-probe-emit';
import { shouldRunAnchorProbe, selectAnchorCandidates } from '../../learner/anchor-probe';
import {
  checkpointForMessageResult,
  stripCheckpointAnswerKeys,
} from '../AITeachingCoordinator';

describe('buildAnchorSignalSource：只取 mastered/struggling，fragile 排除', () => {
  it('抽取 mastered/struggling，并从 conceptLedger 按 conceptKey 与 label 富化 lastSeenAt', () => {
    const source = buildAnchorSignalSource({
      relevantKnowledge: {
        mastered: ['剪辑节奏'],
        fragile: ['色彩理论'],
        struggling: ['转场'],
      },
      backgroundKnowledge: {
        recentConceptLedger: [
          { conceptKey: 'kc-1', label: '剪辑节奏', lastSeenAt: '2026-09-01T00:00:00.000Z' },
          { conceptKey: '转场', label: '转场术语', lastSeenAt: '2026-09-02T00:00:00.000Z' },
        ],
      },
    });
    expect(source.mastered).toEqual(['剪辑节奏']);
    expect(source.struggling).toEqual(['转场']);
    // fragile 不进入任何一份名单
    expect([...(source.mastered || []), ...(source.struggling || [])]).not.toContain('色彩理论');
    expect(source.lastSeenAtByConcept).toMatchObject({
      'kc-1': '2026-09-01T00:00:00.000Z',
      剪辑节奏: '2026-09-01T00:00:00.000Z',
      转场: '2026-09-02T00:00:00.000Z',
      转场术语: '2026-09-02T00:00:00.000Z',
    });
  });

  it('空/缺失投影 → 空信号源（不抛错）', () => {
    expect(buildAnchorSignalSource(null)).toEqual({ mastered: [], struggling: [], lastSeenAtByConcept: {} });
    expect(buildAnchorSignalSource({})).toEqual({ mastered: [], struggling: [], lastSeenAtByConcept: {} });
  });
});

describe('buildAnchorCandidatesFromLearnerSignals：候选映射', () => {
  it('mastered→mastered（0.9），struggling→struggling（0.2），空白标签丢弃', () => {
    const candidates = buildAnchorCandidatesFromLearnerSignals({
      mastered: ['m1', '  ', 'm2'],
      struggling: ['s1'],
      lastSeenAtByConcept: { m1: '2026-09-01T00:00:00.000Z' },
    });
    expect(candidates).toEqual([
      { conceptKey: 'm1', belief: 'mastered', masteryScore: ANCHOR_MASTERED_SCORE, lastSeenAt: '2026-09-01T00:00:00.000Z' },
      { conceptKey: 'm2', belief: 'mastered', masteryScore: ANCHOR_MASTERED_SCORE, lastSeenAt: null },
      { conceptKey: 's1', belief: 'struggling', masteryScore: ANCHOR_STRUGGLING_SCORE, lastSeenAt: null },
    ]);
  });

  it('确定性：同输入恒同输出，且交给 selectAnchorCandidates 可稳定选出一个目标', () => {
    const source = { mastered: ['b', 'a'], struggling: ['c'] };
    const first = buildAnchorCandidatesFromLearnerSignals(source);
    const second = buildAnchorCandidatesFromLearnerSignals(source);
    expect(first).toEqual(second);

    const plans = selectAnchorCandidates(first, { limit: 1 });
    expect(plans).toHaveLength(1);
    // mastered 优先于 struggling，组内同分用字典序兜底
    expect(plans[0]).toMatchObject({ conceptKey: 'a', expected: 'mastered' });
  });
});

describe('summarizeAnchorEvidence：退避计数与 lastProbeAt', () => {
  it('无证据 → { lastProbeAt: null, probesSinceLastFlag: 0 }', () => {
    expect(summarizeAnchorEvidence([])).toEqual({ lastProbeAt: null, probesSinceLastFlag: 0 });
    expect(summarizeAnchorEvidence(null)).toEqual({ lastProbeAt: null, probesSinceLastFlag: 0 });
  });

  it('lastProbeAt = 最近一条；连续未证伪计入，遇到 falsified=true 停止', () => {
    const rows = [
      { occurredAt: '2026-09-18T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
      { occurredAt: '2026-09-15T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
      { occurredAt: '2026-09-10T00:00:00.000Z', payload: JSON.stringify({ falsified: true, signal: 'false_mastery' }) },
      { occurredAt: '2026-09-01T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
    ];
    const summary = summarizeAnchorEvidence(rows);
    expect(summary.lastProbeAt).toBe('2026-09-18T00:00:00.000Z');
    expect(summary.probesSinceLastFlag).toBe(2); // 只数最近两条，第三条证伪即停止
  });

  it('最近一条就是证伪 → 退避计数清零（flag 重置）', () => {
    const summary = summarizeAnchorEvidence([
      { occurredAt: '2026-09-18T00:00:00.000Z', payload: JSON.stringify({ falsified: true }) },
      { occurredAt: '2026-09-15T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
    ]);
    expect(summary.probesSinceLastFlag).toBe(0);
  });

  it('顺序无关；脏 payload / 非法 occurredAt 不参与（被丢弃）', () => {
    const rows = [
      { occurredAt: '2026-09-15T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
      { occurredAt: 'not-a-date', payload: JSON.stringify({ falsified: true }) },
      { occurredAt: '2026-09-18T00:00:00.000Z', payload: '{ not json' },
      { occurredAt: new Date('2026-09-16T00:00:00.000Z'), payload: null },
    ];
    const summary = summarizeAnchorEvidence(rows);
    expect(summary.lastProbeAt).toBe('2026-09-18T00:00:00.000Z');
    expect(summary.probesSinceLastFlag).toBe(3); // 脏 payload 按未证伪处理
  });

  it('与闸门联动：连续投放达上限后应退避', () => {
    const summary = summarizeAnchorEvidence([
      { occurredAt: '2026-09-18T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
      { occurredAt: '2026-09-17T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
      { occurredAt: '2026-09-16T00:00:00.000Z', payload: JSON.stringify({ falsified: false }) },
    ]);
    const decision = shouldRunAnchorProbe({
      now: Date.parse('2026-09-19T12:00:00.000Z'),
      lastProbeAt: summary.lastProbeAt,
      probesSinceLastFlag: summary.probesSinceLastFlag,
      turnsSinceLastProbe: 999,
    });
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toContain('退避');
  });
});

describe('deriveTurnsSinceLastProbe：消息数 − lastCheckpointTurn', () => {
  it('正常差值；负值钳到 0', () => {
    expect(deriveTurnsSinceLastProbe(12, 8)).toBe(4);
    expect(deriveTurnsSinceLastProbe(5, 9)).toBe(0);
  });

  it('缺任一有效值 → undefined（闸门按无信息不拦）', () => {
    expect(deriveTurnsSinceLastProbe(12, undefined)).toBeUndefined();
    expect(deriveTurnsSinceLastProbe(undefined, 3)).toBeUndefined();
    expect(deriveTurnsSinceLastProbe(12, -1)).toBeUndefined();
  });
});

describe('buildAnchorPromptTarget：只注入 conceptKey/expected', () => {
  it('不带内部 reason/排序信息（避免模型泄露"复测"语义）', () => {
    const target = buildAnchorPromptTarget({
      conceptKey: '剪辑节奏',
      expected: 'mastered',
      reason: '掌握信念（masteryScore=0.9）疑似假阳性 → 独立复测证伪',
    });
    expect(target).toEqual({ conceptKey: '剪辑节奏', expected: 'mastered' });
    expect(Object.keys(target).sort()).toEqual(['conceptKey', 'expected']);
  });
});

describe('anchor:result 证据行（幂等 + 只标记）', () => {
  const at = new Date('2026-09-19T12:00:00.000Z');

  it('键由 checkpointId 派生（命中唯一约束 → 重复提交不产生重复行）', () => {
    expect(anchorResultEvidenceKey('cp_123')).toEqual({
      eventId: 'anchor:cp_123',
      evidenceKey: 'anchor:result:cp_123',
    });
  });

  it('形状：type=anchor:result、confidence=0.95、payload 含证伪信号且无答案键', () => {
    const row = buildAnchorResultEvidence({
      checkpointId: 'cp_123',
      conceptKey: '转场',
      expected: 'struggling',
      passed: true,
      signal: 'false_struggle',
      falsified: true,
      userId: 'u1',
      pathId: 'p1',
      taskId: 't1',
      sessionId: 's1',
      occurredAt: at,
    });
    expect(row).toMatchObject({
      id: 'lev_anchor_cp_123',
      eventId: 'anchor:cp_123',
      evidenceKey: 'anchor:result:cp_123',
      userId: 'u1',
      pathId: 'p1',
      taskId: 't1',
      sessionId: 's1',
      evidenceType: 'anchor:result',
      confidence: 0.95,
      occurredAt: at,
    });
    expect(JSON.parse(row.payload)).toEqual({
      checkpointId: 'cp_123',
      conceptKey: '转场',
      expected: 'struggling',
      passed: true,
      falsified: true,
      signal: 'false_struggle',
    });
    expect(row.payload).not.toContain('correctOptionIds');
    expect(row.payload).not.toContain('expectedKeywords');
  });

  it('conceptKey/passed 缺失时安全落 null', () => {
    const row = buildAnchorResultEvidence({
      checkpointId: 'cp_x',
      expected: 'mastered',
      passed: null,
      signal: 'inconclusive',
      falsified: false,
      userId: 'u1',
      occurredAt: at,
    });
    const payload = JSON.parse(row.payload);
    expect(payload.conceptKey).toBeNull();
    expect(payload.passed).toBeNull();
    expect(row.pathId).toBeNull();
  });
});

describe('锚题字段在答案键剥离/下发后存续（不含答案键）', () => {
  const anchorCheckpoint = {
    id: 'cp_anchor',
    type: 'single_choice' as const,
    title: 'Q',
    question: 'Q',
    options: [{ id: 'A', text: 'a' }],
    correctOptionIds: ['A'],
    purpose: 'anchor' as const,
    anchorConceptKey: '剪辑节奏',
    anchorExpectedBelief: 'mastered' as const,
  };

  it('stripCheckpointAnswerKeys 只删答案键，锚题元数据保留', () => {
    const safe = stripCheckpointAnswerKeys({ pendingCheckpoint: anchorCheckpoint })!;
    expect(safe.pendingCheckpoint).toMatchObject({
      purpose: 'anchor',
      anchorConceptKey: '剪辑节奏',
      anchorExpectedBelief: 'mastered',
    });
    expect(safe.pendingCheckpoint).not.toHaveProperty('correctOptionIds');
  });

  it('checkpointForMessageResult 下发版本含锚题元数据、不含答案键', () => {
    const out = checkpointForMessageResult({ pendingCheckpoint: anchorCheckpoint });
    expect(out).toMatchObject({ purpose: 'anchor', anchorConceptKey: '剪辑节奏', anchorExpectedBelief: 'mastered' });
    expect(out).not.toHaveProperty('correctOptionIds');
  });
});
