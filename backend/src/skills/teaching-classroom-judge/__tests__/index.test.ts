import { normalizeClassroomJudgeOutput, type ClassroomQualityJudgeInput } from '../index';

function buildInput(overrides: Partial<ClassroomQualityJudgeInput> = {}): ClassroomQualityJudgeInput {
  return {
    classroom: { taskTitle: '测试任务', mode: 'tutor', turnCount: 3 },
    transcript: [
      { index: 0, role: 'teacher', content: '开场', board: '左栏：法定上限', figure: null, checkpoint: null },
      { index: 1, role: 'learner', content: '学员回答', board: null, figure: null, checkpoint: null },
      { index: 2, role: 'teacher', content: '收束', board: null, figure: '图1[matrix] 行:A｜B', checkpoint: '这条属于哪一类？' },
    ],
    wrapup: { present: true, summary: '{"takeaway":"带走的判断"}', lss: 0.7 },
    ...overrides,
  };
}

describe('teaching-classroom-judge normalize', () => {
  it('evidence index 越界的 finding 被丢弃（不得引用不存在的轮次）', () => {
    const parsed = {
      verdict: 'pass_with_concerns',
      scores: { overall: 80, openingAnchor: 85, criteriaClarity: 80, scaffolding: 75, boardConsistency: 70, closureQuality: 80 },
      findings: [
        { code: 'BOARD_MISMATCH', severity: 'minor', category: 'board', title: 't', detail: 'd', evidenceIds: ['E1'] },
        { code: 'BAD_REF', severity: 'major', category: 'board', title: 't', detail: 'd', evidenceIds: ['E9'] },
        { code: 'NO_REF', severity: 'minor', category: 'board', title: 't', detail: 'd', evidenceIds: [] },
      ],
      evidence: [
        { id: 'E1', index: 0, path: 'board', excerpt: '左栏', interpretation: 'i' },
        { id: 'E2', index: 99, path: 'content', excerpt: '越界', interpretation: 'i' },
      ],
      recommendations: [],
    };
    const output = normalizeClassroomJudgeOutput(parsed, buildInput());
    expect(output.findings.map(f => f.code)).toEqual(['BOARD_MISMATCH']);
    expect(output.evidence.map(e => e.id)).toEqual(['E1']);
  });

  it('整课无板书/图文载荷时 boardConsistency 强制 null（渲染链缺载荷不按 0 分 punish）', () => {
    const input = buildInput({
      transcript: [
        { index: 0, role: 'teacher', content: '开场', board: null, figure: null, checkpoint: null },
        { index: 1, role: 'learner', content: '答', board: null, figure: null, checkpoint: null },
      ],
    });
    const parsed = {
      verdict: 'pass',
      scores: { overall: 90, openingAnchor: 90, criteriaClarity: 90, scaffolding: 90, boardConsistency: 88, closureQuality: 90 },
      findings: [
        { code: 'CLOSURE_OK', severity: 'info', category: 'closure', title: 't', detail: 'd', evidenceIds: ['E1'] },
      ],
      evidence: [{ id: 'E1', index: 0, path: 'content', excerpt: 'x', interpretation: 'i' }],
      recommendations: [],
    };
    const output = normalizeClassroomJudgeOutput(parsed, input);
    expect(output.scores.boardConsistency).toBeNull();
  });

  it('非法 verdict/severity/category 收敛到安全默认；非法枚举 finding 被丢弃', () => {
    const parsed = {
      verdict: 'excellent',
      scores: { overall: 'not-a-number' },
      findings: [
        { code: 'X', severity: 'blocker', category: 'board', title: 't', detail: 'd', evidenceIds: ['E1'] },
        { code: 'Y', severity: 'minor', category: 'not-a-cat', title: 't', detail: 'd', evidenceIds: ['E1'] },
      ],
      evidence: [{ id: 'E1', index: 1, path: 'wrapup', excerpt: 'w', interpretation: 'i' }],
      recommendations: [],
    };
    const output = normalizeClassroomJudgeOutput(parsed, buildInput());
    expect(output.verdict).toBe('inconclusive');
    expect(output.scores.overall).toBe(0);
    // severity 非法 → 丢弃；category 非法 → 归 boundary
    expect(output.findings.map(f => f.category)).toEqual(['boundary']);
    // wrapup 证据不挂轮次，index 置 null
    expect(output.evidence[0].index).toBeNull();
  });

  it('wrapup 证据合法、recommendations 的 findingCodes 对不上时被剔空', () => {
    const parsed = {
      verdict: 'fail',
      scores: { overall: 40 },
      findings: [
        { code: 'CLOSURE_MISSING', severity: 'major', category: 'closure', title: 't', detail: 'd', evidenceIds: ['E1'] },
      ],
      evidence: [{ id: 'E1', index: null, path: 'wrapup', excerpt: 'x', interpretation: 'i' }],
      recommendations: [
        { priority: 'P1', action: 'a', rationale: 'r', findingCodes: ['CLOSURE_MISSING', 'GHOST'] },
      ],
    };
    const output = normalizeClassroomJudgeOutput(parsed, buildInput());
    expect(output.verdict).toBe('fail');
    expect(output.recommendations[0].findingCodes).toEqual(['CLOSURE_MISSING']);
  });
});
