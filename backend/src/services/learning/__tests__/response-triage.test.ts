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
  normalizeSupportNeed,
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

  it('permission_process 命中命名实体（"职业技能鉴定"）不抬成 combination（高精度模式）', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'permission_process',
      blockTypeEvidence: '没上过人社局官网，不知道该搜"健康管理师"还是搜"职业技能鉴定"',
      realProblem: '报考资格口径冲突，没核过官方流程与审批说明，判断不了自己是否符合条件',
      painPoints: ['从未上过官网，不知道入口怎么搜', '报考属于职业技能鉴定，怕点进去还是找不到原文'],
    });
    expect(result.mode).toBe('referral');
  });

  it('environment_tooling 只命中该阻塞的定义词（配置/使用/工具）→ 仍 referral', () => {
    const result = triageGoalResponse({
      primaryBlockType: 'environment_tooling',
      blockTypeEvidence: '电脑配置太旧、工具装不上，根本没法使用这套软件',
      realProblem: '设备环境限制，需要先修好系统配置',
    });
    expect(result.mode).toBe('referral');
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

describe('第二轴 support_need（除学习外的支持需求）', () => {
  it('capability + support_need=emotional → combination（不丢掉真实可学缺口）', () => {
    const result = triageGoalResponse({
      primary_block_type: 'capability',
      recurrence: 'recurring',
      support_need: 'emotional',
    });
    expect(result.mode).toBe('combination');
    expect(result.reasons.join('')).toContain('support_need=emotional');
  });

  it('capability + support_need=none → 仍是 learning_path（零变化）', () => {
    const result = triageGoalResponse({ primary_block_type: 'capability', support_need: 'none' });
    expect(result.mode).toBe('learning_path');
  });

  it('缺失 / 非法 support_need 一律视为 none（零变化）', () => {
    expect(triageGoalResponse({ primary_block_type: 'capability' }).mode).toBe('learning_path');
    expect(triageGoalResponse({ primary_block_type: 'capability', support_need: 'whatever' }).mode).toBe('learning_path');
    expect(normalizeSupportNeed('emotional')).toBe('emotional');
    expect(normalizeSupportNeed('referral')).toBe('referral');
    expect(normalizeSupportNeed('')).toBe('none');
    expect(normalizeSupportNeed(null)).toBe('none');
  });

  it('environment_tooling 无可学习成分 + support_need=emotional → combination', () => {
    const result = triageGoalResponse({ primary_block_type: 'environment_tooling', support_need: 'emotional' });
    expect(result.mode).toBe('combination');
  });

  it('emotion_relationship + support_need=referral → combination（两个专门需求叠加）', () => {
    const result = triageGoalResponse({ primary_block_type: 'emotion_relationship', support_need: 'referral' });
    expect(result.mode).toBe('combination');
  });

  it('blockType 缺失但 support_need 明确 → 仍出负向出口（不因缺标注而漏掉）', () => {
    expect(triageGoalResponse({ support_need: 'emotional' }).mode).toBe('emotional_support');
    expect(triageGoalResponse({ support_need: 'referral' }).mode).toBe('referral');
    expect(triageGoalResponse({ support_need: 'none' }).mode).toBe('learning_path');
  });

  it('capability + support_need=referral → combination（现实中阻塞 + 有东西要学）', () => {
    expect(triageGoalResponse({ primary_block_type: 'capability', support_need: 'referral' }).mode).toBe('combination');
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
