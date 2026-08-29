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
    });
  });
});
