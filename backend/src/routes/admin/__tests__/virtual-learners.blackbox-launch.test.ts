const mockCreateSession = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockFindSession = jest.fn();

// Keep this launch contract suite entirely offline, including route registration dependencies.
jest.mock('../../../virtual-lab/session-factory', () => ({
  createSessionForProfile: (...args: unknown[]) => mockCreateSession(...args),
  SIMULATION_FRICTION_BUDGETS: ['none', 'low', 'normal', 'high', 'stress_test'],
  parseJson: (value: string, fallback: unknown) => value ? JSON.parse(value) : fallback,
}));
jest.mock('../../../virtual-lab/autopilot.service', () => ({
  autopilotService: {
    start: (...args: unknown[]) => mockStart(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  },
  AutopilotService: { readState: jest.fn() },
}));
jest.mock('../../../virtual-lab/blackbox-runner', () => ({ __esModule: true, default: {} }));
jest.mock('../../../virtual-lab/session-reclaim.service', () => ({ virtualSessionReclaimService: {} }));
jest.mock('../../../services/virtual-lab/virtual-session.repo', () => ({
  findSessionById: (...args: unknown[]) => mockFindSession(...args),
  findSessionsForTerminate: jest.fn(),
}));
jest.mock('../virtual-learners.assisted-shared', () => ({}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

import express from 'express';
import { registerAssistedBlackboxRoutes } from '../virtual-learners.assisted-blackbox';

const router = express.Router();
registerAssistedBlackboxRoutes(router);
function post(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
async function launch(body?: Record<string, unknown>) {
  const res = response();
  await post('/:id/start-blackbox-session')({ params: { id: 'p1' }, user: { userId: 'admin1' }, body }, res);
  return res;
}
const session = { id: 's1', status: 'created', currentStage: 'goal', experiment: { mode: 'blackbox-api' } };

beforeEach(() => {
  jest.resetAllMocks();
  mockCreateSession.mockResolvedValue(session);
  mockStart.mockResolvedValue({ runId: 'run1', mode: 'blackbox', target: 'final' });
  mockFindSession.mockResolvedValue(session);
  mockStop.mockResolvedValue({ accepted: true });
});

describe('blackbox launch 自动驾驶契约', () => {
  it.each([undefined, {}, { autopilot: 'off' }])('缺省或 off 只创建，保留脚本手动推进约定：%p', async (body) => {
    const res = await launch(body);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...session, autopilot: 'off' } });
  });

  it('final 创建后启动，透传故事、对抗度与操作者，返回明确的 started 回执', async () => {
    const res = await launch({ storyId: 'story1', storyIndex: 0, frictionBudget: 'high', autopilot: 'final' });
    expect(mockCreateSession).toHaveBeenCalledWith('p1', {
      storyId: 'story1', storyIndex: 0, frictionBudget: 'high', blackboxOperatorId: 'admin1',
    });
    expect(mockStart).toHaveBeenCalledWith('s1', { target: 'final' });
    expect(mockCreateSession.mock.invocationCallOrder[0]).toBeLessThan(mockStart.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...session, autopilot: 'started' } });
  });

  it('并发满返回 queued，不误报 started', async () => {
    mockStart.mockResolvedValue({ queued: true, position: 1 });
    const res = await launch({ autopilot: 'final' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...session, autopilot: 'queued' } });
  });

  it('启动失败保留已创建的会话和 failed 回执，避免重建会话', async () => {
    mockStart.mockRejectedValue(new Error('启动失败'));
    const res = await launch({ autopilot: 'final' });
    expect(res.status).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...session, autopilot: 'failed' } });
  });

  it.each([null, true, false, 'stage', '', 'running', 1])('非法 autopilot 在创建前拒绝：%p', async (autopilot) => {
    const res = await launch({ autopilot });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('非法对抗度在创建前拒绝', async () => {
    const res = await launch({ frictionBudget: 'invalid', autopilot: 'final' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('画像不存在不启动', async () => {
    mockCreateSession.mockResolvedValue(null);
    const res = await launch({ autopilot: 'final' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('创建失败不启动，保留错误码', async () => {
    mockCreateSession.mockRejectedValue(Object.assign(new Error('故事不存在'), { status: 409, code: 'STORY_MISSING' }));
    const res = await launch({ autopilot: 'final' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: '故事不存在', code: 'STORY_MISSING' });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('旧脚本仍可创建后单独按 stage 启动，然后停止', async () => {
    await launch({});
    expect(mockStart).not.toHaveBeenCalled();
    const started = response();
    await post('/sessions/:sessionId/autopilot/start')({ params: { sessionId: 's1' }, body: { target: 'stage', maxTurns: 20 } }, started);
    expect(mockStart).toHaveBeenCalledWith('s1', { target: 'stage', maxTurns: 20 });
    const stopped = response();
    await post('/sessions/:sessionId/autopilot/stop')({ params: { sessionId: 's1' } }, stopped);
    expect(mockStop).toHaveBeenCalledWith('s1');
    expect(stopped.json).toHaveBeenCalledWith({ success: true, data: { accepted: true } });
  });
});
