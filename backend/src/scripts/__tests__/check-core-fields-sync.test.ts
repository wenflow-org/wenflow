import { analyzeCoreFieldsSync, EXEMPT_PLATFORM_ROOTS, CORE_ALIAS_TO_EXEMPT_ROOT } from '../check-core-fields-sync';
import type { OrchestrationStage } from '../../services/field-routing/orchestration-file';
import type { CoreFile } from '../../services/prompt-lab/core-file-loader';

function makeCore(fields: Array<{ name: string; type: string }>): CoreFile {
  return {
    skillId: 'test-skill',
    baseVersion: 1,
    identity: '身份',
    channels: ['dialogue'],
    stateAdvance: false,
    rules: ['r1'],
    fields: fields.map((f) => ({ name: f.name, type: f.type, optional: f.type.endsWith('?'), desc: 'd', turn: false })),
    constraints: [],
    params: { temperature: 0.7, maxTokens: 1000, failurePolicy: 'retry' },
    deltaOutput: false,
    outputMedia: 'json',
  };
}

function makeStage(fields: Array<{ fieldId: string; valueType: string }>, routings: Array<{ agentId: string; fieldId: string }>): OrchestrationStage {
  return {
    stage: 'goal',
    contracts: [],
    fields: fields.map((f) => ({
      fieldId: f.fieldId,
      promptRole: 'hard-required',
      valueType: f.valueType,
      description: 'd',
    })),
    routings: routings.map((r) => ({
      agentId: r.agentId,
      fieldId: r.fieldId,
      render: 'visible',
      handoff: [],
      internal: false,
      accumulate: false,
    })),
  };
}

const SKILL = { skillId: 'test-skill', kind: 'mainline' as const, stage: 'goal', handlerRef: 'backend/src/skills/test-skill/index.ts' };

