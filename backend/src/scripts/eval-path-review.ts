/**
 * 单点测试（**只读，不覆写**）：对指定/最近一条真实路径调用 path-reviewer skill，
 * 必要时（`--replan`）再 dry 跑一次"重规划生成"，用于判断路径重排这条链是否可用。
 *
 * 两个 skill 都真实调用（LLM）；**不写任何库**：重规划结果只打印、不落盘。
 *
 * 结论（2026-09-16 实测，虚拟学习者 7b6f67bf 的「二建实务双代号总时差厘清」）：
 * - path-reviewer：score 0.85~0.90、passed=true、五维评分正常，还会诚实指出"learnerProfile 为 null"；
 *   `replanInstructions=null` → **该路径质量达标，自动重规划分支不会触发**；
 * - 重规划生成（--replan，注入 reviewerFeedback）：67s、产出 3 个阶段，形状为 `{stage, name, ...}`
 *   （持久化层用 `name || title || goal` 兼容两种键形）；
 * - 生产里的自动重排只在**新路径生成**时由评审触发（`triggerSource: 'path-reviewer'`）；
 *   学习状态驱动的重排走 `learning.service` 的 preview + 人工确认流（`requireConfirmation`），
 *   即"路径重排"是**确认制**，不是自动改路径。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-path-review.ts --user=<ID>
 *   npx ts-node --transpile-only src/scripts/eval-path-review.ts --user=<ID> --replan
 */
import 'dotenv/config';
import prisma from '../config/database';
import { executeSkill } from '../skills';
import { pathReviewerDefinition } from '../skills/path-reviewer';
import learningService from '../services/learning/learning.service';

function parseArgs(argv: string[]): { userId: string | null } {
  let userId: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--user=')) userId = arg.slice(7).trim() || null;
    else if (arg === '--replan') continue;
    else if (arg) throw new Error(`未知参数：${arg}`);
  }
  return { userId };
}

async function main(): Promise<void> {
  const { userId: requested } = parseArgs(process.argv.slice(2));

  // 选一条"有里程碑+任务"的路径（默认取任务最多的那条）
  const path = requested
    ? await prisma.learning_paths.findFirst({ where: { userId: requested }, orderBy: { createdAt: 'desc' } })
    : await prisma.learning_paths.findFirst({
        where: { status: { in: ['active', 'completed'] } },
        orderBy: { createdAt: 'desc' },
      });
  if (!path) throw new Error('没有可用路径（请用 --user= 指定学习者）');

  const userId = path.userId;
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true, isVirtualLearner: true } });
  const milestones = await prisma.milestones.findMany({
    where: { learningPathId: path.id },
    orderBy: { stageNumber: 'asc' },
    include: { subtasks: { orderBy: { order: 'asc' }, select: { title: true, cognitiveLoad: true, estimatedMinutes: true } } },
  });
  const goal = await prisma.learning_goals.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { description: true, title: true } });
  const template = (() => { try { return JSON.parse(path.aiPromptTemplate || '{}'); } catch { return {}; } })();

  console.log(`[eval] 学习者 ${(user?.name || userId).slice(0, 16)}（虚拟=${user?.isVirtualLearner === true}）`);
  console.log(`[eval] 路径「${path.title}」｜里程碑 ${milestones.length} 个｜任务 ${milestones.reduce((sum, m) => sum + m.subtasks.length, 0)} 个｜状态 ${path.status}`);
  console.log(`[eval] 目标：${goal?.description?.slice(0, 60) || '(无 goal 记录)'}`);

  // 与 learning.service 的调用形态保持一致（pathPlan / goalContext / prerequisiteTree）
  const pathPlan = {
    name: path.title,
    summary: template.summary || path.description || '',
    cognitiveCore: template.cognitiveCore || template.cognitiveDesign || null,
    estimatedHours: path.estimatedHours ?? null,
    milestones: milestones.map((milestone) => ({
      stageNumber: milestone.stageNumber,
      title: milestone.title,
      description: milestone.description,
      goal: milestone.goal,
      estimatedHours: milestone.estimatedHours,
      tasks: milestone.subtasks.map((task) => task.title),
    })),
  };

  const startedAt = Date.now();
  const result = await executeSkill(pathReviewerDefinition, {
    pathPlan,
    goalContext: {
      surfaceGoal: goal?.description || path.title,
      confirmedProposal: null,
      learnerProfile: null,
    },
    prerequisiteTree: (pathPlan.cognitiveCore as any)?.prerequisiteTree,
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  // 注意：executeSkill 直接返回 output（不带 {success,output} 包装）
  const review: any = (result && (result.output ?? result)) || {};
  console.log(`[eval] 耗时 ${elapsed}s｜score=${review.score} passed=${review.passed}`);
  console.log('[eval] 五维评分:', JSON.stringify(review.dimensions || {}));
  for (const issue of (review.issues || []).slice(0, 5)) {
    console.log(`  - [${issue?.dimension || '?'}] ${String(issue?.problem || issue?.description || issue).slice(0, 120)}`);
  }
  console.log('[eval] 重规划指令:', review.replanInstructions ? String(review.replanInstructions).slice(0, 400) : '(未给出／路径通过)');

  // ── 可选：dry 调用"重规划生成"（LLM），只打印不落盘（--replan）
  if (!process.argv.includes('--replan')) return;
  const feedback = review.replanInstructions
    || `按 CIDPP 评审意见收紧本路径：${(review.issues || []).map((issue: any) => issue?.dimension || issue?.problem).filter(Boolean).slice(0, 3).join('；') || '提高完整性（补前置/验收）'}`;
  console.log(`
[eval] dry 重规划生成（不落盘）｜reviewerFeedback=${String(feedback).slice(0, 120)}`);
  const startReplan = Date.now();
  try {
    const replanned = await (learningService as any).analyzePathWithAgent({
      userId,
      description: goal?.description || path.title,
      source: 'replan',
      mode: 'replan',
      userProfile: {
        replan: { triggerSource: 'path-reviewer', reviewerFeedback: feedback },
      },
    });
    const stages = replanned?.suggestedMilestones || [];
    console.log(`[eval] 重规划耗时 ${((Date.now() - startReplan) / 1000).toFixed(1)}s｜新方案阶段数 ${stages.length}`);
    for (const stage of stages.slice(0, 5)) {
      console.log(`  ${stage?.stage ?? stage?.stageNumber ?? '?'}. ${stage?.name || stage?.title || '(无标题)'}｜任务 ${Array.isArray(stage?.tasks) ? stage.tasks.length : (Array.isArray(stage?.subtasks) ? stage.subtasks.length : '?')}`);
    }
  } catch (error) {
    console.log('[eval] 重规划生成失败：', error instanceof Error ? error.message : String(error));
  }
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
