import prisma from '../config/database';

/**
 * 测试/虚拟账号识别单点（管理端风险队列/统计口径/登录守卫共用）。
 * 判据只有一处：`isTestAccountUser`（JS 正则/字面判断）；SQL 侧一律经
 * `buildRealUserWhere` / `findRealUserIds` 复用同一判据，避免出现第二套匹配实现。
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
 * 前缀一律按**字面**匹配（`TEST_ACCOUNT_PREFIX_PATTERN` 的正则已转义），不交给 SQL 的 LIKE。
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

/** 前缀按字面拼进正则（当前清单只有字母/数字/`_`/`-`，仍显式转义，避免以后加前缀踩坑）。 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEST_ACCOUNT_PREFIX_PATTERN = new RegExp(`^(${TEST_ACCOUNT_PREFIXES.map(escapeRegExp).join('|')})`, 'i');

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
 *
 * ⚠ 2026-10-09 起**不再用 Prisma 的 startsWith 表达前缀**，改为按 id 排除（见下方
 * findTestAccountUserIds / buildRealUserWhere）。原因：Prisma 在 SQLite 上把 startsWith
 * 编译成 LIKE，且**不转义 LIKE 元字符**，`_` 会被当成「任意一个字符」——
 * `startsWith: 'e2e_'` 实际是 `LIKE 'e2e_%'`，会把 `e2e.del.587389.a@example.com`
 * 这类真实账号一起排除掉（实测：该账号在列表/KPI/导出里静默消失，而同一个模块的
 * isTestAccountUser 用字面正则判定它「不是测试账号」，两半口径分叉）。
 * 也不能改用 `gte/lt` 区间去模拟「字面前缀」：LIKE 对 ASCII 大小写不敏感，而区间比较是
 * 大小写敏感的，`simB_luowen` / `EvalRound2` 这类账号会因此漏进统计。
 * 结论：SQL 侧一律以 isTestAccountUser 为唯一判据（取回 id/email/name 后过滤），
 * 从结构上保证两半不会再分叉。
 *
 * 性能：这些调用点都在管理端/KPI 查询里，且库内 users 规模有限；同一请求内请只算一次
 * 并把结果传下去（platform-overview.service.ts 就是这么做的）。
 */
export async function findTestAccountUserIds(): Promise<string[]> {
  const rows = await prisma.users.findMany({
    select: { id: true, email: true, name: true, isVirtualLearner: true },
  });
  return rows.filter((row) => row.isVirtualLearner || isTestAccountUser(row)).map((row) => row.id);
}

/** 真实（非虚拟、非测试/审计）账号 id 清单，供「按用户聚合」的统计口径复用。 */
export async function findRealUserIds(): Promise<string[]> {
  const rows = await prisma.users.findMany({
    select: { id: true, email: true, name: true, isVirtualLearner: true },
  });
  return rows.filter((row) => !row.isVirtualLearner && !isTestAccountUser(row)).map((row) => row.id);
}

/**
 * 真实用户 where 片段（单点入口）：排除虚拟学习者与测试/审计账号。
 * extra 会覆盖同名键（例如统计口径要补 `deletedAt: null`）。
 */
export async function buildRealUserWhere(
  extra?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const excludedIds = await findTestAccountUserIds();
  return {
    isVirtualLearner: false,
    // 空集时省掉 id 条件：既省一条无用条件，也不依赖 `notIn: []` 的语义
    ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
    ...(extra || {}),
  };
}
