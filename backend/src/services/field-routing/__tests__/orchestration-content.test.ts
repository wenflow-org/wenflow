/**
 * validateOrchestrationContent 单元测试（编排文件编辑侧批次 C）
 *
 * 覆盖：内存校验的解析结果、非法 promptRole / render、重复 fieldId、
 * routings 引用未声明字段、顶层非对象、stage 非空等失败路径；
 * 校验逻辑与 parseOrchestrationFile 完全一致（共用 parseOrchestrationText）。
 */

import {
  validateOrchestrationContent,
  applyRoutingEditsToOrchestrationText,
  type OrchestrationStage,
} from '../orchestration-file';

const VALID_YAML = `
stage: test-stage
displayName: Test 阶段
contracts:
  - agentId: skill:test-skill
fields:
  - fieldId: test.alpha
    promptRole: soft-info
    valueType: string
    description: 测试字段
routings:
  - agentId: skill:test-skill
    fieldId: test.alpha
    render: visible
    handoff: []
    internal: false
    accumulate: false
`;

describe('validateOrchestrationContent（内存校验）', () => {
  it('合法内容返回完整解析结果', () => {
    const stage: OrchestrationStage = validateOrchestrationContent(VALID_YAML);
    expect(stage.stage).toBe('test-stage');
    expect(stage.displayName).toBe('Test 阶段');
    expect(stage.contracts).toHaveLength(1);
    expect(stage.fields).toHaveLength(1);
    expect(stage.routings).toHaveLength(1);
    expect(stage.contracts[0].agentId).toBe('skill:test-skill');
    expect(stage.fields[0].promptRole).toBe('soft-info');
    expect(stage.routings[0].render).toBe('visible');
  });

  it('与文件解析等价：contracts 经 deriveContract 派生 displayName', () => {
    const stage = validateOrchestrationContent(VALID_YAML);
    expect(stage.contracts[0].displayName).toBeTruthy();
    expect(stage.contracts[0].description).toBeDefined();
  });

  it('yaml 语法错误抛错', () => {
    expect(() => validateOrchestrationContent('stage: [unclosed')).toThrow(/yaml 解析失败/);
  });

  it('顶层非对象抛错', () => {
    expect(() => validateOrchestrationContent('- a\n- b')).toThrow(/顶层必须是对象/);
  });

  it('非法 promptRole 抛错', () => {
    const bad = VALID_YAML.replace('promptRole: soft-info', 'promptRole: nope-role');
    expect(() => validateOrchestrationContent(bad)).toThrow(/promptRole=nope-role 非法/);
  });

  it('非法 render 抛错', () => {
    const bad = VALID_YAML.replace('render: visible', 'render: rainbow');
    expect(() => validateOrchestrationContent(bad)).toThrow(/render=rainbow 非法/);
  });

  it('重复 fieldId 抛错', () => {
    const bad = `
stage: dup-stage
contracts:
  - agentId: skill:test-skill
fields:
  - fieldId: test.alpha
    promptRole: soft-info
    valueType: string
    description: 第一个
  - fieldId: test.alpha
    promptRole: hidden-inference
    valueType: string
    description: 重复
routings:
  - agentId: skill:test-skill
    fieldId: test.alpha
    render: visible
`;
    expect(() => validateOrchestrationContent(bad)).toThrow(/fields 重复 fieldId/);
  });

  it('routings 引用未声明字段抛错', () => {
    const bad = VALID_YAML.replace('fieldId: test.alpha\n    render: visible', 'fieldId: test.ghost\n    render: visible');
    expect(() => validateOrchestrationContent(bad)).toThrow(/引用了未声明字段/);
  });

  it('重复路由键抛错', () => {
    const dup = `
stage: dup-stage
contracts:
  - agentId: skill:test-skill
fields:
  - fieldId: test.alpha
    promptRole: soft-info
    valueType: string
    description: d
routings:
  - agentId: skill:test-skill
    fieldId: test.alpha
    render: visible
  - agentId: skill:test-skill
    fieldId: test.alpha
    render: hidden
`;
    expect(() => validateOrchestrationContent(dup)).toThrow(/routings 重复键/);
  });

  it('stage 缺失/非字符串抛错', () => {
    expect(() => validateOrchestrationContent('displayName: x\ncontracts: []')).toThrow(/stage 必须为非空字符串/);
  });
});

