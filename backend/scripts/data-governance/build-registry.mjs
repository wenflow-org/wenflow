#!/usr/bin/env node
/**
 * build-registry.mjs —— 来源注册表生成器（只读）
 * ============================================================================
 * 跑 provenance-rules.mjs 的分类规则，遍历 dev.db 全部用户，产出：
 *   - doc/local/DATA-PROVENANCE-REGISTRY-2026-10-06.json（每用户一行）
 *   - 控制台摘要（复现已知锚点：10,387 总数 / builtin_vocationa 153 / builtin_gaokao 52）
 *
 * 只读打开（readOnly: true），不写库；输出文件覆盖式写入（幂等，可重跑）。
 *
 * 用法：node backend/scripts/data-governance/build-registry.mjs
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyProvenance,
  classifyVlBatch,
  PROVENANCE,
  MEASUREMENT_FIX_BOUNDARY_MS,
  ROUND_WINDOW_START_MS,
} from './provenance-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DB_PATH = resolve(REPO_ROOT, 'backend', 'prisma', 'dev.db');
const OUT_PATH = resolve(REPO_ROOT, 'doc', 'local', 'DATA-PROVENANCE-REGISTRY-2026-10-06.json');

/** 已知锚点快照边界：此刻（含）教学会话总数 = 10,387（本轮实测报告引用值）。
 *  该时刻之后 R2/R3 实跑继续新增会话，故「当前总数」会大于锚点值——两者都记录。 */
const ANCHOR_SNAPSHOT_MS = 1791255006734; // 2026-10-06T02:50:06.734Z
const ANCHOR_TOTAL = 10387;
const ANCHOR_BUILTIN_VOCATIONA = 153;
const ANCHOR_BUILTIN_GAOKAO = 52;
const ANCHOR_NON_TEST_LOCAL = 606;

function fmt(ms) {
  if (ms === null || ms === undefined) return null;
  return new Date(Number(ms)).toISOString();
}

