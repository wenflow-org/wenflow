/**
 * 教师补充槽 materialId 回写与抢救合并（全量测试报告 #28）：
 * ① 后台采集回写只动 supplement 键、状态/代次不符即跳过；
 * ② 回合提交整包写 teachingState 时，把并发回写的 id 抢救合并进来，任何先后顺序都不丢。
 */
const mockTx = {
  teaching_sessions: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  teaching_session_messages: {
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    createMany: jest.fn(async () => ({ count: 0 })),
  },
  subtasks: { updateMany: jest.fn(async () => ({ count: 0 })) },
};
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $transaction: mockTransaction },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { teachingSessionRepository } from '../TeachingSessionRepository';

const REQUESTED_AT = '2026-10-03T21:20:56.772Z';

function slotState(slot: Record<string, unknown> | null) {
  return JSON.stringify({ sessionArtifacts: slot ? { supplement: slot } : {} });
}

/** findUnique 按 select 形状分流：合并抢救读 teachingState、消息播种读 messages */
function routeFindUnique(state: { teachingState?: string; messages?: unknown }) {
  mockTx.teaching_sessions.findUnique.mockImplementation(async (args: any) => {
    if (args?.select?.teachingState) return { teachingState: state.teachingState ?? null };
    if (args?.select?.messages) return { messages: state.messages ?? null };
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 1 });
  mockTx.teaching_sessions.update.mockResolvedValue({});
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
});

describe('patchSessionSupplementMaterial（后台采集回写）', () => {
  it('requested 且 requestedAt 对得上 → 只合并 materialId/sourceUrl', async () => {
    routeFindUnique({
      teachingState: slotState({
        status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT, requestedTurn: 40,
      }),
    });

    const written = await teachingSessionRepository.patchSessionSupplementMaterial(
      'sess1',
      { requestedAt: REQUESTED_AT },
      { materialId: 'mat-72688a8f', sourceUrl: 'https://www.reddit.com/r/PLC/comments/11n2aqo' }
    );

    expect(written).toBe(true);
    const data = mockTx.teaching_sessions.update.mock.calls[0][0].data;
    const next = JSON.parse(String(data.teachingState));
    expect(next.sessionArtifacts.supplement).toMatchObject({
      status: 'requested',
      materialId: 'mat-72688a8f',
      sourceUrl: 'https://www.reddit.com/r/PLC/comments/11n2aqo',
      requestedAt: REQUESTED_AT,
    });
  });

  it('requestedAt 不符（另一笔请求）→ 跳过不写', async () => {
    routeFindUnique({
      teachingState: slotState({
        status: 'requested', topic: 'X', query: 'q', requestedAt: '2026-10-03T00:00:00.000Z',
      }),
    });

    const written = await teachingSessionRepository.patchSessionSupplementMaterial(
      'sess1',
      { requestedAt: REQUESTED_AT },
      { materialId: 'mat-late' }
    );

    expect(written).toBe(false);
    expect(mockTx.teaching_sessions.update).not.toHaveBeenCalled();
  });

  it('槽位已 delivered/expired → 跳过不写', async () => {
    routeFindUnique({
      teachingState: slotState({
        status: 'expired', topic: 'X', query: 'q', requestedAt: REQUESTED_AT,
      }),
    });

    const written = await teachingSessionRepository.patchSessionSupplementMaterial(
      'sess1',
      { requestedAt: REQUESTED_AT },
      { materialId: 'mat-late' }
    );

    expect(written).toBe(false);
    expect(mockTx.teaching_sessions.update).not.toHaveBeenCalled();
  });
});

describe('commitTurnState 抢救合并（回写 vs 整包提交竞态）', () => {
  const basePayload = (teachingState: unknown) => ({
    messages: [],
    messagesBaseCount: 0,
    knowledgeState: [],
    teachingState,
  });

  it('外发槽位缺 materialId、库中已有 → 合并进本次提交', async () => {
    routeFindUnique({
      teachingState: slotState({
        status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT,
        materialId: 'mat-fetched', sourceUrl: 'https://supplement.example.com/x',
      }),
    });

    await teachingSessionRepository.commitTurnState('sess1', 'op1', basePayload({
      sessionArtifacts: {
        supplement: { status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT, requestedTurn: 40 },
      },
    }) as never);

    const data = mockTx.teaching_sessions.updateMany.mock.calls[0][0].data;
    const next = JSON.parse(String(data.teachingState));
    expect(next.sessionArtifacts.supplement.materialId).toBe('mat-fetched');
    expect(next.sessionArtifacts.supplement.status).toBe('requested');
  });

  it('库中也没有 materialId → 原样提交（不注入空字段）', async () => {
    routeFindUnique({
      teachingState: slotState({ status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT }),
    });

    await teachingSessionRepository.commitTurnState('sess1', 'op1', basePayload({
      sessionArtifacts: {
        supplement: { status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT, requestedTurn: 40 },
      },
    }) as never);

    const data = mockTx.teaching_sessions.updateMany.mock.calls[0][0].data;
    const next = JSON.parse(String(data.teachingState));
    expect(next.sessionArtifacts.supplement.materialId).toBeUndefined();
  });

  it('外发槽位已有 materialId → 不多读库（等待窗口外零成本）', async () => {
    await teachingSessionRepository.commitTurnState('sess1', 'op1', basePayload({
      sessionArtifacts: {
        supplement: {
          status: 'requested', topic: 'TIA', query: 'q', requestedAt: REQUESTED_AT, materialId: 'mat-already',
        },
      },
    }) as never);

    // 不读 teachingState 做合并（其余 findUnique 来自消息侧表播种，与本合并无关）
    expect(
      mockTx.teaching_sessions.findUnique.mock.calls.some((call: any[]) => call[0]?.select?.teachingState)
    ).toBe(false);
  });
});
