import { describe, expect, it } from 'vitest'
import { isProposalConfirmText, normalizeFieldValue } from '../useGoalLive'

// boundary-test-2026-09-26 A4：模型偶发把未知字段原样写成 "unknown"，字段卡直接展示了英文原值
describe('useGoalLive 字段值归一化', () => {
  it('"unknown" 任意大小写归一为空（回退「待补充」）', () => {
    expect(normalizeFieldValue('unknown')).toBe('')
    expect(normalizeFieldValue('Unknown')).toBe('')
    expect(normalizeFieldValue('  UNKNOWN  ')).toBe('')
  })

  it('正常值原样保留', () => {
    expect(normalizeFieldValue('三个月（到秋天）')).toBe('三个月（到秋天）')
    expect(normalizeFieldValue('完全没用过 Excel 公式')).toBe('完全没用过 Excel 公式')
    // 合法中文「无」是有效语义（如背景经验为无），不归一
    expect(normalizeFieldValue('无')).toBe('无')
    expect(normalizeFieldValue('  去重空白  ')).toBe('去重空白')
  })

  it('空值安全', () => {
    expect(normalizeFieldValue('')).toBe('')
    expect(normalizeFieldValue(null)).toBe('')
    expect(normalizeFieldValue(undefined)).toBe('')
  })
})

describe('isProposalConfirmText（方案卡展示时键入确认短语 = 确认按钮同权）', () => {
  it('确认短语命中（原串或剥应答词后）', () => {
    expect(isProposalConfirmText('按这个来')).toBe(true);
    expect(isProposalConfirmText('按这个来吧')).toBe(true);
    expect(isProposalConfirmText('好的，按这个来')).toBe(true);
    expect(isProposalConfirmText('就按这个来')).toBe(true);
    expect(isProposalConfirmText('可以了')).toBe(true);
    expect(isProposalConfirmText('生成吧')).toBe(true);
    expect(isProposalConfirmText('确认并生成路径')).toBe(true);
    expect(isProposalConfirmText('没问题')).toBe(true);
    expect(isProposalConfirmText('就这么定')).toBe(true);
  });

  it('前后端口径对齐（2026-11-07 分叉修复）：领先确认词 + 方向族短语复合句前后端同义', () => {
    // 后端 CONFIRM_SEGMENT_PATTERNS 按逗号切段，「没问题」与「就按这个方向走」两段分别命中；
    // 前端此前因未在 PROPOSAL_CONFIRM_STRIP_HEAD 收「没问题」，整句落空 → false。现补齐。
    expect(isProposalConfirmText('没问题，就按这个方向走')).toBe(true);
    expect(isProposalConfirmText('好嘞，就按这个方向走')).toBe(true);
    expect(isProposalConfirmText('可以呀，按你说的办')).toBe(true);
    // 仍不得把带调整意图的复合句误判成确认
    expect(isProposalConfirmText('没问题，不过方向想再调一下')).toBe(false);
  });

  it('调整/疑问意图一律不确认，走普通回复', () => {
    expect(isProposalConfirmText('可以，但想先练怎么接话')).toBe(false);
    expect(isProposalConfirmText('按这个来，不过换成周日')).toBe(false);
    expect(isProposalConfirmText('按这个来的话是不是要买锅')).toBe(false);
    expect(isProposalConfirmText('想调整一下第二步')).toBe(false);
    expect(isProposalConfirmText('这个方案是怎么生成的？')).toBe(false);
  });

  it('无方案语境的普通长文本不误伤', () => {
    expect(isProposalConfirmText('我今天想先聊聊怎么开口')).toBe(false);
    expect(isProposalConfirmText('')).toBe(false);
  });
});
