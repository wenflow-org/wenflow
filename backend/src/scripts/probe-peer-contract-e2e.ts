/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 伴学契约端到端探针（审计 P0 §1.5）。
 *
 * 失败模式：core fields 把 followUpQuestions 声明为必填，而提示词/handler 都按可选处理 ⇒
 * 模型省略该字段时整轮 missing-required 失败（peer 无 retryStrategy，不重试），伴学消息整条丢失。
 *
 * 本探针真跑 `executePeerDiscussion`（真 skill + 真 LLM），逐次记录：
 *   - 是否成功产出 message
 *   - 模型原始输出里是否带 followUpQuestions（即本次是否命中"模型省略"这一分支）
 * 并统计 prompt_call_logs 里 skill:peer-reinforcement 的失败计数作为旁证。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-peer-contract-e2e.ts [--runs=2]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { executePeerDiscussion, type PeerDiscussionInput } from '../skills/peer-reinforcement';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const CASES: PeerDiscussionInput[] = [
  {
    topic: '牛顿第一定律',
    strategy: 'feynman',
    tutorContext: [{ role: 'assistant', content: '我们刚讲了惯性：物体不受外力时保持原有运动状态。' }],
    studentMessage: '懂了，就是不动就不动、动就一直动。',
    cognitiveLevel: 'understand',
    understanding: 0.55,
  },
  {
    // 高负荷 + 受挫：规则要求"不连续追问、先共情"，前提是这两个字段真的进了载荷（§2.4a）
    topic: '英语时态',
    strategy: 'feynman',
    tutorContext: [{ role: 'assistant', content: '刚才讲了现在完成时与一般过去时的区别。' }],
    studentMessage: '算了，我是不是根本学不会，越听越乱。',
    cognitiveLevel: 'understand',
    understanding: 0.22,
    loadIndex: 0.85,
    emotionalState: 'frustrated',
  },
  {
    topic: '一元二次方程的判别式',
    strategy: 'counterexample',
    tutorContext: [{ role: 'assistant', content: '判别式 Δ>0 时有两个不等实根。' }],
    studentMessage: '那 Δ=0 是不是没有根？',
    cognitiveLevel: 'apply',
    understanding: 0.35,
  },
];

async function failureCount(): Promise<string> {
  const rows = await prisma.prompt_call_logs.groupBy({
    by: ['success'],
    where: { agentId: 'skill:peer-reinforcement' },
    _count: { _all: true },
  });
  const failed = await prisma.prompt_call_logs.count({
    where: { agentId: 'skill:peer-reinforcement', success: false },
  });
  const byMsg = await prisma.prompt_call_logs.groupBy({
    by: ['errorMessage'],
    where: { agentId: 'skill:peer-reinforcement', success: false },
    _count: { _all: true },
  });
  return `总计 ${rows.reduce((sum, r) => sum + r._count._all, 0)} 条 | 失败 ${failed} 条`
    + (byMsg.length ? ` | 失败原因：${byMsg.map((m) => `${m.errorMessage}×${m._count._all}`).join(' ; ')}` : '');
}

async function main() {
  const runs = Math.max(1, Number(arg('runs') || 2));
  console.log('[probe] 调用前 prompt_call_logs：', await failureCount());

  let ok = 0;
  for (let i = 0; i < Math.min(runs, CASES.length); i += 1) {
    const startedAt = new Date();
    try {
      const result = await executePeerDiscussion(CASES[i]);
      ok += 1;
      console.log(`[probe] #${i + 1} 成功 | message=${(result.message || '').slice(0, 60)}… | followUpQuestions=${JSON.stringify(result.followUpQuestions)}`);
    } catch (error) {
      console.log(`[probe] #${i + 1} 失败 | ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await prisma.prompt_call_logs.findMany({
      where: { agentId: 'skill:peer-reinforcement', createdAt: { gte: startedAt } },
      select: { success: true, errorMessage: true, normalizedOutput: true, extractedJson: true, userPayload: true },
    });
    for (const row of rows) {
      const emitted = /followUpQuestions/.test(row.extractedJson || row.normalizedOutput || '');
      const payload = row.userPayload || '';
      const hasLoad = payload.includes('【本轮认知负荷】');
      const hasEmotion = payload.includes('【本轮情绪】');
      console.log(`[probe]   本次日志：success=${row.success} | 模型输出含 followUpQuestions=${emitted}`
        + ` | 载荷含负荷分区=${hasLoad} 情绪分区=${hasEmotion}${row.errorMessage ? ` | err=${row.errorMessage}` : ''}`);
    }
  }

  console.log('[probe] 调用后 prompt_call_logs：', await failureCount());
  console.log(ok === Math.min(runs, CASES.length)
    ? '[probe] PASS 伴学全部成功产出（未再出现 missing-required 丢消息）'
    : '[probe] CHECK 有失败，见上方');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
