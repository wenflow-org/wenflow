/**
 * 证据记录语义单源测试（ADMIN_DEEP_LEARNER_AUDIT P0 A1 修复）：
 * 后端 LearnerKnowledgeMemoryService.ts:194 score = evidence.confidence（置信度，越高越确信），
 * 点色必须由 signal（mastery/struggle/fatigue/incomplete）驱动——杜绝「越确信越红」的语义反转；
 * 置信度仅作 tooltip 与「证据不足」提示（< 0.5）。
 */
import { describe, expect, it } from 'vitest';
import {
  evidenceDotTone,
  evidenceLowConfidence,
  evidenceSignalZh,
  evidenceConfidenceText,
  evidenceTooltip,
  EVIDENCE_LOW_CONFIDENCE,
} from '../evidence';

describe('evidenceDotTone（信号驱动点色，live 下颜色与置信度语义一致）', () => {
  it('mastery → 绿：高置信（score=1）是好事不是风险', () => {
    expect(evidenceDotTone('mastery', 1)).toBe('ok');
    expect(evidenceDotTone('mastery', 0.3)).toBe('ok');
  });

  it('struggle → 红：事件语义优先于置信度（0.95 置信的挣扎仍是坏事件）', () => {
    expect(evidenceDotTone('struggle', 0.95)).toBe('bad');
    expect(evidenceDotTone('struggle', 0.4)).toBe('bad');
  });

  it('fatigue → 琥珀', () => {
    expect(evidenceDotTone('fatigue', 0.8)).toBe('warn');
  });

  it('incomplete → 灰（中性）', () => {
    expect(evidenceDotTone('incomplete', 0.9)).toBe('muted');
  });

  it('未知信号按置信度兜底：高置信绿、低置信琥珀、中性灰', () => {
    expect(evidenceDotTone('', 0.9)).toBe('ok');
    expect(evidenceDotTone('', 0.3)).toBe('warn');
    expect(evidenceDotTone('summary', 0.6)).toBe('muted');
  });
});

describe('evidenceLowConfidence（证据不足阈值）', () => {
  it('score < 0.5 判定证据不足，0.5 及以上不判定', () => {
    expect(EVIDENCE_LOW_CONFIDENCE).toBe(0.5);
    expect(evidenceLowConfidence(0.49)).toBe(true);
    expect(evidenceLowConfidence(0.5)).toBe(false);
    expect(evidenceLowConfidence(1)).toBe(false);
  });
});

describe('evidenceSignalZh / evidenceConfidenceText / evidenceTooltip', () => {
  it('信号中文映射', () => {
    expect(evidenceSignalZh('mastery')).toBe('掌握');
    expect(evidenceSignalZh('struggle')).toBe('挣扎');
    expect(evidenceSignalZh('fatigue')).toBe('疲劳');
    expect(evidenceSignalZh('incomplete')).toBe('未完成');
    expect(evidenceSignalZh('unknown-signal')).toBe('');
  });

  it('置信度文案为百分比', () => {
    expect(evidenceConfidenceText(0.92)).toBe('置信 92%');
  });

  it('tooltip 含信号中文与置信度；低置信追加「证据不足」', () => {
    expect(evidenceTooltip('mastery', 0.92)).toBe('信号：掌握 · 置信 92%');
    expect(evidenceTooltip('mastery', 0.3)).toContain('置信 30%');
    expect(evidenceTooltip('mastery', 0.3)).toContain('证据不足');
  });
});
