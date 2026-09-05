/**
 * 测试/虚拟账号识别单点测试（ADMIN_DEEP_LEARNER_AUDIT P1：风险队列被测试账号污染）
 * - isTestAccountUser：与前端 Users.vue isTestAccount 命名约定对齐（virtual_ / @test.local / TEST_ACCOUNT_PREFIXES）
 * - REAL_USER_WHERE：email 条件与 admin/platform.ts 等价，供 listForAdmin excludeTest 复用
 */
import { isTestAccountUser, REAL_USER_WHERE, TEST_ACCOUNT_PREFIXES } from '../test-account';

describe('isTestAccountUser', () => {
  it('虚拟学习者：id 以 virtual_ 开头', () => {
    expect(isTestAccountUser({ id: 'virtual_93e4c032', name: '某人', email: 'a@b.com' })).toBe(true);
  });

  it('虚拟学习者：email 以 virtual_ 开头或 @test.local 结尾', () => {
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'virtual_93e4c032@test.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'anything@test.local' })).toBe(true);
  });

  it('审计/测试账号：email 或 name 命中约定前缀（e2e_/audit_probe_/uxaudit_/ui_check/motion_review/qa_audit_）', () => {
    expect(isTestAccountUser({ id: 'u1', name: 'E2E_ms0fz3yx', email: 'e2e@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '财务助理小陈', email: 'audit_probe_01@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'motion_review', email: 'm@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'uxaudit_7', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'ui_check', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'qa_audit_0821', email: 'x@example.com' })).toBe(true);
  });

  it('dev.db 实测账号模式：shotsnap / verify_real_user / vcheck / vqa_audit / align_ / qa_delete_test_', () => {
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
    expect(isTestAccountUser({ id: 'u1', name: '123', email: '123@123.com' })).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: 'aaa', email: 'aaa@wenflow.local' })).toBe(false);
  });

  it('空值不误伤', () => {
    expect(isTestAccountUser({})).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: null, email: null })).toBe(false);
  });
});

describe('REAL_USER_WHERE（Prisma 过滤单点）', () => {
  it('排除 isVirtualLearner，且 NOT 包含全部测试账号命名模式（email + name）', () => {
    expect(REAL_USER_WHERE.isVirtualLearner).toBe(false);
    const emails = REAL_USER_WHERE.NOT.filter((c: any) => c.email).map((c: any) => Object.keys(c.email)[0]);
    expect(emails).toEqual(
      expect.arrayContaining(['startsWith', 'endsWith', 'startsWith', 'startsWith', 'startsWith', 'startsWith', 'startsWith'])
    );
    const names = REAL_USER_WHERE.NOT.filter((c: any) => c.name);
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('TEST_ACCOUNT_PREFIXES 全量同步进 NOT（email + name 各一份）', () => {
    const emails = REAL_USER_WHERE.NOT.filter((c: any) => c.email && c.email.startsWith).map((c: any) => c.email.startsWith);
    const names = REAL_USER_WHERE.NOT.filter((c: any) => c.name).map((c: any) => c.name.startsWith);
    for (const prefix of TEST_ACCOUNT_PREFIXES) {
      expect(emails).toContain(prefix);
      expect(names).toContain(prefix);
    }
  });

  it('实测账号模式可被 NOT 排除（shotsnap / verify / vcheck / vqa_audit / align）', () => {
    const emails = REAL_USER_WHERE.NOT.filter((c: any) => c.email && c.email.startsWith).map((c: any) => c.email.startsWith);
    for (const prefix of ['shotsnap', 'verify_real_user', 'vcheck', 'vqa_audit', 'align_', 'qa_delete_test_']) {
      expect(emails).toContain(prefix);
    }
  });
});
