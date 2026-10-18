/**
 * #55 带预算锚的路径 pilot（2026-10-18）。
 *
 * 与 ab-goal-path 的差别：显式传 visibleSummary.resources + timeDimensions.estimatedHours，
 * 让 path-planning 产出 budgetConservation（target/capacitySum/after），从而可算 ratio / ratioCap。
 *
 * 预算口径（明示假设，非人设卡）：
 * - 备考类按「每天 1 小时 × 3 个月 ≈ 84h」；半年/一年类按 180h/240h 上限；
 * - 短周期兴趣/技能类按 60-84h。
 *
 * 用法：cd backend && npx ts-node -T scripts/pilot55-budgeted.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../src/config/database';
import pathCoordinator from '../src/coordinators/path.coordinator';

const GOALS = [
  { id: 'safety-engineer', rawGoal: '我要备考中级注册安全工程师，半年内系统学完《安全生产管理》，能对上考试大纲的重点章节。', hours: 180, weeks: 24 },
  { id: 'cpa-accounting', rawGoal: '我想在一年内通过注册会计师的专业阶段考试，先从会计和审计两科开始，需要按大纲把重点章节排出来。', hours: 240, weeks: 48 },
  { id: 'high-school-history', rawGoal: '我是高中历史老师，想利用暑假把中外历史纲要（上）通读一遍，梳理出可以上课的单元脉络和关键概念。', hours: 80, weeks: 8 },
  { id: 'german-a2', rawGoal: '我计划四个月后考 Goethe-Zertifikat A2，需要按主题掌握词汇并用德语做简单日常交流。', hours: 120, weeks: 16 },
  { id: 'feline-nursing', rawGoal: '我是宠物医院的新手护士，想系统学习猫科动物的生命周期照护要点，用于日常门诊护理。', hours: 60, weeks: 12 },
  { id: 'agile-pm', rawGoal: '公司要推敏捷转型，我需要系统学习敏捷实践指南，能主持迭代计划会和回顾会。', hours: 84, weeks: 12 },
  { id: 'systematic-review', rawGoal: '我要写一篇系统综述，想学会 Cochrane 手册里的检索、偏倚评估和证据合成方法。', hours: 84, weeks: 12 },
  { id: 'fire-code', rawGoal: '我在做建筑消防设计，需要把建筑设计防火规范 GB 50016 的条文体系学清楚，能按建筑类别查要求。', hours: 84, weeks: 12 },
  { id: 'civil-code', rawGoal: '我想系统学习民法典合同编，能判断常见合同的成立、效力和违约责任。', hours: 84, weeks: 12 },
  { id: 'child-development', rawGoal: '我是幼儿园老师，想弄懂《3-6岁儿童学习与发展指南》对五大领域的发展要求，用来观察和评价班里孩子。', hours: 84, weeks: 12 },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createUser(label: string): Promise<string> {
  const id = `ab55_${label}_${crypto.randomUUID().slice(0, 8)}`.slice(0, 60);
  await prisma.users.create({
    data: {
      id,
      email: `${id}@ab.local`,
      name: label,
      password: crypto.randomUUID(),
      updatedAt: new Date(),
      onboardingCompleted: true,
    },
  });
  return id;
}

async function waitSettled(pathId: string, timeoutMs = 300_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await prisma.learning_paths.findUnique({ where: { id: pathId }, select: { status: true } });
    const milestoneIds = (await prisma.milestones.findMany({ where: { learningPathId: pathId }, select: { id: true } })).map((m) => m.id);
    const tasks = await prisma.subtasks.count({ where: { milestoneId: { in: milestoneIds } } });
    if (tasks > 0 || row?.status === 'failed') return;
    await sleep(3000);
  }
}

function visibleSummary(goal: (typeof GOALS)[number]) {
  return {
    surfaceGoal: goal.rawGoal,
    realProblem: null,
    motivation: null,
    urgency: null,
    backgroundExperience: null,
    learningSignal: null,
    goalOrientation: null,
    painPoints: [],
    constraintsAndBoundaries: [],
    scenario: null,
    currentPainPoint: null,
    currentBaseline: { level: 'beginner', evidence: null },
    resources: {
      timeBudget: '每天 1 小时',
      timeBudgetCadence: 'per_day',
      timePerWeek: null,
      timePerSession: '1 小时',
      timeHorizon: goal.weeks >= 24 ? '半年' : goal.weeks >= 16 ? '4 个月' : '3 个月',
      deadlineText: null,
      deadlineDate: null,
    },
    timeDimensions: {
      totalWeeks: goal.weeks,
      estimatedHours: goal.hours,
      sessionsPerWeek: 5,
      sessionsLengthMin: 60,
    },
    schoolAnchor: null,
    needsMaterial: null,
  };
}

async function main() {
  const results: any[] = [];
  for (let index = 0; index < GOALS.length; index += 1) {
    const goal = GOALS[index];
    const startedAt = Date.now();
    const userId = await createUser(`pilot55-${goal.id}`);
    let pathId: string | null = null;
    let error: string | null = null;
    try {
      await pathCoordinator.generateFromGoal({
        userId,
        rawGoal: goal.rawGoal,
        source: 'goal',
        visibleSummary: visibleSummary(goal) as any,
      });
      const row = await prisma.learning_paths.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      pathId = row?.id || null;
      if (pathId) await waitSettled(pathId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const record = pathId
      ? await prisma.learning_paths.findUnique({ where: { id: pathId }, select: { id: true, title: true, estimatedHours: true, aiPromptTemplate: true } })
      : null;
    let bc: any = null;
    try {
      bc = record ? JSON.parse(record.aiPromptTemplate || '{}').budgetConservation : null;
    } catch {
      bc = null;
    }
    const target = Number(bc?.target) || null;
    const capacity = Number(bc?.capacitySum) || null;
    const delivered = Number(bc?.after) || Number(record?.estimatedHours) || null;
    results.push({
      goal: goal.id,
      pathId,
      ms: Date.now() - startedAt,
      targetHours: target,
      capacityHours: capacity,
      deliveredHours: delivered,
      ratio: target && delivered ? Number((delivered / target).toFixed(3)) : null,
      ratioCap: capacity && delivered ? Number((delivered / capacity).toFixed(3)) : null,
      clampReason: bc?.clampReason || null,
      error,
    });
    const last = results[results.length - 1];
    console.log(`(${index + 1}/${GOALS.length}) ${goal.id}｜${pathId || '-'}｜锚 ${target}h / 容量 ${capacity}h → ${delivered}h｜ratio ${last.ratio} / cap ${last.ratioCap}｜${error || 'ok'}`);
  }
  const usable = results.filter((item) => item.ratio !== null);
  const gap = usable.filter((item) => item.ratio < 0.6 && (item.ratioCap === null || item.ratioCap < 0.8));
  const summary = {
    generatedAt: new Date().toISOString(),
    goals: GOALS.length,
    usable: usable.length,
    ratioBelow60: usable.filter((item) => item.ratio < 0.6).length,
    trueGap: gap.length,
    trueGapRate: usable.length ? Number((gap.length / usable.length).toFixed(3)) : null,
    verdict: usable.length && gap.length / usable.length > 0.4 ? '成立（>40%）' : '不成立（<=40%）',
    results,
  };
  fs.writeFileSync(path.join(__dirname, 'pilot55-budgeted-result.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log('SUMMARY', JSON.stringify({ usable: summary.usable, below60: summary.ratioBelow60, gap: summary.trueGap, rate: summary.trueGapRate, verdict: summary.verdict }));
}

main()
  .catch((error) => {
    console.error('PILOT55_FAILED', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
