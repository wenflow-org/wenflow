/**
 * Admin · Token 成本统计路由测试
 * - 纯函数：agentDisplayName（manifest 名称映射）/ parseMetadataSkillId
 * - 路由级：mock prisma 注入 findMany（token 行 + 调用行），断言响应结构
 *
 * 数据口径（2026-08 实测）：token 只在 api-gateway 层行（tokensUsed>0），
 * skill 归因在 metadata.skillId；调用/失败计数来自全量行。
 */

const mockAgentCallLogs = {
  findMany: jest.fn(),
};

const mockUsers = {
  findMany: jest.fn(),
};

const mockPrisma = {
  users: mockUsers,
  agent_call_logs: mockAgentCallLogs,
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

import { agentDisplayName, parseMetadataSkillId } from '../token-cost';
import router from '../token-cost';

function getRouteHandler(path: string, method: 'get' | 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(query: Record<string, unknown> = {}) {
  return { query, user: { userId: 'admin-1' } } as any;
}

/** token 行（api-gateway 层，带 metadata.skillId） */
function tokenRow(skillId: string, userId: string, model: string, tokens: number, success = true) {
  return {
    metadata: JSON.stringify({ skillId, layer: 'api-gateway-v2', executionLayer: 'api-gateway' }),
    userId,
    model,
    tokensUsed: tokens,
    promptTokens: Math.floor(tokens * 0.8),
    completionTokens: tokens - Math.floor(tokens * 0.8),
    success,
    calledAt: new Date(),
  };
}

/** 调用计数行（skill 层或任意层，无 token） */
function callRow(agentId: string, success = true) {
  return { agentId, success, calledAt: new Date() };
}

describe('agentDisplayName（manifest 名称映射）', () => {
  it('manifest 收录的 agentId 返回可读名', () => {
    const name = agentDisplayName('path-agent');
    expect(name).not.toBe('path-agent');
    expect(name.length).toBeGreaterThan(0);
  });

  it('skill: 前缀剥离', () => {
    expect(agentDisplayName('skill:some-skill')).toBe('some-skill');
  });

  it('未知 id 原样返回', () => {
    expect(agentDisplayName('unknown-agent-xyz')).toBe('unknown-agent-xyz');
  });
});

describe('parseMetadataSkillId', () => {
  it('解析合法 metadata', () => {
    expect(parseMetadataSkillId('{"skillId":"teaching-turn","a":1}')).toBe('teaching-turn');
  });

  it('null / 空 / 非法 JSON 返回 null', () => {
    expect(parseMetadataSkillId(null)).toBeNull();
    expect(parseMetadataSkillId('')).toBeNull();
    expect(parseMetadataSkillId('not-json')).toBeNull();
    expect(parseMetadataSkillId('{"skillId":null}')).toBeNull();
  });
});

describe('GET /token-cost/summary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('总量 / 调用数 / prompt·completion / 按天趋势', async () => {
    mockUsers.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    mockAgentCallLogs.findMany
      .mockResolvedValueOnce([tokenRow('teaching-turn', 'u1', 'm1', 100), tokenRow('teaching-turn', 'u1', 'm1', 200)])
      .mockResolvedValueOnce([callRow('skill:teaching-turn'), callRow('skill:teaching-turn', false), callRow('path-agent')]);

    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totals.tokens).toBe(300);
    expect(body.data.totals.promptTokens).toBe(240); // 2 × 100*0.8
    expect(body.data.totals.completionTokens).toBe(60);
    expect(body.data.totals.calls).toBe(3);
    expect(body.data.totals.failed).toBe(1);
    expect(body.data.trend).toHaveLength(7);
    const sum = body.data.trend.reduce((s: number, t: any) => s + t.tokens, 0);
    expect(sum).toBe(300);
    const failedDay = body.data.trend.find((t: any) => t.failed > 0);
    expect(failedDay).toBeDefined();
  });

  it('includeTest=1 跳过真实用户过滤', async () => {
    mockAgentCallLogs.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7', includeTest: '1' }), res);
    expect(mockUsers.findMany).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.includeTest).toBe(true);
  });
});

describe('GET /token-cost/by-skill', () => {
  beforeEach(() => jest.clearAllMocks());

  it('按 metadata.skillId 聚合：token 降序 + 失败计数 + 可读名', async () => {
    mockUsers.findMany.mockResolvedValue([]);
    mockAgentCallLogs.findMany
      .mockResolvedValueOnce([
        tokenRow('teaching-turn', 'u1', 'm1', 900, true),
        tokenRow('teaching-turn', 'u1', 'm1', 100, false),
        tokenRow('virtual-learner-learn-turn-simulator', 'u1', 'm1', 500),
      ])
      .mockResolvedValueOnce([]);

    const handler = getRouteHandler('/by-skill', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '30' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].key).toBe('teaching-turn');
    expect(body.data.items[0].tokens).toBe(1000);
    expect(body.data.items[0].calls).toBe(2);
    expect(body.data.items[0].failed).toBe(1);
    expect(body.data.items[1].key).toBe('virtual-learner-learn-turn-simulator');
    expect(body.data.items[1].tokens).toBe(500);
  });

  it('无 skillId 的 token 行归入「未归因」', async () => {
    mockUsers.findMany.mockResolvedValue([]);
    mockAgentCallLogs.findMany
      .mockResolvedValueOnce([
        { metadata: '{"skillId":null}', userId: 'system', model: 'm1', tokensUsed: 20, promptTokens: 10, completionTokens: 10, success: true, calledAt: new Date() },
      ])
      .mockResolvedValueOnce([]);

    const handler = getRouteHandler('/by-skill', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.items[0].key).toBe('未归因');
    expect(body.data.items[0].tokens).toBe(20);
  });
});

describe('GET /token-cost/by-user', () => {
  beforeEach(() => jest.clearAllMocks());

  it('top N 排行 + 用户名邮箱补全', async () => {
    mockUsers.findMany
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]) // resolveRealUserIds
      .mockResolvedValueOnce([{ id: 'u1', name: '张三', email: 'zhang@test.com' }]); // 用户名补全
    mockAgentCallLogs.findMany
      .mockResolvedValueOnce([
        tokenRow('teaching-turn', 'u1', 'm1', 700),
        tokenRow('goal-conversation', 'u2', 'm1', 300),
      ])
      .mockResolvedValueOnce([]);

    const handler = getRouteHandler('/by-user', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7', limit: '20' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].key).toBe('u1');
    expect(body.data.items[0].tokens).toBe(700);
    expect(body.data.items[0].name).toBe('张三');
    expect(body.data.items[0].email).toBe('zhang@test.com');
  });
});

describe('GET /token-cost/by-model', () => {
  beforeEach(() => jest.clearAllMocks());

  it('按 model 聚合排行', async () => {
    mockUsers.findMany.mockResolvedValue([]);
    mockAgentCallLogs.findMany
      .mockResolvedValueOnce([
        tokenRow('teaching-turn', 'u1', 'deepseek-v4-flash', 800),
        tokenRow('goal-conversation', 'u2', 'gpt-4o', 200),
      ])
      .mockResolvedValueOnce([]);

    const handler = getRouteHandler('/by-model', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].key).toBe('deepseek-v4-flash');
    expect(body.data.items[0].tokens).toBe(800);
  });
});
