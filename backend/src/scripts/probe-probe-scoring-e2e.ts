/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 前置探测题「确定性判分」端到端探针（审计 P1 §2.1b）。
 *
 * 走真实入口 `requirementOrchestrator.start/step`，真 LLM，脚本化多轮：
 *   第 1 轮给「无证据自评（懂一点）+ 具体卡住场景」，诱导模型在 proposing 时附带探测题；
 *   随后几轮把探测题答案（A/B）回给模型。
 * 然后读回 `goal_conversations.collectedData.understanding.prerequisiteCheckResults`，
 * 用会话里出现过的 `confirmedProposal.prerequisiteDiagnostics[].correctOption` 做**独立重算**，
 * 核对 isCorrect 是否等于确定性结果（而不是模型自报）。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-probe-scoring-e2e.ts [--user=<userId>] [--keep]
 */
import 'dotenv/config';
import prisma from '../config/database';
import requirementOrchestrator from '../coordinators/requirement.coordinator';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const GOAL = '我懂一点 Excel，想学会用数据透视表做月报，最好两周内能独立做出一份。';
const TURNS = [
  '最近一次是上周做月报：我直接拿明细表拉了个透视表，结果汇总数对不上，被领导问"这数怎么来的"就答不上来。',
  '我每周大概能挤出 3 小时，你就直接按这个情况给我一个方向吧，先弄明白为什么汇总会重复计数。',
  '可以，就按这个方向来，麻烦你确认一下。',
  'B',
  'A',
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

interface ProbeResult { probeId?: string; userAnswer?: string; isCorrect?: boolean }

async function readState(conversationId: string) {
  const row = await prisma.goal_conversations.findUnique({
    where: { id: conversationId },
    select: { collectedData: true, stage: true, status: true },
  });
  const data = row?.collectedData ? JSON.parse(row.collectedData) : {};
  const understanding = data.understanding || {};
  const results: ProbeResult[] = Array.isArray(understanding.prerequisiteCheckResults)
    ? understanding.prerequisiteCheckResults
    : [];
  const proposal = data.confirmedProposal || {};
  const diagnostics: any[] = Array.isArray(proposal.prerequisiteDiagnostics) ? proposal.prerequisiteDiagnostics : [];
  return { stage: row?.stage, status: row?.status, results, diagnostics };
}

async function main() {
  const userId = await pickUserId();
  const started: any = await requirementOrchestrator.start(userId, GOAL, {} as any);
  const conversationId: string = started?.conversationId || started?.internal?.core?.conversationId;
  if (!conversationId) throw new Error('拿不到 conversationId：' + JSON.stringify(started).slice(0, 400));
  console.log('[probe] conversationId =', conversationId);

  let state = await readState(conversationId);
  // 判分键跨轮累积：模型往往在「作答轮」不再重复输出 prerequisiteDiagnostics（正是本次要修的场景），
  // 只读最终态会拿不到 correctOption，必须逐轮快照。
  const keyById = new Map<string, string>();
  const recordKeys = (diags: any[]) => {
    for (const d of diags) {
      if (d?.probeId && typeof d.correctOption === 'string') {
        keyById.set(String(d.probeId), d.correctOption);
        console.log(`[probe]   捕获探测题 ${d.probeId}：${String(d.question || '').slice(0, 60)} ⇒ correctOption=${d.correctOption}`);
      }
    }
  };
  recordKeys(state.diagnostics);
  console.log(`[probe] 第 1 轮：stage=${state.stage} 探测题=${state.diagnostics.length} 作答结果=${state.results.length}`);

  for (let i = 0; i < TURNS.length && state.results.length === 0; i += 1) {
    await requirementOrchestrator.step(conversationId, TURNS[i], userId, {} as any);
    state = await readState(conversationId);
    recordKeys(state.diagnostics);
    console.log(`[probe] 第 ${i + 2} 轮：stage=${state.stage} 探测题=${state.diagnostics.length} 作答结果=${state.results.length}`);
  }

  if (state.results.length === 0) {
    console.log('[probe] CHECK 本次对话未触发前置探测题（触发条件苛刻：proposing + 无证据自评 + 依赖前置概念）——判分链路无样本可验');
  } else {
    let mismatches = 0;
    for (const r of state.results) {
      const expected = keyById.get(String(r.probeId));
      const actual = r.userAnswer === expected;
      const flag = expected === undefined ? 'NO-KEY' : (r.isCorrect === actual ? 'OK' : 'MISMATCH');
      if (flag === 'MISMATCH') mismatches += 1;
      console.log(`[probe]   ${r.probeId}: userAnswer=${r.userAnswer} correctOption=${expected ?? 'n/a'} isCorrect=${r.isCorrect} ⇒ ${flag}`);
    }
    console.log(mismatches === 0 && keyById.size > 0
      ? '[probe] PASS 判分与 correctOption 确定性一致'
      : `[probe] ${mismatches} 条不一致 / 判分键缺失 ${keyById.size === 0 ? '(无样本)' : ''}`);
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
