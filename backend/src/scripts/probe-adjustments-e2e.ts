/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 用户「补充说明重新生成」端到端探针（审计 P1 §2.2a / §2.2c）。
 *
 * 用户可见功能：路径页填「补充说明」→ 重新生成时按说明调整。链路本应是
 *   GoalPathRequest.adjustments → coordinator（goalFinalPayload/normalizedInput）→ skill 载荷
 *   → core 规则消费 normalizedInput.understanding.adjustments。
 * 实际两处断裂：① buildNormalizedInputV1 不产出 understanding；② skill 的输入投影是逐字段白名单，
 * 会把 understanding 静默丢掉 ⇒ 规则永无输入、功能无效。
 *
 * 本探针全走生产函数：previewNormalizedGoalInput（真装配）→ buildPathAgentInput（真装配）
 * → executeSkill(pathAgentDefinition)（真 skill + 真 LLM），并读回真实下发的 userPayload。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-adjustments-e2e.ts [--user=<userId>]
 */
import 'dotenv/config';
import prisma from '../config/database';
import pathOrchestrator from '../coordinators/path.coordinator';
import { executeSkill } from '../skills';
import { pathAgentDefinition } from '../skills/path-planning';
import { buildPathAgentInput } from '../services/learning/generation/path-generation.core';
import { buildFramedNormalizedInput } from '../services/learning/path-planning-hints';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const ADJUSTMENT = '第二阶段太难了，我想先把基础补牢一点，每天只有 30 分钟。';

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

  // ① 真实装配（含用户补充说明）
  const assembled: any = await pathOrchestrator.previewNormalizedGoalInput({
    userId,
    rawGoal: '想学会向上汇报',
    visibleSummary: {
      surfaceGoal: '想学会向上汇报',
      realProblem: '汇报被追问逻辑就乱，缺问题框架',
      resources: { timeBudget: '每周5小时', timeHorizon: '1个月+', timePerSession: '45分钟' },
      confirmedProposal: { learningDirection: '汇报逻辑框架', keyStages: ['识别问题结构', '建立汇报框架', '实战汇报'] },
    },
    adjustments: ADJUSTMENT,
  } as any);
  const ni = assembled.userProfile.normalizedInput;
  console.log('[probe] ① 装配后 normalizedInput.understanding =', JSON.stringify(ni.understanding ?? null));
  if (ni.understanding?.adjustments !== ADJUSTMENT) {
    console.log('[probe] FAIL 装配层未把 adjustments 放进 normalizedInput.understanding');
    return;
  }

  // ② 生产装配 + 真实 skill 调用
  const data: any = { userId, description: '想学会向上汇报', userProfile: assembled.userProfile };
  const agentInput = buildPathAgentInput(data);
  const framed = buildFramedNormalizedInput(ni);
  agentInput.metadata = { ...(agentInput.metadata || {}), normalizedInput: framed };
  console.log('[probe] ② framing 后 understanding =', JSON.stringify((framed as any)?.understanding ?? null));

  const startedAt = new Date();
  const result = await executeSkill(pathAgentDefinition, { input: agentInput, context: { userId } });
  const payload = (result as any)?.path || (result as any)?.internal?.ext?.path?.path || null;
  console.log('[probe] ③ 生成 name =', payload?.name ?? '(无输出)', '| milestones =', payload?.milestones?.length ?? 'n/a');

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const calls = await prisma.prompt_call_logs.findMany({
    where: { agentId: 'skill:path-planning', createdAt: { gte: startedAt } },
    select: { userPayload: true },
    orderBy: { createdAt: 'desc' },
  });
  const text = calls[0]?.userPayload || '';
  const hasKey = text.includes('"adjustments"');
  const hasText = text.includes(ADJUSTMENT);
  console.log(`[probe] ④ 载荷含 "adjustments" 键 = ${hasKey} | 含补充说明原文 = ${hasText}`);

  console.log(hasKey && hasText
    ? '[probe] PASS 用户补充说明已进真实模型载荷'
    : '[probe] FAIL 补充说明未进载荷');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
