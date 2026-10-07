/**
 * 测试/虚拟账号识别单点（管理端风险队列/统计口径/登录守卫共用）。
 *
 * 命名约定（前端 admin-redesign learner-profile.ts isTestAccountUser 与此保持同步）：
 * - 虚拟学习者：id 以 virtual_ 开头，或 email 形如 virtual_xxx@test.local（virtual-learners.ts:1129 生成）
 * - 审计/测试账号：email/name 命中 TEST_ACCOUNT_PREFIXES 任一前缀
 * - 其余测试邮箱：以 @test.local 结尾
 *
 * 前缀清单来自 dev.db 实测账号分布（2026-08-15 审计 + 2026-10-07 运营走查 F3-4 复核）：
 * shotsnap（14 个，截图回归批量注册）、verify_real_user / vcheck / vqa_audit / align_
 * （ad-hoc 开发/验证账号）、qa_delete_test_（删除链路回归，含软删测试）；
 * 2026-10-07 补：uitest / uxtest / ui_audit_ / audit_ / eval / simb_ / vqa_ / vizcheck /
 * logocheck / pe-finalverify（「仅真实」311 行里仍混进的 25 行明显测试/仿真账号，
 * 见 F3-4 复核探针 rev-f3-4-probe*.mjs）。分类口径与 backend/scripts/data-governance/
 * provenance-rules.mjs 的 mechanical 规则表对齐（该表是来源治理单一事实源，本清单只取
 * 其中「账号身份」前缀，不含 s?r1-/f1-r3-/seq-r2- 等「本轮实测批次」规则——那类仍是真人驱动）。
 *
 * ⚠ 不能扩到 pe-* / ev2_* / e2e* / ld*_* 等通用机械前缀：用户侧登录守卫（auth.service.ts:170）
 * 复用本单点拒绝登录，而 scripts/paradigm-eval/drive.mjs:105 的探针账号正是 pe-<persona>
 * （注册后立刻登录，34 个 persona 批量跑）。扩到 pe- 会把整条测量探针链路锁死；
 * 本组只收 F3-4 点名的这一批，通用机械前缀留给来源治理口径（synthetic_student）处理。
 *
 * 新增测试命名时先补前缀清单，勿在各调用处内联条件。
 */

/**
 * 测试/审计账号命名前缀（email 或 name 命中即视为测试账号）。
 * 注意：不能 as const —— Prisma 的 usersWhereInput.NOT 要求可变数组。
 */
export const TEST_ACCOUNT_PREFIXES: string[] = [
  'e2e_',
  'audit_probe_',
  'uxaudit_',
  'ui_check',
  'motion_review',
  'qa_audit_',
  'shotsnap',
  'verify_real_user',
  'vcheck',
  'vqa_audit',
  'align_',
  'qa_delete_test_',
  // 2026-10-07（F3-4）：运营走查「仅真实」口径仍混进的测试/仿真账号命名
  'uitest', // uitest0jrs9 / uitest0925 / uitest3v6f…（.ui-audit 走查注册）
  'uxtest', // uxtest0923
  'ui_audit_', // ui_audit_20260815231831
  'audit_', // audit_tester / audit_probe_*（前者旧清单漏收）
  'eval', // eval082612426 / EvalRound2 / EvalRound3 / EvalNight1
  'simb_', // simB_luowen（仿真 cohort B）
  'vqa_', // vqa_1789051985 / vqa_audit_user
  'vizcheck', // vizcheck01 / vizcheck-m / vizcheck-d
  'logocheck', // logocheck2
  'pe-finalverify', // pe-finalverify / pe-finalverify2-4
  // 同一复核的「更宽特征集」命中（F3-4 证据：点名特征集 25 行 / 宽集 31 行，差额即这四族）
  'menutest', // menutest0901（菜单走查）
  'goalprobe', // goalprobe0926（目标链路探针）
  'ev_p', // ev_probe_goal_*（evidence pack 探针）
  'gw-upload-probe', // gw-upload-probe / gw-upload-probe2
];

const TEST_ACCOUNT_PREFIX_PATTERN = new RegExp(`^(${TEST_ACCOUNT_PREFIXES.join('|')})`, 'i');

export function isTestAccountUser(u: { id?: string; name?: string | null; email?: string | null }): boolean {
  const id = String(u.id || '');
  const name = String(u.name || '');
  const email = String(u.email || '');
  if (/^virtual_/.test(id)) return true;
  if (/@test\.local$/i.test(email)) return true;
  if (/^virtual_/i.test(email)) return true;
  if (TEST_ACCOUNT_PREFIX_PATTERN.test(email)) return true;
  if (TEST_ACCOUNT_PREFIX_PATTERN.test(name)) return true;
  return false;
}

/**
 * Prisma where：排除虚拟学习者与测试/审计账号。
 * email 条件与 admin/platform.ts 统计口径等价；name 条件与前端 Users.vue 命名约定对齐。
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
    ...TEST_ACCOUNT_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })),
    ...TEST_ACCOUNT_PREFIXES.map((prefix) => ({ name: { startsWith: prefix } })),
  ],
};
