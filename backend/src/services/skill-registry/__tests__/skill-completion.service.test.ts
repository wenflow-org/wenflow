/**
 * 完成度状态机单测（SKILL_READINESS_SPEC §1）
 *
 * 覆盖：5 档正反用例 + handler-only/aux 豁免链 + TODO 占位阻断 + 注册豁免 + 状态回退。
 * 纯函数 computeCompletionState / 装配 buildCompletionInput / 入口 getSkillCompletion
 * 均为依赖注入（book/fs/core/编排/ACTIVE 可 override），零真实 IO。
 */
import {
  computeCompletionState,
  buildCompletionInput,
  getSkillCompletion,
  hasScaffoldTodo,
  defaultRegisteredCheck,
  type ComputeCompletionInput,
  type CompletionAssemblyDeps,
} from '../skill-completion.service';
import type { SkillsBook, SkillEntry } from '../skills-file';
import type { CoreFile } from '../../prompt-lab/core-file-loader';
import type { OrchestrationStage } from '../../field-routing/orchestration-file';

// F11 键集分派测试：mock 注册键集，避免加载真实 skills/agents 模块（其导入期会触发
// refreshHardRequiredCache → 字段路由缓存刷新等生产装配，jest 环境下有循环 require 风险）
jest.mock('../../../skills', () => ({
  skillHandlers: { 'goal-conversation': jest.fn(), 'stage-designer': jest.fn() },
  allSkillDefinitions: [{ name: 'stage-designer' }],
}));
jest.mock('../../../agents', () => ({
  agentHandlers: { 'skill:learner-model': jest.fn() },
}));

function makeEntry(overrides: Partial<Record<string, unknown>> = {}): SkillEntry {
  return {
    skillId: 'goal-conversation',
    kind: 'mainline',
    stage: 'goal',
    handlerRef: 'backend/src/skills/goal-conversation/index.ts',
    coreFile: 'prompts/core/goal-conversation.yaml',
    ...(overrides as any),
  };
}

function makeBook(entries: SkillEntry[]): SkillsBook {
  return { version: 1, skills: entries };
}

function makeCore(overrides: Partial<Record<string, unknown>> = {}): CoreFile {
  return {
    skillId: 'goal-conversation',
    baseVersion: 1,
    identity: '你是目标对话 Skill。',
    channels: ['dialogue'],
    stateAdvance: false,
    rules: ['按协议输出。'],
    fields: [{ name: 'reply', type: 'string', optional: false, desc: '回复', turn: true }],
    constraints: [],
    params: { temperature: 0.7, maxTokens: 2000, failurePolicy: 'retry-once' },
    deltaOutput: false,
    outputMedia: 'json',
    ...(overrides as any),
  };
}

function makeStage(overrides: Partial<Record<string, unknown>> = {}): OrchestrationStage {
  return {
    stage: 'goal',
    contracts: [{ agentId: 'skill:goal-conversation' }],
    routings: [
      { agentId: 'skill:goal-conversation', fieldId: 'reply', valueType: 'string', dest: 'output' },
    ],
    fields: [{ fieldId: 'reply', valueType: 'string' }],
    ...(overrides as any),
  };
}

/** 全绿输入（live 正例基线） */
function makeFullInput(entry: SkillEntry = makeEntry()): ComputeCompletionInput {
  return {
    entry,
    handlerFileExists: true,
    registered: true,
    core: {
      loaded: true,
      valid: true,
      fields: ['reply'],
      hasTodo: false,
    },
    fieldsSync: {
      state: 'ok',
      missingCount: 0,
      orphanCount: 0,
      typeMismatchCount: 0,
      contractWired: true,
    },
    activePromptExists: true,
    checksGreen: true,
    inManifest: true,
  };
}

