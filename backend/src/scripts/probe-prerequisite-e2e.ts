/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 前置探测结果接线端到端探针（审计 P0 §1.1）。
 *
 * 同源性：不另写组装路径——
 *   ① 生产者：直接调 `goal-conversation.service.buildGoalPathRequest`（= 确认方案后走的同一个私有方法）
 *   ② 装配：`pathOrchestrator.previewNormalizedGoalInput`（= 生产 generateFromGoal 用的同一装配）
 *   ③ 真生成：`pathOrchestrator.generateFromGoal`（= goal 确认后 `runGoalAsync` 调的那个，真 LLM）
 *   ④ 观测：读本次 path-planning 真实下发的 userPayload，确认探测结果真的进了模型载荷
 *
 * 副作用：会为选定用户建一条真路径；跑完按 id 级联删除（milestones/subtasks/generationRuns 随删）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-prerequisite-e2e.ts [--user=<userId>] [--keep]
 */
import 'dotenv/config';
import prisma from '../config/database';
import pathOrchestrator from '../coordinators/path.coordinator';
import goalConversationService from '../services/learning/goal-conversation.service';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const PROBES = [
  {
    probeId: 'probe-e2e-1',
    targetConcept: '把问题拆成可验证的结构（E2E 探针标记）',
    userAnswer: 'B',
    isCorrect: false,
  },
];

async function pickUserId(): Promise<string> {
  const explicit = arg('user');
  if (explicit) return explicit;
  const vl = await prisma.users.findFirst({
    where: { isVirtualLearner: true } as any,
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!vl) throw new Error('库里没有虚拟学习者；请用 --user=<userId> 指定');
  console.log(`[probe] 使用虚拟学习者 ${vl.id} (${vl.name})`);
  return vl.id;
}

async function main() {
  const userId = await pickUserId();

  const understanding = {
    realProblem: '汇报时被追问逻辑就乱，缺问题框架',
    surfaceGoal: '想学会向上汇报',
    prerequisiteCheckResults: PROBES,
  };
  const conversation = {
    id: `probe-conv-${Date.now()}`,
    userId,
    description: '想学会向上汇报',
    learningPathId: null,
    collectedData: JSON.stringify({ messages: [], understanding, collected: {}, confirmedProposal: null }),
  };
  const aiResponse = {
    userVisible: '好的，我按你说的安排一条从问题结构入手的路径。',
    internal: {
      core: { stage: 'completed', confidence: 0.95, isCompleted: true },
      ext: { goalConversation: { understanding, nextQuestions: [], collected: {} } },
    },
  };

  // ① 生产者（真方法）
  const request: any = await (goalConversationService as any).buildGoalPathRequest(conversation, aiResponse);
  console.log('[probe] ① 请求携带 prerequisiteCheckResults =', JSON.stringify(request.prerequisiteCheckResults));
  if (!Array.isArray(request.prerequisiteCheckResults) || request.prerequisiteCheckResults.length === 0) {
    throw new Error('FAIL：生产者未把探测结果放进 GoalPathRequest');
  }

  // ② 真实装配
  const assembled = await pathOrchestrator.previewNormalizedGoalInput(request);
  const ni = (assembled as any).userProfile.normalizedInput;
  console.log('[probe] ② normalizedInput.prerequisiteCheckResults =', JSON.stringify(ni.prerequisiteCheckResults));
  if (!Array.isArray(ni.prerequisiteCheckResults) || ni.prerequisiteCheckResults[0]?.probeId !== 'probe-e2e-1') {
    throw new Error('FAIL：装配后丢失探测结果');
  }

  // ③ 真生成（真 LLM）
  const before = await prisma.prompt_call_logs.count({ where: { agentId: 'skill:path-planning' } });
  const startedAt = new Date();
  const generated: any = await pathOrchestrator.generateFromGoal(request);
  const pathId = generated?.id || generated?.path?.id || null;
  console.log('[probe] ③ 生成结果 pathId =', pathId, '| milestones =', generated?.milestones?.length ?? 'n/a');

  // ④ 观测真实下发的模型载荷
  const calls = await prisma.prompt_call_logs.findMany({
    where: { agentId: 'skill:path-planning', createdAt: { gte: startedAt } },
    select: { id: true, success: true, userPayload: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  const after = await prisma.prompt_call_logs.count({ where: { agentId: 'skill:path-planning' } });
  const hit = calls.find((c) => (c.userPayload || '').includes('probe-e2e-1'));
  console.log(`[probe] ④ path-planning 调用：新增 ${after - before} 条；载荷含探测标记 = ${hit ? 'YES' : 'NO'}`);
  if (hit) {
    const snippet = (hit.userPayload || '').split('\n').filter((l) => l.includes('prerequisiteCheckResults')).slice(0, 6);
    console.log('[probe] 载荷片段：');
    snippet.forEach((l) => console.log('    ' + l.trim().slice(0, 200)));
  } else if (calls[0]) {
    const idx = (calls[0].userPayload || '').indexOf('prerequisiteCheckResults');
    console.log('[probe] 载荷中 prerequisiteCheckResults 位置 =', idx, '（-1 表示未下发）');
  }

  // 清理
  if (pathId && !hasFlag('keep')) {
    try {
      await prisma.learning_paths.delete({ where: { id: pathId } });
      console.log('[probe] 已清理测试路径', pathId);
    } catch (error) {
      console.log('[probe] 清理失败（请手工删）:', pathId, (error as Error).message);
    }
  } else if (pathId) {
    console.log('[probe] --keep：保留路径', pathId);
  }

  const verdict = Boolean(hit) && Array.isArray(generated?.milestones);
  console.log(verdict ? '[probe] PASS 探测结果已进真实模型载荷' : '[probe] CHECK 见上方逐项输出');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
