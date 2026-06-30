const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyzeReasoningQuality() {
  const sessions = await prisma.teaching_sessions.findMany({
    where: { wrapup: { not: null } },
    select: { id: true, wrapup: true },
  });

  console.log('=== LSS Reasoning 质量分析 ===\n');

  const reasonings = [];
  
  sessions.forEach(session => {
    try {
      const wrapup = JSON.parse(session.wrapup);
      if (wrapup.evaluation && wrapup.evaluation.reasoning) {
        reasonings.push({
          sessionId: session.id,
          lss: wrapup.evaluation.sessionLss,
          ktl: wrapup.evaluation.sessionKtl,
          lf: wrapup.evaluation.sessionLf,
          confidence: wrapup.evaluation.confidence,
          reasoning: wrapup.evaluation.reasoning,
          source: wrapup.sources?.evaluation || 'unknown',
          evidence: wrapup.evidence,
        });
      }
    } catch (e) {}
  });

  console.log(`总共 ${reasonings.length} 个有 reasoning 的评估\n`);

  // 按 source 分组展示
  const modelReasonings = reasonings.filter(r => r.source === 'model');
  const failedReasonings = reasonings.filter(r => r.source === 'failed');

  console.log('--- Model 生成的 reasoning ---');
  modelReasonings.forEach((r, idx) => {
    console.log(`\n[${idx + 1}] LSS: ${r.lss}, KTL: ${r.ktl}, LF: ${r.lf}, Conf: ${r.confidence}`);
    console.log(`证据: turnCount=${r.evidence.turnCount}, avgUnderstanding=${r.evidence.avgUnderstanding?.toFixed(2)}`);
    console.log(`Reasoning: ${r.reasoning}`);
  });

  console.log('\n\n--- Failed (保守评分) 的 reasoning ---');
  failedReasonings.forEach((r, idx) => {
    console.log(`\n[${idx + 1}] LSS: ${r.lss}, KTL: ${r.ktl}, LF: ${r.lf}, Conf: ${r.confidence}`);
    console.log(`证据: turnCount=${r.evidence.turnCount}, avgUnderstanding=${r.evidence.avgUnderstanding?.toFixed(2) || 'null'}`);
    console.log(`Reasoning: ${r.reasoning}`);
  });

  await prisma.$disconnect();
}

analyzeReasoningQuality().catch(console.error);
