/**
 * 数据来源分类规则 —— 单一事实源（single source of truth）
 * ============================================================================
 * 用途：把 dev.db 里的账号 / 会话分成「平台行为层」（真实执行史，永远有效）与
 *      「学习效果层」（旧版 mastery/wrapup 标签，合成学员 + 旧测量层缺陷，双重不可信）。
 *
 * 本文件是纯函数式规则：classifyProvenance(email, opts) 输入 email（+可选注册时间），
 * 输出 provenance 分类；buildProvenanceSqlCase() 用同一份 glob 规则生成 SQLite 视图
 * 所用的 CASE 表达式（JS 与 SQL 共用同一组 glob，杜绝两处规则漂移）。
 *
 * 分类（至少这 6 类）：
 *   mechanical     机械脚本 / QA 自动化 / 数据工厂 e2e 账号（pe-*、ev2_*、e2e*、uitest* 等）
 *   vl             虚拟学习者（virtual_*@test.local / vl-*@*），含区分战役批次与 R1 对比组
 *   demo           内置演示账号（builtin_*@preset.local）
 *   test-round     本轮实测系列（gu-r1-* / s?r1-* / seq-r2-* / f1-r3-* / mv-*）及
 *                  2026-10-05（本地 +08:00）后出现的实测账号
 *   human          已人工确证的真人（白名单 CONFIRMED_HUMAN_GLOBS，当前为空）
 *   human-candidate 其余无法确证的账号（不硬标 human，进入人工复核清单）
 *   unknown        邮箱缺失/不合法（正常库内应趋零）
 *
 * ⚠ 封条边界常量：MEASUREMENT_FIX_BOUNDARY_MS
 *   2026-10-08 纪元重置后 = 纪元 2 起点；epoch-1 数据已归档清空，本常量只对
 *   重置时刻之前残留的行有语义（正常应为零行）。
 * ============================================================================
 */

/** 学习效果封条边界（epoch ms）。startTime < 此值 ⇒ measurement_sealed = true。
 *  2026-10-08 纪元重置（doc/local/DATA-EPOCH-RESET-2026-10-08.md）：epoch-1 学习数据
 *  已全量归档（backend/prisma/archive/dev.db-epoch1-final-20261008.db）并从活库清空。
 *  边界更新为纪元 2 起点（=2026-10-08T18:40:00+08），此后新产生的数据不再封条。 */
export const MEASUREMENT_FIX_BOUNDARY_MS = 1791456000000; // 2026-10-08T18:40:00+08:00（纪元 2 起点）

/** 实测窗口起点（epoch ms）= 纪元 2 起点。原 2026-10-05 启发式已随纪元重置失效——
 *  它曾把该时刻后注册的账号一律标 test-round；纪元 2 起新注册账号默认 real，
 *  测量夹具请用显式 email glob / 账号名规则命中。 */
export const ROUND_WINDOW_START_MS = 1791456000000; // 2026-10-08T18:40:00+08:00

/** R2 实测轨开跑时刻（epoch ms）= 2026-10-05T20:00:00Z（R2 seq/ad 两轨当晚开跑）。
 *  仅用于标注 vl 账号的「R2 复用状态」，不改变 provenance 分类。 */
export const R2_ACTIVITY_START_MS = 1791230400000; // 2026-10-05T20:00:00Z

/** 分类常量 */
export const PROVENANCE = Object.freeze({
  MECHANICAL: 'mechanical',
  VL: 'vl',
  DEMO: 'demo',
  TEST_ROUND: 'test-round',
  HUMAN: 'human',
  HUMAN_CANDIDATE: 'human-candidate',
  UNKNOWN: 'unknown',
});

/** 合成学员：synthetic_student = provenance ∈ 此集合（human / human-candidate = false） */
export const SYNTHETIC_STUDENT_PROVENANCE = Object.freeze([
  PROVENANCE.MECHANICAL,
  PROVENANCE.VL,
  PROVENANCE.DEMO,
  PROVENANCE.TEST_ROUND,
]);

/**
 * 规则表（顺序即优先级，先命中先返回）。email 一律 lower-case 后匹配。
 * glob 语法：`*` 任意串，`?` 单字符；与 SQLite GLOB（lower(email)）语义一致。
 */
