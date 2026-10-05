/**
 * Admin · Token 成本统计路由测试
 * - 纯函数：agentDisplayName（manifest 名称映射）/ parseMetadataSkillId
 * - 路由级：mock 服务层聚合函数（2026-10-04 SQL 聚合改造后，DB 侧由
 *   aggregateWindow / aggregateTokenGroups 提供聚合结果，route 只做装配）
 *
 * 数据口径（2026-08 实测）：token 只在 api-gateway 层行（tokensUsed>0），
 * skill 归因在 metadata.skillId（SQL json_extract 取值）；调用/失败计数来自全量行。
 */

jest.mock('../../../services/cost/token-cost.service', () => ({
  __esModule: true,
  resolveRealUserIds: jest.fn(),
  listUsersBasicInfo: jest.fn(),
  aggregateWindow: jest.fn(),
  aggregateTokenGroups: jest.fn(),
}));

import { agentDisplayName, parseMetadataSkillId, __clearTokenCacheForTests } from '../token-cost';
import router from '../token-cost';
import {
  resolveRealUserIds,
  listUsersBasicInfo,
  aggregateWindow,
  aggregateTokenGroups,
} from '../../../services/cost/token-cost.service';
import { dayKeyOf } from '../../../services/time/day-boundary';

const mockResolveRealUserIds = resolveRealUserIds as jest.Mock;
const mockListUsersBasicInfo = listUsersBasicInfo as jest.Mock;
const mockAggregateWindow = aggregateWindow as jest.Mock;
const mockAggregateTokenGroups = aggregateTokenGroups as jest.Mock;

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

/** 分组聚合行（= SQL (skillId,userId,model) GROUP BY 的产出；prompt/completion 默认 80/20 拆分） */
function group(
  skillId: string | null,
  userId: string | null,
  model: string | null,
  params: { tokens: number; calls?: number; failed?: number; promptTokens?: number; completionTokens?: number },
) {
  const prompt = params.promptTokens ?? Math.floor(params.tokens * 0.8);
  return {
    skillId,
    userId,
    model,
    calls: params.calls ?? 1,
    failed: params.failed ?? 0,
    tokens: params.tokens,
    promptTokens: prompt,
    completionTokens: params.completionTokens ?? params.tokens - prompt,
  };
}

const ZERO_WINDOW = { calls: 0, failed: 0, tokens: 0 };

/** 窗口聚合 mock：总量（toMs=null）用 totals；每个本地日窗用 dayValue（只给「今天」填值） */
function mockWindow(totals: { calls: number; failed: number; tokens: number } = ZERO_WINDOW, dayValue?: Partial<typeof ZERO_WINDOW>) {
  mockAggregateWindow.mockImplementation(async (fromMs: number, toMs: number | null) => {
    if (toMs == null) return totals;
    const label = dayKeyOf(new Date(fromMs));
    if (label === dayKeyOf(new Date())) return { ...ZERO_WINDOW, ...(dayValue ?? {}) };
    return { ...ZERO_WINDOW };
  });
}

function mockEmptyTokenGroups() {
  mockAggregateTokenGroups.mockResolvedValue([]);
}

describe('agentDisplayName（manifest 名称映射）', () => {
  it('manifest 收录的 agentId 返回可读名', () => {
    const name = agentDisplayName('path-agent');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('skill: 前缀剥离', () => {
    expect(agentDisplayName('skill:unknown-skill')).toBe('unknown-skill');
  });

  it('未知 id 原样返回', () => {
    expect(agentDisplayName('random-id')).toBe('random-id');
  });
});

describe('parseMetadataSkillId', () => {
  it('解析合法 metadata', () => {
    expect(parseMetadataSkillId('{"skillId":"teaching-turn"}')).toBe('teaching-turn');
  });

  it('null / 空 / 非法 JSON 返回 null', () => {
    expect(parseMetadataSkillId(null)).toBeNull();
    expect(parseMetadataSkillId('')).toBeNull();
    expect(parseMetadataSkillId('not-json')).toBeNull();
    expect(parseMetadataSkillId('{"skillId":null}')).toBeNull();
  });
});

describe('GET /token-cost/summary', () => {
  beforeEach(() => { jest.clearAllMocks(); __clearTokenCacheForTests(); });

  it('缓存命中：同 key 二次请求不重复查库（TTL 5min 内存缓存）', async () => {
    mockResolveRealUserIds.mockResolvedValue(['u1']);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([group('teaching-turn', 'u1', 'm1', { tokens: 100 })]);

    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);
    const callsAfterFirst = mockAggregateTokenGroups.mock.calls.length + mockAggregateWindow.mock.calls.length;

    // 二次请求：缓存命中，聚合查询不再被调用
    const res2 = createResponse();
    await handler(createRequest({ days: '7' }), res2);
    expect(mockAggregateTokenGroups.mock.calls.length + mockAggregateWindow.mock.calls.length).toBe(callsAfterFirst);
    expect(res2.json.mock.calls[0][0].data.totals.tokens).toBe(100);
  });

  it('总量 / 调用数 / prompt·completion / 按天趋势', async () => {
    mockResolveRealUserIds.mockResolvedValue(['u1', 'u2']);
    // 窗口总量：3 次调用（含 1 失败）；今天窗内 3 次调用 1 失败
    mockWindow({ calls: 3, failed: 1, tokens: 300 }, { calls: 3, failed: 1, tokens: 300 });
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'm1', { tokens: 300, calls: 2 }),
    ]);

    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totals.tokens).toBe(300);
    expect(body.data.totals.promptTokens).toBe(240); // 0.8 拆分
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
    mockWindow();
    mockEmptyTokenGroups();
    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7', includeTest: '1' }), res);
    expect(mockResolveRealUserIds).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.includeTest).toBe(true);
  });
});

