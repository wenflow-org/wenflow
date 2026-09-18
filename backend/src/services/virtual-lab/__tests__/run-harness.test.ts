import {
  classifyAdvanceResponse,
  classifySessionStatus,
  createRunState,
  defaultLearnerName,
  isPathReady,
  nextBackoffMs,
  parseHarnessArgs,
  parseRunState,
} from '../run-harness';

describe('classifyAdvanceResponse（advance-day 处置分类）', () => {
  it('网络中断/网关繁忙 → retryable', () => {
    expect(classifyAdvanceResponse({ httpStatus: 0 }).kind).toBe('retryable');
    expect(classifyAdvanceResponse({ httpStatus: 503, body: {} }).kind).toBe('retryable');
    expect(classifyAdvanceResponse({ httpStatus: 504, body: {} }).kind).toBe('retryable');
  });

  it('409 分两种语义：天数上限终止，租约忙可重试', () => {
    const capped = classifyAdvanceResponse({
      httpStatus: 409,
      body: { success: false, error: '已达模拟天数上限（30）或课表为空' },
    });
    expect(capped.kind).toBe('fatal');

    const busy = classifyAdvanceResponse({
      httpStatus: 409,
      body: { success: false, error: '会话正被其他操作占用' },
    });
    expect(busy.kind).toBe('retryable');
  });

  it('认证/参数错误 → fatal', () => {
    expect(classifyAdvanceResponse({ httpStatus: 401 }).kind).toBe('fatal');
    expect(classifyAdvanceResponse({ httpStatus: 400, body: { error: 'days 必须是 1..60 的数字' } }).kind).toBe('fatal');
  });

  it('路径未就绪（success=false 或 learning.started=false 或 reverted）→ day-not-started（不烧模拟日）', () => {
    expect(classifyAdvanceResponse({
      httpStatus: 200,
      body: { success: false, error: '学习路径尚未就绪（里程碑生成中），请稍后重试' },
    }).kind).toBe('day-not-started');

    expect(classifyAdvanceResponse({
      httpStatus: 200,
      body: { success: true, data: { reverted: true, simulatedDay: '2026-08-31' } },
    }).kind).toBe('day-not-started');

    expect(classifyAdvanceResponse({
      httpStatus: 200,
      body: { success: true, data: { simulatedDay: '2026-09-01', learning: { started: false, chunks: 0, error: '未就绪' } } },
    }).kind).toBe('day-not-started');
  });

  it('成功上课 → advanced，带模拟日与课次', () => {
    const outcome = classifyAdvanceResponse({
      httpStatus: 200,
      body: { success: true, data: { simulatedDay: '2026-09-02', learning: { started: true, chunks: 2 } } },
    });
    expect(outcome.kind).toBe('advanced');
    expect(outcome.simulatedDay).toBe('2026-09-02');
    expect(outcome.lessons).toBe(2);
  });
});

describe('classifySessionStatus', () => {
  it('completed/failed 为终局，其余视为进行中', () => {
    expect(classifySessionStatus('completed')).toBe('completed');
    expect(classifySessionStatus('failed')).toBe('failed');
    expect(classifySessionStatus('running')).toBe('active');
    expect(classifySessionStatus('paused')).toBe('active');
    expect(classifySessionStatus(undefined)).toBe('active');
  });
});

describe('isPathReady（路径就绪代理判定）', () => {
  it('未生成/无当前子任务 → 未就绪', () => {
    expect(isPathReady(null)).toBe(false);
    expect(isPathReady({ learningPathId: null, status: 'generating', pathContext: null })).toBe(false);
    expect(isPathReady({ learningPathId: 'lp1', status: 'not_started', pathContext: { currentTaskTitle: 'x' } })).toBe(false);
    expect(isPathReady({ learningPathId: 'lp1', status: 'active', pathContext: { currentTaskTitle: null } })).toBe(false);
  });

  it('有路径 + 有当前子任务 → 就绪', () => {
    expect(isPathReady({ learningPathId: 'lp1', status: 'active', pathContext: { currentTaskTitle: '任务一' } })).toBe(true);
  });
});

