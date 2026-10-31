#!/usr/bin/env node
/**
 * 一次性数据迁移：把存量「模板卡」从账号模型迁到纯档案模型（2026-10-29 用户拍板）。
 *
 * 背景：此前导入/自建一张卡 = 建一个 isVirtualLearner 账号 + 档案（一卡一账号），
 * 于是导入 200 张金标卡后「用户账号」里多出 200 个不需要的虚拟账号。新语义：
 * 卡库不是账号，只是档案；只有派生实例/预置实例才建账号。
 *
 * 本脚本扫描：userId IS NOT NULL AND presetKey IS NULL 且 profile JSON 无 derivedFrom（模板卡）。
 * 对每张卡：
 *   1) 把随卡资料从原 user 目录搬到卡归属键目录 `card-<profileId>`（用 material-store 读写）；
 *   2) 档案 userId 置 null；
 *   3) 确认档案已脱离后，删除对应 users 行（仅 isVirtualLearner；且无会话/路径等依赖）。
 * 预置卡（presetKey 非空）与派生实例（profile 有 derivedFrom）一律不动。
 *
 * 用法（cd backend）：
 *   npx ts-node --transpile-only scripts/migrate-card-templates-to-library.ts            # 默认 dry-run，只打印计划
 *   npx ts-node --transpile-only scripts/migrate-card-templates-to-library.ts --dry-run  # 同上
 *   npx ts-node --transpile-only scripts/migrate-card-templates-to-library.ts --apply    # 正式执行（先备份 dev.db）
 *
 * 安全：--apply 前自动把 SQLite 库文件（含 -wal/-shm/-journal）复制到系统临时目录，不落仓库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';
import prisma from '../src/config/database';
import { listMaterials, readMaterial, writeMaterial, deleteMaterial } from '../src/services/materials/material-store';
import { cardOwnerKey } from '../src/services/virtual-lab/card-owner-key';

const ARGV = new Set(process.argv.slice(2));
const APPLY = ARGV.has('--apply');
const DRY_RUN = !APPLY; // 安全默认：不显式 --apply 就只打印计划

interface CardRow {
  id: string;
  userId: string;
  profile: string;
  users: { id: string; email: string | null; name: string | null; isVirtualLearner: boolean } | null;
}

interface Plan {
  profileId: string;
  userId: string;
  userName: string | null;
  isVirtualLearner: boolean;
  destOwnerKey: string;
  materials: Array<{ id: string; title: string }>;
  /** 非虚拟账号（isVirtualLearner=0）：档案照脱钩，但不删账号，需人工确认 */
  keepAccount: boolean;
  note?: string;
}

/** 随卡资料的归属标题清单（scenarioCard.materials，与导出回程同源） */
function ownedMaterialTitles(profile: Record<string, unknown>): string[] {
  const seed = (profile.personaSeed || {}) as Record<string, unknown>;
  const sc = (seed.scenarioCard || {}) as Record<string, unknown>;
  const owned = (sc.materials as Array<{ title?: string }> | undefined) || [];
  return owned.map((m) => String(m.title || '').trim()).filter(Boolean);
}

/** 是否派生实例（profile JSON 写了 derivedFrom） */
function isDerivedInstance(profile: Record<string, unknown>): boolean {
  const df = profile.derivedFrom;
  return Boolean(df && typeof df === 'object');
}

function dbFilePath(): string | null {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return null;
  const rel = url.slice('file:'.length);
  // Prisma 以 schema 所在目录解析 SQLite 相对路径（backend/prisma）
  return path.isAbsolute(rel) ? rel : path.resolve(__dirname, '..', 'prisma', rel);
}

/** 正式执行前备份 SQLite 库到系统临时目录（含 WAL/SHM/journal 旁文件） */
function backupDatabase(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(os.tmpdir(), `wenflow-dev-db-backup-${stamp}.db`);
  fs.copyFileSync(dbPath, dest);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) {
      try {
        fs.copyFileSync(side, `${dest}${suffix}`);
      } catch {
        /* 旁文件复制失败不阻断主库备份 */
      }
    }
  }
  return dest;
}

