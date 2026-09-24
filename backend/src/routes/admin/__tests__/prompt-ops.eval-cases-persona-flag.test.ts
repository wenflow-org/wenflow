/**
 * 回归：GET /eval-cases 的「人设引用失效」标记（personaMissing）。
 * 2026-09-24 管理端巡检：模拟用例引用的虚拟学习者被删除后，列表无任何标记，
 * 只有跑批时才会从 skipped 里发现用例被跳过。现在列表直接标出。
 * repo 层 mock：本用例只验证列表载荷的标记语义与既有字段不回归。
 */

export {};

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() },
}));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../services/admin/prompt-ops.repo', () => ({
  ...jest.requireActual('../../../services/admin/prompt-ops.repo'),
  listEvalCases: jest.fn(),
}));
jest.mock('../../../services/virtual-lab/virtual-learner-profile.repo', () => ({
  ...jest.requireActual('../../../services/virtual-lab/virtual-learner-profile.repo'),
  filterExistingProfileIds: jest.fn(),
}));

import router from '../prompt-ops';
import { listEvalCases } from '../../../services/admin/prompt-ops.repo';
import { filterExistingProfileIds } from '../../../services/virtual-lab/virtual-learner-profile.repo';

const listEvalCasesMock = listEvalCases as unknown as jest.Mock;
const filterExistingProfileIdsMock = filterExistingProfileIds as unknown as jest.Mock;

interface RouteLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }>;
  };
}

function getRouteHandler(path: string, method: 'get') {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((item) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

interface ListPayload {
  success: boolean;
  data: Array<{ id: string; personaMissing: boolean; messages: unknown; enabled: boolean }>;
}

const row = (id: string, expectations: Record<string, unknown>) => ({
  id,
  agentId: 'skill:goal-conversation',
  caseId: id,
  name: `用例 ${id}`,
  description: null,
  messagesJson: JSON.stringify([{ role: 'user', content: 'hi' }]),
  previousStateJson: null,
  expectationsJson: JSON.stringify(expectations),
  enabled: true,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-02T00:00:00Z'),
});

describe('GET /eval-cases：人设引用失效标记', () => {
  beforeEach(() => jest.clearAllMocks());

  it('模拟用例引用已删除的虚拟学习者 → personaMissing=true，其余用例为 false', async () => {
    listEvalCasesMock.mockResolvedValue([
      row('c-live', { mode: 'simulated', personaId: 'p-alive' }),
      row('c-ghost', { mode: 'simulated', personaId: 'p-deleted' }),
      row('c-scenario', { mode: 'simulated', scenario: '随便聊聊' }),
      row('c-manual', { mustContainText: ['x'] }),
    ]);
    // 只核验出现过的 personaId（批量一次查询）
    filterExistingProfileIdsMock.mockImplementation(async (ids: string[]) => {
      expect([...ids].sort()).toEqual(['p-alive', 'p-deleted']);
      return new Set(['p-alive']);
    });

    const handler = getRouteHandler('/eval-cases', 'get');
    const res = createResponse();
    await handler({ query: {} }, res);

    const payload = res.json.mock.calls[0][0] as ListPayload;
    expect(payload.success).toBe(true);
    expect(payload.data.map((c) => [c.id, c.personaMissing])).toEqual([
      ['c-live', false],
      ['c-ghost', true],
      ['c-scenario', false],
      ['c-manual', false],
    ]);
    // 既有字段不回归
    expect(payload.data[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(payload.data[0].enabled).toBe(true);
  });

  it('无模拟用例时不查库（personaIds 为空）', async () => {
    listEvalCasesMock.mockResolvedValue([row('c-manual', {})]);
    filterExistingProfileIdsMock.mockResolvedValue(new Set());

    const handler = getRouteHandler('/eval-cases', 'get');
    const res = createResponse();
    await handler({ query: {} }, res);

    expect(filterExistingProfileIdsMock).toHaveBeenCalledWith([]);
    expect((res.json.mock.calls[0][0] as ListPayload).data[0].personaMissing).toBe(false);
  });
});