/**
 * #10：字段路由行级 patch 把值改回 null 后必须回原文（不得残留 `notes: null`，
 * 不得丢失文末换行 / 混入别的行尾）。
 */
describe('applyRoutingEditsToOrchestrationText（行级路由改写）', () => {
  const ORIG = [
    '# test goal.yaml（fixture）',
    'stage: test-stage',
    'displayName: Test 阶段',
    'contracts:',
    '  - agentId: skill:test-skill',
    'fields:',
    '  - fieldId: test.alpha',
    '    promptRole: soft-info',
    '    valueType: string',
    '    description: 测试字段',
    'routings:',
    '  - agentId: skill:test-skill',
    '    fieldId: test.alpha',
    '    render: visible',
    '    handoff: []',
    '    internal: false',
    '    accumulate: false',
    '',
  ].join('\n');

  it('写 notes 再置 null：文件逐字节回原文（删键 + 保留文末换行）', () => {
    const withNotes = applyRoutingEditsToOrchestrationText(ORIG, 'skill:test-skill', 'test.alpha', {
      notes: '临时说明',
    });
    expect(withNotes).toContain('    notes: "临时说明"');
    expect(withNotes.endsWith('\n')).toBe(true);

    const back = applyRoutingEditsToOrchestrationText(withNotes, 'skill:test-skill', 'test.alpha', {
      notes: null,
    });
    expect(back).toBe(ORIG);
    expect(back).not.toContain('notes: null');
  });

  it('原本没有该键时置 null 不写 null 行，文本不变', () => {
    const out = applyRoutingEditsToOrchestrationText(ORIG, 'skill:test-skill', 'test.alpha', {
      visibilityPreset: null,
    });
    expect(out).toBe(ORIG);
  });

  it('CRLF 文件保持 CRLF 且保留文末换行', () => {
    const crlf = ORIG.replace(/\n/g, '\r\n');
    const out = applyRoutingEditsToOrchestrationText(crlf, 'skill:test-skill', 'test.alpha', {
      notes: 'x',
    });
    expect(out.endsWith('\r\n')).toBe(true);
    // 不得混入裸 LF：去掉所有 CRLF 后不应再有 \n
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('改 render / handoff 只动目标键，注释与其余文本保持', () => {
    const out = applyRoutingEditsToOrchestrationText(ORIG, 'skill:test-skill', 'test.alpha', {
      render: 'hidden',
      handoff: ['goal-agent'],
      internal: true,
      accumulate: true,
    });
    expect(out).toContain('# test goal.yaml（fixture）');
    expect(out).toContain('    render: hidden');
    expect(out).toContain("    handoff: ['goal-agent']");
    expect(out).toContain('    internal: true');
    expect(out).toContain('    accumulate: true');
  });

  it('目标条目不存在抛错', () => {
    expect(() =>
      applyRoutingEditsToOrchestrationText(ORIG, 'skill:test-skill', 'test.ghost', { render: 'hidden' }),
    ).toThrow(/未找到路由条目/);
  });

  it('多条路由：只改命中 (agentId, fieldId) 的那条', () => {
    const two = ORIG.replace(
      '    accumulate: false\n',
      '    accumulate: false\n  - agentId: goal-agent\n    fieldId: test.alpha\n    render: visible\n    handoff: []\n    internal: false\n    accumulate: false\n',
    );
    const out = applyRoutingEditsToOrchestrationText(two, 'goal-agent', 'test.alpha', { render: 'hidden' });
    // skill 行不变，goal-agent 行变
    expect(out).toContain('  - agentId: skill:test-skill\n    fieldId: test.alpha\n    render: visible');
    expect(out).toContain('  - agentId: goal-agent\n    fieldId: test.alpha\n    render: hidden');
  });
});