async function loadPlan(): Promise<{ plans: Plan[]; skippedDerived: number; totalProfiles: number }> {
  const rows = (await prisma.virtual_learner_profiles.findMany({
    where: { userId: { not: null }, presetKey: null },
    select: {
      id: true,
      userId: true,
      profile: true,
      users: { select: { id: true, email: true, name: true, isVirtualLearner: true } },
    },
    orderBy: { createdAt: 'asc' },
  })) as unknown as CardRow[];

  const totalProfiles = await prisma.virtual_learner_profiles.count();
  const plans: Plan[] = [];
  let skippedDerived = 0;

  for (const row of rows) {
    let profile: Record<string, unknown> = {};
    try {
      profile = JSON.parse(row.profile || '{}') as Record<string, unknown>;
    } catch {
      // 坏 JSON 按模板卡处理（无 derivedFrom 可识）
    }
    if (isDerivedInstance(profile)) {
      skippedDerived++;
      continue;
    }
    const userId = row.userId;
    const titles = ownedMaterialTitles(profile);
    const records = listMaterials(userId);
    const titleSet = new Set(titles.map((t) => t.toLowerCase()));

    // 有明确随卡标题 → 只搬匹配项；虚拟账号且无标题清单 → 搬该账号全部资料（模板账号只有卡资料）；
    // 非虚拟账号无标题清单 → 保守不动资料，留给人工确认。
    const isVirtual = Boolean(row.users?.isVirtualLearner);
    let picked = records;
    if (titleSet.size) {
      picked = records.filter((r) => titleSet.has(r.name.replace(/\.md$/i, '').trim().toLowerCase()));
    } else if (!isVirtual) {
      picked = [];
    }

    plans.push({
      profileId: row.id,
      userId,
      userName: row.users?.name ?? null,
      isVirtualLearner: isVirtual,
      destOwnerKey: cardOwnerKey(row.id),
      materials: picked.map((r) => ({ id: r.id, title: r.name.replace(/\.md$/i, '') })),
      keepAccount: !isVirtual,
      note: isVirtual ? undefined : '非虚拟账号：档案脱钩但保留 users 行（需人工确认）',
    });
  }

  return { plans, skippedDerived, totalProfiles };
}

async function dependencyCounts(userId: string): Promise<Record<string, number>> {
  const [sessions, teaching, paths, goals] = await Promise.all([
    prisma.virtual_sessions.count({ where: { userId } }),
    prisma.teaching_sessions.count({ where: { userId } }),
    prisma.learning_paths.count({ where: { userId } }),
    prisma.goal_conversations.count({ where: { userId } }),
  ]);
  return { sessions, teaching, paths, goals };
}

