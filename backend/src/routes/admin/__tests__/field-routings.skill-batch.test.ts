/**
 * GET /skill-batch（阶段级批量 skill 字段路由 + core 状态投影）单测
 *
 * - 一次返回 stage 下全部 skill 的投影（routings/fields/core.sync），
 *   与单 skill 端点（/skill/:skillId）响应逐字段一致
 * - 空 stage（有编排文件、无登记 skill）→ skills: []
 * - 未知 stage → 404；缺 stage → 400；编排文件损坏 → 422
 * - 路由注册顺序守卫：/skill-batch 必须在 /skill/:skillId 之前
 *
 * 隔离：ORCHESTRATION_DIR / SKILLS_FILE / CORE_FILES_DIR 全部指向临时目录，
 * 通过 jest.isolateModules 动态装载路由（目录常量在模块装载时固化），
 * 不触碰真实 prompts/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_contracts: { findMany: jest.fn(async () => []) },
    field_definitions: { findMany: jest.fn(async () => []) },
    node_config_changes: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  },
}));

jest.mock('../../../services/field-dispatcher', () => ({ clearRoutingCache: jest.fn() }));

jest.mock('../../../services/prompt-composer', () => ({ clearSupplementRenderCache: jest.fn() }));

jest.mock('../../../services/field-routing-bootstrap.service', () => ({
  detectFieldRoutingDrift: jest.fn(async () => ({ driftCount: 0, items: [] })),
  ensureStageFieldRoutings: jest.fn(async () => ({})),
  syncStageFieldRoutingsFromFile: jest.fn(async () => ({})),
  pruneStageFieldRoutings: jest.fn(async () => ({})),
}));

const SKILLS_YAML = `version: 1
skills:
  - skillId: zz-fixture-goal-a
    kind: mainline
    stage: goal
    handlerRef: backend/src/skills/zz-fixture-goal-a.ts
    coreFile: prompts/core/zz-fixture-goal-a.yaml
  - skillId: zz-fixture-goal-b
    kind: mainline
    stage: goal
    handlerRef: backend/src/skills/zz-fixture-goal-b.ts
    coreFile: prompts/core/zz-fixture-goal-b.yaml
  - skillId: zz-fixture-goal-aux
    kind: aux
    stage: goal
    handlerRef: backend/src/skills/zz-fixture-goal-aux.ts
    coreFile: prompts/core/zz-fixture-goal-aux.yaml
`;

const GOAL_YAML = `stage: goal
displayName: Goal 阶段
description: test

contracts:
  - agentId: skill:zz-fixture-goal-a
  - agentId: skill:zz-fixture-goal-b
  - agentId: skill:zz-fixture-goal-aux

fields:
  - fieldId: reply
    promptRole: public-reply
    valueType: string
    description: 回复
  - fieldId: milestone
    promptRole: proposal-output
    valueType: object
    description: 里程碑

routings:
  - agentId: skill:zz-fixture-goal-a
    fieldId: reply
    render: visible
    handoff: []
  - agentId: skill:zz-fixture-goal-a
    fieldId: milestone
    render: hidden
    handoff: []
  - agentId: skill:zz-fixture-goal-b
    fieldId: reply
    render: visible
    handoff: []
`;

const TEACHING_YAML = `stage: teaching
displayName: Teaching 阶段
description: test

contracts: []
fields: []
routings: []
`;

function coreYaml(skillId: string, fields: string): string {
  return `skillId: ${skillId}
baseVersion: 1
identity: ${skillId}
channels:
  - dialogue
rules:
  - 规则
fields:
${fields}
constraints: []
params:
  temperature: 0.7
  maxTokens: 2000
  failurePolicy: retry
`;
}

let tempRoot = '';
let router: any;

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-fr-batch-'));
  const orchDir = path.join(tempRoot, 'orchestration');
  const coreDir = path.join(tempRoot, 'core');
  fs.mkdirSync(orchDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(orchDir, 'goal.yaml'), GOAL_YAML, 'utf-8');
  fs.writeFileSync(path.join(orchDir, 'teaching.yaml'), TEACHING_YAML, 'utf-8');
  fs.writeFileSync(
    path.join(coreDir, 'zz-fixture-goal-a.yaml'),
    coreYaml('zz-fixture-goal-a', '  - name: reply\n    type: string\n    desc: 回复\n  - name: milestone\n    type: object\n    desc: 里程碑'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(coreDir, 'zz-fixture-goal-b.yaml'),
    coreYaml('zz-fixture-goal-b', '  - name: reply\n    type: string\n    desc: 回复'),
    'utf-8',
  );
  const skillsFile = path.join(tempRoot, 'skills.yaml');
  fs.writeFileSync(skillsFile, SKILLS_YAML, 'utf-8');

  process.env.ORCHESTRATION_DIR = orchDir;
  process.env.CORE_FILES_DIR = coreDir;
  process.env.SKILLS_FILE = skillsFile;
  jest.isolateModules(() => {
    router = require('../field-routings').default;
  });
});

afterAll(() => {
  delete process.env.ORCHESTRATION_DIR;
  delete process.env.CORE_FILES_DIR;
  delete process.env.SKILLS_FILE;
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
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

describe('GET /skill-batch（阶段级批量投影）', () => {
  it('路由注册顺序守卫：/skill-batch 在 /skill/:skillId 之前（否则被 skillId=batch 吞掉）', () => {
    const paths = (router as any).stack
      .filter((item: any) => item.route?.path?.startsWith('/skill'))
      .map((item: any) => item.route.path);
    expect(paths).toEqual(['/skill-batch', '/skill/:skillId']);
  });

  it('一次返回 stage 下全部 skill 的投影（routings/fields/core.sync）', async () => {
    const handler = getRouteHandler('/skill-batch');
    const res = createResponse();
    await handler({ query: { stage: 'goal' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    const data = res.json.mock.calls[0][0].data;
    expect(data.stage).toBe('goal');
    expect(data.promptRoleMeta).toBeTruthy();
    expect(data.skills.map((s: any) => s.skillId)).toEqual([
      'zz-fixture-goal-a',
      'zz-fixture-goal-b',
      'zz-fixture-goal-aux',
    ]);

    const a = data.skills.find((s: any) => s.skillId === 'zz-fixture-goal-a');
    expect(a.agentId).toBe('skill:zz-fixture-goal-a');
    expect(a.routings.map((r: any) => r.fieldId)).toEqual(['reply', 'milestone']);
    expect(a.fields.map((f: any) => f.fieldId).sort()).toEqual(['milestone', 'reply']);
    expect(a.fields.every((f: any) => f.locks && f.locks.level)).toBe(true);
    expect(a.core.exists).toBe(true);
    expect(a.core.sync.state).toBe('ok');
    expect(a.core.sync.missing).toEqual([]);

    const b = data.skills.find((s: any) => s.skillId === 'zz-fixture-goal-b');
    expect(b.routings).toHaveLength(1);
    expect(b.fields.map((f: any) => f.fieldId)).toEqual(['reply']);
    expect(b.core.exists).toBe(true);
    expect(b.core.sync.state).toBe('ok');

    const aux = data.skills.find((s: any) => s.skillId === 'zz-fixture-goal-aux');
    expect(aux.routings).toEqual([]);
    expect(aux.fields).toEqual([]);
    expect(aux.core.exists).toBe(false);
    expect(aux.core.sync).toBeNull();
  });

  it('批量条目与单 skill 端点结果逐字段一致', async () => {
    const batchHandler = getRouteHandler('/skill-batch');
    const singleHandler = getRouteHandler('/skill/:skillId');

    const batchRes = createResponse();
    await batchHandler({ query: { stage: 'goal' } }, batchRes);
    const singleRes = createResponse();
    await singleHandler({ params: { skillId: 'zz-fixture-goal-a' } }, singleRes);

    const batchItem = batchRes.json.mock.calls[0][0].data.skills.find(
      (s: any) => s.skillId === 'zz-fixture-goal-a',
    );
    const singleData = singleRes.json.mock.calls[0][0].data;
    const { promptRoleMeta: singleMeta, ...singleRest } = singleData;
    expect(batchItem).toEqual(singleRest);
    expect(batchRes.json.mock.calls[0][0].data.promptRoleMeta).toEqual(singleMeta);
  });

  it('空 stage（有编排文件、无登记 skill）→ skills: []', async () => {
    const handler = getRouteHandler('/skill-batch');
    const res = createResponse();
    await handler({ query: { stage: 'teaching' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    const data = res.json.mock.calls[0][0].data;
    expect(data.stage).toBe('teaching');
    expect(data.skills).toEqual([]);
  });

  it('未知 stage → 404', async () => {
    const handler = getRouteHandler('/skill-batch');
    const res = createResponse();
    await handler({ query: { stage: 'nonexistent' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it('缺 stage 参数 → 400', async () => {
    const handler = getRouteHandler('/skill-batch');
    const res = createResponse();
    await handler({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it('编排文件损坏 → 422', async () => {
    fs.writeFileSync(path.join(process.env.ORCHESTRATION_DIR!, 'broken.yaml'), 'stage: [unclosed', 'utf-8');
    const handler = getRouteHandler('/skill-batch');
    const res = createResponse();
    await handler({ query: { stage: 'broken' } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});
