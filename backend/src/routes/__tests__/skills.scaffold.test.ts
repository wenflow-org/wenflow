/**
 * POST /api/admin/skills/scaffold 端点单测（SCAFFOLD_P5_SURVEY §5 / SKILL_READINESS_SPEC §5）
 *
 * 覆盖：
 *   - 正常创建 → 200 { success, data: { skillId, kind, status, generated, completion, snippets, note } }
 *   - 已存在（条目与生成物齐备）→ 409 + completion
 *   - 输入非法 → 400；冲突 → 409
 *   - SKILLS_FILE_DISABLED=1 → 503（过渡开关拒绝写盘）
 *   - GET /scaffold/meta → kinds/stages/agents
 *
 * 通过 jest.mock 替身 scaffoldSkill / getScaffoldMeta；错误类使用 requireActual 保留
 * instanceof 语义（路由内部分派 400/409）。
 */
import type { SkillCompletionReport } from '../../services/skill-registry/skill-completion.service';
import type { ScaffoldOutcome } from '../../services/skill-registry/skill-scaffold.service';

const mockScaffoldSkill = jest.fn();
const mockGetScaffoldMeta = jest.fn();

jest.mock('../../services/skill-registry/skill-scaffold.service', () => {
  const actual = jest.requireActual('../../services/skill-registry/skill-scaffold.service');
  return {
    ...actual,
    scaffoldSkill: (...args: unknown[]) => mockScaffoldSkill(...args),
    getScaffoldMeta: (...args: unknown[]) => mockGetScaffoldMeta(...args),
  };
});

jest.mock('../../services/skill-registry/skill-completion.service', () => ({
  getSkillCompletion: jest.fn(),
}));

jest.mock('../../services/skill-registry/skills-file', () => ({
  loadSkillsBookRaw: jest.fn(() => ({ version: 1, skills: [] })),
}));

jest.mock('../../services/agent-manifest.service', () => ({
  getCanonicalAgentId: jest.fn((id: string) => (id.startsWith('skill:') ? id : `skill:${id}`)),
  getAgentManifest: jest.fn(() => undefined),
  getAgentOfSkill: jest.fn(() => null),
  listRawManifestEntries: jest.fn(() => []),
}));

jest.mock('../../services/skill-runtime-contract.service', () => ({
  getUnifiedSkillStats: jest.fn(async () => new Map()),
  resolveEffectiveSkillRuntimeConfig: jest.fn(async () => ({
    skillId: 'x',
    canonicalId: 'skill:x',
    route: {},
    llmRequest: {},
    override: null,
    reliability: {},
  })),
  toLegacySkillRuntimeStats: jest.fn(),
  emptyRuntimeStats: jest.fn(),
}));

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findMany: jest.fn(async () => []) },
    agent_contracts: { findUnique: jest.fn(async () => null) },
    node_config_changes: { create: jest.fn(async (args: any) => ({ id: 'audit-1', ...args.data })) },
  },
}));

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));

jest.mock('../../gateway', () => ({ getGateway: jest.fn(() => null) }));

import router from '../admin/skills';
import { ScaffoldInputError, ScaffoldConflictError } from '../../services/skill-registry/skill-scaffold.service';

const completionFixture: SkillCompletionReport = {
  status: 'handler-ready',
  gates: {
    draft: { ok: true, detail: '户口簿有登记' },
    handlerReady: { ok: true, detail: 'handler 文件存在（F5）' },
    coreReady: { ok: false, detail: 'TODO 占位' },
    fieldsSynced: { ok: true, detail: 'contracts 已追加' },
    live: { ok: false, detail: '无 ACTIVE' },
  },
  items: [],
  warnings: [],
};

