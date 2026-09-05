/**
 * M1 统一编辑：加字段原子 API 单测（UNIFIED_EDITING_DESIGN §4.3 / §5.4）
 *
 * 覆盖：
 * - 成功路径：双文件写入（文本级追加保留格式）+ ensure 落库 + 审计 + sync 复检
 * - valueType 映射（core string[] → array<string>；object? → object）
 * - 锁映射（locked=system → systemLocked；locked=structure → structureLocked）
 * - 幂等 409（core fields ∪ 编排 fieldId 重名）
 * - core 校验失败 → 不落任何文件（编排不写）
 * - 编排校验失败 → core 不写（内存校验前置）
 * - 编排写盘失败 → core 回滚原内容（fs 注入 EIO）
 * - enum（core-only）→ 422 VALUE_TYPE_UNMAPPABLE
 * - GET /api/admin/field-routings/skill/:skillId 集成：POST 后新字段可见 + sync 投影
 *
 * 通过 jest.isolateModules 在设置 CORE_FILES_DIR / ORCHESTRATION_DIR / SKILLS_FILE /
 * PROMPTS_DIR 后动态装载路由（目录常量在模块装载时固化），避免触碰真实 prompts/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockCoreParseFail = { value: false };
const mockOrchestrationValidateFail = { value: false };

// ---- 内存假库（ensureStageFieldRoutings 只建不更新语义） ----
const dbTables = {
  agent_contracts: new Map<string, Record<string, any>>(),
  field_definitions: new Map<string, Record<string, any>>(),
  agent_field_routings: new Map<string, Record<string, any>>(),
};
const dbAudit: Array<Record<string, any>> = [];

function resetDb(): void {
  dbTables.agent_contracts.clear();
  dbTables.field_definitions.clear();
  dbTables.agent_field_routings.clear();
  dbAudit.length = 0;
}

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_contracts: {
      findUnique: async ({ where }: any) => dbTables.agent_contracts.get(where.agentId) ?? null,
      upsert: async ({ where, create }: any) => {
        const existing = dbTables.agent_contracts.get(where.agentId);
        if (existing) return existing;
        dbTables.agent_contracts.set(where.agentId, create);
        return create;
      },
    },
    field_definitions: {
      findFirst: async ({ where }: any) =>
        [...dbTables.field_definitions.values()].find((r) => r.stage === where.stage && r.fieldId === where.fieldId) ?? null,
      findUnique: async ({ where }: any) =>
        dbTables.field_definitions.get(`${where.stage_fieldId.stage}\u0000${where.stage_fieldId.fieldId}`) ?? null,
      upsert: async ({ where, create }: any) => {
        const key = `${where.stage_fieldId.stage}\u0000${where.stage_fieldId.fieldId}`;
        const existing = dbTables.field_definitions.get(key);
        if (existing) return existing;
        dbTables.field_definitions.set(key, create);
        return create;
      },
      findMany: async ({ where }: any) => [...dbTables.field_definitions.values()].filter((r) => r.stage === where.stage),
    },
    agent_field_routings: {
      findUnique: async ({ where }: any) =>
        dbTables.agent_field_routings.get(`${where.agentId_fieldId.agentId}\u0000${where.agentId_fieldId.fieldId}`) ?? null,
      upsert: async ({ where, create }: any) => {
        const key = `${where.agentId_fieldId.agentId}\u0000${where.agentId_fieldId.fieldId}`;
        const existing = dbTables.agent_field_routings.get(key);
        if (existing) return existing;
        dbTables.agent_field_routings.set(key, create);
        return create;
      },
      findMany: async () => [...dbTables.agent_field_routings.values()],
    },
    node_config_changes: {
      create: async ({ data }: any) => {
        dbAudit.push(data);
        return { id: data.id, ...data };
      },
    },
  },
}));

jest.mock('../../services/field-dispatcher', () => ({ clearRoutingCache: jest.fn() }));

jest.mock('../../services/prompt-composer', () => ({ clearSupplementRenderCache: jest.fn() }));

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: jest.fn(() => ({ invalidateCache: jest.fn() })),
}));

jest.mock('../../services/cache/prompt-cache.service', () => ({
  promptCache: { clearAgentCache: jest.fn() },
}));

jest.mock('../../services/prompt-lab/core-file-loader', () => {
  const actual = jest.requireActual('../../services/prompt-lab/core-file-loader');
  return {
    ...actual,
    parseCoreFile: jest.fn((filePath: string, raw: string) => {
      if (mockCoreParseFail.value && raw.includes('corefail_field')) {
        return {
          core: null,
          diagnostics: [{ filePath, code: 'schema-error', message: '模拟核心文件校验失败' }],
        };
      }
      return actual.parseCoreFile(filePath, raw);
    }),
  };
});

jest.mock('../../services/field-routing/orchestration-file', () => {
  const actual = jest.requireActual('../../services/field-routing/orchestration-file');
  return {
    ...actual,
    validateOrchestrationContent: jest.fn((content: string) => {
      if (mockOrchestrationValidateFail.value && content.includes('orchfail_field')) {
        throw new Error('模拟编排校验失败');
      }
      return actual.validateOrchestrationContent(content);
    }),
  };
});

const FIXTURE_CORE = `# test core（fixture）
skillId: goal-conversation
baseVersion: 1
identity: 测试核心文件
channels: [dialogue]
stateAdvance: false
rules:
  - 测试规则
fields:
  - name: reply
    type: string
    turn: true
    desc: 回复文本
  - name: understanding
    type: object
    desc: |
      累积的理解数据
      · surface_goal（string）用户原始诉求
constraints: []
params: { temperature: 0.5, maxTokens: 4000, failurePolicy: retry }
deltaOutput: false
outputMedia: json
`;

const FIXTURE_ORCHESTRATION = `# test goal.yaml（fixture）
stage: goal
order: 1
displayName: Goal 阶段
description: 测试 fixture

contracts:
  - agentId: skill:goal-conversation
  - agentId: goal-agent

fields:
  - fieldId: understanding.surface_goal
    promptRole: hard-required
    valueType: string
    description: 用户最初表述的原话

routings:
  - agentId: skill:goal-conversation
    fieldId: understanding.surface_goal
    render: visible
    handoff: [goal-agent]
    internal: false
    accumulate: true
`;

const FIXTURE_SKILLS = `version: 1
skills:
  - skillId: goal-conversation
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/goal-conversation/index.ts
    coreFile: prompts/core/goal-conversation.yaml
`;

let tempRoot = '';
let coreDir = '';
let orchestrationDir = '';
let promptsDir = '';
let skillsFile = '';
let promptLabRouter: any;
let fieldRoutingsRouter: any;

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-field-add-'));
  coreDir = path.join(tempRoot, 'core');
  orchestrationDir = path.join(tempRoot, 'orchestration');
  promptsDir = path.join(tempRoot, 'prompts');
  skillsFile = path.join(tempRoot, 'skills.yaml');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(orchestrationDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'goal-conversation.yaml'), FIXTURE_CORE, 'utf-8');
  fs.writeFileSync(path.join(orchestrationDir, 'goal.yaml'), FIXTURE_ORCHESTRATION, 'utf-8');
  fs.writeFileSync(skillsFile, FIXTURE_SKILLS, 'utf-8');

  process.env.CORE_FILES_DIR = coreDir;
  process.env.ORCHESTRATION_DIR = orchestrationDir;
  process.env.SKILLS_FILE = skillsFile;
  process.env.PROMPTS_DIR = promptsDir;

  jest.isolateModules(() => {
    promptLabRouter = require('../prompt-lab').default;
    fieldRoutingsRouter = require('../admin/field-routings').default;
  });
});

afterAll(() => {
  delete process.env.CORE_FILES_DIR;
  delete process.env.ORCHESTRATION_DIR;
  delete process.env.SKILLS_FILE;
  delete process.env.PROMPTS_DIR;
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  resetDb();
  mockCoreParseFail.value = false;
  mockOrchestrationValidateFail.value = false;
  fs.writeFileSync(path.join(coreDir, 'goal-conversation.yaml'), FIXTURE_CORE, 'utf-8');
  fs.writeFileSync(path.join(orchestrationDir, 'goal.yaml'), FIXTURE_ORCHESTRATION, 'utf-8');
});

function getRouteHandler(router: any, p: string, method: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === p && item.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

async function postField(payload: Record<string, unknown>, skillId = 'goal-conversation') {
  const handler = getRouteHandler(promptLabRouter, '/core/:skillId/field', 'post');
  const res = createResponse();
  await handler({ params: { skillId }, body: payload, user: { userId: 'u1' } }, res);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

async function getSkillRoutings(skillId = 'goal-conversation') {
  const handler = getRouteHandler(fieldRoutingsRouter, '/skill/:skillId', 'get');
  const res = createResponse();
  await handler({ params: { skillId } }, res);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

const readCore = () => fs.readFileSync(path.join(coreDir, 'goal-conversation.yaml'), 'utf-8');
const readOrchestration = () => fs.readFileSync(path.join(orchestrationDir, 'goal.yaml'), 'utf-8');

describe('appendFieldToCore / appendFieldToOrchestration 纯函数（格式保留 + parse 往返）', () => {
  it('顶层直配：fields 末尾追加，原文件注释/flow 风格保留，parseCoreFile 往返通过', async () => {
    const { appendFieldToCore } = jest.requireActual<typeof import('../../services/skill-registry/skill-scaffold.service')>(
      '../../services/skill-registry/skill-scaffold.service',
    );
    const next = appendFieldToCore(FIXTURE_CORE, { name: 'test_flag', type: 'string', desc: '测试字段', turn: true });
    const { parseCoreFile } = jest.requireActual('../../services/prompt-lab/core-file-loader');
    const checked = parseCoreFile(path.join(coreDir, 'goal-conversation.yaml'), next);
    expect(checked.core).not.toBeNull();
    expect(checked.core!.fields.find((f) => f.name === 'test_flag')).toMatchObject({
      type: 'string',
      desc: '测试字段',
      turn: true,
    });
    // 原文件格式保留
    expect(next).toContain('# test core（fixture）');
    expect(next).toContain('channels: [dialogue]');
    expect(next).toContain('  - name: test_flag');
  });

  it('嵌套（root 缺失）：追加顶层 object + desc 列子字段', async () => {
    const { appendFieldToCore } = jest.requireActual<typeof import('../../services/skill-registry/skill-scaffold.service')>(
      '../../services/skill-registry/skill-scaffold.service',
    );
    const next = appendFieldToCore(FIXTURE_CORE, {
      name: 'learner_profile.goal',
      type: 'string',
      desc: '',
      children: [{ path: 'goal', type: 'string', desc: '学习目标' }],
    });
    const { parseCoreFile } = jest.requireActual('../../services/prompt-lab/core-file-loader');
    const checked = parseCoreFile(path.join(coreDir, 'goal-conversation.yaml'), next);
    expect(checked.core!.fields.find((f) => f.name === 'learner_profile')).toMatchObject({
      type: 'object',
    });
    expect(checked.core!.fields.find((f) => f.name === 'learner_profile')!.desc).toContain('· goal（string）学习目标');
  });

  it('嵌套（root 存在）：仅补 desc 子字段说明，原块标量保留', async () => {
    const { appendFieldToCore } = jest.requireActual<typeof import('../../services/skill-registry/skill-scaffold.service')>(
      '../../services/skill-registry/skill-scaffold.service',
    );
    const next = appendFieldToCore(FIXTURE_CORE, {
      name: 'understanding.new_subfield',
      type: 'string',
      desc: '',
      children: [{ path: 'new_subfield', type: 'string', desc: '新子字段说明' }],
    });
    const { parseCoreFile } = jest.requireActual('../../services/prompt-lab/core-file-loader');
    const checked = parseCoreFile(path.join(coreDir, 'goal-conversation.yaml'), next);
    const understanding = checked.core!.fields.find((f) => f.name === 'understanding')!;
    expect(understanding.desc).toContain('· surface_goal（string）用户原始诉求');
    expect(understanding.desc).toContain('· new_subfield（string）新子字段说明');
  });

  it('编排双段追加：注释保留 + validateOrchestrationContent 通过', async () => {
    const { appendFieldToOrchestration } = jest.requireActual<typeof import('../../services/skill-registry/skill-scaffold.service')>(
      '../../services/skill-registry/skill-scaffold.service',
    );
    const next = appendFieldToOrchestration(
      FIXTURE_ORCHESTRATION,
      { fieldId: 'test_flag', promptRole: 'public-reply', valueType: 'string', description: '测试字段' },
      { agentId: 'skill:goal-conversation', fieldId: 'test_flag', render: 'visible', handoff: [], internal: false, accumulate: false },
    );
    const { validateOrchestrationContent } = jest.requireActual('../../services/field-routing/orchestration-file');
    const stage = validateOrchestrationContent(next);
    expect(stage.fields.find((f) => f.fieldId === 'test_flag')!.description).toBe('测试字段');
    expect(stage.routings.find((r) => r.fieldId === 'test_flag')!.agentId).toBe('skill:goal-conversation');
    expect(next).toContain('# test goal.yaml（fixture）');
  });
});

describe('POST /core/:skillId/field 成功路径', () => {
  it('顶层字段：双文件写入（保留格式）+ 落库 + 审计 + sync 复检通过', async () => {
    const { body } = await postField({
      name: 'test_flag',
      type: 'string',
      role: 'public-reply',
      render: 'visible',
      desc: '测试字段：标记本轮是否完成',
      turn: true,
    });

    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.field).toEqual({ name: 'test_flag', fieldId: 'test_flag' });
    expect(data.coreWritten).toBe(true);
    expect(data.orchestrationWritten).toBe(true);
    expect(data.synced).toBe(true);
    expect(data.syncCheck.missing).toHaveLength(0);
    expect(data.syncCheck.typeMismatch).toHaveLength(0);
    expect(data.auditId).toBeTruthy();

    // 双文件
    const coreText = readCore();
    expect(coreText).toContain('  - name: test_flag');
    expect(coreText).toContain('    type: string');
    expect(coreText).toContain('    turn: true');
    expect(coreText).toContain('    desc: 测试字段：标记本轮是否完成');
    expect(coreText).toContain('channels: [dialogue]'); // 原格式保留
    const orchText = readOrchestration();
    expect(orchText).toContain('  - fieldId: test_flag');
    expect(orchText).toContain('    promptRole: public-reply');
    expect(orchText).toContain('    valueType: string');
    expect(orchText).toContain('  - agentId: skill:goal-conversation');
    expect(orchText).toContain('    handoff: []');
    expect(orchText).toContain('# test goal.yaml（fixture）'); // 注释保留

    // 落库（ensure 只建不更新）
    expect([...dbTables.field_definitions.values()].some((r) => r.fieldId === 'test_flag' && r.stage === 'goal')).toBe(true);
    const fieldRow = [...dbTables.field_definitions.values()].find((r) => r.fieldId === 'test_flag')!;
    expect(fieldRow.promptRole).toBe('public-reply');
    expect(fieldRow.valueType).toBe('string');
    expect(fieldRow.description).toBe('测试字段：标记本轮是否完成');
    expect([...dbTables.agent_field_routings.values()].some((r) => r.agentId === 'skill:goal-conversation' && r.fieldId === 'test_flag')).toBe(true);

    // 审计
    const audit = dbAudit[dbAudit.length - 1];
    expect(audit.changeType).toBe('skill-field-add');
    expect(audit.targetTable).toBe('core.yaml+orchestration');
    expect(audit.targetId).toBe('goal-conversation');
    expect(audit.fieldId).toBe('test_flag');
    expect(audit.before).toBeNull();
    expect(JSON.parse(audit.after)).toMatchObject({ fieldId: 'test_flag', coreType: 'string', promptRole: 'public-reply' });
    expect(audit.actorId).toBe('u1');

    // 备份
    const backupsDir = path.join(promptsDir, 'backups', 'unified-edit');
    const tsDirs = fs.readdirSync(backupsDir);
    expect(tsDirs.length).toBeGreaterThan(0);
    const latest = path.join(backupsDir, tsDirs[tsDirs.length - 1]);
    expect(fs.existsSync(path.join(latest, 'core-goal-conversation.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(latest, 'orchestration-goal.yaml'))).toBe(true);
  });

  it('valueType 映射：type=string[] → array<string>；type=object? → object（? 剥除）', async () => {
    const { body: body1 } = await postField({
      name: 'tags_array',
      type: 'string[]',
      role: 'soft-info',
      render: 'hidden',
      handoff: ['goal-agent'],
      internal: true,
      desc: '标签数组',
    });
    expect(body1.success).toBe(true);
    expect(readOrchestration()).toContain('    valueType: array<string>');

    const { body: body2 } = await postField({
      name: 'optional_object',
      type: 'object?',
      role: 'public-reply',
      desc: '可选对象',
    });
    expect(body2.success).toBe(true);
    const orch = readOrchestration();
    expect(orch).toContain('    valueType: object');
    expect(readCore()).toContain('    type: object?');
  });

  it('锁映射：locked=system → systemLocked: true；locked=structure → structureLocked: true', async () => {
    const { body: body1 } = await postField({
      name: 'locked_system_field',
      type: 'number',
      role: 'control-signal',
      render: 'hidden',
      internal: true,
      locked: 'system',
      desc: '系统锁定字段',
    });
    expect(body1.success).toBe(true);
    const orch1 = readOrchestration();
    expect(orch1).toContain('    systemLocked: true');
    expect(orch1).not.toContain('    structureLocked: true');
    const fieldRow1 = [...dbTables.field_definitions.values()].find((r) => r.fieldId === 'locked_system_field')!;
    expect(fieldRow1.systemLocked).toBe(true);
    expect(fieldRow1.structureLocked).toBe(false);

    const { body: body2 } = await postField({
      name: 'locked_structure_field',
      type: 'boolean',
      role: 'soft-info',
      render: 'hidden',
      internal: true,
      locked: 'structure',
      desc: '结构锁定字段',
    });
    expect(body2.success).toBe(true);
    expect(readOrchestration()).toContain('    structureLocked: true');
    const fieldRow2 = [...dbTables.field_definitions.values()].find((r) => r.fieldId === 'locked_structure_field')!;
    expect(fieldRow2.systemLocked).toBe(false);
    expect(fieldRow2.structureLocked).toBe(true);
  });

  it('嵌套字段：root 缺失 → core 追加 object 顶层；编排 fieldId 原样点分', async () => {
    const { body } = await postField({
      name: 'learner_profile.goal',
      type: 'string',
      role: 'soft-info',
      handoff: ['goal-agent'],
      desc: '学习目标画像',
    });
    expect(body.success).toBe(true);
    const coreText = readCore();
    expect(coreText).toContain('  - name: learner_profile');
    expect(coreText).toContain('    type: object');
    expect(coreText).toContain('· goal（string）学习目标画像');
    const orchText = readOrchestration();
    expect(orchText).toContain('  - fieldId: learner_profile.goal');
    expect(orchText).toContain('    valueType: string');
  });

  it('嵌套字段：root 存在 → core understanding desc 追加子字段说明', async () => {
    const { body } = await postField({
      name: 'understanding.new_subfield',
      type: 'string',
      role: 'soft-info',
      handoff: ['goal-agent'],
      desc: '新子字段说明',
    });
    expect(body.success).toBe(true);
    const coreText = readCore();
    expect(coreText).toContain('· new_subfield（string）新子字段说明');
    expect(coreText).toContain('· surface_goal（string）用户原始诉求');
    const { parseCoreFile } = jest.requireActual('../../services/prompt-lab/core-file-loader');
    const checked = parseCoreFile(path.join(coreDir, 'goal-conversation.yaml'), coreText);
    expect(checked.core!.fields.find((f) => f.name === 'understanding')!.desc).toContain('· new_subfield（string）新子字段说明');
  });
});

describe('POST /core/:skillId/field 幂等与校验失败回滚', () => {
  it('幂等：同名 fieldId 二次提交 → 409 FIELD_EXISTS，文件无二次追加', async () => {
    const first = await postField({ name: 'dup_field', type: 'string', role: 'public-reply', desc: '重复字段' });
    expect(first.body.success).toBe(true);
    const orchAfterFirst = readOrchestration();

    const second = await postField({ name: 'dup_field', type: 'string', role: 'public-reply', desc: '重复字段' });
    expect(second.res.status).toHaveBeenCalledWith(409);
    expect(second.body.code).toBe('FIELD_EXISTS');
    expect(readOrchestration()).toBe(orchAfterFirst);
    // DB 无重复行
    expect([...dbTables.field_definitions.values()].filter((r) => r.fieldId === 'dup_field')).toHaveLength(1);
  });

  it('core 校验失败 → 422 CORE_VALIDATION_FAILED，双文件均未写（编排不写）', async () => {
    mockCoreParseFail.value = true;
    const coreBefore = readCore();
    const orchBefore = readOrchestration();
    const { res, body } = await postField({
      name: 'corefail_field',
      type: 'string',
      role: 'public-reply',
      desc: '触发 core 校验失败',
    });
    expect(res.status).toHaveBeenCalledWith(422);
    expect(body.code).toBe('CORE_VALIDATION_FAILED');
    expect(readCore()).toBe(coreBefore);
    expect(readOrchestration()).toBe(orchBefore);
    expect([...dbTables.field_definitions.values()].some((r) => r.fieldId === 'corefail_field')).toBe(false);
    expect(dbAudit.length).toBe(0);
  });

  it('编排校验失败 → 422 ORCHESTRATION_VALIDATION_FAILED，core 恢复原内容', async () => {
    mockOrchestrationValidateFail.value = true;
    const coreBefore = readCore();
    const orchBefore = readOrchestration();
    const { res, body } = await postField({
      name: 'orchfail_field',
      type: 'string',
      role: 'public-reply',
      desc: '触发编排校验失败',
    });
    expect(res.status).toHaveBeenCalledWith(422);
    expect(body.code).toBe('ORCHESTRATION_VALIDATION_FAILED');
    expect(readCore()).toBe(coreBefore);
    expect(readOrchestration()).toBe(orchBefore);
  });

  it('编排写盘失败 → 500 ORCHESTRATION_WRITE_FAILED，core 回滚原内容', async () => {
    const rawFsp = jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const originalWriteFile = rawFsp.writeFile.bind(rawFsp);
    const spy = jest.spyOn(rawFsp, 'writeFile').mockImplementation(async (p: any, d: any, e: any) => {
      if (!String(p).endsWith('goal-conversation.yaml')) throw new Error('EIO: 模拟编排写盘失败');
      return originalWriteFile(p, d, e);
    });
    try {
      const coreBefore = readCore();
      const { res, body } = await postField({
        name: 'writefail_field',
        type: 'string',
        role: 'public-reply',
        desc: '触发编排写盘失败',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(body.code).toBe('ORCHESTRATION_WRITE_FAILED');
      expect(readCore()).toBe(coreBefore); // core 已回滚
      expect(readOrchestration()).not.toContain('writefail_field'); // 编排未写
    } finally {
      spy.mockRestore();
    }
  });

  it('enum（core-only）→ 422 VALUE_TYPE_UNMAPPABLE；非法 handoff 目标 → 422 HANDOFF_TARGET_UNKNOWN', async () => {
    const coreBefore = readCore();
    const { res, body } = await postField({ name: 'enum_field', type: 'enum', role: 'soft-info', desc: '枚举字段' });
    expect(res.status).toHaveBeenCalledWith(422);
    expect(body.code).toBe('VALUE_TYPE_UNMAPPABLE');
    expect(readCore()).toBe(coreBefore);

    const { res: res2, body: body2 } = await postField({
      name: 'bad_handoff_field',
      type: 'string',
      role: 'soft-info',
      handoff: ['nope-agent'],
      desc: '非法流转目标',
    });
    expect(res2.status).toHaveBeenCalledWith(422);
    expect(body2.code).toBe('HANDOFF_TARGET_UNKNOWN');
  });
});

describe('GET /skill/:skillId 集成（POST 后读取）', () => {
  it('POST 新字段后 GET 返回该字段的 routings + fields + core 状态投影', async () => {
    const posted = await postField({
      name: 'integration_field',
      type: 'string[]',
      role: 'soft-info',
      render: 'hidden',
      handoff: ['goal-agent'],
      internal: true,
      accumulate: true,
      visibilityPreset: 'agent-internal',
      persistKey: 'integrationKey',
      desc: '集成测试字段',
    });
    expect(posted.body.success).toBe(true);

    const { body } = await getSkillRoutings();
    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.skillId).toBe('goal-conversation');
    expect(data.stage).toBe('goal');
    expect(data.agentId).toBe('skill:goal-conversation');

    const routing = data.routings.find((r: any) => r.fieldId === 'integration_field');
    expect(routing).toBeDefined();
    expect(routing.render).toBe('hidden');
    expect(routing.handoff).toEqual(['goal-agent']);
    expect(routing.internal).toBe(true);
    expect(routing.accumulate).toBe(true);
    expect(routing.visibilityPreset).toBe('agent-internal');

    const field = data.fields.find((f: any) => f.fieldId === 'integration_field');
    expect(field).toBeDefined();
    expect(field.valueType).toBe('array<string>');
    expect(field.persistKey).toBe('integrationKey');
    expect(field.locks.level).toBe('fully-editable');

    // core 状态投影
    expect(data.core.exists).toBe(true);
    expect(data.core.fields.some((f: any) => f.name === 'integration_field')).toBe(true);
    expect(data.core.sync.state).toBe('ok');
    expect(data.core.sync.missing).toHaveLength(0);
    expect(data.core.sync.typeMismatch).toHaveLength(0);
  });

  it('未知 skillId → 404', async () => {
    const { res, body } = await getSkillRoutings('ghost-skill');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body.success).toBe(false);
  });
});
