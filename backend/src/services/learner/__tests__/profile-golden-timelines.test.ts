/**
 * Profile Golden Timelines（确定性层，2026-11-21）：
 * 用 4 份跨课 JSON 快照夹具**离线回放**画像层的确定性函数（零 LLM、毫秒级、进常规 CI），
 * 钉住「接线与契约形状」：
 *   1. cold-start           纯冷启动：不编造历史、评审/文案投影三数组全空、预测载荷无硬证据
 *   2. false-mastery        虚假掌握：上一节 lessonReport 契约缺口（met=false+missingKcs）必须进预测载荷
 *   3. sustained-overload   持续高负荷：paceMode=recover / fatigue=high 进预测载荷与评审摘要
 *   4. misconception-reversal 误解反转：失效的 pending 误解洞察在机会点结算为 miss（不再回注）
 *
 * LLM 契约层（真模型跑同一批夹具）见 profile-golden-timelines.llm.test.ts（env 门控，不进常规 CI）。
 */
import fs from 'node:fs';
import path from 'node:path';

const mockCallPrompt = jest.fn();
jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

const findUnique = jest.fn();
const upsert = jest.fn();
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_projections: { findUnique, upsert } },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { learnerProjectionService } from '../LearnerProjectionService';
import { insightCalibrationService } from '../insight-calibration.service';
import { readPreviousLessonReport } from '../../ai-teaching/teaching-context-recap';
import { lessonKnowledgeEnricher } from '../../../skills/profile-lesson-enrich/index';
import { learningPredictor } from '../../../skills/profile-learning-predict/index';

const fixturesDir = path.resolve(__dirname, 'fixtures', 'golden-timelines');
const loadFixture = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, `${id}.json`), 'utf8'));

/** 通过 mock callPrompt 捕获 skill spec（与各 skill 自身单测同一模式） */
async function capturePredictPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  mockCallPrompt.mockImplementationOnce(async (spec: any, p: any) => {
    captured = spec.buildUserPayload(p);
    return { success: true, output: spec.normalizeOutput({ stallRisk: 0.5 }, p), debug: { durationMs: 1 } };
  });
  await learningPredictor(payload as any);
  return captured;
}

async function captureEnrichNormalize(modelOutput: unknown, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  mockCallPrompt.mockImplementationOnce(async (spec: any, p: any) => {
    captured = spec.normalizeOutput(modelOutput, p);
    return { success: true, output: captured, debug: { durationMs: 1 } };
  });
  await lessonKnowledgeEnricher(payload as any);
  return captured;
}