const GLOB_RULES = [
  // ── 虚拟学习者（vl）─────────────────────────────────────────────────────
  { provenance: PROVENANCE.VL, globs: ['virtual_*@*', 'vl-*@*', 'vl_*@*'] },
  // ── 内置演示（demo）────────────────────────────────────────────────────
  { provenance: PROVENANCE.DEMO, globs: ['builtin_*@preset.local'] },
  // ── 机械脚本 / QA 自动化 / 数据工厂 e2e（mechanical）───────────────────
  {
    provenance: PROVENANCE.MECHANICAL,
    globs: [
      'pe-*@*', // measurement-probe / 机械验证脚本账号（含 pe-abdlv*、pe-absmoke*）
      'ev2_*@*', // evidence v2 批量
      'ev_p*@*', // evidence pack 探针
      'ld*_*@*', // load / dataset 批量（ld0_0_* 等）
      'e2e*@*', // e2e 自动化（e2efull* / e2emun* / e2e_mrui*）
      'uitest*@*',
      'uicheck*@*',
      'uxtest*@*',
      'uxaudit*@*',
      'ui_*@*',
      'qaui*@*',
      'qa_*@*', // qa_local_* / qa_audit_* / qa_delete_test_*
      'shotsnap*@*',
      'vizcheck*@*',
      'logocheck*@*',
      'pixelui*@*',
      'menutest*@*',
      'motion_review*@*',
      'ob-*@*', // onboarding / ob 检查
      'gw-upload-probe*@*',
      'goalprobe*@*',
      'obsweep*@*',
      'rtverify*@*',
      'vchecks*@*',
      'align_*@*',
      'verify_real_user*@*',
      'wfvis*@*',
      'reviewer*@*',
      'audit_*@*', // audit_tester / audit_probe_*
      'eval*@*', // eval082612426 / EvalRound2 / EvalRound3 / EvalNight1
      'simb_*@*', // 仿真 cohort B（simB_luowen，14 会话）
      'vqa_*@*',
      'st0*@*', // st0925****（49 秒内 3 会话的机械爆发）
      'admin@*', // 平台管理员（非学习者）
      'linceshi*@*', // USER_SIDE_QA_REPORT 明示「测试账号」
      'yanzheng*@*', // USER_SIDE_QA_REPORT 明示 QA 验证账号
    ],
  },
  // ── 本轮实测系列（test-round，按命名）──────────────────────────────────
  {
    provenance: PROVENANCE.TEST_ROUND,
    globs: [
      'gu-r1-*@*', // R1 GUI 走查
      's?r1-*@*', // R1 场景序列（s1r1-* / s2r1-* / s3r1-* / s4r1-*）
      'seq-r2-*@*', // R2 单账号序列轨
      'f1-r3-*@*', // 修复轮 R3 实测
      'mv-*@*', // mv-smoke-r1-* 冒烟
    ],
  },
];

/** 已人工确证的真人白名单（glob，小写）。当前为空：真人尚未确证，全部走 human-candidate。 */
export const CONFIRMED_HUMAN_GLOBS = [];

const globCache = new Map();
function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (re) return re;
  // 统一按小写匹配（与 SQL 侧 lower(email) GLOB lower(glob) 一致）
  const pattern = String(glob).toLowerCase();
  let out = '^';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  out += '$';
  re = new RegExp(out);
  globCache.set(glob, re);
  return re;
}

/**
 * 分类单个 email。
 * @param {string} email
 * @param {{ userCreatedAtMs?: number }} [opts] 注册时间（epoch ms），用于本轮窗口兜底判断
 * @returns {{ provenance: string, matchedBy: string }}
 */
export function classifyProvenance(email, opts = {}) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e || !e.includes('@')) {
    return { provenance: PROVENANCE.UNKNOWN, matchedBy: 'invalid-email' };
  }
  for (const rule of GLOB_RULES) {
    for (const g of rule.globs) {
      if (globToRegExp(g).test(e)) {
        return { provenance: rule.provenance, matchedBy: `glob:${g}` };
      }
    }
  }
  for (const g of CONFIRMED_HUMAN_GLOBS) {
    if (globToRegExp(g).test(e)) return { provenance: PROVENANCE.HUMAN, matchedBy: `human:${g}` };
  }
  const createdAt = Number(opts.userCreatedAtMs);
  if (Number.isFinite(createdAt) && createdAt >= ROUND_WINDOW_START_MS) {
    return { provenance: PROVENANCE.TEST_ROUND, matchedBy: 'round-window' };
  }
  return { provenance: PROVENANCE.HUMAN_CANDIDATE, matchedBy: 'fallback' };
}

