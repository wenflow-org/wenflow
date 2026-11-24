/**
 * 学生侧 wrapup 脱敏投影（2026-11-24 真跑复盘后复核）。
 *
 * 运营字段（影子对比/收束控制态/内部审计/运行时信封）不得随学生端详情下发；
 * 学生完课卡实际消费的 summary / evaluation 分数 / stateUpdate / progress 必须保留。
 */
import { projectWrapupForStudent } from '../teaching-session-views';

const wrapup = () => ({
  status: 'complete',
  sources: { summary: 'model', evaluation: 'model' },
  summary: { topicSummary: '本节学了读表。', practiceAdvice: '再练两行。' },
  evaluation: {
    sessionLss: 6,
    sessionKtl: 2.5,
    sessionLf: 6,
    confidence: 0.72,
    reasoning: '内部判定理由，不应下发',
    metricTiers: { sessionLss: 'mid', sessionKtl: 'low', sessionLf: 'mid' },
    metricEvidence: { sessionLss: '内部证据' },
    metricMetadata: { formula: 'x' },
    duration: 25,
    messageCount: 8,
  },
  progress: { newlyMastered: ['识别钟点列'] },
  evidence: { turnCount: 8, avgUnderstanding: 0.4 },
  stateUpdate: { lss: 2.5, ktl: 6.07, lf: 2.25, lsb: 3.82, mature: true },
  duration: 25,
  summarySource: 'model',
  evaluationSource: 'model',
  runtimeEnvelope: { debug: '内部' },
  finalizationAction: 'end_only',
  closureAudit: { openQuestion: null },
  learner: { fatigueRisk: 'low', recommendedPacing: 'moderate' },
  shadowDeterministic: {
    formulaVersion: 'session-eval-det-v2',
    deterministic: { lss: 4.4, ktl: 3.5, lf: 4.4 },
    llm: { lss: 6, ktl: 2.5, lf: 6 },
    delta: { lss: -1.6, ktl: 1, lf: -1.6 },
  },
  controlStateSnapshot: {
    paceMode: 'recover',
    challengeLevelCap: 'low',
    controlFlags: { distressRecover: true },
  },
});

describe('projectWrapupForStudent', () => {
  it('移除运营/内部字段：影子、控制态、运行时信封、收束审计、内部节奏建议', () => {
    const projected = projectWrapupForStudent(wrapup());
    for (const key of ['shadowDeterministic', 'controlStateSnapshot', 'runtimeEnvelope', 'finalizationAction', 'closureAudit', 'learner']) {
      expect(projected).not.toHaveProperty(key);
    }
  });

  it('评估只留分数与展示字段，移除判定依据（tiers/evidence/metadata/reasoning/confidence）', () => {
    const evaluation = projectWrapupForStudent(wrapup()).evaluation;
    expect(evaluation).toMatchObject({
      sessionLss: 6, sessionKtl: 2.5, sessionLf: 6, duration: 25, messageCount: 8,
    });
    for (const key of ['metricTiers', 'metricEvidence', 'metricMetadata', 'reasoning', 'confidence']) {
      expect(evaluation).not.toHaveProperty(key);
    }
  });

  it('完课卡与反馈页依赖的字段保留：summary / stateUpdate / progress / sources', () => {
    const projected = projectWrapupForStudent(wrapup());
    expect(projected.summary).toEqual({ topicSummary: '本节学了读表。', practiceAdvice: '再练两行。' });
    expect(projected.stateUpdate).toMatchObject({ ktl: 6.07, lsb: 3.82, mature: true });
    expect(projected.progress.newlyMastered).toEqual(['识别钟点列']);
    expect(projected.sources).toEqual({ summary: 'model', evaluation: 'model' });
  });

  it('不修改原始对象（只做浅拷贝 + evaluation 深拷贝）', () => {
    const input = wrapup();
    const projected = projectWrapupForStudent(input);
    expect(input).toHaveProperty('shadowDeterministic');
    expect(input.evaluation).toHaveProperty('metricTiers');
    expect(projected).not.toBe(input);
  });

  it('null / 非对象原样返回（旧数据与空 wrapup 不抛）', () => {
    expect(projectWrapupForStudent(null)).toBeNull();
    expect(projectWrapupForStudent('x')).toBe('x');
    expect(projectWrapupForStudent({ status: 'summary-only' })).toEqual({ status: 'summary-only' });
  });
});
