/**
 * 传感器一致性回看（**只读**，不调 LLM、不写库）
 *
 * 用途（§7 P1-1 + 走查 P2 的副产品）：检查点自 2026-09-17 起由**代码裁决**
 * （答案键，`judgedBy='code'`，置信度 0.95），而同一轮模型还给出一个**自评**
 * （`analysis.understanding`）。两个传感器一不一致，是"代码裁决该不该当地基"
 * 的直接证据：
 *  - **自评高但判错** = 模型高估 → 若拿自评当传感器，难度带会被拖向升档（危险）
 *  - **自评低但判对** = 模型低估 → 会把带拖向降档（浪费）
 * 一致率越低，越应坚持"只有代码裁决进带，模型派生项单独记账"。
 *
 * 数据来源：`learner_evidence(evidenceType='checkpoint:result')` 的
 * `payload.judgedBy / passed / type`，配对同一会话里「理解检查：…」那条用户消息
 * **之后**那条助手消息的 `analysis.understanding`。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-judge-agreement.ts [--user=<id>] [--limit=20] [--threshold=0.6] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

interface CheckpointResult {
  sessionId: string;
  checkpointId: string;
  type: string;
  passed: boolean;
  judgedBy: string;
  occurredAt: Date;
  understanding: number | null;
}

/** 取「理解检查：…」之后那条助手消息的 understanding（配对不到就 null） */
function findSelfAssessment(messages: unknown, submittedAt: Date): number | null {
  if (!Array.isArray(messages)) return null;
  const list = messages as Array<{ role?: string; content?: string; timestamp?: string; analysis?: { understanding?: unknown } }>;
  let judgeIndex = -1;
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    if (m?.role !== 'user' || typeof m.content !== 'string' || !m.content.includes('理解检查')) continue;
    const at = m.timestamp ? new Date(m.timestamp).getTime() : NaN;
    // 允许 5 分钟时钟差：判定落库时刻与消息时刻不必严格相等
    if (Number.isFinite(at) && at <= submittedAt.getTime() + 5 * 60 * 1000) judgeIndex = i;
  }
  if (judgeIndex < 0) return null;
  for (let i = judgeIndex + 1; i < list.length; i += 1) {
    const u = list[i]?.analysis?.understanding;
    if (typeof u === 'number' && Number.isFinite(u)) return u;
  }
  return null;
}

async function main() {
  const userId = arg('user');
  const limit = Number(arg('limit') ?? 50);
  const threshold = Number(arg('threshold') ?? 0.6);
  const asJson = process.argv.includes('--json');

  const rows = await prisma.learner_evidence.findMany({
    where: { evidenceType: 'checkpoint:result', ...(userId ? { userId } : {}) },
    orderBy: { occurredAt: 'desc' },
    take: Number.isFinite(limit) && limit > 0 ? limit : 50,
  });

  const results: CheckpointResult[] = [];
  const sessionCache = new Map<string, Array<{ role?: string; content?: string; timestamp?: string; analysis?: { understanding?: unknown } }>>();

  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(row.payload ?? '{}'));
    } catch {
      continue;
    }
    const sessionId = row.sessionId ?? '';
    if (!sessionId) continue;

    if (!sessionCache.has(sessionId)) {
      const session = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { messages: true } });
      let parsed: unknown = [];
      try {
        parsed = JSON.parse(String(session?.messages ?? '[]'));
      } catch {
        parsed = [];
      }
      sessionCache.set(sessionId, Array.isArray(parsed) ? parsed as never : []);
    }

    results.push({
      sessionId,
      checkpointId: String(payload.checkpointId ?? ''),
      type: String(payload.type ?? 'unknown'),
      passed: payload.passed === true,
      judgedBy: String(payload.judgedBy ?? 'unknown'),
      occurredAt: row.occurredAt,
      understanding: findSelfAssessment(sessionCache.get(sessionId), row.occurredAt),
    });
  }

  const paired = results.filter((r) => r.understanding !== null);
  const overestimate = paired.filter((r) => (r.understanding as number) >= threshold && !r.passed);
  const underestimate = paired.filter((r) => (r.understanding as number) < threshold && r.passed);
  const agreed = paired.length - overestimate.length - underestimate.length;
  const agreementRate = paired.length > 0 ? agreed / paired.length : null;
  const byJudge = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.judgedBy] = (acc[r.judgedBy] ?? 0) + 1;
    return acc;
  }, {});
  const byType = paired.reduce<Record<string, { paired: number; agreed: number }>>((acc, r) => {
    const key = r.type;
    acc[key] = acc[key] ?? { paired: 0, agreed: 0 };
    acc[key].paired += 1;
    const isAgree = ((r.understanding as number) >= threshold) === r.passed;
    if (isAgree) acc[key].agreed += 1;
    return acc;
  }, {});

  const report = {
    scope: { userId: userId ?? '(全部用户)', limit, threshold, sampled: results.length },
    judgedByDistribution: byJudge,
    paired: paired.length,
    unpaired: results.length - paired.length,
    agreement: {
      agreed,
      rate: agreementRate === null ? null : Number(agreementRate.toFixed(3)),
      overestimate: overestimate.length,
      underestimate: underestimate.length,
    },
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, rate: Number((v.agreed / v.paired).toFixed(3)) }])),
    disagreements: [...overestimate, ...underestimate].slice(0, 8).map((r) => ({
      session: r.sessionId.slice(0, 40),
      checkpointId: r.checkpointId,
      type: r.type,
      judgedBy: r.judgedBy,
      passed: r.passed,
      selfAssessment: r.understanding,
      direction: (r.understanding as number) >= threshold ? '模型高估（自评≥阈值但判错）' : '模型低估（自评<阈值但判对）',
    })),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('== 传感器一致性回看（代码裁决 vs 模型自评） ==');
  console.log(`范围：${report.scope.userId} · 取最近 ${limit} 条 · 阈值 ${threshold}`);
  console.log(`样本：${results.length} 条 checkpoint:result｜渠道分布 ${JSON.stringify(byJudge)}`);
  console.log(`可配对（找到同轮自评）：${paired.length}｜不可配对：${report.unpaired}`);
  if (agreementRate === null) {
    console.log('一致率：—（还没有可配对的样本）');
  } else {
    console.log(`一致率：${(agreementRate * 100).toFixed(1)}%（一致 ${agreed}）`);
    console.log(`  模型高估：${overestimate.length} 条（自评≥${threshold} 但判错）`);
    console.log(`  模型低估：${underestimate.length} 条（自评<${threshold} 但判对）`);
  }
  for (const [type, v] of Object.entries(report.byType)) {
    console.log(`  题型 ${type}：配对 ${v.paired}｜一致率 ${(v.rate * 100).toFixed(1)}%`);
  }
  if (report.disagreements.length > 0) {
    console.log('— 不一致样本（最多 8 条）—');
    for (const d of report.disagreements) {
      console.log(`  ${d.direction}｜${d.type}｜judgedBy=${d.judgedBy}｜self=${d.selfAssessment}｜passed=${d.passed}｜cp=${d.checkpointId}`);
    }
  }
  console.log('说明：代码裁决（judgedBy=code）才进成功率带；模型派生项只作对照，不进带。');
}

main()
  .catch((error) => {
    console.error('[audit-judge-agreement] 失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
