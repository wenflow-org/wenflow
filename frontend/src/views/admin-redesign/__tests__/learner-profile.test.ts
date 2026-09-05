/**
 * 学习者域共享派生逻辑测试（ADMIN_DEEP_LEARNER_AUDIT P1 批）：
 * - isTestAccountUser 命名约定（与后端 utils/test-account.ts 同源）
 * - levelFromXp 等级公式（与后端 level.util.ts 一致）
 * - conceptLedger 概念条 tone/width 映射
 * - LearnerDetail tab 归一化（6 → 3 旧名重定向）
 */
import { describe, expect, it } from 'vitest';
import {
  isTestAccountUser,
  levelFromXp,
  levelLabel,
  conceptBarTone,
  conceptBarWidth,
  transferReadinessZh,
  misconceptionRiskZh,
  normalizeLearnerTab,
} from '../learner-profile';

describe('isTestAccountUser（测试/虚拟账号识别，与后端同源）', () => {
  it('虚拟学习者：id 以 virtual_ 开头或邮箱 @test.local / virtual_ 前缀', () => {
    expect(isTestAccountUser({ id: 'virtual_93e4c032', name: '某人', email: 'a@b.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'virtual_93e4c032@test.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'anything@test.local' })).toBe(true);
  });

  it('审计/测试账号：name/email 命中约定前缀（e2e_/audit_probe_/uxaudit_/ui_check/motion_review/qa_audit_）', () => {
    expect(isTestAccountUser({ id: 'u1', name: 'E2E_ms0fz3yx', email: 'e2e@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '财务助理小陈', email: 'audit_probe_01@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'motion_review', email: 'm@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'uxaudit_7', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'ui_check', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'qa_audit_0821', email: 'x@example.com' })).toBe(true);
  });

  it('dev.db 实测账号模式（与后端 TEST_ACCOUNT_PREFIXES 同步）：shotsnap/verify_real_user/vcheck/vqa_audit/align_/qa_delete_test_', () => {
    expect(isTestAccountUser({ id: 'u1', name: 'shotsnap547618', email: 'shotsnap547618@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'x', email: 'shotsnap206060@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'verify_real_user_0821', email: 'verify_real_user_0821@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'vchecksgxvef', email: 'vchecksgxvef@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'vqa_audit_user', email: 'vqa_audit_user@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'align_x0tlh', email: 'align_x0tlh@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'qa_delete_test_879', email: 'qa_delete_test_879@wenflow.local' })).toBe(true);
  });

  it('真实用户不误伤', () => {
    expect(isTestAccountUser({ id: 'u1', name: '陈晓', email: 'chenxiao@example.com' })).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: 'admin', email: 'admin@wenflow.local' })).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: 'review', email: 'motion@example.com' })).toBe(false);
    expect(isTestAccountUser({})).toBe(false);
  });
});

describe('levelFromXp / levelLabel（等级公式与后端 level.util.ts 一致）', () => {
  it('floor(sqrt(xp/100))+1 分档', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(1600)).toBe(5);
    expect(levelFromXp(-5)).toBe(1);
  });

  it('徽章文案 L1-L5', () => {
    expect(levelLabel(0)).toBe('L1');
    expect(levelLabel(860)).toBe('L3');
    expect(levelLabel(2100)).toBe('L5');
  });
});

describe('conceptLedger 概念条映射', () => {
  it('tone：误解风险高或转移就绪低 → 红；中 → 琥珀；就绪高 → 绿；未知 → 灰', () => {
    expect(conceptBarTone({ transferReadiness: 'high', misconceptionRisk: 'low' })).toBe('ok');
    expect(conceptBarTone({ transferReadiness: 'medium', misconceptionRisk: 'medium' })).toBe('warn');
    expect(conceptBarTone({ transferReadiness: 'low', misconceptionRisk: 'low' })).toBe('bad');
    expect(conceptBarTone({ transferReadiness: 'high', misconceptionRisk: 'high' })).toBe('bad');
    expect(conceptBarTone({})).toBe('muted');
  });

  it('width：高 90 / 中 55 / 低 25 / 未知 8', () => {
    expect(conceptBarWidth('high')).toBe(90);
    expect(conceptBarWidth('medium')).toBe(55);
    expect(conceptBarWidth('low')).toBe(25);
    expect(conceptBarWidth(undefined)).toBe(8);
  });

  it('中文标签', () => {
    expect(transferReadinessZh('high')).toBe('可迁移');
    expect(transferReadinessZh('low')).toBe('不宜迁移');
    expect(misconceptionRiskZh('high')).toBe('高');
    expect(transferReadinessZh('nope')).toBe('—');
  });
});

describe('normalizeLearnerTab（6 tab → 3 tab 深链重定向）', () => {
  it('新 tab 名原样保留', () => {
    expect(normalizeLearnerTab('overview')).toBe('overview');
    expect(normalizeLearnerTab('profile')).toBe('profile');
    expect(normalizeLearnerTab('evidence')).toBe('evidence');
  });

  it('旧 tab 名重定向：cognitive→profile、memory→profile、teaching→profile、dynamic→evidence', () => {
    expect(normalizeLearnerTab('cognitive')).toBe('profile');
    expect(normalizeLearnerTab('memory')).toBe('profile');
    expect(normalizeLearnerTab('teaching')).toBe('profile');
    expect(normalizeLearnerTab('dynamic')).toBe('evidence');
  });

  it('未知值兜底 overview', () => {
    expect(normalizeLearnerTab(undefined)).toBe('overview');
    expect(normalizeLearnerTab('whatever')).toBe('overview');
    expect(normalizeLearnerTab('COGNITIVE')).toBe('profile');
  });
});
