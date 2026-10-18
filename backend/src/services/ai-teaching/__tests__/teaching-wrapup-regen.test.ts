/**
 * wrapup 重生成（teaching-wrapup-regen，2026-10-11 补轮）契约测试：
 * - 仅完结 + wrapup 退化（summary-only/fallback）可重生成；未退化/非完结 → 跳过并给原因；
 * - 技能产出 ext 缺失 → 显式报错，不写库；
 * - 成功路径：wrapup 列回写 model/model + regeneratedAt 留痕；评估可靠时补 learning_metrics
 *   （revision 守卫 + sourceKey deleteMany/create，与 completeWithEvent metric 块同语义）。
 */
const prismaMock = {
  teaching_sessions: { findUnique: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
  teaching_session_messages: { findMany: jest.fn(async () => []) },
  users: { findUnique: jest.fn(async () => ({ learningStateRevision: 7 })), updateMany: jest.fn(async () => ({ count: 1 })) },
  learning_metrics: { deleteMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async () => ({})) },
  admin_audit_logs: { create: jest.fn(async () => ({})) },
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
jest.mock('../../../config/database', () => ({ __esModule: true, default: prismaMock }));
jest.mock('../../../skills', () => ({
  __esModule: true,
  executeSkill: jest.fn(),
  sessionWrapupAgentDefinition: { name: 'session-wrapup', version: '1.0.0' },
}));
jest.mock('../../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../TeachingContextBuilder', () => ({
  __esModule: true,
  buildTeachingScenarioContext: jest.fn(async () => ({
    taskTitle: 't', taskDescription: 'd',
    pathContext: { pathTitle: 'p', pathSummary: 's' },
    learningState: null,
  })),
}));
jest.mock('../teaching-session-lifecycle', () => ({
  __esModule: true,
  loadRetrievabilityHints: jest.fn(async () => []),
}));
jest.mock('../../learning/learning-state.service', () => ({
  __esModule: true,
  learningStateService: {
    prepareSessionScoreCommit: jest.fn(async () => ({
      userId: 'u1',
      expectedRevision: 7,
      sourceKey: 'session-wrapup:sess-1',
      data: { sourceKey: 'session-wrapup:sess-1', userId: 'u1', lss: 6 },
      metrics: { lss: 6, ktl: 6, lf: 6, lsb: 0, timestamp: new Date().toISOString() },
    })),
  },
}));

import { regenerateWrapup } from '../teaching-wrapup-regen';
import { executeSkill } from '../../../skills';
import { teachingSessionRepository } from '../TeachingSessionRepository';

const degradedWrapup = {
  status: 'summary-only',
  sources: { summary: 'fallback', evaluation: 'unavailable' },
  summary: { topicSummary: '占位', knowledgeItems: [] },
  duration: 3,
};

function mockSession(over: Record<string, unknown> = {}) {
  jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue({
    id: 'sess-1', userId: 'u1', taskId: 'task-1', learningPathId: 'lp-1',
    subject: '数学', topic: '一次函数', taskType: 'practice',
    status: 'completed', startTime: new Date('2026-10-11T03:00:00Z'), endTime: new Date('2026-10-11T03:03:00Z'),
    createdAt: new Date('2026-10-11T03:00:00Z'),
    messages: [
      { role: 'assistant', content: '你好', timestamp: new Date() },
      { role: 'user', content: '好的', timestamp: new Date() },
    ],
    knowledgeState: [{ name: 'k1', status: 'mastered', progress: 100 }],
    teachingState: {}, wrapup: degradedWrapup, duration: 3, revision: 9,
    ...over,
  } as never);
}

const skillOutput = (over: Record<string, unknown> = {}) => ({
  runtimeEnvelope: { businessState: { phase: 'wrapup-generated' } },
  internal: {
    ext: {
      sessionWrapup: {
        result: {
          summarySource: 'model',
          evaluationSource: 'model',
          evaluation: { sessionLss: 6, sessionKtl: 6, sessionLf: 6, confidence: 0.8, reasoning: 'r' },
          ...over,
        },
        artifact: { status: 'complete', sources: { summary: 'model', evaluation: 'model' }, summary: { topicSummary: '真总结' } },
      },
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession();
});

describe('wrapup 重生成守卫', () => {
  it('非完结会话 → 拒绝', async () => {
    mockSession({ status: 'active' });
    const r = await regenerateWrapup('sess-1');
    expect(r.regenerated).toBe(false);
    expect(r.error).toContain('仅完结会话');
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it('wrapup 未退化（complete）→ 跳过', async () => {
    mockSession({ wrapup: { status: 'complete', sources: { summary: 'model', evaluation: 'model' } } });
    const r = await regenerateWrapup('sess-1');
    expect(r.skipped).toContain('未退化');
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it('技能未产出 ext → 报错且不写库', async () => {
    (executeSkill as unknown as jest.Mock).mockResolvedValue({ internal: {} });
    const r = await regenerateWrapup('sess-1');
    expect(r.regenerated).toBe(false);
    expect(r.error).toContain('ext');
    expect(prismaMock.teaching_sessions.updateMany).not.toHaveBeenCalled();
  });
});

describe('wrapup 重生成成功路径', () => {
  it('回写 model/model + regeneratedAt 留痕；评估可靠时补 learning_metrics', async () => {
    (executeSkill as unknown as jest.Mock).mockResolvedValue(skillOutput());
    const r = await regenerateWrapup('sess-1', { adminId: 'admin-1' });
    expect(r.regenerated).toBe(true);
    expect(prismaMock.teaching_sessions.updateMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.teaching_sessions.updateMany.mock.calls[0][0] as { where: { id: string; status: string }; data: { wrapup: string } };
    expect(call.where).toEqual({ id: 'sess-1', status: 'completed' });
    const written = JSON.parse(call.data.wrapup);
    expect(written.summarySource).toBe('model');
    expect(written.evaluationSource).toBe('model');
    expect(written.regeneratedAt).toBeTruthy();
    expect(written.stateUpdate.lss).toBe(6);
    // metric 块：revision 守卫 + sourceKey 清旧写新
    expect(prismaMock.users.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', learningStateRevision: 7 },
      data: { learningStateRevision: { increment: 1 } },
    });
    expect(prismaMock.learning_metrics.deleteMany).toHaveBeenCalledWith({ where: { sourceKey: 'session-wrapup:sess-1' } });
    expect(prismaMock.learning_metrics.create).toHaveBeenCalled();
    // 审计留痕
    expect(prismaMock.admin_audit_logs.create).toHaveBeenCalled();
  });

  it('指标竞争失败不阻塞 wrapup 回写（stateUpdate 保留旧值）', async () => {
    (executeSkill as unknown as jest.Mock).mockResolvedValue(skillOutput());
    prismaMock.users.updateMany.mockResolvedValueOnce({ count: 0 }); // revision 竞争
    const r = await regenerateWrapup('sess-1');
    expect(r.regenerated).toBe(true);
    const call = prismaMock.teaching_sessions.updateMany.mock.calls[0][0] as { data: { wrapup: string } };
    const written = JSON.parse(call.data.wrapup);
    expect(written.stateUpdate).toBeNull(); // 旧 degraded 无 stateUpdate → null
    expect(prismaMock.learning_metrics.create).not.toHaveBeenCalled();
  });
});
