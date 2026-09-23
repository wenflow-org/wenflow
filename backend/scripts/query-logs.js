const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 直接看今天 LLM 调用的字段填充情况
  console.log('=== 今天 LLM 调用样本 (最近5条) ===');
  const samples = await prisma.$queryRawUnsafe(`
    SELECT "startedAt", success, "statusCode", "requestedModel",
           "finishReason", "completionTokens", "promptTokens", "totalTokens",
           "durationMs",
           length("responseBody") as body_len,
           substr("responseBody", 1, 100) as body_head
    FROM llm_execution_attempts
    WHERE "startedAt" >= datetime('now', '-1 day')
    ORDER BY "startedAt" DESC
    LIMIT 5
  `);
  for (const s of samples) {
    console.log(`${s.startedAt} | success=${s.success} HTTP${s.statusCode} | ${s.requestedModel} | finish=${s.finishReason} | tokens: p=${s.promptTokens} c=${s.completionTokens} t=${s.totalTokens} | ${s.durationMs}ms | bodyLen=${s.body_len}`);
    console.log(`  body: ${(s.body_head||'(null)')}`);
  }

  // 今天 success=1 的 LLM 调用，看 responseBody 是否为空
  console.log('\n=== 今天 success=1 的 LLM 调用 → responseBody 空 vs 非空 ===');
  const bodyStats = await prisma.$queryRawUnsafe(`
    SELECT 
      CASE WHEN "responseBody" IS NULL THEN 'null'
           WHEN "responseBody" = '' THEN 'empty'
           ELSE 'has_content' END as body_status,
      COUNT(*) as cnt
    FROM llm_execution_attempts
    WHERE "startedAt" >= datetime('now', '-1 day') AND success = 1
    GROUP BY body_status
  `);
  for (const b of bodyStats) console.log(`  ${b.body_status}: ${b.cnt}`);

  // 看看有没有 responseBody 有内容但截断的
  console.log('\n=== 有 responseBody 的成功调用最后 100 字符 ===');
  const withBody = await prisma.$queryRawUnsafe(`
    SELECT "startedAt", "completionTokens", "finishReason",
           substr("responseBody", max(length("responseBody") - 100, 1), 100) as tail,
           length("responseBody") as blen
    FROM llm_execution_attempts
    WHERE "responseBody" IS NOT NULL AND "responseBody" != '' AND success = 1
    ORDER BY "startedAt" DESC
    LIMIT 5
  `);
  for (const w of withBody) {
    console.log(`  ${w.startedAt} | tokens=${w.completionTokens} finish=${w.finishReason} len=${w.blen}`);
    console.log(`    tail: ...${w.tail}`);
  }
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); });