/**
 * 非能力问题分诊（纯函数）：
 *   goal understanding 阻塞类型标注 → { mode, reasons, confidence } + 负向出口文案。
 *
 * 覆盖每个 mode 分支 + 缺字段 + 情绪带技能证据 → combination + urgency 降档。
 */
import {
  DEFAULT_RESPONSE_TRIAGE_ENFORCEMENT,
  RESPONSE_TRIAGE_KEY,
  buildTriageAdvisoryLine,
  normalizeResponseTriageEnforcementMode,
  resolveResponseTriageFromCollectedData,
  triageGoalResponse,
} from '../response-triage';

describe('triageGoalResponse 规则表', () => {
  it('缺少 primaryBlockType → learning_path / low / 记录缺少标注', () => {
    const result = triageGoalResponse({ realProblem: '不知道怎么下手' });
    expect(result.mode).toBe('learning_path');
    expect(result.confidence).toBe('low');
    expect(result.reasons.join('')).toContain('缺少阻塞类型标注');
  });

  it('未知 primaryBlockType → learning_path / low（不臆造分支）', () => {
    const result = triageGoalResponse({ primaryBlockType: 'skill_gap' });
    expect(result.mode).toBe('learning_path');
    expect(result.confidence).toBe('low');
  });

  it('capability + recurring + 证据 → learning_path / high', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'capability',
      recurrence: 'recurring',
      blockTypeEvidence: '每次写复盘都写不出结论',
    });
    expect(result.mode).toBe('learning_path');
    expect(result.confidence).toBe('high');
  });

  it('capability 但无复现/证据 → learning_path / medium', () => {
    const result = triageGoalResponse({ primaryBlockType: 'capability', recurrence: 'once' });
    expect(result.mode).toBe('learning_path');
    expect(result.confidence).toBe('medium');
  });

  it('emotion_relationship 无技能证据 → emotional_support', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'emotion_relationship',
      blockTypeEvidence: '一想到要当众汇报就失眠',
    });
    expect(result.mode).toBe('emotional_support');
    expect(result.reasons.join('')).toContain('emotion_relationship');
  });

  it('emotion_relationship + 证据提到具体技能 → combination', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'emotion_relationship',
      blockTypeEvidence: '怕汇报，而且完全不会用数据图表方法',
    });
    expect(result.mode).toBe('combination');
  });

  it('environment_tooling 无可学习成分 → referral', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'environment_tooling',
      blockTypeEvidence: '电脑太旧，装不上软件',
    });
    expect(result.mode).toBe('referral');
  });

  it('permission_process 但 realProblem 含可学习成分 → combination', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'permission_process',
      realProblem: '没有审批权限，得先学会走报销流程模板',
    });
    expect(result.mode).toBe('combination');
  });

  it('oneoff_operation → combination', () => {
    const result = triageGoalResponse({ primaryBlockType: 'oneoff_operation' });
    expect(result.mode).toBe('combination');
  });

  it('urgency 极高 + constraints 非空 → confidence 降一档', () => {
    const base = triageGoalResponse({
      primaryBlockType: 'capability',
      recurrence: 'recurring',
      blockTypeEvidence: '反复卡住',
    });
    expect(base.confidence).toBe('high');

    const downgraded = triageGoalResponse({
      primaryBlockType: 'capability',
      recurrence: 'recurring',
      blockTypeEvidence: '反复卡住',
      urgency: '极高',
      constraintsAndBoundaries: ['下周就要汇报'],
    });
    expect(downgraded.confidence).toBe('medium');
    expect(downgraded.reasons.join('')).toContain('降一档');
  });

  it('容忍 snake_case 字段（goal understanding 口径）', () => {
    const result = triageGoalResponse({
      primary_block_type: 'capability',
      recurrence: 'recurring',
      block_type_evidence: '反复不会',
    });
    expect(result.mode).toBe('learning_path');
    expect(result.confidence).toBe('high');
  });
});

describe('buildTriageAdvisoryLine 负向出口文案', () => {
  it('learning_path 不产出任何文案（默认零变化）', () => {
    expect(buildTriageAdvisoryLine({ mode: 'learning_path', confidence: 'high', reasons: [] })).toBe('');
    expect(buildTriageAdvisoryLine(null)).toBe('');
    expect(buildTriageAdvisoryLine(undefined)).toBe('');
  });

  it('非 learning_path 产出可被断言的结论行', () => {
    const line = buildTriageAdvisoryLine({ mode: 'emotional_support', confidence: 'medium', reasons: [] });
    expect(line).toContain('系统判断');
    expect(line).toContain('情绪');
    expect(line).not.toBe(buildTriageAdvisoryLine({ mode: 'referral', confidence: 'medium', reasons: [] }));
  });

  it('低置信度追加提示', () => {
    const line = buildTriageAdvisoryLine({ mode: 'combination', confidence: 'low', reasons: [] });
    expect(line).toContain('置信度低');
  });
});

describe('collectedData 承载读取与模式归一化', () => {
  it('resolveResponseTriageFromCollectedData 往返读回', () => {
    const triage = triageGoalResponse({ primaryBlockType: 'emotion_relationship' });
    expect(resolveResponseTriageFromCollectedData({ [RESPONSE_TRIAGE_KEY]: triage })).toEqual(triage);
  });

  it('缺失/损坏一律 null', () => {
    expect(resolveResponseTriageFromCollectedData(undefined)).toBeNull();
    expect(resolveResponseTriageFromCollectedData({})).toBeNull();
    expect(resolveResponseTriageFromCollectedData({ [RESPONSE_TRIAGE_KEY]: { mode: 'bogus' } })).toBeNull();
  });

  it('normalizeResponseTriageEnforcementMode 默认 advisory，仅 gated 才切换', () => {
    expect(normalizeResponseTriageEnforcementMode(undefined)).toBe(DEFAULT_RESPONSE_TRIAGE_ENFORCEMENT);
    expect(normalizeResponseTriageEnforcementMode('advisory')).toBe('advisory');
    expect(normalizeResponseTriageEnforcementMode('gated')).toBe('gated');
    expect(normalizeResponseTriageEnforcementMode('GATED')).toBe('gated');
    expect(normalizeResponseTriageEnforcementMode('weird')).toBe('advisory');
  });
});