describe('nextBackoffMs（指数退避）', () => {
  it('单调递增且封顶', () => {
    expect(nextBackoffMs(1)).toBe(5_000);
    expect(nextBackoffMs(2)).toBe(10_000);
    expect(nextBackoffMs(3)).toBe(20_000);
    expect(nextBackoffMs(10)).toBe(60_000);
    expect(nextBackoffMs(1_000)).toBe(60_000);
  });
});

describe('defaultLearnerName', () => {
  it('带时间戳，便于在管理台辨认与清理', () => {
    expect(defaultLearnerName(new Date('2026-09-18T12:34:56.789Z'))).toBe('[e2e] 跑数 20260918-123456');
  });
});

describe('parseHarnessArgs', () => {
  const env = { E2E_ADMIN_NAME: 'root', E2E_ADMIN_PASSWORD: 'secret', VIRTUAL_LAB_BASE_URL: 'http://127.0.0.1:4000/' };

  it('env 兜底 + 参数覆盖 + 去掉 baseUrl 尾部斜杠', () => {
    const args = parseHarnessArgs(['--name=张三', '--days=4', '--base-days-ago=30', '--state=/tmp/s.json'], env);
    expect(args.baseUrl).toBe('http://127.0.0.1:4000');
    expect(args.adminName).toBe('root');
    expect(args.adminPassword).toBe('secret');
    expect(args.learnerName).toBe('张三');
    expect(args.maxDays).toBe(4);
    expect(args.baseDaysAgo).toBe(30);
    expect(args.statePath).toBe('/tmp/s.json');
    expect(args.keep).toBe(false);
  });

  it('--keep 开关生效；--session 支持显式续跑', () => {
    const args = parseHarnessArgs(['--keep', '--session=vs123'], {});
    expect(args.keep).toBe(true);
    expect(args.resumeSessionId).toBe('vs123');
    expect(args.adminName).toBe('admin');
    expect(args.adminPassword).toBeNull();
  });

  it('凭据兜底：E2E_* 优先，其次 .env 的 INIT_ADMIN_*', () => {
    const initWith = parseHarnessArgs([], { INIT_ADMIN_NAME: 'root2', INIT_ADMIN_PASSWORD: 'p2' });
    expect(initWith.adminName).toBe('root2');
    expect(initWith.adminPassword).toBe('p2');

    const e2eWins = parseHarnessArgs([], {
      E2E_ADMIN_NAME: 'e2e', E2E_ADMIN_PASSWORD: 'pe', INIT_ADMIN_NAME: 'root2', INIT_ADMIN_PASSWORD: 'p2',
    });
    expect(e2eWins.adminName).toBe('e2e');
    expect(e2eWins.adminPassword).toBe('pe');
  });

  it('非法 days / 未知参数 / 命令行传密码 → 抛出', () => {
    expect(() => parseHarnessArgs(['--days=0'], {})).toThrow(/days/);
    expect(() => parseHarnessArgs(['--days=999'], {})).toThrow(/days/);
    expect(() => parseHarnessArgs(['--nope=1'], {})).toThrow(/未知参数/);
    expect(() => parseHarnessArgs(['--admin-password=x'], {})).toThrow(/E2E_ADMIN_PASSWORD/);
  });
});

describe('RunState（断点续跑状态）', () => {
  it('新建状态字段完整', () => {
    const state = createRunState({ runId: 'r1', learnerName: '张三' });
    expect(state.version).toBe(1);
    expect(state.round).toBe(0);
    expect(state.sessionId).toBeNull();
    expect(state.findings).toEqual([]);
  });

  it('parseRunState：结构不符/版本不符/无 sessionId → null（视为从头跑）', () => {
    expect(parseRunState(null)).toBeNull();
    expect(parseRunState({ version: 2, sessionId: 'vs1' })).toBeNull();
    expect(parseRunState({ version: 1 })).toBeNull();
  });

  it('parseRunState：合法状态保留进度与 findings，容忍脏字段', () => {
    const parsed = parseRunState({
      version: 1,
      runId: 'r1',
      learnerName: '张三',
      sessionId: 'vs1',
      round: 3,
      findings: [{ code: 'x', detail: 'y' }, { bad: true }, 'nope'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe('vs1');
    expect(parsed!.round).toBe(3);
    expect(parsed!.findings).toEqual([{ code: 'x', detail: 'y' }]);
  });
});
