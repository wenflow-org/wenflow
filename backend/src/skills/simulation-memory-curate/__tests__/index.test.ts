/**
 * simulation-memory-curate（课后记忆提炼 skill）单元测试
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

describe('simulation-memory-curate', () => {
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
    it('收束轮自评高 + 自认完成 → 也不造 mastered（自评完成 ≠ 掌握，外部评审 P1.5）', () => {
      const fallback = buildMemoryCuratorFallback(baseInput);
      // 确定性 fallback 没有模型判读：宁可无新增记忆，绝不按自评硬造 confidence 0.7 的伪掌握
      expect(fallback.masteredConcepts).toEqual([]);
      expect(fallback.struggleConcepts).toEqual([]);
      expect(fallback.memoryDelta).not.toContain('掌握了');
      // P2-33：fallback 文案自带明确方向（不再是「按此校准」这类无方向 meta 句）
      expect(fallback.selfCalibration).toContain('高估');
      expect(fallback.selfCalibration).not.toContain('按此校准');
      expect(fallback.selfCalibrationBias).toBe('overestimate');
    });

    it('P2-33：fallback 文案可被确定性解析器判出方向；无 persona 字段不下判决', () => {
      const { parseSelfCalibrationVerdict } = require('../../../virtual-lab/learner-memory');
      const over = buildMemoryCuratorFallback({ ...baseInput, persona: { selfAssessmentAccuracy: 'overconfident' } });
      expect(parseSelfCalibrationVerdict(over.selfCalibration)).toBe('overconfident');
      const under = buildMemoryCuratorFallback({ ...baseInput, persona: { selfAssessmentAccuracy: 'underconfident' } });
      expect(parseSelfCalibrationVerdict(under.selfCalibration)).toBe('underconfident');
      const none = buildMemoryCuratorFallback({ ...baseInput, persona: {} });
      expect(parseSelfCalibrationVerdict(none.selfCalibration)).toBeNull();
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
    it('模型明确返回空 masteredConcepts → 原样采信，绝不回退自评伪掌握（外部评审 P1.5）', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [],
        struggleConcepts: [{ name: '调色', blocker: '白平衡搞不定', severity: 'high' }],
        selfCalibration: '我以为会了，其实调色还不行。',
        selfCalibrationBias: 'overestimate',
        memoryDelta: '这课没有真正掌握的新内容，调色还卡着。',
      }, baseInput);
      expect(normalized.masteredConcepts).toEqual([]);
      expect(normalized.struggleConcepts.map((s) => s.name)).toEqual(['调色']);
    });

    it('字段缺失/类型错才回退 fallback（此时 mastered 兜底为空）', () => {
      const normalized = normalizeMemoryCuratorOutput({
        selfCalibration: '',
        memoryDelta: '',
      }, baseInput);
      expect(normalized.masteredConcepts).toEqual([]);
      // struggle 回退保留自评卡点信息（低估方向无害）
      expect(normalized.struggleConcepts).toEqual([]);
    });

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
      // 模型漏给结构化 bias → 回落到画像先验（baseInput 的 selfAssessmentAccuracy=偏高估）
      expect(normalized.selfCalibrationBias).toBe('overestimate');

      const withBias = normalizeMemoryCuratorOutput({
        masteredConcepts: [{ name: '剪辑节奏' }],
        struggleConcepts: [],
        selfCalibration: '这课基本准',
        selfCalibrationBias: 'accurate',
        memoryDelta: '',
      }, baseInput);
      expect(withBias.selfCalibrationBias).toBe('accurate');
    });

    it('远迁移门：transferEvidence.kind=none 时掌握 confidence 压到 0.6', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [{ name: '剪辑节奏', evidence: '能跟着做', confidence: 0.9 }],
        struggleConcepts: [],
        transferEvidence: [{ concept: '剪辑节奏', kind: 'none', evidence: '只是复述了结论' }],
        selfCalibration: '较准',
        memoryDelta: '',
      }, baseInput);
      expect(normalized.masteredConcepts[0].confidence).toBe(0.6);
    });

    it('远迁移门：new_context/own_words 保留原 confidence', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [{ name: '剪辑节奏', evidence: '换了一个探店视频也能卡上点', confidence: 0.9 }],
        struggleConcepts: [],
        transferEvidence: [{ concept: '剪辑节奏', kind: 'new_context', evidence: '换场景仍能做对' }],
        selfCalibration: '较准',
        memoryDelta: '',
      }, baseInput);
      expect(normalized.masteredConcepts[0].confidence).toBe(0.9);
    });

    it('LLM 明确判空（合法空数组）→ 原样采信，不回退自评伪掌握（外部评审 P1.5 翻转旧判例）', () => {
      const normalized = normalizeMemoryCuratorOutput({
        masteredConcepts: [],
        struggleConcepts: [],
      }, baseInput);
      // 旧实现把空数组当缺失、回退成「自评完成→0.7 掌握」——那是在制造已掌握印象。
      // 完成 ≠ 掌握：模型明确判空就是「本课无新增掌握」的合法结论。
      expect(normalized.masteredConcepts).toEqual([]);
      expect(normalized.struggleConcepts).toEqual([]);
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
