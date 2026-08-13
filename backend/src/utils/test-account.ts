/**
 * 测试/虚拟账号识别单点（管理端风险队列/统计口径）。
 *
 * 命名约定（与前端 admin-redesign Users.vue isTestAccount 一致）：
 * - 虚拟学习者：id 以 virtual_ 开头，或 email 形如 virtual_xxx@test.local（virtual-learners.ts:1129 生成）
 * - 审计/测试账号：email/name 以 e2e_ / audit_probe_ / uxaudit_ / ui_check / motion_review / qa_audit_ 开头
 * - 其余测试邮箱：以 @test.local 结尾
 */

export function isTestAccountUser(u: { id?: string; name?: string | null; email?: string | null }): boolean {
  const id = String(u.id || '');
  const name = String(u.name || '');
  const email = String(u.email || '');
  if (/^virtual_/.test(id)) return true;
  if (/@test\.local$/i.test(email)) return true;
  if (/^virtual_/i.test(email)) return true;
  if (/^(e2e_|audit_probe_|uxaudit_|ui_check|motion_review|qa_audit_)/i.test(email)) return true;
  if (/^(e2e_|audit_probe_|uxaudit_|ui_check|motion_review|qa_audit_)/i.test(name)) return true;
  return false;
}

/**
 * Prisma where：排除虚拟学习者与测试/审计账号。
 * email 条件与 admin/platform.ts REAL_USER_WHERE 等价；name 条件与前端 Users.vue 命名约定对齐。
 * 注意：不能 as const —— Prisma 的 usersWhereInput.NOT 要求可变数组。
 */
export const REAL_USER_WHERE: {
  isVirtualLearner: boolean;
  NOT: ({ email: { startsWith: string } | { endsWith: string } } | { name: { startsWith: string } })[];
} = {
  isVirtualLearner: false,
  NOT: [
    { email: { startsWith: 'virtual_' } },
    { email: { endsWith: '@test.local' } },
    { email: { startsWith: 'e2e_' } },
    { email: { startsWith: 'audit_probe_' } },
    { email: { startsWith: 'uxaudit_' } },
    { email: { startsWith: 'ui_check' } },
    { email: { startsWith: 'motion_review' } },
    { email: { startsWith: 'qa_audit_' } },
    { name: { startsWith: 'e2e_' } },
    { name: { startsWith: 'audit_probe_' } },
    { name: { startsWith: 'uxaudit_' } },
    { name: { startsWith: 'ui_check' } },
    { name: { startsWith: 'motion_review' } },
    { name: { startsWith: 'qa_audit_' } },
  ],
};
