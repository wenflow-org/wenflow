/**
 * workbench-meta 端点单测（SKILL_READINESS_SPEC §1.2/§1.3）：
 * - 404 降级：不在 manifest 但户口簿有登记的 skill → 200 + { draft: true, completion, displayName, description }
 * - 完全不在户口簿 → 404
 * - manifest skill 正常路径 → 200 + completion 字段（全部 skill 响应扩展）
 * - manifest kind=agent → 400（行为不变）
 */
import type { AgentManifestEntry } from '../../services/agent-manifest.service';
import type { SkillCompletionReport } from '../../services/skill-registry/skill-completion.service';

const manifestFixture: AgentManifestEntry = {
  id: 'skill:goal-conversation',
  name: '目标对话',
  description: '与学习者多轮对话，收集学习目标',
  category: 'generation',
  kind: 'skill',
  runtimeEnabled: true,
  userVisible: true,
};

const completionFixture: SkillCompletionReport = {
  status: 'live',
  gates: {
    draft: { ok: true, detail: '户口簿有登记' },
    handlerReady: { ok: true, detail: 'handler 存在' },
    coreReady: { ok: true, detail: 'core 合法' },
    fieldsSynced: { ok: true, detail: '无缺项' },
    live: { ok: true, detail: 'ACTIVE 存在' },
  },
  items: [],
  warnings: [],
};

const draftCompletionFixture: SkillCompletionReport = {
  ...completionFixture,
  status: 'draft',
  gates: { ...completionFixture.gates, handlerReady: { ok: false, detail: 'handler 不存在' } },
};

const mockGetSkillCompletion = jest.fn();

jest.mock('../../services/skill-registry/skill-completion.service', () => ({
  getSkillCompletion: (...args: unknown[]) => mockGetSkillCompletion(...args),
}));

jest.mock('../../services/skill-registry/skills-file', () => ({
  loadSkillsBookRaw: jest.fn(() => ({
    version: 1,
    skills: [
      {
        skillId: 'draft-skill',
        kind: 'mainline',
        stage: 'goal',
        handlerRef: 'backend/src/skills/draft-skill/index.ts',
        coreFile: 'prompts/core/draft-skill.yaml',
        displayName: '草稿技能',
        description: 'scaffold 后未合并 manifest 的 skill',
      },
    ],
  })),
}));

jest.mock('../../services/agent-manifest.service', () => ({
  getCanonicalAgentId: jest.fn((id: string) => (id.startsWith('skill:') ? id : `skill:${id}`)),
  getAgentManifest: jest.fn((id: string) => (id === 'skill:goal-conversation' ? manifestFixture : undefined)),
  getAgentOfSkill: jest.fn(() => null),
}));

jest.mock('../../services/skill-runtime-contract.service', () => ({
  getUnifiedSkillStats: jest.fn(async () => new Map()),
  resolveEffectiveSkillRuntimeConfig: jest.fn(async () => ({
    skillId: 'goal-conversation',
    canonicalId: 'skill:goal-conversation',
    route: {
      model: 'deepseek-v4-flash',
      temperature: 0.7,
      maxTokens: 2000,
      timeoutMs: 30000,
      thinkingMode: null,
      reasoningEffort: null,
      source: 'platform-default',
      hasSkillOverride: false,
    },
    llmRequest: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 2000, source: 'route', activePrompt: null },
    override: null,
    reliability: {
      maxUpstreamAttempts: 3,
      maxTransportRetries: 2,
      maxLogicalRetries: 1,
      logicalRetrySource: 'platform-default',
      platformMaxLogicalRetries: 1,
    },
  })),
  toLegacySkillRuntimeStats: jest.fn(),
  emptyRuntimeStats: jest.fn(),
}));

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findMany: jest.fn(async () => []) },
    agent_contracts: { findUnique: jest.fn(async () => null) },
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

async function callWorkbenchMeta(skillId: string) {
  const handler = getRouteHandler('/:skillId/workbench-meta');
  const res = createResponse();
  await handler({ params: { skillId }, query: {} }, res);
  return res;
}

describe('workbench-meta：404 降级与 completion 扩展', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSkillCompletion.mockResolvedValue(draftCompletionFixture);
  });

  it('不在 manifest 但户口簿有条目 → 200 + draft 态 completion（scaffold 链路）', async () => {
    const res = await callWorkbenchMeta('draft-skill');
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          draft: true,
          displayName: '草稿技能',
          description: 'scaffold 后未合并 manifest 的 skill',
          completion: expect.objectContaining({ status: 'draft' }),
        }),
      }),
    );
    expect(mockGetSkillCompletion).toHaveBeenCalledWith('draft-skill');
  });

  it('完全不在 manifest 也不在户口簿 → 404（行为不变）', async () => {
    const res = await callWorkbenchMeta('ghost-skill');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockGetSkillCompletion).not.toHaveBeenCalled();
  });

  it('manifest skill 正常路径 → 200 + completion 字段（复用本次 ACTIVE 查询）', async () => {
    mockGetSkillCompletion.mockResolvedValue(completionFixture);
    const res = await callWorkbenchMeta('goal-conversation');
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.skill.id).toBe('skill:goal-conversation');
    expect(body.data.completion.status).toBe('live');
    expect(mockGetSkillCompletion).toHaveBeenCalledWith(
      'goal-conversation',
      expect.objectContaining({ activePromptIds: expect.any(Set) }),
    );
  });

  it('manifest kind=agent → 400（Agent 编排器不用 Skill 工作台）', async () => {
    const { getAgentManifest: mockGetAgentManifest } = require('../../services/agent-manifest.service');
    mockGetAgentManifest.mockReturnValueOnce({
      ...manifestFixture,
      id: 'goal-agent',
      kind: 'agent',
      name: '目标 Agent',
    });
    const res = await callWorkbenchMeta('goal-agent');
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