describe('check-core-fields-sync：analyzeCoreFieldsSync 规则分支', () => {
  it('嵌套首段命中 core 字段 → ok，零缺项零孤儿', () => {
    const core = makeCore([{ name: 'understanding', type: 'object' }, { name: 'reply', type: 'string' }]);
    const stage = makeStage(
      [
        { fieldId: 'understanding.surface_goal', valueType: 'string' },
        { fieldId: 'reply', valueType: 'string' },
      ],
      [
        { agentId: 'skill:test-skill', fieldId: 'understanding.surface_goal' },
        { agentId: 'skill:test-skill', fieldId: 'reply' },
      ],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('ok');
    expect(report.missing).toEqual([]);
    expect(report.orphan).toEqual([]);
    expect(report.typeMismatch).toEqual([]);
  });

  it('首段在豁免清单（userVisible/goalConversation/core）→ 不报缺项，且 core 等价字段不算孤儿', () => {
    const core = makeCore([
      { name: 'reply', type: 'string' },
      { name: 'state', type: 'object' },
      { name: 'nextQuestions', type: 'string[]' },
    ]);
    const stage = makeStage(
      [
        { fieldId: 'userVisible', valueType: 'string' },
        { fieldId: 'goalConversation.nextQuestions', valueType: 'array<string>' },
        { fieldId: 'core.stage', valueType: 'string' },
      ],
      [
        { agentId: 'skill:test-skill', fieldId: 'userVisible' },
        { agentId: 'skill:test-skill', fieldId: 'goalConversation.nextQuestions' },
        { agentId: 'skill:test-skill', fieldId: 'core.stage' },
      ],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('ok');
    expect(report.missing).toEqual([]);
    expect(report.orphan).toEqual([]);
    expect(CORE_ALIAS_TO_EXEMPT_ROOT.get('reply')).toBe('userVisible');
    expect(CORE_ALIAS_TO_EXEMPT_ROOT.get('state')).toBe('core');
    expect(EXEMPT_PLATFORM_ROOTS.map((s) => s.root)).toEqual(
      expect.arrayContaining(['userVisible', 'core', 'goalConversation', 'debug', 'control', 'path']),
    );
  });

  it('编排首段不在 core fields 且不在豁免 → 缺项（error 级，state=missing）', () => {
    const core = makeCore([{ name: 'reply', type: 'string' }]);
    const stage = makeStage(
      [{ fieldId: 'unknownRoot.field', valueType: 'string' }],
      [{ agentId: 'skill:test-skill', fieldId: 'unknownRoot.field' }],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('missing');
    expect(report.missing).toEqual([
      expect.objectContaining({ fieldId: 'unknownRoot.field', root: 'unknownRoot' }),
    ]);
  });

  it('core 字段未出现在任何产出行首段 → 孤儿（warn），不阻断 state=ok', () => {
    const core = makeCore([{ name: 'reply', type: 'string' }, { name: 'unusedField', type: 'string' }]);
    const stage = makeStage(
      [{ fieldId: 'reply', valueType: 'string' }],
      [{ agentId: 'skill:test-skill', fieldId: 'reply' }],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('ok');
    expect(report.orphan).toEqual([expect.objectContaining({ coreField: 'unusedField' })]);
  });

  it('顶层直配字段 core type ↔ 编排 valueType 不一致 → typeMismatch（warn）；嵌套与 enum 跳过', () => {
    const core = makeCore([
      { name: 'reply', type: 'string' },
      { name: 'topics', type: 'string[]' },
      { name: 'verdict', type: 'enum' },
    ]);
    const stage = makeStage(
      [
        { fieldId: 'reply', valueType: 'number' },
        { fieldId: 'topics', valueType: 'array<object>' },
        { fieldId: 'verdict', valueType: 'string' },
        { fieldId: 'reply.sub', valueType: 'string' },
      ],
      [
        { agentId: 'skill:test-skill', fieldId: 'reply' },
        { agentId: 'skill:test-skill', fieldId: 'topics' },
        { agentId: 'skill:test-skill', fieldId: 'verdict' },
        { agentId: 'skill:test-skill', fieldId: 'reply.sub' },
      ],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('ok');
    expect(report.typeMismatch).toEqual([
      expect.objectContaining({ fieldId: 'reply', coreType: 'string', routingValueType: 'number' }),
      expect.objectContaining({ fieldId: 'topics', coreType: 'string[]', routingValueType: 'array<object>' }),
    ]);
    // enum（core-only）与嵌套 fieldId（reply.sub）不参与类型比对
    expect(report.typeMismatch.filter((m) => m.fieldId === 'verdict')).toEqual([]);
    expect(report.typeMismatch.filter((m) => m.fieldId === 'reply.sub')).toEqual([]);
  });

  it('aux / handler-only 豁免（不进字段路由）；core 缺失 → no-core；无产出行 → no-routings', () => {
    const stage = makeStage(
      [{ fieldId: 'reply', valueType: 'string' }],
      [{ agentId: 'skill:aux-skill', fieldId: 'reply' }],
    );
    const reports = analyzeCoreFieldsSync([stage], [
      { skillId: 'aux-skill', kind: 'aux' as const, handlerRef: 'backend/src/skills/v4-aux-skills/index.ts' },
      { skillId: 'handler-only-skill', kind: 'handler-only' as const, handlerRef: 'backend/src/skills/x/index.ts', noPromptFile: true },
      { skillId: 'main-skill', kind: 'mainline' as const, stage: 'goal', handlerRef: 'backend/src/skills/x/index.ts' },
      { skillId: 'no-routing-skill', kind: 'mainline' as const, stage: 'goal', handlerRef: 'backend/src/skills/x/index.ts' },
    ], (skillId) => {
      if (skillId === 'no-routing-skill') return { core: makeCore([{ name: 'reply', type: 'string' }]) };
      return null;
    });
    // aux/handler-only 不产出报告
    expect(reports.filter((r) => r.skillId === 'aux-skill')).toEqual([]);
    expect(reports.filter((r) => r.skillId === 'handler-only-skill')).toEqual([]);
    // mainline 无 core 文件 → no-core
    const noCore = reports.find((r) => r.skillId === 'main-skill')!;
    expect(noCore.state).toBe('no-core');
    // mainline 有 core 但该 stage 无产出 routing 行 → no-routings
    const noRoutings = reports.find((r) => r.skillId === 'no-routing-skill')!;
    expect(noRoutings.state).toBe('no-routings');
  });

  it('编排层 agent（非 skill:<id>）的 routing 行天然不在检查范围', () => {
    const core = makeCore([{ name: 'reply', type: 'string' }]);
    const stage = makeStage(
      [{ fieldId: 'normalizedInput.foo', valueType: 'string' }],
      [
        { agentId: 'path-agent', fieldId: 'normalizedInput.foo' },
        { agentId: 'goal-agent', fieldId: 'normalizedInput.foo' },
      ],
    );
    const [report] = analyzeCoreFieldsSync([stage], [SKILL], () => ({ core }));
    expect(report.state).toBe('no-routings');
    expect(report.missing).toEqual([]);
  });
});