describe('GET /token-cost/by-skill', () => {
  beforeEach(() => { jest.clearAllMocks(); __clearTokenCacheForTests(); });

  it('按 metadata.skillId 聚合：token 降序 + 失败计数 + 可读名', async () => {
    mockResolveRealUserIds.mockResolvedValue([]);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'm1', { tokens: 1000, calls: 2, failed: 1 }),
      group('virtual-learner-learn-turn-simulator', 'u1', 'm1', { tokens: 500 }),
    ]);

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
    mockResolveRealUserIds.mockResolvedValue([]);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group(null, 'system', 'm1', { tokens: 20, promptTokens: 10, completionTokens: 10 }),
    ]);

    const handler = getRouteHandler('/by-skill', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.items[0].key).toBe('未归因');
    expect(body.data.items[0].tokens).toBe(20);
  });
});

describe('GET /token-cost/by-user', () => {
  beforeEach(() => { jest.clearAllMocks(); __clearTokenCacheForTests(); });

  it('top N 排行 + 用户名邮箱补全', async () => {
    mockResolveRealUserIds.mockResolvedValue(['u1', 'u2']);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'm1', { tokens: 700 }),
      group('goal-conversation', 'u2', 'm1', { tokens: 300 }),
    ]);
    mockListUsersBasicInfo.mockResolvedValue([{ id: 'u1', name: '张三', email: 'zhang@test.com' }]);

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

  it('q 过滤：按昵称/邮箱命中，且搜索面覆盖全量（不受 limit 截断）', async () => {
    mockResolveRealUserIds.mockResolvedValue(['u1', 'u2', 'u3']);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'm1', { tokens: 900 }),
      group('teaching-turn', 'u2', 'm1', { tokens: 800 }),
      group('teaching-turn', 'u3', 'm1', { tokens: 700 }),
    ]);
    mockListUsersBasicInfo.mockResolvedValue([
      { id: 'u1', name: '甲', email: 'a@test.com' },
      { id: 'u2', name: '乙', email: 'b@test.com' },
      { id: 'u3', name: '测试账号丙', email: 'c@test.com' },
    ]);

    const handler = getRouteHandler('/by-user', 'get');
    const res = createResponse();
    // limit=1，但按昵称命中的是排名第 3 的 u3 → 证明搜索在全量 byUser 上过滤，而非只搜 Top-limit
    await handler(createRequest({ days: '7', limit: '1', q: '测试账号' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].key).toBe('u3');
    expect(body.data.items[0].name).toBe('测试账号丙');
  });
});

describe('GET /token-cost/by-model', () => {
  beforeEach(() => { jest.clearAllMocks(); __clearTokenCacheForTests(); });

  it('按 model 聚合排行', async () => {
    mockResolveRealUserIds.mockResolvedValue([]);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'deepseek-v4-flash', { tokens: 800 }),
      group('goal-conversation', 'u2', 'gpt-4o', { tokens: 200 }),
    ]);

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

describe('GET /token-cost · 成本字段与 pricingStatus', () => {
  beforeEach(() => { jest.clearAllMocks(); __clearTokenCacheForTests(); });

  it('summary 响应：新增成本字段 + 顶层 pricingStatus；单价未配置时 usd=null（不用 0 冒充）', async () => {
    mockResolveRealUserIds.mockResolvedValue(['u1']);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'deepseek-v4-flash', { tokens: 1000 }),
      group('teaching-turn', 'u1', 'agnes-3.0-flash', { tokens: 500 }),
    ]);

    const handler = getRouteHandler('/summary', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    // 顶层 pricingStatus：models.config.ts 的 pricing 仍为空 → 出现过的模型都进待补清单
    expect(body.pricingStatus.configuredModels).toEqual([]);
    expect(body.pricingStatus.missingPricingModels).toEqual(['deepseek-v4-flash', 'agnes-3.0-flash']);
    // totals 成本字段
    expect(body.data.totals.usd).toBeNull();
    expect(body.data.totals.pricingKnown).toBe(false);
    expect(body.data.totals.callsMissingPricing).toBe(2);
    expect(body.data.totals.pricedCalls).toBe(0);
    // 既有字段语义/名字不变
    expect(body.data.totals.tokens).toBe(1500);
    expect(body.data.totals.calls).toBe(0);
  });

  it('by-model 条目：携带 usd/pricingKnown/callsMissingPricing/pricedCalls', async () => {
    mockResolveRealUserIds.mockResolvedValue([]);
    mockWindow();
    mockAggregateTokenGroups.mockResolvedValue([
      group('teaching-turn', 'u1', 'deepseek-v4-flash', { tokens: 800 }),
      group('teaching-turn', 'u1', 'deepseek-v4-flash', { tokens: 200 }),
    ]);

    const handler = getRouteHandler('/by-model', 'get');
    const res = createResponse();
    await handler(createRequest({ days: '7' }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.pricingStatus.missingPricingModels).toEqual(['deepseek-v4-flash']);
    // 同 model 两组 → 同一个桶：prompt 640+160 / completion 200+0…（组级 80/20 拆分）
    const item = body.data.items[0];
    expect(item.key).toBe('deepseek-v4-flash');
    expect(item.usd).toBeNull();
    expect(item.pricingKnown).toBe(false);
    expect(item.callsMissingPricing).toBe(2);
    expect(item.pricedCalls).toBe(0);
    expect(item.calls).toBe(2);
    expect(item.promptTokens).toBe(800); // floor(800*0.8)=640 + floor(200*0.8)=160
    expect(item.completionTokens).toBe(200); // (800-640) + (200-160)
  });
});
