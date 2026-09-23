/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 自动重规划载荷端到端探针（审计 P0 §1.3）。
 *
 * 背景：path-reviewer 判 passed=false 时会在 `generate()` 内部触发一次自动重规划，
 * 给 replan 对象写 `triggerSource` / `reviewerFeedback`（path-generation.core.ts）。
 * 此前载荷**从不渲染** reviewerFeedback、也没有旧路径可对照 ⇒ 规则「逐条修正评审反馈」失效，
 * 重规划退化成「同样输入的再次采样」。
 *
 * 为什么不用「跑一条真路径等评审否决」：评审通过与否是随机的（实测同输入一次否决、一次通过），
 * 靠它触发会得到时有时无的样本。本探针改为**确定性地**构造评审否决后的 replan 对象
 * （键与 path-generation.core.ts 注入的完全一致），其余全部走生产函数：
 *   buildPathAgentInput（生产装配）→ executeSkill(pathAgentDefinition)（真 skill + 真 LLM），
 * 再读回本次真实下发的 userPayload，确认两个分区都在。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-replan-payload-e2e.ts [--user=<userId>]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { executeSkill } from '../skills';
import { pathAgentDefinition } from '../skills/path-planning';
import { buildPathAgentInput } from '../services/learning/generation/path-generation.core';
import { buildFramedNormalizedInput } from '../services/learning/path-planning-hints';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

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

/** 与 path-generation.core.ts 评审否决分支注入的 replan 键完全一致。 */
const REVIEWER_FEEDBACK = '1. 在 milestone-1 之前新增一个阶段，显式覆盖前置概念「把问题拆成可验证的结构」；'
  + '2. milestone-3「实战汇报」跳跃过大，拆为「框架化演练」与「限时实战」两个阶段；'
  + '3. milestone-2 的 goal 不可观察，需改成学员自己能判断的结果。';

const PREVIOUS_PLAN = {
  name: '向上汇报的结构化表达',
  summary: '把进展、问题、请求组织成上级能快速决策的框架。',
  cognitiveCore: { coreConcepts: [{ name: '结论先行' }, { name: '依据分层' }] },
  milestones: [
    { title: '识别问题结构', goal: '能说清结论与依据' },
    { title: '建立汇报框架', goal: '能按框架组织一次汇报' },
    { title: '实战汇报', goal: '独立完成一次15分钟汇报' },
  ],
};

async function main() {
  const userId = await pickUserId();

  const data: any = {
    userId,
    description: '想学会向上汇报',
    source: 'replan',
    mode: 'replan',
    userProfile: {
      currentLevel: 'beginner',
      timePerDay: '每周5小时',
      learnerProfile: { surfaceGoal: '想学会向上汇报' },
      normalizedInput: {
        version: '1.0',
        learnerProfile: { surfaceGoal: '想学会向上汇报' },
        problemSpace: { realProblem: '汇报被追问逻辑就乱，缺问题框架' },
        resources: { timeBudget: '每周5小时' },
      },
      replan: {
        triggerSource: 'path-reviewer',
        reviewerFeedback: REVIEWER_FEEDBACK,
        previousPlan: PREVIOUS_PLAN,
      },
    },
  };

  // 生产装配（不做第二套组装）
  const agentInput = buildPathAgentInput(data);
  agentInput.metadata = {
    ...(agentInput.metadata || {}),
    normalizedInput: buildFramedNormalizedInput(data.userProfile.normalizedInput),
  };

  const startedAt = new Date();
  console.log('[probe] agentInput.metadata.replan =', JSON.stringify((agentInput as any).metadata?.replan).slice(0, 200));
  const result = await executeSkill(pathAgentDefinition, {
    input: agentInput,
    context: { userId },
  });
  const payload = (result as any)?.path || (result as any)?.internal?.ext?.path?.path || null;
  console.log('[probe] 生成 name =', payload?.name ?? '(无输出)', '| milestones =', payload?.milestones?.length ?? 'n/a');

  // prompt_call_logs 由网关侧异步落库，稍等再查，避免读到空窗
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const calls = await prisma.prompt_call_logs.findMany({
    where: { createdAt: { gte: startedAt } },
    select: { agentId: true, success: true, userPayload: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`[probe] 本次窗口内 prompt_call_logs ${calls.length} 条；agentId = ${[...new Set(calls.map((c) => c.agentId))].join(', ') || '(无)'}`);
  const replanCall = calls.find((c) => (c.userPayload || '').includes('【路径重调模式】'));
  if (!replanCall) {
    const lens = calls.map((c) => `${c.agentId}:${(c.userPayload || '').length}`).join(', ');
    console.log('[probe] 各条 userPayload 长度 =', lens || '(无)');
    console.log('[probe] FAIL 本次调用载荷里没有【路径重调模式】分区（replan 未生效）');
    return;
  }

  const text = replanCall.userPayload || '';
  const hasFeedback = text.includes('【路径评审反馈】');
  const hasPrevious = text.includes('【被调整的原路径】');
  const hasItem6 = text.includes('必须逐条修正反馈中指出的结构缺陷');
  const echoesFeedback = text.includes('把问题拆成可验证的结构');
  const echoesPrevious = text.includes('原路径名：向上汇报的结构化表达');
  console.log(`[probe] 含【路径评审反馈】=${hasFeedback} 含【被调整的原路径】=${hasPrevious} 含第6条要求=${hasItem6}`);
  console.log(`[probe] 反馈正文已渲染=${echoesFeedback} 原路径名已渲染=${echoesPrevious}`);
  const seg = text.split('【被调整的原路径】')[1]?.split('【')[0]?.trim();
  if (seg) console.log('[probe] 原路径片段：\n' + seg);

  console.log(hasFeedback && hasPrevious && hasItem6 && echoesFeedback && echoesPrevious
    ? '[probe] PASS 重规划载荷含评审反馈 + 原路径 + 逐条修正要求'
    : '[probe] FAIL 重调载荷缺分区或内容');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