function getRouteHandler(path: string, method = 'get') {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

async function callScaffold(body: unknown) {
  const handler = getRouteHandler('/scaffold', 'post');
  const res = createResponse();
  await handler({ body }, res);
  return res;
}

describe('skills scaffold 端点', () => {
  const originalEnv = process.env.SKILLS_FILE_DISABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    mockScaffoldSkill.mockResolvedValue({
      status: 'created',
      skillId: 'test-scaffold-demo',
      kind: 'mainline',
      generated: ['prompts/core/test-scaffold-demo.yaml', 'backend/src/skills/test-scaffold-demo/index.ts'],
      completion: completionFixture,
      snippets: [
        { title: 'skills/index.ts 注册片段', content: '// x' },
        { title: 'agent-manifest.service.ts 条目模板（F12：mainline/handler-only 必须登记，kind=skill）', content: "// { id: 'skill:test-scaffold-demo', ... }" },
      ],
      note: 'handler 未实现前调用会抛 SC_NOT_IMPLEMENTED',
    });
    mockGetScaffoldMeta.mockReturnValue({
      kinds: ['mainline', 'aux', 'handler-only'],
      stages: ['goal', 'path', 'teaching', 'profile', 'simulation'],
      agents: [{ id: 'goal-agent', name: '目标 Agent' }],
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SKILLS_FILE_DISABLED;
    else process.env.SKILLS_FILE_DISABLED = originalEnv;
  });

  it('POST /scaffold 正常创建 → 200 + created + 响应体结构', async () => {
    const res = await callScaffold({ skillId: 'test-scaffold-demo', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' });
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('created');
    expect(body.data.skillId).toBe('test-scaffold-demo');
    expect(body.data.completion.status).toBe('handler-ready');
    expect(body.data.generated).toHaveLength(2);
    expect(body.data.note).toContain('SC_NOT_IMPLEMENTED');
    // P2：响应 snippets 含 manifest 条目模板（F12 登记指引）
    expect(body.data.snippets.some((s: any) => s.title.includes('agent-manifest.service.ts'))).toBe(true);
    expect(mockScaffoldSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: 'test-scaffold-demo', kind: 'mainline' }),
    );
  });

  it('创建成功时写 node_config_changes 审计（changeType=skill-scaffold，targetId=skillId，before=null，after=生成物摘要）', async () => {
    const res = await callScaffold({ skillId: 'test-scaffold-demo', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' });
    expect(res.status).not.toHaveBeenCalled();
    const systemDb = (jest.requireMock('../../config/system-database') as any).default;
    const createMock = systemDb.node_config_changes.create as jest.Mock;
    expect(createMock).toHaveBeenCalledTimes(1);
    const [call] = createMock.mock.calls;
    expect(call[0].data.changeType).toBe('skill-scaffold');
    expect(call[0].data.targetTable).toBe('skills');
    expect(call[0].data.targetId).toBe('test-scaffold-demo');
    expect(call[0].data.before).toBeNull();
    const after = JSON.parse(call[0].data.after);
    expect(after.status).toBe('created');
    expect(after.kind).toBe('mainline');
    expect(after.generated).toHaveLength(2);
  });

  it('已存在（条目与生成物齐备）→ 409 + completion（不写审计：无实际写入）', async () => {
    mockScaffoldSkill.mockResolvedValue({
      status: 'already-exists',
      skillId: 'test-scaffold-demo',
      completion: completionFixture,
    } as ScaffoldOutcome);
    const res = await callScaffold({ skillId: 'test-scaffold-demo', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' });
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.data.completion.status).toBe('handler-ready');
    const systemDb = (jest.requireMock('../../config/system-database') as any).default;
    expect(systemDb.node_config_changes.create).not.toHaveBeenCalled();
  });

  it('输入非法 → 400', async () => {
    mockScaffoldSkill.mockRejectedValue(new ScaffoldInputError('mainline 必填 stage'));
    const res = await callScaffold({ skillId: 'x', kind: 'mainline' });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('冲突（manifest 占用）→ 409', async () => {
    mockScaffoldSkill.mockRejectedValue(new ScaffoldConflictError('skillId 已被 manifest 占用'));
    const res = await callScaffold({ skillId: 'teaching-turn', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('SKILLS_FILE_DISABLED=1 → 503（过渡开关拒绝写盘）', async () => {
    process.env.SKILLS_FILE_DISABLED = '1';
    const res = await callScaffold({ skillId: 'x', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockScaffoldSkill).not.toHaveBeenCalled();
  });

  it('GET /scaffold/meta → 200 + kinds/stages/agents', async () => {
    const handler = getRouteHandler('/scaffold/meta', 'get');
    const res = createResponse();
    await handler({ query: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.kinds).toContain('mainline');
    expect(body.data.stages).toContain('goal');
    expect(body.data.agents[0]).toEqual({ id: 'goal-agent', name: '目标 Agent' });
  });
});
