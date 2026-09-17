/**
 * 成功率带回看（**只读**，不调 LLM、不写库）
 *
 * 用途（§7 P1-1）：把"独立传感器 → 带判定 → 难度档位"这条链的现状一眼看清——
 * 有多少**代码裁决**样本、成功率落在带内还是带外、带给出的动作、以及最近几次难度锚点里
 * 是否真的出现了带理由（`success_rate_below_band` / `success_rate_above_band`）。
 *
 * 为什么需要它：带只在 ≥6 个代码裁决样本时才动作，而样本是**按用户**累积的
 * （一次从零验证只有 1 条）——所以"带到底动没动"必须能便宜地回看，而不是每次重跑真实课。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-success-band.ts --user=<id> [--path=<pathId>] [--limit=10]
 */
import 'dotenv/config';
import prisma from '../config/database';
import {
  loadCodeJudgedSuccess,
  resolveSuccessBandVerdict,
  SUCCESS_BAND_HIGH,
  SUCCESS_BAND_LOW,
  SUCCESS_BAND_MIN_SAMPLE,
} from '../services/learner/independent-success-band.service';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const userId = arg('user');
  const pathId = arg('path');
  const limit = Math.max(1, Number(arg('limit') ?? 10));
  if (!userId) {
    console.log('[band] 用法：--user=<id> [--path=<pathId>] [--limit=10]');
    return;
  }

  const raw = await loadCodeJudgedSuccess(userId, { pathId });
  const verdict = await resolveSuccessBandVerdict(userId, { pathId });
  console.log(
    `[band] 用户 ${userId}${pathId ? `｜路径 ${pathId}` : ''}\n` +
      `[band] 代码裁决样本 ${raw.sample}（通过 ${raw.passed}）｜成功率 ${raw.rate === null ? 'null' : raw.rate.toFixed(2)}` +
      `｜带 ${SUCCESS_BAND_LOW}–${SUCCESS_BAND_HIGH}｜样本下限 ${SUCCESS_BAND_MIN_SAMPLE}`,
  );
  console.log(`[band] 带判定 = ${verdict.action}（${verdict.reason}）`);

  // 按题型分解：选择题是可靠通道；简答要点判定保守（会低估），只看趋势
  const rows = await prisma.learner_evidence.findMany({
    where: {
      userId,
      evidenceType: 'checkpoint:result',
      ...(pathId ? { pathId } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: 60,
    select: { payload: true, occurredAt: true },
  });
  const byType = new Map<string, { total: number; passed: number; code: number }>();
  for (const row of rows) {
    let parsed: { type?: unknown; passed?: unknown; judgedBy?: unknown } | null = null;
    try {
      parsed = JSON.parse(String(row.payload || '{}')) as { type?: unknown; passed?: unknown; judgedBy?: unknown };
    } catch {
      continue;
    }
    const type = typeof parsed?.type === 'string' ? parsed.type : 'unknown';
    const bucket = byType.get(type) ?? { total: 0, passed: 0, code: 0 };
    bucket.total += 1;
    if (parsed?.passed === true) bucket.passed += 1;
    if (parsed?.judgedBy === 'code') bucket.code += 1;
    byType.set(type, bucket);
  }
  console.log('[band] 按题型（最近 60 条检查点结果）：');
  for (const [type, bucket] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    · ${type.padEnd(14)} 共 ${String(bucket.total).padStart(3)}｜通过 ${String(bucket.passed).padStart(3)}｜其中代码裁决 ${bucket.code}`);
  }

  const anchors = await prisma.learner_evidence.findMany({
    where: { userId, evidenceType: 'task:difficulty:adjustment' },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: { payload: true, occurredAt: true },
  });
  console.log(`[band] 最近 ${anchors.length} 次难度锚点：`);
  for (const anchor of anchors) {
    let parsed: { baseline?: unknown; adjusted?: unknown; direction?: unknown; reasons?: unknown } | null = null;
    try {
      parsed = JSON.parse(String(anchor.payload || '{}')) as { baseline?: unknown; adjusted?: unknown; direction?: unknown; reasons?: unknown };
    } catch {
      continue;
    }
    const reasons: string[] = Array.isArray(parsed?.reasons)
      ? parsed.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [];
    const bandReason = reasons.find((reason) => reason.startsWith('success_rate_'));
    const baseline = `baseline=${Number(parsed?.baseline)}`;
    const adjusted = `adjusted=${Number(parsed?.adjusted)}`;
    const direction = String(parsed?.direction ?? '');
    console.log(
      `    · ${anchor.occurredAt.toISOString().slice(0, 16)} ${baseline} ${adjusted}` +
        ` ${direction}${bandReason ? `  ← ${bandReason}` : ''}`,
    );
  }
  console.log(
    '\n[band] 注：带理由出现 = 这条链真的动了档位；只有知识类理由 = 带还没到样本下限（或落在带内，按设计不动）。',
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}