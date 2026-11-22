/**
 * 延迟保持探针（2026-11-19）单测：
 * 窗口/散列、目标选择、到期判定、幂等排期、失败降级与答案键不下发。
 */
import {
  RETENTION_PROBE_FAILED_MASTERY,
  RETENTION_PROBE_MAX_HOURS,
  RETENTION_PROBE_MIN_HOURS,
  RetentionProbeService,
  isRetentionProbeDue,
  isRetentionProbeExpired,
  retentionProbeDelayHours,
  retentionProbeIdFor,
  selectRetentionProbeConcepts,
  toRetentionProbePublicView,
  type RetentionProbeDeps,
  type RetentionProbeRecord,
} from '../retention-probe.service';

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-11-19T08:00:00.000Z');

function makeDeps(overrides: Partial<RetentionProbeDeps> = {}) {
  const rows = new Map<string, { projectionKey: string; payload: string }>();
  const evidence: Array<{ passed: boolean; judgedBy: string; conceptKey: string }> = [];
  const failed: Array<{ conceptKey: string; mastery?: number }> = [];
  const passedReviews: string[] = [];
  const deps: RetentionProbeDeps = {
    findProjection: async (key, userId) => {
      const row = rows.get(key);
      if (!row) return null;
      const parsed = JSON.parse(row.payload) as RetentionProbeRecord;
      return parsed.userId === userId ? row : null;
    },
    listProjections: async (userId) => Array.from(rows.values())
      .filter((row) => (JSON.parse(row.payload) as RetentionProbeRecord).userId === userId),
    createProjection: async (row) => {
      rows.set(row.projectionKey, { projectionKey: row.projectionKey, payload: row.payload });
    },
    updateProjection: async (key, payload) => {
      rows.set(key, { projectionKey: key, payload });
    },
    loadLessonQuestions: async () => [],
    generateQuestion: async (input) => ({
      question: `${input.conceptName} 的新情境题？`,
      type: 'single_choice',
      conceptName: input.conceptName,
      options: [{ id: 'A', text: '对' }, { id: 'B', text: '错' }],
      correctOptionIds: ['A'],
    }),
    writeEvidence: async ({ probe, passed, judgedBy }) => {
      evidence.push({ passed, judgedBy, conceptKey: probe.conceptKey });
    },
    applyFailedProbe: async (probe) => {
      failed.push({ conceptKey: probe.conceptKey, mastery: RETENTION_PROBE_FAILED_MASTERY });
      return { totalItems: 1, appliedItems: 1, skippedDuplicateItems: 0, skippedNegativeInterval: 0 };
    },
    applyPassedProbe: async (probe) => {
      passedReviews.push(probe.conceptKey);
      return { totalItems: 1, appliedItems: 1, skippedDuplicateItems: 0, skippedNegativeInterval: 0 };
    },
    now: () => T0,
    ...overrides,
  };
  return { deps, rows, evidence, failed, passedReviews };
}