function main() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  const users = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.isVirtualLearner, u.createdAt,
              u.deletedAt
       FROM users u ORDER BY u.email`,
    )
    .all();

  const sessionAgg = db
    .prepare(
      `SELECT userId, COUNT(*) c, MIN(startTime) mn, MAX(startTime) mx
       FROM teaching_sessions GROUP BY userId`,
    )
    .all();
  const aggByUser = new Map(sessionAgg.map((r) => [r.userId, r]));

  const profileTagsByUser = new Map(
    db
      .prepare('SELECT userId, tags FROM virtual_learner_profiles')
      .all()
      .map((r) => [r.userId, r.tags]),
  );

  const registry = [];
  const byProvenance = {};
  const vlBatchCounts = {};
  const humanCandidates = [];
  const unknowns = [];

  for (const u of users) {
    const agg = aggByUser.get(u.id);
    const sessionCount = agg ? Number(agg.c) : 0;
    const { provenance, matchedBy } = classifyProvenance(u.email, {
      userCreatedAtMs: Number(u.createdAt),
    });
    const row = {
      email: u.email,
      provenance,
      matchedBy,
      sessionCount,
      firstSessionAt: fmt(agg ? agg.mn : null),
      lastSessionAt: fmt(agg ? agg.mx : null),
      userCreatedAt: fmt(u.createdAt),
      isVirtualLearner: Boolean(u.isVirtualLearner),
      softDeleted: Boolean(u.deletedAt),
    };
    if (provenance === PROVENANCE.VL) {
      const vl = classifyVlBatch({
        email: u.email,
        profileTags: profileTagsByUser.get(u.id),
        userCreatedAtMs: Number(u.createdAt),
        lastSessionMs: agg ? Number(agg.mx) : 0,
      });
      row.vlBatch = vl.batch;
      row.vlBatchLabel = vl.label;
      row.r2Reused = vl.r2Reused;
      vlBatchCounts[vl.batch] = vlBatchCounts[vl.batch] || { users: 0, sessions: 0 };
      vlBatchCounts[vl.batch].users += 1;
      vlBatchCounts[vl.batch].sessions += sessionCount;
    }
    registry.push(row);

    byProvenance[provenance] = byProvenance[provenance] || { users: 0, sessions: 0 };
    byProvenance[provenance].users += 1;
    byProvenance[provenance].sessions += sessionCount;
    if (provenance === PROVENANCE.HUMAN_CANDIDATE) humanCandidates.push(row);
    if (provenance === PROVENANCE.UNKNOWN) unknowns.push(row);
  }

  // ── 锚点复现 ────────────────────────────────────────────────────────────
  const countAt = (ms) =>
    Number(db.prepare('SELECT COUNT(*) c FROM teaching_sessions WHERE createdAt <= ?').get(ms).c);
  const liveTotal = Number(db.prepare('SELECT COUNT(*) c FROM teaching_sessions').get().c);
  const anchorTotal = countAt(ANCHOR_SNAPSHOT_MS);
  const builtinVocationa = Number(
    db
      .prepare(
        `SELECT COUNT(*) c FROM teaching_sessions s JOIN users u ON u.id=s.userId
         WHERE u.email='builtin_vocational-electrician-exam@preset.local'`,
      )
      .get().c,
  );
  const builtinGaokao = Number(
    db
      .prepare(
        `SELECT COUNT(*) c FROM teaching_sessions s JOIN users u ON u.id=s.userId
         WHERE u.email='builtin_gaokao-science@preset.local'`,
      )
      .get().c,
  );
  const nonTestLocal = Number(
    db
      .prepare(
        `SELECT COUNT(*) c FROM teaching_sessions s JOIN users u ON u.id=s.userId
         WHERE u.email NOT LIKE '%@test.local'`,
      )
      .get().c,
  );

  const anchors = {
    anchorSnapshotAt: fmt(ANCHOR_SNAPSHOT_MS),
    anchorTotalExpected: ANCHOR_TOTAL,
    anchorTotalActual: anchorTotal,
    anchorTotalReproduced: anchorTotal === ANCHOR_TOTAL,
    liveTotal,
    builtinVocationalExpected: ANCHOR_BUILTIN_VOCATIONA,
    builtinVocationalActual: builtinVocationa,
    builtinGaokaoExpected: ANCHOR_BUILTIN_GAOKAO,
    builtinGaokaoActual: builtinGaokao,
    nonTestLocalExpected: ANCHOR_NON_TEST_LOCAL,
    nonTestLocalActual: nonTestLocal,
  };

  const out = {
    generatedAt: new Date().toISOString(),
    dbPath: 'backend/prisma/dev.db',
    boundaryConstants: {
      measurementFixBoundaryMs: MEASUREMENT_FIX_BOUNDARY_MS,
      measurementFixBoundaryIso: fmt(MEASUREMENT_FIX_BOUNDARY_MS),
      measurementFixBoundaryNote: '修复轮上线后更新此值',
      roundWindowStartMs: ROUND_WINDOW_START_MS,
      roundWindowStartIso: fmt(ROUND_WINDOW_START_MS),
    },
    anchors,
    summaryByProvenance: byProvenance,
    summaryVlBatch: vlBatchCounts,
    unknownCount: unknowns.length,
    humanCandidateCount: humanCandidates.length,
    users: registry,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  // ── 控制台摘要 ──────────────────────────────────────────────────────────
  console.log('═'.repeat(72));
  console.log('数据来源注册表 · 构建摘要  (' + out.generatedAt + ')');
  console.log('═'.repeat(72));
  console.log('用户总数:', users.length, '| 当前会话总数:', liveTotal);
  console.log('');
  console.log('按 provenance 分层:');
  for (const key of [
    PROVENANCE.VL,
    PROVENANCE.DEMO,
    PROVENANCE.MECHANICAL,
    PROVENANCE.TEST_ROUND,
    PROVENANCE.HUMAN,
    PROVENANCE.HUMAN_CANDIDATE,
    PROVENANCE.UNKNOWN,
  ]) {
    const v = byProvenance[key] || { users: 0, sessions: 0 };
    console.log(
      '  ' +
        key.padEnd(16) +
        ' users=' +
        String(v.users).padStart(4) +
        '  sessions=' +
        String(v.sessions).padStart(6),
    );
  }
  console.log('');
  console.log('vl 批次细分:');
  for (const [k, v] of Object.entries(vlBatchCounts)) {
    console.log(
      '  ' + k.padEnd(12) + ' users=' + String(v.users).padStart(4) + '  sessions=' + String(v.sessions).padStart(6),
    );
  }
  console.log('');
  console.log('锚点复现:');
  console.log(
    `  [${anchors.anchorTotalReproduced ? 'OK' : 'FAIL'}] 总数(锚点快照 ${anchors.anchorSnapshotAt}) = ` +
      `${anchorTotal} (期望 ${ANCHOR_TOTAL})   |  当前实时 = ${liveTotal}`,
  );
  console.log(
    `  [${builtinVocationa === ANCHOR_BUILTIN_VOCATIONA ? 'OK' : 'FAIL'}] builtin_vocational-electrician-exam = ${builtinVocationa} (期望 ${ANCHOR_BUILTIN_VOCATIONA})`,
  );
  console.log(
    `  [${builtinGaokao === ANCHOR_BUILTIN_GAOKAO ? 'OK' : 'FAIL'}] builtin_gaokao-science = ${builtinGaokao} (期望 ${ANCHOR_BUILTIN_GAOKAO})`,
  );
  console.log(
    `  [${nonTestLocal === ANCHOR_NON_TEST_LOCAL ? 'OK' : 'FAIL'}] 排除 @test.local 后 = ${nonTestLocal} (期望 ${ANCHOR_NON_TEST_LOCAL})`,
  );
  console.log('');
  console.log('unknown:', unknowns.length, '| human-candidate:', humanCandidates.length);
  if (unknowns.length) console.log('  unknown 清单:', unknowns.map((r) => r.email).join(', '));
  if (humanCandidates.length) {
    console.log('  human-candidate 清单:');
    for (const r of humanCandidates) console.log('    -', r.email, '(' + r.sessionCount + ' 会话)');
  }
  console.log('');
  console.log('输出:', OUT_PATH);
  console.log('═'.repeat(72));

  db.close();

  const ok =
    anchors.anchorTotalReproduced &&
    builtinVocationa === ANCHOR_BUILTIN_VOCATIONA &&
    builtinGaokao === ANCHOR_BUILTIN_GAOKAO &&
    nonTestLocal === ANCHOR_NON_TEST_LOCAL &&
    unknowns.length === 0;
  if (!ok) process.exitCode = 2;
}

main();