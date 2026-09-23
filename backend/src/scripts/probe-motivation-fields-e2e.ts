/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 动机信号/动机帧接线端到端探针（审计 P0 §1.2）。
 *
 * 问题：规则 #25 要求每轮维护 state.motivation_signal / state.mi_frames，但字段表只声明了
 * stage/confidence/done ⇒ 模型没有理由产出它们（hidden 字段直接死掉），而代码与
 * collectedData 持久化都在等它。
 *
 * 本探针走**真实入口**：`requirementOrchestrator.start/step`（= 目标对话路由调的那两个方法），
 * 真 LLM，然后读回 `goal_conversations.collectedData` 看两个字段是否真的落库。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-motivation-fields-e2e.ts [--user=<userId>] [--keep]
 */
import 'dotenv/config';
import prisma from '../config/database';
import requirementOrchestrator from '../coordinators/requirement.coordinator';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const GOAL = '我想试试把向上汇报讲清楚。之前试过列提纲，但一到会上被领导追问就乱了，这次一定要改过来，怕再被打断。';
const FOLLOW_UP = '最近一次是月度经营会，我讲到一半被问"数据支撑在哪"，当场就卡住了，后面全乱了。';

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

function extractConversationId(result: any): string | null {
  return result?.conversationId
    || result?.internal?.core?.conversationId
    || result?.conversation?.id
    || null;
}

async function readMotivation(conversationId: string) {
  const row = await prisma.goal_conversations.findUnique({
    where: { id: conversationId },
    select: { collectedData: true, stage: true, status: true },
  });
  const data = row?.collectedData ? JSON.parse(row.collectedData) : {};
  return {
    stage: row?.stage,
    status: row?.status,
    motivationSignal: data.motivationSignal ?? data.motivation_signal ?? null,
    miFrames: data.miFrames ?? data.mi_frames ?? null,
  };
}

async function main() {
  const userId = await pickUserId();

  console.log('[probe] 第 1 轮 start（含 change talk / 障碍 / 失败模式）…');
  const started: any = await requirementOrchestrator.start(userId, GOAL, {} as any);
  const conversationId = extractConversationId(started);
  console.log('[probe] conversationId =', conversationId);
  if (!conversationId) {
    console.log('[probe] start 返回结构：', JSON.stringify(started).slice(0, 600));
    throw new Error('拿不到 conversationId');
  }

  let observed = await readMotivation(conversationId);
  console.log('[probe] 第 1 轮落库：', JSON.stringify(observed));

  if (!observed.motivationSignal && !observed.miFrames) {
    console.log('[probe] 第 1 轮未产出动机字段，追加 1 轮 step（更具体场景）…');
    await requirementOrchestrator.step(conversationId, FOLLOW_UP, userId, {} as any);
    observed = await readMotivation(conversationId);
    console.log('[probe] 第 2 轮落库：', JSON.stringify(observed));
  }

  const okSignal = observed.motivationSignal !== null && observed.motivationSignal !== undefined;
  const okFrames = observed.miFrames !== null && observed.miFrames !== undefined;
  console.log(`[probe] motivationSignal 落库 = ${okSignal ? 'YES' : 'NO'} | miFrames 落库 = ${okFrames ? 'YES' : 'NO'}`);
  if (okFrames) console.log('[probe] miFrames 帧名 =', Object.keys(observed.miFrames || {}).join(', '));

  if (!hasFlag('keep')) {
    try {
      await requirementOrchestrator.reset(conversationId, userId);
    } catch (error) {
      console.log('[probe] reset 失败（继续尝试删除）:', (error as Error).message);
    }
    try {
      const stillThere = await prisma.goal_conversations.findUnique({ where: { id: conversationId }, select: { id: true } });
      if (stillThere) {
        await prisma.goal_conversations.delete({ where: { id: conversationId } });
        console.log('[probe] 已删除测试会话', conversationId);
      } else {
        console.log('[probe] 会话已由 reset 删除', conversationId);
      }
    } catch (error) {
      console.log('[probe] 删除失败（请手工删）:', conversationId, (error as Error).message);
    }
  } else {
    console.log('[probe] --keep：保留会话', conversationId);
  }

  console.log(okSignal || okFrames ? '[probe] PASS 动机字段已落库' : '[probe] CHECK 两轮均未产出（见上方逐轮输出）');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
