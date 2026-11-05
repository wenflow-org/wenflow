const mockPrisma = {
  prediction_records: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  teaching_sessions: {
    findFirst: jest.fn(),
  },
  learner_evidence: {
    // 默认无 checkpoint 留痕（clearAllMocks 只清调用不清实现，既有用例天然走空证据）
    findMany: jest.fn().mockResolvedValue([]),
  },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));

import { predictionCalibrationService } from '../PredictionCalibrationService';

describe('PredictionCalibrationService（校准闭环）', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('recordPrediction', () => {
    it('写入预测行（含 focusConcepts 序列化 + summaryEcho 截断）', async () => {
      mockPrisma.prediction_records.create.mockResolvedValue({});
      const id = await predictionCalibrationService.recordPrediction({
        userId: 'u1',
        taskId: 't1',
        prediction: {
          stallRisk: 0.7,
          predictedTone: 'struggle',
          suggestedDepth: 'deep',
          focusConcepts: ['合并聚合'],
          rationale: 'r',
        },
        summaryEcho: 'x'.repeat(600),
      });

      expect(id).toMatch(/^prd_/);
      const arg = mockPrisma.prediction_records.create.mock.calls[0][0];
      expect(arg.data.stallRisk).toBe(0.7);
      expect(arg.data.focusConcepts).toBe('["合并聚合"]');
      expect(arg.data.summaryEcho).toHaveLength(500);
    });
  });

  describe('resolveOutcome', () => {
    it('找到未回写记录 → 更新 outcome', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      const ok = await predictionCalibrationService.resolveOutcome('u1', 't1', 'struggled');
      expect(ok).toBe(true);
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith({
        where: { id: 'prd_1' },
        data: { outcome: 'struggled', outcomeAt: expect.any(Date) },
      });
    });

    it('无未回写记录 → false（幂等，不重复回写）', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue(null);
      const ok = await predictionCalibrationService.resolveOutcome('u1', 't1', 'smooth');
      expect(ok).toBe(false);
      expect(mockPrisma.prediction_records.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveFromTaskCompletion（挣扎信号判定）', () => {
    it('knowledgeState 含 review → struggled', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"review","progress":50}]',
        wrapup: null,
      });
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'struggled' }) })
      );
    });

    it('wrapup.evaluation.sessionLss >= 6 → struggled', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"mastered","progress":100}]',
        wrapup: '{"evaluation":{"sessionLss":7.2}}',
      });
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'struggled' }) })
      );
    });

    it('无挣扎信号 → smooth', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"mastered","progress":100}]',
        wrapup: '{"evaluation":{"sessionLss":2.1}}',
      });
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'smooth' }) })
      );
    });

    it('无会话 → smooth（完成本身即顺畅信号）', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue(null);
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'smooth' }) })
      );
    });

    it('两次 code 裁决 failed（checkpoint:result passed=false）→ struggled（F4：判据消费 code 负证据）', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      // R1 复刻：知识面 mastered + sessionLss 低档，旧判据会记 smooth，但 code 两次判错
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"mastered","progress":100}]',
        wrapup: '{"evaluation":{"sessionLss":2.1}}',
      });
      mockPrisma.learner_evidence.findMany.mockResolvedValue([
        {
          evidenceType: 'checkpoint:result',
          payload: '{"checkpointId":"cp1","passed":false,"judgedBy":"code","detail":"缺少要点：合并聚合"}',
        },
        {
          evidenceType: 'checkpoint:result',
          payload: '{"checkpointId":"cp2","passed":false,"judgedBy":"code","detail":"缺少要点：换元"}',
        },
      ]);
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.learner_evidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u1', taskId: 't1' }),
        })
      );
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'struggled' }) })
      );
    });

    it('checkpoint:attempt attempts_exhausted（重答到顶强消）→ struggled', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"mastered","progress":100}]',
        wrapup: '{"evaluation":{"sessionLss":2.1}}',
      });
      mockPrisma.learner_evidence.findMany.mockResolvedValue([
        {
          evidenceType: 'checkpoint:attempt',
          payload: '{"checkpointId":"cp1","outcome":"attempts_exhausted","attempts":3}',
        },
      ]);
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'struggled' }) })
      );
    });

    it('checkpoint 通过/跳过不判负（passed=true、attempt=skipped）→ smooth', async () => {
      mockPrisma.prediction_records.findFirst.mockResolvedValue({ id: 'prd_1' });
      mockPrisma.prediction_records.update.mockResolvedValue({});
      mockPrisma.teaching_sessions.findFirst.mockResolvedValue({
        knowledgeState: '[{"name":"A","status":"mastered","progress":100}]',
        wrapup: '{"evaluation":{"sessionLss":2.1}}',
      });
      mockPrisma.learner_evidence.findMany.mockResolvedValue([
        {
          evidenceType: 'checkpoint:result',
          payload: '{"checkpointId":"cp1","passed":true,"judgedBy":"code"}',
        },
        {
          evidenceType: 'checkpoint:attempt',
          payload: '{"checkpointId":"cp2","outcome":"skipped"}',
        },
        {
          evidenceType: 'checkpoint:attempt',
          payload: '{"checkpointId":"cp3","outcome":"unresolved"}',
        },
      ]);
      await predictionCalibrationService.resolveFromTaskCompletion('u1', 't1');
      expect(mockPrisma.prediction_records.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'smooth' }) })
      );
    });
  });

  describe('empiricalStats（实证命中率）', () => {
    it('命中率与校准桶计算正确', async () => {
      mockPrisma.prediction_records.findMany.mockResolvedValue([
        // 命中：高风险 + 实际挣扎
        { stallRisk: 0.8, predictedTone: 'struggle', outcome: 'struggled' },
        // 命中：低风险 + 实际顺畅
        { stallRisk: 0.1, predictedTone: 'smooth', outcome: 'smooth' },
        // 未命中：低风险但实际挣扎
        { stallRisk: 0.2, predictedTone: 'smooth', outcome: 'struggled' },
        // 未命中：高风险但实际顺畅
        { stallRisk: 0.7, predictedTone: 'struggle', outcome: 'smooth' },
      ]);
      const stats = await predictionCalibrationService.empiricalStats('u1');
      expect(stats.total).toBe(4);
      expect(stats.stallHitRate).toBe(0.5);
      // tone：struggle→struggled ✓ / smooth→smooth ✓ / smooth→struggled ✗ / struggle→smooth ✗
      expect(stats.toneHitRate).toBe(0.5);
      // 校准桶：0-0.3 桶 n=2（0.1, 0.2）hard=1；0.3-0.6 桶 n=0；0.6-1.0 桶 n=2（0.7, 0.8）hard=1
      expect(stats.calibration[0]).toMatchObject({ n: 2, hard: 1, hardRate: 0.5 });
      expect(stats.calibration[1]).toMatchObject({ n: 0, hardRate: null });
      expect(stats.calibration[2]).toMatchObject({ n: 2, hard: 1, hardRate: 0.5 });
    });

    it('无已回写样本 → 全 null（不虚报）', async () => {
      mockPrisma.prediction_records.findMany.mockResolvedValue([]);
      const stats = await predictionCalibrationService.empiricalStats('u1');
      expect(stats.total).toBe(0);
      expect(stats.stallHitRate).toBeNull();
      expect(stats.toneHitRate).toBeNull();
      expect(stats.calibration).toEqual([]);
      // 新增条件校准字段在空样本时也不虚报：每组 total 0、比率 null
      expect(stats.byDepth).toHaveLength(3);
      expect(stats.byDepth.every((g: any) => g.total === 0 && g.stallHitRate === null)).toBe(true);
      expect(stats.depthKeySource).toBe('none');
    });
  });

  describe('empiricalStats（条件校准：按教学深度分组）', () => {
    /** 8 行样本：deep 组 6 行（够样本），standard 组 2 行（不足），shallow 组 0 行 */
    const rowsByDepth = [
      // --- deep 组（6 行）：stall 命中 4/6，tone 命中 4/6，hard 4/6 ---
      { stallRisk: 0.8, predictedTone: 'struggle', outcome: 'struggled', suggestedDepth: 'deep' },
      { stallRisk: 0.7, predictedTone: 'struggle', outcome: 'smooth', suggestedDepth: 'deep' },
      { stallRisk: 0.9, predictedTone: 'fatigue', outcome: 'failed', suggestedDepth: 'deep' },
      { stallRisk: 0.1, predictedTone: 'smooth', outcome: 'smooth', suggestedDepth: 'deep' },
      { stallRisk: 0.2, predictedTone: 'smooth', outcome: 'struggled', suggestedDepth: 'deep' },
      { stallRisk: 0.6, predictedTone: 'struggle', outcome: 'struggled', suggestedDepth: 'deep' },
      // --- standard 组（2 行）：样本不足，必须给 null ---
      { stallRisk: 0.5, predictedTone: 'smooth', outcome: 'smooth', suggestedDepth: 'standard' },
      { stallRisk: 0.4, predictedTone: 'struggle', outcome: 'struggled', suggestedDepth: 'standard' },
    ];

    it('按 depth 分组给出命中率与校准桶（全局字段不被破坏）', async () => {
      mockPrisma.prediction_records.findMany.mockResolvedValue(rowsByDepth);
      const stats = await predictionCalibrationService.empiricalStats('u1');

      // 全局口径与修复前完全一致：4/8 stall 命中（standard 两行都在 0.5 边界上判 miss）、6/8 tone 命中
      expect(stats.total).toBe(8);
      expect(stats.stallHitRate).toBe(0.5);
      expect(stats.toneHitRate).toBe(0.75);
      expect(stats.calibration[0]).toMatchObject({ range: '0-0.3', n: 2, hard: 1, hardRate: 0.5 });
      expect(stats.calibration[1]).toMatchObject({ range: '0.3-0.6', n: 2, hard: 1, hardRate: 0.5 });
      expect(stats.calibration[2]).toMatchObject({ range: '0.6-1.0', n: 4, hard: 3, hardRate: 0.75 });

      // 条件校准：deep 组
      const deep = stats.byDepth.find((g: any) => g.depth === 'deep');
      expect(deep).toMatchObject({
        depthSource: 'suggested',
        total: 6,
        insufficient: false,
        stallHitRate: 0.667,
        toneHitRate: 0.667,
        hardRate: 0.667,
      });
      // deep 组内桶：0-0.3 n=2 hard=1；0.3-0.6 空（0.6 归上桶）；0.6-1.0 n=4 hard=3
      expect(deep.calibration[0]).toMatchObject({ n: 2, hard: 1, hardRate: 0.5 });
      expect(deep.calibration[1]).toMatchObject({ n: 0, hardRate: null });
      expect(deep.calibration[2]).toMatchObject({ n: 4, hard: 3, hardRate: 0.75 });

      // 全局与分组互不干扰：deep 组占比不等于全局（条件校准的意义所在）
      expect(stats.byDepthMinSample).toBe(5);
      expect(stats.depthKeySource).toBe('suggested');
      expect(stats.unclassifiedDepthCount).toBe(0);
    });

    it('某组样本不足 → 该组比率与桶占比全 null，但 total 如实计数', async () => {
      mockPrisma.prediction_records.findMany.mockResolvedValue(rowsByDepth);
      const stats = await predictionCalibrationService.empiricalStats('u1');

      const standard = stats.byDepth.find((g: any) => g.depth === 'standard');
      expect(standard.total).toBe(2);
      expect(standard.insufficient).toBe(true);
      expect(standard.stallHitRate).toBeNull();
      expect(standard.toneHitRate).toBeNull();
      expect(standard.hardRate).toBeNull();
      // 桶内 n 如实计数（2 行都落在 0.3-0.6），但 hardRate 不给（防小样本虚报）
      expect(standard.calibration[1]).toMatchObject({ n: 2, hard: 1, hardRate: null });

      // 完全无样本的 shallow 组：total 0 + 全 null，组本身仍返回（前端可显示空态）
      const shallow = stats.byDepth.find((g: any) => g.depth === 'shallow');
      expect(shallow).toMatchObject({ total: 0, insufficient: true, depthSource: 'none' });
      expect(shallow.stallHitRate).toBeNull();
      expect(shallow.calibration.every((b: any) => b.hardRate === null)).toBe(true);
    });

    it('有 actualDepth 时以实际执行深度为主，缺失才回落 suggestedDepth', async () => {
      mockPrisma.prediction_records.findMany.mockResolvedValue([
        // 建议 shallow，实际按 deep 执行 → 应计入 deep 组并标记 actual
        { stallRisk: 0.8, predictedTone: 'struggle', outcome: 'struggled', suggestedDepth: 'shallow', actualDepth: 'deep' },
        // 无 actualDepth → 回落 suggestedDepth
        { stallRisk: 0.9, predictedTone: 'struggle', outcome: 'struggled', suggestedDepth: 'shallow' },
        // 深度非法/缺失 → 计入 unclassifiedDepthCount，不进任何组
        { stallRisk: 0.3, predictedTone: 'smooth', outcome: 'smooth', suggestedDepth: 'extreme' },
        { stallRisk: 0.3, predictedTone: 'smooth', outcome: 'smooth', suggestedDepth: null },
      ]);
      const stats = await predictionCalibrationService.empiricalStats('u1');

      expect(stats.total).toBe(4);
      const deep = stats.byDepth.find((g: any) => g.depth === 'deep');
      const shallow = stats.byDepth.find((g: any) => g.depth === 'shallow');
      expect(deep.total).toBe(1);
      expect(deep.depthSource).toBe('actual');
      expect(shallow.total).toBe(1);
      expect(shallow.depthSource).toBe('suggested');
      // 两组都样本不足 → 不给命中率
      expect(deep.stallHitRate).toBeNull();
      expect(shallow.stallHitRate).toBeNull();
      expect(stats.unclassifiedDepthCount).toBe(2);
      expect(stats.depthKeySource).toBe('mixed');
    });
  });
});
