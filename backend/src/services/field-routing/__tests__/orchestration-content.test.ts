/**
 * validateOrchestrationContent 单元测试（编排文件编辑侧批次 C）
 *
 * 覆盖：内存校验的解析结果、非法 promptRole / render、重复 fieldId、
 * routings 引用未声明字段、顶层非对象、stage 非空等失败路径；
 * 校验逻辑与 parseOrchestrationFile 完全一致（共用 parseOrchestrationText）。
 */

import {
  validateOrchestrationContent,
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
