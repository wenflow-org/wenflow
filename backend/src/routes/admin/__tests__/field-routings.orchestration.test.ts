/**
 * 编排文件 PUT 保存审计 + prune 端点单测（P2 补全）
 *
 * - PUT /orchestration/:stage：保存后写 node_config_changes（changeType='orchestration-save'，
 *   before/after = 保存前/后文件摘要）；真实写盘隔离到临时 ORCHESTRATION_DIR。
 * - POST /orchestration/:stage/prune：默认 dry-run（只报告不删）；dryRun=false 执行；
 *   actorId 透传；未知 stage 404。
 *
 * 通过 jest.isolateModules 在设置 ORCHESTRATION_DIR 后动态装载路由（orchestration-file
 * 在模块装载时固化目录），避免触碰真实 prompts/orchestration/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockEnsureStageFieldRoutings = jest.fn();
const mockPruneStageFieldRoutings = jest.fn();
const mockNodeConfigCreate = jest.fn(async (args: any) => ({ id: 'audit-1', ...args.data }));
const mockNodeConfigFindMany = jest.fn(async (_args: unknown) => []);
const mockContractsFindMany = jest.fn(async (_args: unknown) => []);
const mockFieldsFindMany = jest.fn(async (_args: unknown) => []);

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_contracts: { findMany: (args: unknown) => mockContractsFindMany(args) },
    field_definitions: { findMany: (args: unknown) => mockFieldsFindMany(args) },
    node_config_changes: {
      create: (args: unknown) => mockNodeConfigCreate(args),
      findMany: (args: unknown) => mockNodeConfigFindMany(args),
    },
  },
}));

jest.mock('../../../services/field-dispatcher', () => ({ clearRoutingCache: jest.fn() }));

jest.mock('../../../services/prompt-composer', () => ({ clearSupplementRenderCache: jest.fn() }));

jest.mock('../../../services/field-routing-bootstrap.service', () => ({
  detectFieldRoutingDrift: jest.fn(async () => ({ driftCount: 0, items: [] })),
  ensureStageFieldRoutings: (...args: unknown[]) => mockEnsureStageFieldRoutings(...args),
  syncStageFieldRoutingsFromFile: jest.fn(async () => ({})),
  pruneStageFieldRoutings: (...args: unknown[]) => mockPruneStageFieldRoutings(...args),
}));

const MINIMAL_GOAL_YAML = `# test goal.yaml
stage: goal
displayName: Goal 阶段
description: test

contracts:
  - agentId: goal-agent

fields: []
routings: []
`;

let tempRoot = '';
let router: any;

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-orch-route-'));
  process.env.ORCHESTRATION_DIR = path.join(tempRoot, 'orchestration');
  fs.mkdirSync(process.env.ORCHESTRATION_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.ORCHESTRATION_DIR, 'goal.yaml'), MINIMAL_GOAL_YAML, 'utf-8');
  jest.isolateModules(() => {
    router = require('../field-routings').default;
  });
});

afterAll(() => {
  delete process.env.ORCHESTRATION_DIR;
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsureStageFieldRoutings.mockResolvedValue({
    fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0,
  });
  mockPruneStageFieldRoutings.mockResolvedValue({
    stage: 'goal', dryRun: true, candidates: [], protectedRows: [], deletedCount: 0, auditIds: [],
  });
});

function getRouteHandler(p: string, method = 'get') {
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

describe('编排文件 PUT 保存（P2 审计补强）', () => {
  it('保存成功：文件写盘 + 写 orchestration-save 审计（before/after 文件摘要）', async () => {
    const newContent = MINIMAL_GOAL_YAML.replace(
      'fields: []',
      'fields:\n  - fieldId: reply\n    promptRole: public-reply\n    valueType: string\n    description: 回复',
    );
    const handler = getRouteHandler('/orchestration/:stage', 'put');
    const res = createResponse();
    await handler({ params: { stage: 'goal' }, body: { content: newContent }, user: { userId: 'u1' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);

    // 文件已写盘（临时编排目录）
    const onDisk = fs.readFileSync(path.join(process.env.ORCHESTRATION_DIR!, 'goal.yaml'), 'utf-8');
    expect(onDisk).toBe(newContent);

    // 审计：changeType='orchestration-save'，targetId=stage，before/after 为摘要
    expect(mockNodeConfigCreate).toHaveBeenCalledTimes(1);
    const data = mockNodeConfigCreate.mock.calls[0][0].data;
    expect(data.changeType).toBe('orchestration-save');
    expect(data.targetTable).toBe('orchestration');
    expect(data.targetId).toBe('goal');
    expect(data.actorId).toBe('u1');
    const before = JSON.parse(data.before);
    const after = JSON.parse(data.after);
    expect(before.lineCount).toBe(MINIMAL_GOAL_YAML.split('\n').length);
    expect(after.lineCount).toBe(newContent.split('\n').length);
    expect(before.charCount).toBe(MINIMAL_GOAL_YAML.length);
    expect(before.sha1).not.toBe(after.sha1);
  });

  it('保存语义不变：ensure（只建不更新）仍被调用，response 带 syncHint', async () => {
    const handler = getRouteHandler('/orchestration/:stage', 'put');
    const res = createResponse();
    await handler({ params: { stage: 'goal' }, body: { content: MINIMAL_GOAL_YAML }, user: {} }, res);
    expect(mockEnsureStageFieldRoutings).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.syncHint).toContain('已有行属性修改需执行同步后生效');
  });
});

describe('GET /orchestration/:stage 相关审计查询', () => {
  it('GET /changes?stage= 的过滤含 stage 级审计分支（targetTable=orchestration + targetId=stage，命中 orchestration-save/prune 行）', async () => {
    mockContractsFindMany.mockResolvedValue([{ agentId: 'goal-agent' }]);
    mockFieldsFindMany.mockResolvedValue([{ fieldId: 'reply' }]);
    mockNodeConfigFindMany.mockResolvedValue([
      {
        id: 'a1', changeType: 'orchestration-save', targetTable: 'orchestration', targetId: 'goal',
        agentId: null, fieldId: null, before: '{"lineCount":1}', after: '{"lineCount":2}',
        actorId: 'u1', actorRole: 'admin', reason: 'x', createdAt: new Date(),
      },
    ]);
    const handler = getRouteHandler('/changes', 'get');
    const res = createResponse();
    await handler({ query: { stage: 'goal' } }, res);

    const findWhere: any = (mockNodeConfigFindMany.mock.calls[0][0] as any)?.where;
    // stage 级审计（无 agentId/fieldId）按 targetTable+targetId 命中
    expect(findWhere.OR).toEqual(
      expect.arrayContaining([{ targetTable: 'orchestration', targetId: 'goal' }]),
    );
    const body = res.json.mock.calls[0][0];
    expect(body.data[0].changeType).toBe('orchestration-save');
    expect(body.data[0].before).toEqual({ lineCount: 1 });
  });
});

describe('POST /orchestration/:stage/prune（孤儿行清理）', () => {
  it('未知 stage → 404', async () => {
    const handler = getRouteHandler('/orchestration/:stage/prune', 'post');
    const res = createResponse();
    await handler({ params: { stage: 'nope' }, body: {}, user: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPruneStageFieldRoutings).not.toHaveBeenCalled();
  });

  it('默认 dry-run（body 不带参数）→ 只报告不删，dryRun=true + actorId 透传', async () => {
    mockPruneStageFieldRoutings.mockResolvedValue({
      stage: 'goal', dryRun: true,
      candidates: [{ table: 'field_definitions', key: 'goal\u0000ghost', row: { id: 'x' } }],
      protectedRows: [{ table: 'agent_field_routings', key: 'goal-agent/ghost' }],
      deletedCount: 0, auditIds: [],
    });
    const handler = getRouteHandler('/orchestration/:stage/prune', 'post');
    const res = createResponse();
    await handler({ params: { stage: 'goal' }, body: {}, user: { userId: 'u1' } }, res);

    const [prisma, stageObj, opts] = mockPruneStageFieldRoutings.mock.calls[0];
    expect(prisma).toBeDefined();
    expect(stageObj.stage).toBe('goal');
    expect(opts).toEqual({ dryRun: true, actorId: 'u1' });

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.candidates).toHaveLength(1);
    expect(body.data.deletedCount).toBe(0);
  });

  it('dryRun=false → 执行删除并透传 dryRun=false；无 user 时 actorId 默认 admin', async () => {
    mockPruneStageFieldRoutings.mockResolvedValue({
      stage: 'goal', dryRun: false,
      candidates: [{ table: 'field_definitions', key: 'goal\u0000ghost', row: { id: 'x' } }],
      protectedRows: [],
      deletedCount: 1, auditIds: ['audit-1'],
    });
    const handler = getRouteHandler('/orchestration/:stage/prune', 'post');
    const res = createResponse();
    await handler({ params: { stage: 'goal' }, body: { dryRun: false }, user: {} }, res);

    const opts = mockPruneStageFieldRoutings.mock.calls[0][2];
    expect(opts).toEqual({ dryRun: false, actorId: 'admin' });
    const body = res.json.mock.calls[0][0];
    expect(body.data.deletedCount).toBe(1);
    expect(body.data.auditIds).toEqual(['audit-1']);
  });
});