async function main(): Promise<number> {
  const dbPath = dbFilePath();
  console.log(`[migrate-cards] 模式：${DRY_RUN ? 'DRY-RUN（只打印计划）' : 'APPLY（正式执行）'}`);
  console.log(`[migrate-cards] DB：${dbPath ?? '(非 file: 数据源，跳过备份)'}`);

  const { plans, skippedDerived, totalProfiles } = await loadPlan();
  const beforeUserId = plans.length;
  const beforeVirtualUsers = await prisma.users.count({ where: { isVirtualLearner: true } });
  const materialsPlanned = plans.reduce((sum, p) => sum + p.materials.length, 0);
  const accountsPlanned = plans.filter((p) => p.isVirtualLearner).length;
  const keepAccounts = plans.filter((p) => p.keepAccount);

  console.log(`[migrate-cards] 扫描：档案总数 ${totalProfiles}；模板卡 ${plans.length}；派生实例跳过 ${skippedDerived}`);
  console.log(`[migrate-cards] 计划：资料搬移 ${materialsPlanned} 份；删除虚拟账号 ${accountsPlanned} 个；保留非虚拟账号 ${keepAccounts.length} 个`);
  for (const p of keepAccounts) {
    console.log(`  [keep] profile=${p.profileId} user=${p.userId} ${p.userName ?? ''} — ${p.note}`);
  }
  if (DRY_RUN) {
    for (const p of plans.slice(0, 20)) {
      console.log(`  [plan] ${p.profileId} user=${p.userId} 资料=${p.materials.length} → ${p.destOwnerKey}`);
    }
    if (plans.length > 20) console.log(`  ... 其余 ${plans.length - 20} 张卡略`);
    console.log('[migrate-cards] dry-run 未写库。确认无误后加 --apply 执行。');
    return 0;
  }

  if (dbPath && !fs.existsSync(dbPath)) {
    console.error(`[migrate-cards] 找不到数据库文件，拒绝执行：${dbPath}`);
    return 1;
  }
  if (dbPath) {
    const backup = backupDatabase(dbPath);
    console.log(`[migrate-cards] 已备份数据库 → ${backup}`);
  }

  let detached = 0;
  let materialsMoved = 0;
  let accountsDeleted = 0;
  let accountsKept = 0;
  const failed: Array<{ profileId: string; reason: string }> = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    try {
      // 1) 资料搬家（先写后删；重复执行安全）
      for (const item of plan.materials) {
        const found = readMaterial(plan.userId, item.id);
        if (!found) continue;
        writeMaterial({ ...found.record, userId: plan.destOwnerKey }, found.markdown);
        deleteMaterial(plan.userId, item.id);
        materialsMoved++;
      }

      // 2) 档案脱钩
      await prisma.virtual_learner_profiles.update({
        where: { id: plan.profileId },
        data: { userId: null },
      });
      const after = await prisma.virtual_learner_profiles.findUnique({
        where: { id: plan.profileId },
        select: { userId: true },
      });
      if (!after || after.userId !== null) {
        throw new Error('档案脱钩校验失败（userId 仍非空）');
      }
      detached++;

      // 3) 删除账号（仅虚拟账号；确认无会话/路径等依赖后才删）
      if (!plan.isVirtualLearner) {
        accountsKept++;
      } else {
        const deps = await dependencyCounts(plan.userId);
        const depTotal = Object.values(deps).reduce((a, b) => a + b, 0);
        if (depTotal > 0) {
          accountsKept++;
          console.log(`  [keep-account] profile=${plan.profileId} user=${plan.userId} 仍有依赖 ${JSON.stringify(deps)}，未删账号`);
        } else {
          await prisma.users.delete({ where: { id: plan.userId } });
          accountsDeleted++;
        }
      }
    } catch (error) {
      failed.push({ profileId: plan.profileId, reason: error instanceof Error ? error.message : String(error) });
      console.error(`  [fail] profile=${plan.profileId} ${failed[failed.length - 1].reason}`);
    }

    if ((i + 1) % 25 === 0 || i + 1 === plans.length) {
      console.log(`[migrate-cards] 进度 ${i + 1}/${plans.length}：脱钩 ${detached}，资料 ${materialsMoved}，删号 ${accountsDeleted}，失败 ${failed.length}`);
    }
  }

  const afterProfiles = await prisma.virtual_learner_profiles.count();
  const afterUserId = await prisma.virtual_learner_profiles.count({ where: { userId: { not: null } } });
  const afterVirtualUsers = await prisma.users.count({ where: { isVirtualLearner: true } });

  console.log('[migrate-cards] ===== 对账 =====');
  console.log(`  档案总数：${totalProfiles} → ${afterProfiles}（应不变）`);
  console.log(`  有账号档案：${beforeUserId} → ${afterUserId}`);
  console.log(`  虚拟账号（users.isVirtualLearner=1）：${beforeVirtualUsers} → ${afterVirtualUsers}`);
  console.log(`  资料搬移：${materialsMoved}/${materialsPlanned}`);
  console.log(`  档案脱钩：${detached}/${plans.length}；删号：${accountsDeleted}/${accountsPlanned}；保留账号：${accountsKept}（其中非虚拟 ${keepAccounts.length}）`);
  console.log(`  失败：${failed.length}`);
  for (const f of failed) console.log(`    - ${f.profileId}: ${f.reason}`);

  return failed.length ? 1 : 0;
}

main()
  .catch((error) => {
    console.error('[migrate-cards] 迁移异常：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
