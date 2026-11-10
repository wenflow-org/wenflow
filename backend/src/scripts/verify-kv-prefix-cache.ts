/**
 * KV 前缀缓存验证脚本（P1-2）
 *
 * 固定输入连调 goal-conversation 3 次（冷 → 热 → 间隔 60s 验证缓存 TTL），
 * 从 llm_execution_attempts 读取 ttftMs / promptCacheHitTokens / promptCacheMissTokens，
 * 验证 DeepSeek 自动前缀缓存是否命中（改造后应 hit>0、miss 下降、TTFT 下降）。
 *
 * 用法：npm run verify:kv-prefix-cache（backend）
 */
import 'dotenv/config';
import prisma from '../config/database';
import { executeSkillWithResult } from '../skills';
import { goalConversationAgentDefinition } from '../skills/goal-conversation';

const VERIFY_USER_ID = 'kv-prefix-verify';

const FIXED_INPUT = {
  input: '我想学好概率论，但每次做应用题都卡壳，尤其是条件概率',
  userId: VERIFY_USER_ID,
  conversationHistory: [
    { role: 'user' as const, content: '我想学好概率论' },
    { role: 'assistant' as const, content: '好的，能说说你具体卡在哪里吗？' },
    { role: 'user' as const, content: '每次做应用题都卡壳' },
  ],
  previousStage: 'understanding',
  previousUnderstanding: {
    surface_goal: '学好概率论',
    real_problem: '应用题解题卡壳',
  },
  maxFormatRetries: 2,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function latestAttempt(): Promise<{ ttftMs: number | null; hit: number | null; miss: number | null; promptTokens: number | null } | null> {
  const attempt = await prisma.llm_execution_attempts.findFirst({
    where: { userId: VERIFY_USER_ID },
    orderBy: { startedAt: 'desc' },
    select: { ttftMs: true, promptCacheHitTokens: true, promptCacheMissTokens: true, promptTokens: true },
  });
  if (!attempt) return null;
  return {
    ttftMs: attempt.ttftMs ?? null,
    hit: attempt.promptCacheHitTokens ?? null,
    miss: attempt.promptCacheMissTokens ?? null,
    promptTokens: attempt.promptTokens ?? null,
  };
}

async function runOnce(tag: string) {
  const result = await executeSkillWithResult(goalConversationAgentDefinition, FIXED_INPUT, {});
  const attempt = await latestAttempt();
  console.log(`[${tag}]`, {
    ok: result.success === true,
    structuredOutputValid: (result as any)?.debug?.structuredOutputValid,
    ttftMs: attempt?.ttftMs ?? 'n/a',
    promptCacheHitTokens: attempt?.hit ?? 'n/a',
    promptCacheMissTokens: attempt?.miss ?? 'n/a',
    promptTokens: attempt?.promptTokens ?? 'n/a',
  });
  return attempt;
}

async function main() {
  console.log('=== KV 前缀缓存验证（固定输入 × 3 连调）===');
  console.log('run1（冷）: 应 miss ≈ promptTokens，hit = 0');
  const run1 = await runOnce('run1');

  await sleep(2_000);
  console.log('run2（热，间隔 2s）: 应 hit > 0，miss 显著下降');
  const run2 = await runOnce('run2');

  await sleep(60_000);
  console.log('run3（间隔 60s，验证前缀缓存 TTL）');
  const run3 = await runOnce('run3');

  const summarize = (r: { hit: number | null; miss: number | null; promptTokens: number | null } | null) => {
    if (!r || r.hit == null) return 'n/a';
    // 口径（2026-11-08）：命中率 = hit / promptTokens。
    // 禁用 hit/(hit+miss)——上游常只回 cached_tokens、不回 miss，NULL 当 0 会把分母压塌、
    // 命中率虚报成 100%（doc/PROMPT_CACHE_OPTIMIZATION.md 明文禁止该形式）。
    const prompt = r.promptTokens;
    if (!prompt || prompt <= 0) return 'n/a';
    const missPart = r.miss == null ? 'miss 未上报' : `miss=${r.miss}`;
    return `${((r.hit / prompt) * 100).toFixed(1)}% hit（hit=${r.hit}/${prompt}，${missPart}）`;
  };

  console.log('\n=== 汇总 ===');
  console.log('run1 缓存命中占比:', summarize(run1));
  console.log('run2 缓存命中占比:', summarize(run2));
  console.log('run3 缓存命中占比:', summarize(run3));
  if (run1 && run2 && run3) {
    const hitGain = (run2.hit ?? 0) > (run1.hit ?? 0);
    // miss 常为 NULL（新版上游不回 uncached_tokens）——此时不下「未降」的结论，避免假阴性。
    const missComparable = run1.miss != null && run2.miss != null;
    const missDrop = missComparable ? (run2.miss as number) < (run1.miss as number) : null;
    const ttftImprove = run2.ttftMs != null && run1.ttftMs != null ? run2.ttftMs < run1.ttftMs : null;
    console.log('\n判定:',
      hitGain ? '✅ 缓存命中提升' : '⚠️ 命中未提升',
      missDrop === null ? '| miss 未上报，跳过' : (missDrop ? '| ✅ miss 下降' : '| ⚠️ miss 未降'),
      ttftImprove === null ? '' : (ttftImprove ? '| ✅ TTFT 下降' : '| ⚠️ TTFT 未降'));
    if (!hitGain) {
      console.log('提示：若 provider 未返回 prompt_cache_hit_tokens，请确认模型为 DeepSeek 且前缀 ≥ 最小缓存单元。');
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