describe('skill-completion：五档状态推进（正例）', () => {
  it('draft：户口簿有条目即可（handler 缺失 + 未注册）', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      handlerFileExists: false,
      registered: false,
    });
    expect(report.status).toBe('draft');
    expect(report.gates.draft.ok).toBe(true);
    expect(report.gates.handlerReady.ok).toBe(false);
    expect(report.gates.handlerReady.detail).toContain('文件不存在');
  });

  it('占位 handler 场景：handler 文件存在但未注册 → handler-ready（F11 仅展示项，不阻断状态推进）', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      registered: false,
      core: { loaded: false, valid: false, fields: [], hasTodo: false },
    });
    expect(report.status).toBe('handler-ready');
    expect(report.gates.handlerReady.ok).toBe(true);
    expect(report.gates.handlerReady.detail).toContain('handler 文件');
    expect(report.gates.handlerReady.detail).toContain('注册未就绪');
    // F11 注册存在性移入 items 展示（checksGreen 语义），不参与状态推进
    expect(report.items.find((item) => item.id === 'registered')?.ok).toBe(false);
    expect(report.items.find((item) => item.id === 'registered')?.hint).toContain('不阻断');
  });

  it('handler-ready：handler 文件 + 注册齐全，core 缺失', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      core: { loaded: false, valid: false, fields: [], hasTodo: false },
    });
    expect(report.status).toBe('handler-ready');
    expect(report.gates.handlerReady.ok).toBe(true);
    expect(report.gates.coreReady.ok).toBe(false);
    expect(report.gates.coreReady.detail).toContain('文件不存在');
  });

  it('core-ready：core 合法但 fields-sync 缺项 → 停在 core-ready', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      fieldsSync: {
        state: 'missing',
        missingCount: 2,
        orphanCount: 0,
        typeMismatchCount: 0,
        contractWired: true,
      },
      activePromptExists: false,
    });
    expect(report.status).toBe('core-ready');
    expect(report.gates.coreReady.ok).toBe(true);
    expect(report.gates.fieldsSynced.ok).toBe(false);
    expect(report.gates.fieldsSynced.detail).toContain('2 个缺项');
  });

  it('core-ready：编排 contracts 缺 skill:<id>（F3 铁律）→ 阻断 fields-synced', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      fieldsSync: {
        state: 'ok',
        missingCount: 0,
        orphanCount: 0,
        typeMismatchCount: 0,
        contractWired: false,
      },
      activePromptExists: false,
    });
    expect(report.status).toBe('core-ready');
    expect(report.gates.fieldsSynced.detail).toContain('编排契约缺 skill:goal-conversation');
  });

  it('fields-synced：字段路由无缺项但无 ACTIVE prompt → 停在 fields-synced', () => {
    const report = computeCompletionState({ ...makeFullInput(), activePromptExists: false });
    expect(report.status).toBe('fields-synced');
    expect(report.gates.fieldsSynced.ok).toBe(true);
    expect(report.gates.live.ok).toBe(false);
    expect(report.gates.live.detail).toContain('无 ACTIVE 行');
  });

  it('live：全绿（含孤儿/类型 warn 不阻断）', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      fieldsSync: {
        state: 'ok',
        missingCount: 0,
        orphanCount: 1,
        typeMismatchCount: 1,
        contractWired: true,
      },
    });
    expect(report.status).toBe('live');
    expect(report.gates.live.ok).toBe(true);
    expect(report.gates.live.detail).toContain('ACTIVE');
    // 孤儿/类型不一致只进依据文本，不阻断状态
    expect(report.gates.fieldsSynced.detail).toContain('孤儿 1 条');
    expect(report.items.find((item) => item.id === 'fieldsSynced')?.ok).toBe(true);
  });
});

