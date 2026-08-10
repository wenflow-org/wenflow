/**
 * GET /api/admin/skills/reconciliation 端点单测（SKILL_READINESS_SPEC §4.2）：
 * 四向对账（户口簿/manifest/gateway 注册/ACTIVE prompt）+ 完成度投影 + 差集标记。
 */
import type { SkillCompletionReport } from '../../services/skill-registry/skill-completion.service';

const completionFixture: SkillCompletionReport = {
  status: 'live',
  gates: {
    draft: { ok: true, detail: 'd' },
    handlerReady: { ok: true, detail: 'h' },
    coreReady: { ok: true, detail: 'c' },
    fieldsSynced: { ok: true, detail: 'f' },
    live: { ok: true, detail: 'l' },
  },
  items: [],
  warnings: [],
};

const mockGetSkillCompletion = jest.fn();

jest.mock('../../services/skill-registry/skill-completion.service', () => ({
  getSkillCompletion: (...args: unknown[]) => mockGetSkillCompletion(...args),
}));

jest.mock('../../services/skill-registry/skills-file', () => {
  const book = {
    version: 1,
    skills: [
      {
        skillId: 'goal-conversation',
        kind: 'mainline',
        stage: 'goal',
        handlerRef: 'backend/src/skills/goal-conversation/index.ts',
        coreFile: 'prompts/core/goal-conversation.yaml',
        displayName: '目标对话',
      },
      {
        skillId: 'semantic-freeze-judge',
        kind: 'aux',
        handlerRef: 'backend/src/skills/v4-aux-skills/semantic-freeze-judge/index.ts',
        coreFile: 'prompts/core/semantic-freeze-judge.yaml',
        registrationPoint: 'platform-direct',
      },
      {
        skillId: 'unregistered-skill',
        kind: 'aux',
        handlerRef: 'backend/src/skills/unregistered/index.ts',
        coreFile: 'prompts/core/unregistered.yaml',
      },
    ],
  };
  return {
    loadSkillsBookRaw: jest.fn(() => book),
    getActiveSkillIds: jest.fn(() => new Set(book.skills.map((entry: any) => entry.skillId))),
  };
});

jest.mock('../../services/agent-manifest.service', () => ({
  listRawManifestEntries: jest.fn(() => [
    { id: 'goal-agent', kind: 'agent' },
    { id: 'skill:goal-conversation', kind: 'skill' },
    { id: 'skill:semantic-freeze-judge', kind: 'skill' },
  ]),
}));

jest.mock('../../services/field-routing/orchestration-file', () => ({
  loadOrchestrationFiles: jest.fn(() => []),
}));

const mockAgentPromptsFindMany = jest.fn();
const mockSkillRegistrationsFindMany = jest.fn();

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findMany: (...args: unknown[]) => mockAgentPromptsFindMany(...args) },
    skill_registrations: { findMany: (...args: unknown[]) => mockSkillRegistrationsFindMany(...args) },
  },
}));

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));

jest.mock('../../gateway', () => ({ getGateway: jest.fn(() => null) }));

import router from '../admin/skills';

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

async function callReconciliation() {
  const handler = getRouteHandler('/reconciliation');
  const res = createResponse();
  await handler({ params: {}, query: {} }, res);
  return res;
}

describe('GET /api/admin/skills/reconciliation：四向对账', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSkillCompletion.mockResolvedValue(completionFixture);
    mockAgentPromptsFindMany.mockResolvedValue([
      { agentId: 'skill:goal-conversation' },
      { agentId: 'skill:ghost-prompt' },
    ]);
    mockSkillRegistrationsFindMany.mockResolvedValue([
      { name: 'goal-conversation' },
      { name: 'ghost-registration' },
    ]);
  });

  it('每行四列状态 + completion + 差集标记；注册豁免与 ACTIVE 豁免正确', async () => {
    const res = await callReconciliation();
    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);

    const items = body.data.items;
    expect(items).toHaveLength(3);

    const goal = items.find((item: any) => item.skillId === 'goal-conversation');
    expect(goal).toEqual(
      expect.objectContaining({
        book: true,
        manifest: true,
        registered: true,
        active: true,
        diff: null,
        completion: expect.objectContaining({ status: 'live' }),
      }),
    );

    // platform-direct 豁免：未注册是预期 → 不标 unregistered；无 ACTIVE 且非 noPromptFile → active-missing
    const exempt = items.find((item: any) => item.skillId === 'semantic-freeze-judge');
    expect(exempt.registered).toBe(false);
    expect(exempt.registrationExempt).toBe(true);
    expect(exempt.active).toBe(false);
    expect(exempt.diff).toBe('active-missing');

    // 户口簿有注册无且非豁免 → unregistered
    const unregistered = items.find((item: any) => item.skillId === 'unregistered-skill');
    expect(unregistered.registered).toBe(false);
    expect(unregistered.registrationExempt).toBe(false);
    expect(unregistered.diff).toBe('unregistered');
    expect(unregistered.manifest).toBe(false);
  });

  it('幽灵残留单列：注册表有、户口簿无 → orphanRegistrations + summary 计数', async () => {
    const res = await callReconciliation();
    const body = res.json.mock.calls[0][0];
    expect(body.data.orphanRegistrations).toEqual([{ name: 'ghost-registration' }]);
    expect(body.data.summary).toEqual(
      expect.objectContaining({
        total: 3,
        registered: 1,
        active: 1,
        unregistered: 1,
        activeMissing: 1,
        orphanRegistrations: 1,
        byStatus: { live: 3 },
      }),
    );
  });

  it('completion 计算复用本次 ACTIVE 查询（activePromptIds 注入，无额外 DB 查询）', async () => {
    await callReconciliation();
    expect(mockGetSkillCompletion).toHaveBeenCalledWith(
      'goal-conversation',
      expect.objectContaining({
        activePromptIds: new Set(['skill:goal-conversation', 'skill:ghost-prompt']),
      }),
    );
    // agent_prompts 只查一次（端点内），未因 completion 重复查询
    expect(mockAgentPromptsFindMany).toHaveBeenCalledTimes(1);
  });

  it('DB 查询失败 → 500（错误不静默）', async () => {
    mockAgentPromptsFindMany.mockRejectedValue(new Error('db down'));
    const res = await callReconciliation();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
