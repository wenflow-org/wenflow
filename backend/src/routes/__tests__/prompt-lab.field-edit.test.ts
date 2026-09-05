/**
 * M3 统一编辑：改字段 PATCH / 删字段 DELETE 原子 API 单测
 *
 * 覆盖：
 * - PATCH 成功路径：core+编排双文件同步修改 + 落库 update 语义（sync 全量对账：
 *   managedByCode=true 行更新、false 行跳过报告）+ 审计 skill-field-update + 复检
 * - PATCH 类型修改（valueType 联动）、可选声明清除（persistKey/pathInRawOutput）
 * - PATCH 幂等（无变化 → changed=false，不写盘不审计）
 * - PATCH 404（字段三处缺一）/ 409（systemLocked）/ 写盘失败 core 回滚
 * - DELETE 成功路径：双文件条目删除 + DB 行删除 + 审计 before 全量摘要
 * - DELETE 409 消费检查（编排内其他 agent 引用 / 其他 skill core inputs 消费）
 * - DELETE 409 systemLocked / 404 / 写盘失败回滚
 * - DELETE protected（managedByCode=false 行跳过并报告，文件仍删）
 * - 嵌套字段 PATCH / DELETE（child note 更新 / 末子级联删 root）
 *
 * 通过 jest.isolateModules 在设置 CORE_FILES_DIR / ORCHESTRATION_DIR / SKILLS_FILE /
 * PROMPTS_DIR 后动态装载路由（目录常量在模块装载时固化），避免触碰真实 prompts/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---- 内存假库（update/delete 语义 + managedByCode 保护） ----
const dbTables = {
  agent_contracts: new Map<string, Record<string, any>>(),
  field_definitions: new Map<string, Record<string, any>>(),
  agent_field_routings: new Map<string, Record<string, any>>(),
};
const dbAudit: Array<Record<string, any>> = [];

function seedRow(map: Map<string, Record<string, any>>, key: string, row: Record<string, any>): void {
  map.set(key, { ...row });
}

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
      update: async ({ where, data }: any) => {
        const row = dbTables.agent_contracts.get(where.agentId);
        if (!row) throw new Error('agent_contracts row not found');
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: any) => {
        dbTables.agent_contracts.set(data.agentId, { ...data });
        return { ...data };
      },
    },
    field_definitions: {
      findFirst: async ({ where }: any) =>
        [...dbTables.field_definitions.values()].find((r) => r.stage === where.stage && r.fieldId === where.fieldId) ?? null,
      findUnique: async ({ where }: any) =>
        dbTables.field_definitions.get(`${where.stage_fieldId.stage}\u0000${where.stage_fieldId.fieldId}`) ?? null,
      update: async ({ where, data }: any) => {
        const key = `${where.stage_fieldId.stage}\u0000${where.stage_fieldId.fieldId}`;
        const row = dbTables.field_definitions.get(key);
        if (!row) throw new Error('field_definitions row not found');
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: any) => {
        const key = `${data.stage}\u0000${data.fieldId}`;
        dbTables.field_definitions.set(key, { ...data });
        return { ...data };
      },
      delete: async ({ where }: any) => {
        const key = `${where.stage_fieldId.stage}\u0000${where.stage_fieldId.fieldId}`;
        const row = dbTables.field_definitions.get(key);
        dbTables.field_definitions.delete(key);
        return row;
      },
      findMany: async ({ where }: any) => [...dbTables.field_definitions.values()].filter((r) => r.stage === where.stage),
    },
    agent_field_routings: {
      findUnique: async ({ where }: any) =>
        dbTables.agent_field_routings.get(`${where.agentId_fieldId.agentId}\u0000${where.agentId_fieldId.fieldId}`) ?? null,
      update: async ({ where, data }: any) => {
        const key = `${where.agentId_fieldId.agentId}\u0000${where.agentId_fieldId.fieldId}`;
        const row = dbTables.agent_field_routings.get(key);
        if (!row) throw new Error('agent_field_routings row not found');
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: any) => {
        const key = `${data.agentId}\u0000${data.fieldId}`;
        dbTables.agent_field_routings.set(key, { ...data });
        return { ...data };
      },
      delete: async ({ where }: any) => {
        const key = `${where.agentId_fieldId.agentId}\u0000${where.agentId_fieldId.fieldId}`;
        const row = dbTables.agent_field_routings.get(key);
        dbTables.agent_field_routings.delete(key);
        return row;
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
  - name: test_flag
    type: string
    desc: 测试标记字段
  - name: shared_field
    type: string
    desc: 共享字段（goal-agent 也引用）
  - name: locked_field
    type: string
    desc: 系统锁定字段
  - name: learner_profile
    type: object
    desc: |
      学习画像
      · goal（string）学习目标画像
      · pace（string）学习节奏
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
  - fieldId: test_flag
    promptRole: public-reply
    valueType: string
    description: 测试标记字段
  - fieldId: shared_field
    promptRole: soft-info
    valueType: string
    description: 共享字段（goal-agent 也引用）
  - fieldId: locked_field
    promptRole: control-signal
    valueType: string
    description: 系统锁定字段
    systemLocked: true
  - fieldId: learner_profile.goal
    promptRole: soft-info
    valueType: string
    description: 学习目标画像
  - fieldId: learner_profile.pace
    promptRole: soft-info
    valueType: string
    description: 学习节奏画像

routings:
  - agentId: skill:goal-conversation
    fieldId: understanding.surface_goal
    render: visible
    handoff: [goal-agent]
    internal: false
    accumulate: true
  - agentId: skill:goal-conversation
    fieldId: test_flag
    render: visible
    handoff: [goal-agent]
    internal: false
    accumulate: false
  - agentId: skill:goal-conversation
    fieldId: shared_field
    render: visible
    handoff: [goal-agent]
    internal: false
    accumulate: false
  - agentId: goal-agent
    fieldId: shared_field
    render: visible
    handoff: []
    internal: false
    accumulate: true
  - agentId: skill:goal-conversation
    fieldId: locked_field
    render: hidden
    handoff: []
    internal: true
    accumulate: false
  - agentId: skill:goal-conversation
    fieldId: learner_profile.goal
    render: hidden
    handoff: [goal-agent]
    internal: true
    accumulate: true
  - agentId: skill:goal-conversation
    fieldId: learner_profile.pace
    render: hidden
    handoff: [goal-agent]
    internal: true
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

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-field-edit-'));
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
  fs.writeFileSync(path.join(coreDir, 'goal-conversation.yaml'), FIXTURE_CORE, 'utf-8');
  fs.writeFileSync(path.join(orchestrationDir, 'goal.yaml'), FIXTURE_ORCHESTRATION, 'utf-8');
  fs.writeFileSync(skillsFile, FIXTURE_SKILLS, 'utf-8');
  // 预置 DB 行：test_flag（managedByCode=true，验证 update 语义）
  seedRow(dbTables.agent_contracts, 'skill:goal-conversation', {
    agentId: 'skill:goal-conversation', stage: 'goal', managedByCode: true,
  });
  seedRow(dbTables.agent_contracts, 'goal-agent', { agentId: 'goal-agent', stage: 'goal', managedByCode: true });
  seedRow(dbTables.field_definitions, 'goal\u0000test_flag', {
    id: 'fd-test-flag', stage: 'goal', fieldId: 'test_flag',
    promptRole: 'public-reply', valueType: 'string', persistKey: null, pathInRawOutput: null,
    description: '测试标记字段', systemLocked: false, structureLocked: false, managedByCode: true,
  });
  seedRow(dbTables.field_definitions, 'goal\u0000shared_field', {
    id: 'fd-shared', stage: 'goal', fieldId: 'shared_field',
    promptRole: 'soft-info', valueType: 'string', persistKey: null, pathInRawOutput: null,
    description: '共享字段（goal-agent 也引用）', systemLocked: false, structureLocked: false, managedByCode: true,
  });
  seedRow(dbTables.agent_field_routings, 'skill:goal-conversation\u0000test_flag', {
    id: 'r-test-flag', agentId: 'skill:goal-conversation', fieldId: 'test_flag',
    render: 'visible', handoff: JSON.stringify(['goal-agent']), internalFlag: false,
    accumulate: false, visibilityPreset: null, managedByCode: true,
  });
  seedRow(dbTables.agent_field_routings, 'goal-agent\u0000shared_field', {
    id: 'r-shared-agent', agentId: 'goal-agent', fieldId: 'shared_field',
    render: 'visible', handoff: null, internalFlag: false, accumulate: true, visibilityPreset: null, managedByCode: true,
  });
});

function getRouteHandler(p: string, method: string) {
  const layer = (promptLabRouter as any).stack.find(
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

async function patchField(name: string, payload: Record<string, unknown>, skillId = 'goal-conversation') {
  const handler = getRouteHandler('/core/:skillId/field/:name', 'patch');
  const res = createResponse();
  await handler({ params: { skillId, name }, body: payload, user: { userId: 'u1' } }, res);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

async function deleteField(name: string, skillId = 'goal-conversation') {
  const handler = getRouteHandler('/core/:skillId/field/:name', 'delete');
  const res = createResponse();
  await handler({ params: { skillId, name }, body: {}, user: { userId: 'u1' } }, res);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

const readCore = () => fs.readFileSync(path.join(coreDir, 'goal-conversation.yaml'), 'utf-8');
const readOrchestration = () => fs.readFileSync(path.join(orchestrationDir, 'goal.yaml'), 'utf-8');

describe('PATCH /core/:skillId/field/:name 成功路径', () => {
  it('改 role/render/handoff/desc：双文件同步变 + DB update + 审计 before/after + 复检', async () => {
    const { body } = await patchField('test_flag', {
      role: 'soft-info',
      render: 'hidden',
      handoff: ['path'],
      desc: '测试标记字段（已修改）',
    });

    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.changed).toBe(true);
    expect(data.coreWritten).toBe(true);
    expect(data.orchestrationWritten).toBe(true);
    expect(data.syncCheck.missing).toHaveLength(0);
    expect(data.syncCheck.typeMismatch).toHaveLength(0);

    // 双文件
    const coreText = readCore();
    expect(coreText).toContain('    desc: 测试标记字段（已修改）');
    const orchText = readOrchestration();
    expect(orchText).toContain('    promptRole: soft-info');
    expect(orchText).toContain('    render: hidden');
    expect(orchText).toContain('    handoff: [path]');
    expect(orchText).toContain('    description: 测试标记字段（已修改）');
    expect(orchText).toContain('# test goal.yaml（fixture）'); // 注释保留

    // 落库 update 语义：既有行被更新（sync 全量对账）
    const fieldRow = dbTables.field_definitions.get('goal\u0000test_flag')!;
    expect(fieldRow.promptRole).toBe('soft-info');
    expect(fieldRow.description).toBe('测试标记字段（已修改）');
    const routingRow = dbTables.agent_field_routings.get('skill:goal-conversation\u0000test_flag')!;
    expect(routingRow.render).toBe('hidden');
    expect(JSON.parse(routingRow.handoff)).toEqual(['path']);
    expect(data.dbSync.fieldsUpdated).toBeGreaterThanOrEqual(1);
    expect(data.dbSync.routingsUpdated).toBeGreaterThanOrEqual(1);
    expect(data.dbSync.skippedAdminRows).toEqual([]);

    // 审计
    const audit = dbAudit[dbAudit.length - 1];
    expect(audit.changeType).toBe('skill-field-update');
    expect(audit.targetId).toBe('goal-conversation');
    expect(audit.fieldId).toBe('test_flag');
    expect(audit.actorId).toBe('u1');
    const before = JSON.parse(audit.before);
    expect(before).toMatchObject({ promptRole: 'public-reply', render: 'visible', handoff: ['goal-agent'], desc: '测试标记字段' });
    const after = JSON.parse(audit.after);
    expect(after).toMatchObject({ promptRole: 'soft-info', render: 'hidden', handoff: ['path'], desc: '测试标记字段（已修改）' });
  });

  it('改 type（string → string[]）：core type 变 + 编排 valueType 联动 array<string>', async () => {
    const { body } = await patchField('test_flag', {
      type: 'string[]',
      desc: '标签数组',
    });
    expect(body.success).toBe(true);
    expect(readCore()).toContain('    type: string[]');
    const orchText = readOrchestration();
    expect(orchText).toContain('    valueType: array<string>');
    expect(dbTables.field_definitions.get('goal\u0000test_flag')!.valueType).toBe('array<string>');
    expect(JSON.parse(dbAudit[dbAudit.length - 1].after)).toMatchObject({ coreType: 'string[]', valueType: 'array<string>' });
  });

  it('清除可选声明：persistKey/pathInRawOutput 传空 → 编排声明行移除、DB 落 null', async () => {
    await patchField('test_flag', {
      role: 'soft-info',
      persistKey: 'flagKey',
      pathInRawOutput: 'internal.flag',
      desc: '带落库键的字段',
    });
    expect(readOrchestration()).toContain('    persistKey: flagKey');
    expect(readOrchestration()).toContain('    pathInRawOutput: internal.flag');

    const { body } = await patchField('test_flag', {
      role: 'soft-info',
      persistKey: '',
      pathInRawOutput: '',
      desc: '带落库键的字段',
    });
    expect(body.success).toBe(true);
    const orchText = readOrchestration();
    expect(orchText).not.toContain('persistKey');
    expect(orchText).not.toContain('pathInRawOutput');
    expect(dbTables.field_definitions.get('goal\u0000test_flag')!.persistKey).toBeNull();
    expect(dbTables.field_definitions.get('goal\u0000test_flag')!.pathInRawOutput).toBeNull();
  });

  it('锁定修改：locked=structure → structureLocked 行新增', async () => {
    const { body } = await patchField('test_flag', {
      role: 'public-reply',
      locked: 'structure',
      desc: '测试标记字段',
    });
    expect(body.success).toBe(true);
    expect(readOrchestration()).toContain('    structureLocked: true');
    expect(dbTables.field_definitions.get('goal\u0000test_flag')!.structureLocked).toBe(true);
  });

  it('幂等：与现状完全一致 → changed=false，不写盘不落库不审计', async () => {
    const coreBefore = readCore();
    const orchBefore = readOrchestration();
    const { body } = await patchField('test_flag', {
      type: 'string',
      role: 'public-reply',
      render: 'visible',
      handoff: ['goal-agent'],
      desc: '测试标记字段',
      persistKey: '',
      pathInRawOutput: '',
    });
    expect(body.success).toBe(true);
    expect(body.data.changed).toBe(false);
    expect(body.data.coreWritten).toBe(false);
    expect(body.data.orchestrationWritten).toBe(false);
    expect(body.data.auditId).toBe('');
    expect(readCore()).toBe(coreBefore);
    expect(readOrchestration()).toBe(orchBefore);
    expect(dbAudit.length).toBe(0);
    expect(dbTables.field_definitions.get('goal\u0000test_flag')!.promptRole).toBe('public-reply');
  });

  it('managedByCode=false 覆盖行：文件照改，DB 行跳过并报告 skippedAdminRows', async () => {
    const adminRow = dbTables.field_definitions.get('goal\u0000test_flag')!;
    adminRow.managedByCode = false;
    const routingRow = dbTables.agent_field_routings.get('skill:goal-conversation\u0000test_flag')!;
    routingRow.managedByCode = false;

    const { body } = await patchField('test_flag', {
      role: 'soft-info',
      desc: '测试标记字段',
    });
    expect(body.success).toBe(true);
    expect(readOrchestration()).toContain('    promptRole: soft-info'); // 文件为准，照改
    expect(adminRow.promptRole).toBe('public-reply'); // DB 受保护行不更新
    expect(routingRow.render).toBe('visible');
    expect(body.data.dbSync.skippedAdminRows.length).toBeGreaterThanOrEqual(2);
    const keys = body.data.dbSync.skippedAdminRows.map((r: any) => r.key);
    expect(keys).toContain('goal/test_flag');
    expect(keys).toContain('skill:goal-conversation/test_flag');
  });
});

describe('PATCH /core/:skillId/field/:name 校验与回滚', () => {
  it('字段不存在（core/编排三处缺一）→ 404 FIELD_NOT_FOUND', async () => {
    const { res, body } = await patchField('ghost_field', { desc: '不存在' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body.code).toBe('FIELD_NOT_FOUND');
  });

  it('编排有字段但 core 无声明 → 404 FIELD_NOT_FOUND（三处需同名）', async () => {
    const coreText = readCore().replace('  - name: test_flag\n    type: string\n    desc: 测试标记字段\n', '');
    fs.writeFileSync(path.join(coreDir, 'goal-conversation.yaml'), coreText, 'utf-8');
    const { res, body } = await patchField('test_flag', { desc: 'core 已删' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body.code).toBe('FIELD_NOT_FOUND');
  });

  it('systemLocked 字段 → 409 FIELD_SYSTEM_LOCKED，文件不变', async () => {
    const coreBefore = readCore();
    const orchBefore = readOrchestration();
    const { res, body } = await patchField('locked_field', { desc: '想改锁字段' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body.code).toBe('FIELD_SYSTEM_LOCKED');
    expect(readCore()).toBe(coreBefore);
    expect(readOrchestration()).toBe(orchBefore);
  });

  it('目标锁定为 system → 409 FIELD_SYSTEM_LOCKED', async () => {
    const { res, body } = await patchField('test_flag', { locked: 'system' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body.code).toBe('FIELD_SYSTEM_LOCKED');
  });

  it('编排写盘失败 → 500，core 回滚原内容', async () => {
    const rawFsp = jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const originalWriteFile = rawFsp.writeFile.bind(rawFsp);
    const spy = jest.spyOn(rawFsp, 'writeFile').mockImplementation(async (p: any, d: any, e: any) => {
      if (!String(p).endsWith('goal-conversation.yaml')) throw new Error('EIO: 模拟编排写盘失败');
      return originalWriteFile(p, d, e);
    });
    try {
      const coreBefore = readCore();
      const { res, body } = await patchField('test_flag', { desc: '触发写盘失败' });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(body.code).toBe('ORCHESTRATION_WRITE_FAILED');
      expect(readCore()).toBe(coreBefore);
      expect(readOrchestration()).not.toContain('触发写盘失败');
    } finally {
      spy.mockRestore();
    }
  });

  it('非法 handoff 目标 → 422 HANDOFF_TARGET_UNKNOWN', async () => {
    const { res, body } = await patchField('test_flag', { handoff: ['nope-agent'] });
    expect(res.status).toHaveBeenCalledWith(422);
    expect(body.code).toBe('HANDOFF_TARGET_UNKNOWN');
  });
});

describe('DELETE /core/:skillId/field/:name 成功路径', () => {
  it('顶层字段：双文件条目删除 + DB 行删除 + 审计 before 全量摘要 + 复检无新孤儿', async () => {
    const { body } = await deleteField('test_flag');

    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.deleted).toEqual(expect.arrayContaining([
      { table: 'core-fields', key: 'test_flag' },
      { table: 'orchestration-fields', key: 'test_flag' },
      { table: 'orchestration-routings', key: 'skill:goal-conversation/test_flag' },
    ]));

    // 双文件
    const coreText = readCore();
    expect(coreText).not.toContain('test_flag');
    expect(coreText).toContain('# test core（fixture）');
    const orchText = readOrchestration();
    expect(orchText).not.toContain('test_flag');
    expect(orchText).toContain('# test goal.yaml（fixture）');
    expect(orchText).toContain('shared_field'); // 其他字段保留

    // 复检
    expect(data.syncCheck.missing).toHaveLength(0);
    expect(data.syncCheck.typeMismatch).toHaveLength(0);

    // DB 行删除
    expect(dbTables.field_definitions.has('goal\u0000test_flag')).toBe(false);
    expect(dbTables.agent_field_routings.has('skill:goal-conversation\u0000test_flag')).toBe(false);
    expect(data.dbDeleted).toEqual(expect.arrayContaining([
      { table: 'field_definitions', key: 'goal/test_flag' },
      { table: 'agent_field_routings', key: 'skill:goal-conversation/test_flag' },
    ]));
    expect(data.protectedRows).toEqual([]);

    // 审计
    const audit = dbAudit[dbAudit.length - 1];
    expect(audit.changeType).toBe('skill-field-delete');
    expect(audit.fieldId).toBe('test_flag');
    expect(audit.after).toBeNull();
    const before = JSON.parse(audit.before);
    expect(before).toMatchObject({
      name: 'test_flag',
      promptRole: 'public-reply',
      valueType: 'string',
      render: 'visible',
      handoff: ['goal-agent'],
    });
  });

  it('嵌套字段：core desc 子字段说明移除 + 编排双条目删除（root 仍有其他路由行 → 不级联）', async () => {
    const { body } = await deleteField('learner_profile.goal');
    expect(body.success).toBe(true);
    const coreText = readCore();
    expect(coreText).not.toContain('· goal（string）学习目标');
    expect(coreText).toContain('· pace（string）学习节奏'); // 兄弟子字段保留
    expect(coreText).toContain('  - name: learner_profile'); // root 条目保留（pace 仍路由）
    const orchText = readOrchestration();
    expect(orchText).not.toContain('learner_profile.goal');
    expect(orchText).toContain('learner_profile.pace');
    // 复检无新缺项/孤儿
    expect(body.data.syncCheck.missing).toHaveLength(0);
    expect(body.data.syncCheck.orphan.map((o: any) => o.coreField)).not.toContain('learner_profile');
  });

  it('嵌套末子：root 无剩余路由行 → 级联删除 core root 条目（无新孤儿）', async () => {
    // 先删 pace，只剩 goal 一个子字段
    await deleteField('learner_profile.pace');
    const { body } = await deleteField('learner_profile.goal');
    expect(body.success).toBe(true);
    const coreText = readCore();
    expect(coreText).not.toContain('  - name: learner_profile');
    const orchText = readOrchestration();
    expect(orchText).not.toContain('learner_profile');
    expect(body.data.syncCheck.orphan.map((o: any) => o.coreField)).not.toContain('learner_profile');
  });

  it('managedByCode=false 覆盖行：文件照删，DB 行保留并报告 protectedRows', async () => {
    dbTables.field_definitions.get('goal\u0000test_flag')!.managedByCode = false;

    const { body } = await deleteField('test_flag');
    expect(body.success).toBe(true);
    expect(readCore()).not.toContain('test_flag'); // 文件为准照删
    expect(readOrchestration()).not.toContain('test_flag');
    expect(dbTables.field_definitions.has('goal\u0000test_flag')).toBe(true); // DB 受保护
    expect(dbTables.agent_field_routings.has('skill:goal-conversation\u0000test_flag')).toBe(false);
    expect(body.data.protectedRows).toContainEqual({ table: 'field_definitions', key: 'goal/test_flag' });
  });
});

describe('DELETE /core/:skillId/field/:name 保护检查与回滚', () => {
  it('其他 agent 的 routings 仍引用 → 409 FIELD_CONSUMED（列出消费方）', async () => {
    const coreBefore = readCore();
    const { res, body } = await deleteField('shared_field');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body.code).toBe('FIELD_CONSUMED');
    expect(body.consumers.agents).toContain('goal-agent');
    expect(readCore()).toBe(coreBefore);
    expect(readOrchestration()).toContain('shared_field');
  });

  it('其他 skill 的 core inputs 消费（ref: skill:goal-conversation.xxx）→ 409 FIELD_CONSUMED', async () => {
    fs.writeFileSync(
      path.join(coreDir, 'consumer-skill.yaml'),
      `skillId: consumer-skill
baseVersion: 1
identity: 消费方
channels: [task]
rules:
  - 规则
inputs:
  - name: flagInput
    type: string
    ref: skill:goal-conversation.test_flag
    desc: 消费 test_flag
fields:
  - name: reply
    type: string
    desc: 回复
constraints: []
params: { temperature: 0.5, maxTokens: 4000, failurePolicy: retry }
deltaOutput: false
outputMedia: json
`,
      'utf-8',
    );
    try {
      const { res, body } = await deleteField('test_flag');
      expect(res.status).toHaveBeenCalledWith(409);
      expect(body.code).toBe('FIELD_CONSUMED');
      expect(body.consumers.skills).toEqual([{ skillId: 'consumer-skill', refs: ['skill:goal-conversation.test_flag'] }]);
    } finally {
      fs.rmSync(path.join(coreDir, 'consumer-skill.yaml'), { force: true });
    }
  });

  it('systemLocked 字段 → 409 FIELD_SYSTEM_LOCKED', async () => {
    const { res, body } = await deleteField('locked_field');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body.code).toBe('FIELD_SYSTEM_LOCKED');
  });

  it('字段不存在 → 404 FIELD_NOT_FOUND', async () => {
    const { res, body } = await deleteField('ghost_field');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body.code).toBe('FIELD_NOT_FOUND');
  });

  it('编排写盘失败 → 500，core 回滚原内容', async () => {
    const rawFsp = jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const originalWriteFile = rawFsp.writeFile.bind(rawFsp);
    const spy = jest.spyOn(rawFsp, 'writeFile').mockImplementation(async (p: any, d: any, e: any) => {
      if (!String(p).endsWith('goal-conversation.yaml')) throw new Error('EIO: 模拟编排写盘失败');
      return originalWriteFile(p, d, e);
    });
    try {
      const coreBefore = readCore();
      const { res, body } = await deleteField('test_flag');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(body.code).toBe('ORCHESTRATION_WRITE_FAILED');
      expect(readCore()).toBe(coreBefore);
      expect(readOrchestration()).toContain('test_flag'); // 编排未写
      expect(dbTables.field_definitions.has('goal\u0000test_flag')).toBe(true); // DB 未动
    } finally {
      spy.mockRestore();
    }
  });
});

describe('嵌套字段 PATCH', () => {
  it('改嵌套子字段类型与 desc：core desc 说明块替换 + 编排 valueType 联动', async () => {
    const { body } = await patchField('learner_profile.goal', {
      type: 'object[]',
      desc: '学习目标画像（多目标）',
    });
    expect(body.success).toBe(true);
    const coreText = readCore();
    expect(coreText).toContain('· goal（object[]）学习目标画像（多目标）');
    expect(coreText).not.toContain('· goal（string）学习目标画像');
    expect(coreText).toContain('· pace（string）学习节奏');
    expect(readOrchestration()).toContain('    valueType: array<object>');
    expect(body.data.syncCheck.typeMismatch).toHaveLength(0);
    expect(JSON.parse(dbAudit[dbAudit.length - 1].after)).toMatchObject({ coreType: 'object[]', desc: '学习目标画像（多目标）' });
  });

  it('嵌套字段幂等：提交一致 → changed=false', async () => {
    const { body } = await patchField('learner_profile.goal', {
      type: 'string',
      desc: '学习目标画像',
    });
    expect(body.success).toBe(true);
    expect(body.data.changed).toBe(false);
    expect(dbAudit.length).toBe(0);
  });
});