describe('skill-completion：豁免链（handler-only / aux）', () => {
  it('handler-only：core-ready / fields-synced / live 全豁免 → 直接 live', () => {
    const entry = makeEntry({
      skillId: 'learner-model',
      kind: 'handler-only',
      noPromptFile: true,
      registrationPoint: 'agents',
      coreFile: undefined,
      stage: undefined,
    });
    const report = computeCompletionState({
      ...makeFullInput(entry),
      core: null,
      fieldsSync: null,
      activePromptExists: false,
      registered: true,
    });
    expect(report.status).toBe('live');
    expect(report.gates.coreReady.detail).toContain('handler-only 豁免');
    expect(report.gates.fieldsSynced.detail).toContain('豁免');
    expect(report.gates.live.detail).toContain('豁免：无 prompt 文件');
  });

  it('aux：fields-synced 豁免但 live 不豁免（runAux requireActivePrompt）', () => {
    const entry = makeEntry({ skillId: 'teaching-opening-generator', kind: 'aux', stage: undefined });
    const report = computeCompletionState({
      ...makeFullInput(entry),
      fieldsSync: null,
      activePromptExists: false,
    });
    expect(report.status).toBe('fields-synced');
    expect(report.gates.fieldsSynced.ok).toBe(true);
    expect(report.gates.live.ok).toBe(false);
    expect(report.gates.live.detail).toContain('辅助 Skill 不豁免');
  });

  it('aux：有 ACTIVE → live（manifest 分项对 aux 恒绿，F12 豁免）', () => {
    const entry = makeEntry({ skillId: 'teaching-opening-generator', kind: 'aux', stage: undefined });
    const report = computeCompletionState({ ...makeFullInput(entry), fieldsSync: null, inManifest: false });
    expect(report.status).toBe('live');
    expect(report.items.find((item) => item.id === 'manifest')?.ok).toBe(true);
  });
});

describe('skill-completion：阻断与回退（反例）', () => {
  it('core.yaml 含 scaffold TODO 占位 → 阻断 core-ready', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      core: { loaded: true, valid: true, fields: ['reply'], hasTodo: true },
    });
    expect(report.status).toBe('handler-ready');
    expect(report.gates.coreReady.ok).toBe(false);
    expect(report.gates.coreReady.detail).toContain('TODO');
  });

  it('core.yaml schema 校验失败 → 阻断 core-ready', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      core: { loaded: true, valid: false, fields: [], hasTodo: false },
    });
    expect(report.status).toBe('handler-ready');
    expect(report.gates.coreReady.detail).toContain('格式校验失败');
  });

  it('core fields 为空 → 阻断 core-ready', () => {
    const report = computeCompletionState({
      ...makeFullInput(),
      core: { loaded: true, valid: true, fields: [], hasTodo: false },
    });
    expect(report.status).toBe('handler-ready');
    expect(report.gates.coreReady.detail).toContain('fields 为空');
  });

  it('platform-direct / none 注册豁免：未落注册表也可达 handler-ready', () => {
    for (const registrationPoint of ['platform-direct', 'none']) {
      const entry = makeEntry({ skillId: 'semantic-freeze-judge', registrationPoint });
      const report = computeCompletionState({
        ...makeFullInput(entry),
        registered: true,
        core: { loaded: false, valid: false, fields: [], hasTodo: false },
      });
      expect(report.status).toBe('handler-ready');
      expect(report.gates.handlerReady.ok).toBe(true);
    }
  });

  it('状态回退：live 全绿后 core 被删 → 回退 handler-ready（派生投影不落库）', () => {
    const input = makeFullInput();
    expect(computeCompletionState(input).status).toBe('live');
    const regressed = computeCompletionState({
      ...input,
      core: { loaded: false, valid: false, fields: [], hasTodo: false },
    });
    expect(regressed.status).toBe('handler-ready');
    // 各档独立判定：ACTIVE 行仍在（live 档事实未变），但连续前缀被 core 档截断
    expect(regressed.gates.live.ok).toBe(true);
    expect(regressed.gates.coreReady.ok).toBe(false);
  });

  it('展示项：wired=false 进 warnings 但不参与状态；recentCalls 恒 null', () => {
    const report = computeCompletionState({ ...makeFullInput(), wired: false });
    expect(report.status).toBe('live');
    expect(report.warnings).toContain('W3-wired 未接线（辅助展示，不进状态判定）');
    expect(report.items.find((item) => item.id === 'recentCalls')?.ok).toBeNull();
    expect(report.items.find((item) => item.id === 'checksGreen')?.ok).toBe(true);
  });
});