/** 是否合成学员（synthetic_student 布尔） */
export function isSyntheticStudent(provenance) {
  return SYNTHETIC_STUDENT_PROVENANCE.includes(provenance);
}

/** 学习效果层是否封条（measurement_sealed 布尔） */
export function isMeasurementSealed(startTimeMs) {
  return Number(startTimeMs) < MEASUREMENT_FIX_BOUNDARY_MS;
}

/**
 * vl 账号的批次细分（纯函数，输入 email/注册时间/可选 profile tags + 最近活跃时间）。
 * 返回：
 *   batch: 'r1b'          —— R1 对比组（virtual_learner_profiles.tags 含 vl-r1b-*）
 *          'r1-measure'   —— 本轮窗口内新建、未打 r1b 标签的测量 VL（如 virtual_e982a766）
 *          'campaign'     —— 旧版批量战役批次（其余全部 virtual_ 与 vl- 前缀）
 *   r2Reused: 是否在 R2 轨（>= R2_ACTIVITY_START_MS）仍有会话（仅 r1b/r1-measure 可能为 true）
 *   label: 人类可读批次标签
 * @param {{ email?: string, profileTags?: string[]|string, userCreatedAtMs?: number, lastSessionMs?: number }} opts
 */
export function classifyVlBatch(opts = {}) {
  const email = String(opts.email ?? '').trim().toLowerCase();
  let tags = opts.profileTags ?? [];
  if (typeof tags === 'string') {
    tags = tags
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  const tagList = tags.map((t) => String(t).toLowerCase());
  const hasR1b = tagList.some((t) => t.startsWith('vl-r1b-'));
  const createdAt = Number(opts.userCreatedAtMs ?? 0);
  const lastSession = Number(opts.lastSessionMs ?? 0);
  let batch;
  let label;
  if (hasR1b) {
    batch = 'r1b';
    label = 'R1 对比组（vl-r1b-*）';
  } else if (Number.isFinite(createdAt) && createdAt >= ROUND_WINDOW_START_MS) {
    batch = 'r1-measure';
    label = 'R1 测量 VL（本轮窗口新建，未打 r1b 标签）';
  } else {
    batch = 'campaign';
    label = '旧版批量战役批次';
  }
  const r2Reused =
    (batch === 'r1b' || batch === 'r1-measure') &&
    Number.isFinite(lastSession) &&
    lastSession >= R2_ACTIVITY_START_MS;
  return { email, batch, label, r2Reused };
}

/**
 * 生成 SQLite CASE 表达式（与 JS 规则同源）。
 * @param {string} emailExpr SQL 邮箱表达式（如 "u.email"）
 * @param {string} createdAtExpr SQL 注册时间表达式（如 "u.createdAt"）
 */
export function buildProvenanceSqlCase(emailExpr, createdAtExpr) {
  const arms = [];
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  arms.push(
    `WHEN ${emailExpr} IS NULL OR instr(${emailExpr}, '@') = 0 THEN ${q(PROVENANCE.UNKNOWN)}`,
  );
  for (const rule of GLOB_RULES) {
    const cond = rule.globs
      .map((g) => `lower(${emailExpr}) GLOB ${q(g.toLowerCase())}`)
      .join(' OR ');
    arms.push(`WHEN ${cond} THEN ${q(rule.provenance)}`);
  }
  for (const g of CONFIRMED_HUMAN_GLOBS) {
    arms.push(`WHEN lower(${emailExpr}) GLOB ${q(g.toLowerCase())} THEN ${q(PROVENANCE.HUMAN)}`);
  }
  arms.push(
    `WHEN ${createdAtExpr} IS NOT NULL AND ${createdAtExpr} >= ${ROUND_WINDOW_START_MS} THEN ${q(PROVENANCE.TEST_ROUND)}`,
  );
  arms.push(`ELSE ${q(PROVENANCE.HUMAN_CANDIDATE)}`);
  return `CASE\n    ${arms.join('\n    ')}\n  END`;
}
