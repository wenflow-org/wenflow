/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 响应分诊「只落库/遥测」端到端探针（审计 P1 §2.1a，已拍板口径）。
 *
 * 冲突：提示词明令 hidden 信号（primary_block_type / support_need）不得向用户宣布，
 * 而平台侧 advisory 默认会把「系统判断：你卡住的主因更偏情绪/信心…」拼进 userVisible 并落库。
 * 现口径：分诊结论只落库/遥测，不进用户可见文本；需要用户显式知情时走 gated 确认闸门。
 *
 * 走真实入口 requirementOrchestrator.start，真 LLM，目标文本刻意带情绪阻塞证据以触发非 learning_path。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-triage-advisory-e2e.ts [--user=<userId>] [--keep]
 */
import 'dotenv/config';
import prisma from '../config/database';
import requirementOrchestrator from '../coordinators/requirement.coordinator';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const GOAL = '一想到要在月度经营会上当众汇报就失眠，怕被领导否定；上次汇报讲到一半被打断，之后就不敢再讲了。';

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
  const started: any = await requirementOrchestrator.start(userId, GOAL, {} as any);
  const conversationId: string = started?.conversationId || started?.internal?.core?.conversationId;
  const userVisible: string = String(started?.userVisible ?? '');
  console.log('[probe] conversationId =', conversationId);
  console.log('[probe] 返回的 userVisible（前 120 字）：', userVisible.slice(0, 120));

  const row = await prisma.goal_conversations.findUnique({
    where: { id: conversationId },
    select: { collectedData: true },
  });
  const data = row?.collectedData ? JSON.parse(row.collectedData) : {};
  const triage = data.responseTriage || null;
  console.log('[probe] 落库 responseTriage =', JSON.stringify(triage));

  const hasAnnounce = userVisible.includes('系统判断');
  console.log(`[probe] userVisible 含「系统判断」行 = ${hasAnnounce ? 'YES（不合口径）' : 'NO'}`);
  console.log(`[probe] responseTriage 已落库 = ${triage ? 'YES' : 'NO'} | mode = ${triage?.mode ?? 'n/a'}`);

  if (triage && triage.mode !== 'learning_path' && !hasAnnounce) {
    console.log('[probe] PASS 非学习路径结论只落库、未进用户可见文本');
  } else if (!triage || triage.mode === 'learning_path') {
    console.log('[probe] CHECK 本轮未触发非学习路径分诊（模型未给出情绪阻塞证据），口径无从对比');
  } else {
    console.log('[probe] FAIL 分诊结论仍出现在 userVisible');
  }

  if (!hasFlag('keep')) {
    try { await requirementOrchestrator.reset(conversationId, userId); } catch { /* 忽略 */ }
    try {
      const still = await prisma.goal_conversations.findUnique({ where: { id: conversationId }, select: { id: true } });
      if (still) { await prisma.goal_conversations.delete({ where: { id: conversationId } }); console.log('[probe] 已删除测试会话'); }
      else console.log('[probe] 会话已由 reset 删除');
    } catch (error) { console.log('[probe] 清理失败（请手工删）:', conversationId, (error as Error).message); }
  } else {
    console.log('[probe] --keep：保留会话', conversationId);
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