describe('profile golden timelines（确定性层）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsert.mockResolvedValue({});
  });

  describe('夹具 1：cold-start（0 节课）', () => {
    const fixture = loadFixture('cold-start');

    it('无上一节 → 无契约缺口硬证据；预测载荷只有摘要兜底，无任何 evidence 键', async () => {
      expect(readPreviousLessonReport(fixture.previousSession)).toBeUndefined();
      const payload = await capturePredictPayload(fixture.predictionOpts);
      expect(Object.keys(payload)[0]).toBe('fatigueSignal');
      expect(payload.knowledgeStateSummary).toBe('无历史摘要');
      expect(payload.contractGaps).toBeUndefined();
      expect(payload.checkpointEvidence).toBeUndefined();
      expect(payload.retentionHints).toBeUndefined();
      expect(payload.paceMode).toBeUndefined();
    });

    it('评审投影：三数组全空、currentPath=null；文案投影：全局背景空且不携带 knowledgeStateSummary（信息隔离）', () => {
      const review = learnerProjectionService.toReviewProjection(fixture.learnerSnapshot as any);
      expect(review.knowledgeDigest.mastered).toEqual([]);
      expect(review.knowledgeDigest.fragile).toEqual([]);
      expect(review.knowledgeDigest.struggling).toEqual([]);
      expect(review.knowledgeDigest.currentPath).toBeNull();

      const guidance = learnerProjectionService.toGuidanceProjection(fixture.learnerSnapshot as any) as any;
      const bg = guidance.learnerSnapshot.knowledgeMemory.globalBackground;
      expect(bg.reusableFoundations).toEqual([]);
      expect(bg.blockedFoundations).toEqual([]);
      expect(bg.conceptLedger).toEqual([]);
      expect(bg).not.toHaveProperty('knowledgeStateSummary');
    });

    it('lesson-enrich 归一器：模型凭空造的概念不进台账（冷启动不编造历史）', async () => {
      const output = await captureEnrichNormalize(
        {
          conceptLedger: [{ label: '凭空概念：量子学习法', misconceptionRisk: 'high' }],
          reusableFoundations: ['从未展示过的能力'],
          blockedFoundations: [],
        },
        { knowledgeState: [], taskContext: { learningPathId: 'lp', taskId: 'tk' } },
      );
      expect(output.conceptLedger).toEqual([]);
    });
  });

  describe('夹具 2：false-mastery（met=false + missingKcs）', () => {
    const fixture = loadFixture('false-mastery');

    it('上一节契约缺口被折算成硬证据：met=false / missingKcs 2 条 / exitTicketPassed=false', () => {
      const gaps = readPreviousLessonReport(fixture.previousSession);
      expect(gaps).toBeDefined();
      expect(gaps!.met).toBe(false);
      expect(gaps!.missingKcs).toEqual(['kc_map_callback_independent', 'kc_map_for_equivalence']);
      expect(gaps!.exitTicketPassed).toBe(false);
    });

    it('契约缺口进预测载荷：位于 taskContext 之后的 evidence 键首，稳定前缀不被打乱', async () => {
      const payload = await capturePredictPayload({
        ...fixture.predictionOpts,
        contractGaps: readPreviousLessonReport(fixture.previousSession),
      });
      const keys = Object.keys(payload);
      expect(keys.slice(0, 3)).toEqual(['fatigueSignal', 'knowledgeStateSummary', 'taskContext']);
      expect(keys[3]).toBe('contractGaps');
      expect((payload.contractGaps as any).met).toBe(false);
      expect((payload.contractGaps as any).missingKcs).toHaveLength(2);
    });

    it('评审投影：缺口概念出现在 struggling；文案投影：不携带 knowledgeStateSummary', () => {
      const review = learnerProjectionService.toReviewProjection(fixture.learnerSnapshot as any);
      expect(review.knowledgeDigest.struggling).toContain('数组的 map 与 for 循环的区别');
      const guidance = learnerProjectionService.toGuidanceProjection(fixture.learnerSnapshot as any) as any;
      expect(guidance.learnerSnapshot.knowledgeMemory.globalBackground).not.toHaveProperty('knowledgeStateSummary');
    });

    it('claims 台账：风险预告型断言（expect=仍不稳）在概念仍 struggling 的机会点结算为 hit', async () => {
      findUnique.mockResolvedValue({
        payload: JSON.stringify({
          schemaVersion: 'learner-insight-records-v1', pathId: 'lp_golden_1',
          records: [{
            id: 'c1', claim: '学习者 map 回调仍无法独立写出',
            insightType: 'falsifiable_claim', conceptKeys: ['数组的 map 与 for 循环的区别'],
            predictedAt: '2026-11-20T10:00:00.000Z', outcome: 'pending', checkedAt: null,
            checkOn: 'next_lesson', expect: '仍不稳，需要再看一次等价改写',
          }],
        }),
      });
      const records = await insightCalibrationService.resolvePending('u1', 'lp_golden_1', {
        opportunityAt: '2026-11-21T10:00:00.000Z',
        struggling: ['数组的 map 与 for 循环的区别'],
        fragile: [],
      });
      expect(records[0].outcome).toBe('hit');
    });
  });

  describe('夹具 3：sustained-overload（连续两节受挫/疲劳）', () => {
    const fixture = loadFixture('sustained-overload');

    it('paceMode=recover 与 fatigue=high 都进预测载荷（恢复导向的确定性信号）', async () => {
      const payload = await capturePredictPayload({
        ...fixture.predictionOpts,
        paceMode: fixture.learnerSnapshot.learningControlState.paceMode,
      });
      expect(payload.paceMode).toBe('recover');
      expect(payload.fatigueSignal).toBe('high');
    });

    it('评审投影 learnerDigest：lf=9 / fatigue=high / pacing=recover（文案层的减负依据）', () => {
      const review = learnerProjectionService.toReviewProjection(fixture.learnerSnapshot as any);
      expect(review.learnerDigest.metrics.lf).toBe(9);
      expect(review.learnerDigest.fatigue).toBe('high');
      expect(review.learnerDigest.pacing).toBe('recover');
    });
  });

  describe('夹具 4：misconception-reversal（误解反转）', () => {
    const fixture = loadFixture('misconception-reversal');

    it('失效的 pending 误解洞察在机会点结算为 miss（风险预告语义 + 概念已稳）——miss 后不再回注', async () => {
      findUnique.mockResolvedValue({
        payload: JSON.stringify({
          schemaVersion: 'learner-insight-records-v1', pathId: 'lp_golden_3',
          records: [fixture.priorInsightsFixture.insightRecord],
        }),
      });
      const records = await insightCalibrationService.resolvePending('u1', 'lp_golden_3', fixture.stateReviewOpportunity);
      expect(records[0].outcome).toBe('miss');
      expect(records[0].checkedAt).toBeTruthy();
    });

    it('评审投影：该概念已进 mastered、struggling 清空；契约 met=true 且无缺口', () => {
      const review = learnerProjectionService.toReviewProjection(fixture.learnerSnapshot as any);
      expect(review.knowledgeDigest.mastered).toContain('深拷贝与浅拷贝的边界');
      expect(review.knowledgeDigest.struggling).toEqual([]);
      const gaps = readPreviousLessonReport(fixture.previousSession);
      expect(gaps!.met).toBe(true);
      expect(gaps!.missingKcs).toEqual([]);
      expect(gaps!.exitTicketPassed).toBe(true);
    });
  });
});
