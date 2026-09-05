/**
 * virtual-learner-memory-curator（课后记忆提炼 skill）单元测试
 *
 * 覆盖：
 * - buildMemoryCuratorFallback：LLM 不可用时确定性提炼（自评高→掌握 / 低→卡点）
 * - normalizeMemoryCuratorOutput：LLM 输出归一化 + 空结果回退 fallback
 * - aggregateSelfState：从回合序列取收束轮自述
 */
import {
  buildMemoryCuratorFallback,
  normalizeMemoryCuratorOutput,
  type MemoryCuratorInput,
} from '../index';

describe('virtual-learner-memory-curator', () => {
  const baseInput: MemoryCuratorInput = {
    persona: {
      selfAssessmentAccuracy: '偏高估',
      learningStyle: 'doing',
    },
    currentTask: {
      title: '剪辑节奏练习',
      linkedConcept: '剪辑节奏',
      acceptanceCriteria: '能独立剪出 30 秒卡点',
    },
    turnSequence: [
      {
        turn: 1,
        reply: '我先按教程试了一下，感觉节奏还行。',
        learnerState: { phaseFocus: 'trying', conceptualMastery: 0.4, wantsHint: false },
        learnerFeedback: { selfReportedTaskDone: false, confidence: 0.4 },
      },
      {
        turn: 2,
        reply: '好像会了，我自己剪了一段，节奏能对上。',
        learnerState: { phaseFocus: 'ready_to_close', conceptualMastery: 0.85, wantsHint: false },
        learnerFeedback: { selfReportedTaskDone: true, confidence: 0.88, wantsMoreHelp: false, remainingBlockers: [] },
      },
    ],
    existingKnown: [],
    existingStruggle: [],
  };

  describe('buildMemoryCuratorFallback（确定性兜底）', () => {
    it('收束轮自评高 + 自认完成 → mastered', () => {
      const fallback = buildMemoryCuratorFallback(baseInput);
      expect(fallback.masteredConcepts.map((m) => m.name)).toEqual(['剪辑节奏']);
      expect(fallback.struggleConcepts).toEqual([]);
      expect(fallback.memoryDelta).toContain('剪辑节奏');
      expect(fallback.selfCalibration).toContain('偏高估');
    });

    it('收束轮自评低 / 有卡点 → struggle', () => {
      const input: MemoryCuratorInput = {
        ...baseInput,
        turnSequence: [
          {
            turn: 1,
            reply: '还是不太会，曲线工具怎么用都卡住。',
            learnerState: { phaseFocus: 'blocked', conceptualMastery: 0.3, wantsHint: true },
            learnerFeedback: { selfReportedTaskDone: false, confidence: 0.3, wantsMoreHelp: true, remainingBlockers: ['曲线工具'] },
          },
        ],
      };
      const fallback = buildMemoryCuratorFallback(input);
      expect(fallback.masteredConcepts).toEqual([]);
      expect(fallback.struggleConcepts.map((s) => s.name)).toEqual(['剪辑节奏']);
      expect(fallback.struggleConcepts[0].blocker).toContain('曲线工具');
    });

    it('无回合序列 → 空记忆', () => {
      const fallback = buildMemoryCuratorFallback({ ...baseInput, turnSequence: [] });
      expect(fallback.masteredConcepts).toEqual([]);
      expect(fallback.struggleConcepts).toEqual([]);
    });
  });

  describe('normalizeMemoryCuratorOutput（LLM 输出归一化）', () => {
    it('LLM 有效输出优先', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [{ name: '剪辑节奏', evidence: '我自己剪了一段能对上', confidence: 0.9 }],
        struggleConcepts: [{ name: '调色', blocker: '白平衡搞不定', severity: 'high' }],
        selfCalibration: '自评偏高，打八折',
        memoryDelta: '这课我掌握了剪辑节奏，但调色还不行。',
      }, baseInput);
      expect(normalized.masteredConcepts).toEqual([
        { name: '剪辑节奏', evidence: '我自己剪了一段能对上', confidence: 0.9 },
      ]);
      expect(normalized.struggleConcepts).toEqual([
        { name: '调色', blocker: '白平衡搞不定', severity: 'high' },
      ]);
      expect(normalized.selfCalibration).toBe('自评偏高，打八折');
    });

    it('LLM 空结果回退确定性 fallback（记忆不丢）', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [],
        struggleConcepts: [],
      }, baseInput);
      expect(normalized.masteredConcepts.map((m) => m.name)).toEqual(['剪辑节奏']);
    });

    it('LLM 输出缺字段回退', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [{ name: '剪辑节奏' }],
        struggleConcepts: [],
        selfCalibration: '',
        memoryDelta: '',
      }, baseInput);
      expect(normalized.masteredConcepts[0].confidence).toBe(0.6);
      expect(normalized.selfCalibration.length).toBeGreaterThan(0);
    });
  });
});
