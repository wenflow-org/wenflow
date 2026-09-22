/* eslint-disable no-console -- 一次性触发 CLI：验证 kc-mapper 修复后 KC 图是否落库 */
/**
 * 触发一次完整路径生成（生产同款函数 GoalConversationService.quickGeneratePath）：
 * 核心生成（path-planning → path-reviewer）+ 后台 stage 设计 + kc-mapper 落库。
 *
 * ⚠️ 关键：stage 阶段由 path-generation.core.ts:995 以 runBackgroundTask 注册在
 * **本进程**后台跑，脚本必须等它完成再退出，否则后台任务被 process.exit 掐断
 * （2026-09-22 首次验证就踩过：核心生成成功但 0 子任务、kc-mapper 从未被调用）。
 * 完成信号：路径 aiPromptTemplate._generation.kcMapping（stage 任务最终事务才写它）。
 */
import 'dotenv/config';
import prisma from '../config/database';
import { backgroundTaskTracker } from '../services/background-task-tracker.service';
import goalConversationService from '../services/learning/goal-conversation.service';

const USER_ID = process.env.TRIGGER_USER_ID || 'user_30a97921-8fcf-454c-801a-9983dc83db1c';
const POLL_TIMEOUT_MS = Number(process.env.TRIGGER_POLL_TIMEOUT_MS || 300_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForStagePhase(pathId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    const row = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { aiPromptTemplate: true },
    });
    const tpl = JSON.parse(row?.aiPromptTemplate || '{}');
    const subtasks = await prisma.subtasks.count({ where: { milestones: { learningPathId: pathId } } });
    const state = `子任务=${subtasks} kcMapping=${tpl._generation?.kcMapping ?? '(未到)'}`;
    if (state !== last) {
      console.log(`[stage] ${state}`);
      last = state;
    }
    if (tpl._generation?.kcMapping) return;
    await sleep(5000);
  }
  console.log(`[stage] 等待超时（${POLL_TIMEOUT_MS / 1000}s），最后状态: ${last}`);
}

async function main() {
  const started = Date.now();
  console.log(`[trigger] 开始生成 userId=${USER_ID}`);
  const result = await goalConversationService.quickGeneratePath(USER_ID, {
    goal: '明天上午 10 点要用 Excel 给 300 行的销售明细按日期和品类分类汇总，现在只会最基础的求和',
    level: 'beginner',
    timePerDay: '1 小时',
    learningStyle: 'mixed',
  });
  const pathId = result?.internal?.core?.learningPath?.id;
  console.log(`[trigger] 核心生成完成 pathId=${pathId} name=${result?.internal?.core?.learningPath?.name} 耗时=${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!pathId) return;

  await waitForStagePhase(pathId);
  await backgroundTaskTracker.drain().catch(() => undefined);

  const row = await prisma.learning_paths.findUnique({ where: { id: pathId }, select: { aiPromptTemplate: true } });
  const tpl = JSON.parse(row?.aiPromptTemplate || '{}');
  const ann = tpl.kcAnnotation;
  console.log(`[verify] kcAnnotation=${ann ? '已落库' : 'null'}` +
    (ann ? ` conceptKcs=${ann.conceptKcs?.length ?? 0} taskKcLinks=${ann.taskKcLinks?.length ?? 0} edges=${ann.kcGraph?.edges?.length ?? 0}` : '') +
    ` | kcMapping=${tpl._generation?.kcMapping ?? '-'}`);
  console.log(`[trigger] 全流程耗时=${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[trigger] 失败:', e); process.exit(1); });
