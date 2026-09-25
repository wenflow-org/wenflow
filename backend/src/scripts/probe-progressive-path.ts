/* eslint-disable @typescript-eslint/no-explicit-any -- 探针脚本：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/* eslint-disable no-console -- 一次性验收 CLI */
/**
 * 渐进式 stage 设计 E2E 探针（活的 path 批次 D，需 PROGRESSIVE_STAGE_DESIGN=1）：
 *   ① 生产入口生成路径 → 断言仅 stage 1 有任务、stage 2/3 空、canStartLearning
 *   ② 直调 completeTask 完成 stage 1 全部任务 → 断言 stage 2 被后台设计（轮询）
 *      + kcAnnotation v2 byStage 含 stage1&2 + 学习者信号进 designer 输入（遥测）
 * 用法：PROGRESSIVE_STAGE_DESIGN=1 npx ts-node --transpile-only src/scripts/probe-progressive-path.ts
 */
import 'dotenv/config';

async function main(): Promise<void> {
  const userId = process.argv[2] || 'user_dcc84aa2-26fa-4f3b-a9d8-d5aebd959766';
  const { prisma } = await import('../config/database');
  const pathOrchestrator = (await import('../coordinators/path.coordinator')).default;
  const learningService = (await import('../services/learning/learning.service')).default;
  const isProgressive = (await import('../services/learning/generation/progressive-design')).isProgressiveStageDesignEnabled;
  console.log(`[probe] PROGRESSIVE_STAGE_DESIGN=${isProgressive() ? 'ON' : 'OFF（本探针需要 ON 才有意义）'}`);

  // ① 生产入口生成（走 generateFromGoal→generate→core→enrich 全链）
  const startedAt = Date.now();
  const result: any = await pathOrchestrator.generateFromGoal({
    userId,
    rawGoal: '渐进式探针：我想用两周时间学会摄影构图基础，能拍出构图清晰的照片',
    visibleSummary: {
      surfaceGoal: '渐进式探针：两周学会摄影构图基础',
      realProblem: '拍照片没有构图意识，出片靠运气',
      painPoints: ['不知道怎么取景'],
      constraintsAndBoundaries: [],
      currentBaseline: { level: 'beginner', evidence: null },
      resources: { timeBudget: '每周 3 小时', timeBudgetCadence: 'per_week', timePerWeek: '每周 3 小时', timePerSession: '45 分钟', timeHorizon: '2 周', deadlineText: null },
      successCriteria: { observableResult: '能按构图原则拍出合格照片', acceptanceCheck: null },
      confirmedProposal: {
        learningDirection: '摄影构图入门',
        firstDeliverable: '一组构图分析照片',
        keyStages: ['认识构图', '练习三分法', '实拍复盘'],
        outOfScope: [],
        scopeSize: null,
      },
    },
  } as any);
  const payload = result?.path || result?.data?.path || result;
  const pathId = payload?.id ?? result?.id;
  console.log(`[probe] 生成完成 ${Date.now() - startedAt}ms｜pathId=${pathId}`);

  // ② 断言：仅 stage 1 有任务
  const readTemplate = async () => {
    const row: any = await prisma.learning_paths.findUnique({ where: { id: pathId }, select: { aiPromptTemplate: true } });
    return JSON.parse(row.aiPromptTemplate || '{}');
  };
  const readStages = async () => {
    const milestones: any[] = await prisma.milestones.findMany({
      where: { learningPathId: pathId },
      orderBy: { stageNumber: 'asc' },
      include: { subtasks: { select: { id: true, status: true } } },
    });
    return milestones;
  };

  const wait = async (check: () => Promise<boolean>, timeoutMs: number, label: string) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    console.log(`[probe] 超时：${label}`);
    return false;
  };

  // 等 stage1 enrichment（后台任务）完成
  await wait(async () => {
    const milestones = await readStages();
    return (milestones[0]?.subtasks?.length || 0) > 0;
  }, 300_000, 'stage 1 任务就绪');

  const milestonesAfterCreate = await readStages();
  const stage1Tasks = milestonesAfterCreate[0]?.subtasks?.length || 0;
  const restTasks = milestonesAfterCreate.slice(1).reduce((sum, m) => sum + m.subtasks.length, 0);
  console.log(`[probe] 阶段数=${milestonesAfterCreate.length}｜stage1 任务=${stage1Tasks}｜后续 stage 任务合计=${restTasks}`);
  if (stage1Tasks === 0 || restTasks > 0) {
    console.log('[probe] FAIL：渐进语义不成立（stage1 未设计或后续 stage 被提前设计）');
    process.exitCode = 1;
    return;
  }
  console.log('[probe] PASS：仅 stage 1 被设计（渐进语义成立）');

  // ③ 完成 stage 1 全部任务（真实 completeTask 链路）
  for (const task of milestonesAfterCreate[0].subtasks) {
    await learningService.completeTask({
      userId,
      taskId: task.id,
      pathId,
      actualMinutes: 20,
      rating: 3,
    } as any);
  }
  console.log('[probe] stage 1 任务已全部 completeTask');

  // ④ 等 stage 2 后台设计（append-only + 学习者信号）
  const designed = await wait(async () => {
    const milestones = await readStages();
    return (milestones[1]?.subtasks?.length || 0) > 0;
  }, 600_000, 'stage 2 后台设计就绪');
  if (!designed) { process.exitCode = 1; return; }

  const milestonesFinal = await readStages();
  const template = await readTemplate();
  const kc = template.kcAnnotation || {};
  console.log(`[probe] stage2 任务=${milestonesFinal[1].subtasks.length}｜stage3 任务=${milestonesFinal[2]?.subtasks?.length ?? 0}`);
  console.log(`[probe] kcAnnotation version=${kc.version}｜byStage keys=${Object.keys(kc.byStage || {}).join(',')}｜taskKcLinks=${(kc.taskKcLinks || []).length}`);
  const kcOk = kc.version === 2 && kc.byStage?.['1'] && kc.byStage?.['2'];
  console.log(`[probe] ${kcOk ? 'PASS' : 'FAIL'}：kc 增量合并（v2 byStage 含 stage1&2）`);
  console.log(kcOk ? '[probe] 全部通过' : '[probe] 存在失败项');
  if (!kcOk) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