describe('retentionProbeDelayHours / window', () => {
  it('同 session+concept 确定性落在 24–72h（含 24，不含 72）', () => {
    for (const concept of ['识别隐含前提', '补写成立前提句', '定位证据页面']) {
      const hours = retentionProbeDelayHours('session-1', concept);
      expect(hours).toBeGreaterThanOrEqual(RETENTION_PROBE_MIN_HOURS);
      expect(hours).toBeLessThan(RETENTION_PROBE_MAX_HOURS);
      expect(retentionProbeDelayHours('session-1', concept)).toBe(hours);
    }
    // 同一概念换会话应散到不同时刻（避免全部同一时间到期）
    const spread = new Set(['s1', 's2', 's3', 's4', 's5'].map((s) => retentionProbeDelayHours(s, '同一个概念')));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('探针 id 稳定且与概念归一化无关', () => {
    expect(retentionProbeIdFor('s1', ' 概念A ')).toBe(retentionProbeIdFor('s1', '概念A。'));
    expect(retentionProbeIdFor('s1', '概念A')).not.toBe(retentionProbeIdFor('s2', '概念A'));
  });

  it('到期窗口：scheduledAt ≤ now ≤ windowEndsAt；超过 72h 判过期', () => {
    const base = {
      status: 'pending' as const,
      scheduledAt: new Date(T0.getTime() + 24 * HOUR).toISOString(),
      windowEndsAt: new Date(T0.getTime() + 72 * HOUR).toISOString(),
    };
    expect(isRetentionProbeDue(base, new Date(T0.getTime() + 23 * HOUR))).toBe(false);
    expect(isRetentionProbeDue(base, new Date(T0.getTime() + 24 * HOUR))).toBe(true);
    expect(isRetentionProbeDue(base, new Date(T0.getTime() + 72 * HOUR))).toBe(true);
    expect(isRetentionProbeExpired(base, new Date(T0.getTime() + 72 * HOUR + 1))).toBe(true);
    expect(isRetentionProbeDue({ ...base, status: 'passed' }, new Date(T0.getTime() + 30 * HOUR))).toBe(false);
  });
});

describe('selectRetentionProbeConcepts', () => {
  it('优先独立证据 KC，再 mastered，再高进度 learning；去重、跳过占位、上限 3', () => {
    const picked = selectRetentionProbeConcepts({
      lessonReport: { independentKcs: ['识别隐含前提', '补写成立前提句'] } as any,
      knowledgeState: [
        { name: '识别隐含前提', status: 'mastered', progress: 100 },
        { name: '已掌握点', status: 'mastered', progress: 100 },
        { name: '高进度点', status: 'learning', progress: 70 },
        { name: '低进度点', status: 'learning', progress: 30 },
        { name: 'concept-12', status: 'mastered', progress: 100 },
      ],
    });
    expect(picked).toEqual(['识别隐含前提', '补写成立前提句', '已掌握点']);
  });

  it('无契约/看板证据 → 空数组', () => {
    expect(selectRetentionProbeConcepts({})).toEqual([]);
  });
});

describe('RetentionProbeService.scheduleForSession', () => {
  it('按契约核心 KC 排 24–72h 探针，重复调用幂等', async () => {
    const { deps, rows } = makeDeps();
    const service = new RetentionProbeService(deps);
    const input = {
      userId: 'u1',
      sessionId: 's1',
      pathId: 'p1',
      taskId: 't1',
      subject: '法律',
      topic: '违约金',
      taskTitle: '拆解条款',
      lessonReport: { independentKcs: ['识别隐含前提', '补写成立前提句'] } as any,
      knowledgeState: [{ name: '已掌握点', status: 'mastered', progress: 100 }],
      lessonAt: T0,
    };
    const first = await service.scheduleForSession(input);
    expect(first.scheduled).toBe(3);
    expect(rows.size).toBe(3);
    const probes = Array.from(rows.values()).map((row) => JSON.parse(row.payload) as RetentionProbeRecord);
    for (const probe of probes) {
      const scheduledAt = new Date(probe.scheduledAt).getTime();
      expect(scheduledAt).toBeGreaterThanOrEqual(T0.getTime() + 24 * HOUR);
      expect(scheduledAt).toBeLessThan(T0.getTime() + 72 * HOUR);
      expect(probe.windowEndsAt).toBe(new Date(T0.getTime() + 72 * HOUR).toISOString());
      expect(probe.status).toBe('pending');
    }
    const second = await service.scheduleForSession(input);
    expect(second).toEqual({ scheduled: 0, skipped: 3 });
  });
});

describe('RetentionProbeService.answer', () => {
  async function dueProbe(overrides: Partial<RetentionProbeDeps> = {}, expectedViews = 1) {
    const { deps, rows, evidence, failed, passedReviews } = makeDeps(overrides);
    const service = new RetentionProbeService(deps);
    await service.scheduleForSession({
      userId: 'u1',
      sessionId: 's1',
      pathId: 'p1',
      taskId: 't1',
      lessonReport: { independentKcs: ['识别隐含前提'] } as any,
      lessonAt: T0,
    });
    const row = Array.from(rows.values())[0];
    const probe = JSON.parse(row.payload) as RetentionProbeRecord;
    const dueAt = new Date(probe.scheduledAt);
    const views = await service.listDue('u1', { now: dueAt, limit: 1 });
    expect(views).toHaveLength(expectedViews);
    // 公开视图不含答案键
    expect(JSON.stringify(views)).not.toContain('correctOptionIds');
    expect(JSON.stringify(views)).not.toContain('expectedKeywords');
    return { service, rows, row, probe, dueAt, evidence, failed, passedReviews };
  }

  it('把原题面传给出题方，拒绝重复题，不写判分证据', async () => {
    const loadLessonQuestions = jest.fn().mockResolvedValue(['请识别这个前提？']);
    const generateQuestion = jest.fn().mockResolvedValue({
      question: '请识别这个前提。', type: 'short_answer', conceptName: '识别隐含前提', expectedKeywords: ['条件'],
    });
    const { service, probe, dueAt, evidence, failed } = await dueProbe({ loadLessonQuestions, generateQuestion }, 0);
    expect(loadLessonQuestions).toHaveBeenCalledWith('s1', 'u1');
    expect(generateQuestion).toHaveBeenCalledWith(expect.objectContaining({ priorQuestions: ['请识别这个前提？'] }));
    await expect(service.answer('u1', probe.id, '条件', { now: dueAt })).rejects.toThrow('RETENTION_PROBE_QUESTION_NOT_READY');
    expect(evidence).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('无法核对原题时不出题，也不对学员扣分', async () => {
    const generateQuestion = jest.fn();
    const { service, probe, dueAt, evidence, failed } = await dueProbe({
      loadLessonQuestions: async () => null, generateQuestion,
    }, 0);
    await expect(service.answer('u1', probe.id, 'A', { now: dueAt })).rejects.toThrow('RETENTION_PROBE_QUESTION_NOT_READY');
    expect(generateQuestion).not.toHaveBeenCalled();
    expect(evidence).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('存量坏题不会参与计分，也不会在提交时被替换', async () => {
    const { service, rows, row, probe, dueAt, evidence, failed } = await dueProbe();
    const stored = JSON.parse(rows.get(row.projectionKey)!.payload) as RetentionProbeRecord;
    stored.question!.correctOptionIds = ['A', 'B'];
    rows.set(row.projectionKey, { ...row, payload: JSON.stringify(stored) });
    await expect(service.answer('u1', probe.id, 'A', { now: dueAt })).rejects.toThrow('RETENTION_PROBE_QUESTION_NOT_READY');
    expect(evidence).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('答错 → failed、写 retention:probe:result 证据并触发 canonical 降级', async () => {
    const { service, probe, dueAt, evidence, failed } = await dueProbe();
    const result = await service.answer('u1', probe.id, 'B', { now: dueAt });
    expect(result.passed).toBe(false);
    expect(result.judgedBy).toBe('code');
    expect(result.downgraded).toBe(true);
    expect(evidence).toEqual([{ passed: false, judgedBy: 'code', conceptKey: probe.conceptKey }]);
    expect(failed).toHaveLength(1);
    expect(failed[0].conceptKey).toBe(probe.conceptKey);
  });

  it('答对 → passed、不降级', async () => {
    const { service, probe, dueAt, evidence, failed, passedReviews } = await dueProbe();
    const result = await service.answer('u1', probe.id, 'A', { now: dueAt });
    expect(result.passed).toBe(true);
    expect(result.downgraded).toBe(false);
    expect(evidence).toEqual([{ passed: true, judgedBy: 'code', conceptKey: probe.conceptKey }]);
    expect(failed).toEqual([]);
    // 通过也要推进 FSRS（否则 dueAt 不动，探针会无限重复到期）
    expect(passedReviews).toEqual([probe.conceptKey]);
  });

  it('降级事件被去重吞掉（appliedItems=0）→ downgraded=false，不假报已降级（外部评审 P1.1）', async () => {
    const { service, probe, dueAt } = await dueProbe({
      applyFailedProbe: async () => ({ totalItems: 1, appliedItems: 0, skippedDuplicateItems: 1, skippedNegativeInterval: 0 }),
    });
    const result = await service.answer('u1', probe.id, 'B', { now: dueAt });
    expect(result.passed).toBe(false);
    expect(result.downgraded).toBe(false);
  });

  it('答对但 FSRS 推进被去重（appliedItems=0）不炸：仍返回 passed，只是留痕', async () => {
    const { service, probe, dueAt, evidence } = await dueProbe({
      applyPassedProbe: async () => ({ totalItems: 1, appliedItems: 0, skippedDuplicateItems: 1, skippedNegativeInterval: 0 }),
    });
    const result = await service.answer('u1', probe.id, 'A', { now: dueAt });
    expect(result.passed).toBe(true);
    expect(result.downgraded).toBe(false);
    expect(evidence).toHaveLength(1);
  });

  it('同一探针重复作答 → NOT_PENDING（不重复写证据/降级）', async () => {
    const { service, probe, dueAt, evidence } = await dueProbe();
    await service.answer('u1', probe.id, 'B', { now: dueAt });
    await expect(service.answer('u1', probe.id, 'B', { now: dueAt })).rejects.toThrow('RETENTION_PROBE_NOT_PENDING');
    expect(evidence).toHaveLength(1);
  });

  it('未到 scheduledAt → NOT_DUE（不能提前作答）', async () => {
    const { service, probe, dueAt, evidence } = await dueProbe();
    const tooEarly = new Date(new Date(probe.scheduledAt).getTime() - 60 * 1000);
    await expect(service.answer('u1', probe.id, 'B', { now: tooEarly })).rejects.toThrow('RETENTION_PROBE_NOT_DUE');
    expect(evidence).toEqual([]);
    // 到期后同一条仍可作答
    await expect(service.answer('u1', probe.id, 'B', { now: dueAt })).resolves.toEqual(expect.objectContaining({ passed: false }));
  });

  it('超过 72h → EXPIRED，不判失败', async () => {
    const { service, probe, dueAt, evidence, failed } = await dueProbe();
    const afterWindow = new Date(dueAt.getTime() + 72 * HOUR);
    await expect(service.answer('u1', probe.id, 'B', { now: afterWindow })).rejects.toThrow('RETENTION_PROBE_EXPIRED');
    expect(evidence).toEqual([]);
    expect(failed).toEqual([]);
  });
});

describe('toRetentionProbePublicView', () => {
  it('选择题只带 id/text，不带答案键；简答不带 expectedKeywords', () => {
    const base: RetentionProbeRecord = {
      id: 'rp_1',
      userId: 'u1',
      conceptKey: 'kc',
      label: '概念',
      sessionId: 's1',
      lessonAt: T0.toISOString(),
      scheduledAt: T0.toISOString(),
      windowEndsAt: T0.toISOString(),
      status: 'pending',
      attempts: 0,
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
      question: {
        question: '题',
        type: 'single_choice',
        conceptName: '概念',
        options: [{ id: 'A', text: '对' }, { id: 'B', text: '错' }],
        correctOptionIds: ['A'],
      },
    };
    const view = toRetentionProbePublicView(base);
    expect(view.question.options).toEqual([{ id: 'A', text: '对' }, { id: 'B', text: '错' }]);
    expect(JSON.stringify(view)).not.toContain('correctOptionIds');
  });
});