describe('skill-completion：装配与入口（依赖注入）', () => {
  const deps: CompletionAssemblyDeps = {
    book: makeBook([makeEntry()]),
    existsFile: () => true,
    registeredCheck: () => true,
    loadCore: () => ({ core: makeCore() }),
    orchestrationStages: [makeStage()],
    activePromptIds: new Set(['skill:goal-conversation']),
    inManifest: () => true,
  };

  it('buildCompletionInput：全绿注入 → live', async () => {
    const input = await buildCompletionInput(makeEntry(), deps);
    const report = computeCompletionState(input);
    expect(report.status).toBe('live');
    expect(input.handlerFileExists).toBe(true);
    expect(input.core).toEqual({ loaded: true, valid: true, fields: ['reply'], hasTodo: false });
    expect(input.fieldsSync?.contractWired).toBe(true);
    expect(input.activePromptExists).toBe(true);
  });

  it('buildCompletionInput：handler 文件缺失 + 无 ACTIVE → draft（FS 事实注入生效）', async () => {
    const input = await buildCompletionInput(makeEntry(), {
      ...deps,
      existsFile: () => false,
      registeredCheck: () => false,
      activePromptIds: new Set(),
    });
    const report = computeCompletionState(input);
    expect(report.status).toBe('draft');
  });

  it('buildCompletionInput：fields-sync 缺项注入 → core-ready（孤儿不阻断）', async () => {
    const input = await buildCompletionInput(makeEntry(), {
      ...deps,
      loadCore: () => ({ core: makeCore() }),
      orchestrationStages: [
        makeStage({
          routings: [
            { agentId: 'skill:goal-conversation', fieldId: 'ghostRoot.x', valueType: 'string', dest: 'output' },
          ],
        }),
      ],
    });
    const report = computeCompletionState(input);
    expect(report.status).toBe('core-ready');
    expect(report.gates.fieldsSynced.detail).toContain('缺项');
  });

  it('getSkillCompletion：skillId 不在户口簿 → 抛错', async () => {
    await expect(getSkillCompletion('ghost-skill', deps)).rejects.toThrow('不在户口簿');
  });

  it('getSkillCompletion：入口 → 完整报告（gates 五档 + items 九项）', async () => {
    const report = await getSkillCompletion('goal-conversation', deps);
    expect(report.status).toBe('live');
    expect(Object.keys(report.gates)).toEqual(['draft', 'handlerReady', 'coreReady', 'fieldsSynced', 'live']);
    expect(report.items.map((item) => item.id)).toEqual([
      'manifest', 'handler', 'registered', 'core', 'fieldsSynced', 'promptActive', 'checksGreen', 'wired', 'recentCalls',
    ]);
  });
});

describe('skill-completion：注册判定（F11 键集分派）', () => {
  it('defaultRegisteredCheck：skillHandlers 键 / definitions 名 / agents skill:<id> 命中', () => {
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'goal-conversation' }))).toBe(true);
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'stage-designer' }))).toBe(true);
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'learner-model', kind: 'handler-only', registrationPoint: 'agents', noPromptFile: true, coreFile: undefined }))).toBe(true);
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'unknown-skill' }))).toBe(false);
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'semantic-freeze-judge', registrationPoint: 'platform-direct' }))).toBe(true);
    expect(defaultRegisteredCheck(makeEntry({ skillId: 'ghost', registrationPoint: 'none' }))).toBe(true);
  });
});

describe('skill-completion：TODO 占位扫描', () => {
  it('hasScaffoldTodo：identity/rules 含 TODO → true；无 → false', () => {
    expect(hasScaffoldTodo(makeCore())).toBe(false);
    expect(hasScaffoldTodo(makeCore({ identity: 'TODO: 填写身份' }))).toBe(true);
    expect(hasScaffoldTodo(makeCore({ rules: ['TODO 占位规则'] }))).toBe(true);
  });
});
