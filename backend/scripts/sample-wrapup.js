const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getSampleWrapup() {
  const sessions = await prisma.teaching_sessions.findMany({
    where: { wrapup: { not: null } },
    select: { id: true, wrapup: true, messages: true },
    take: 2,
  });

  sessions.forEach((session, idx) => {
    console.log(`\n========== Session ${idx + 1}: ${session.id} ==========`);
    if (session.wrapup) {
      try {
        const wrapup = JSON.parse(session.wrapup);
        console.log('\n--- Evaluation ---');
        if (wrapup.evaluation) {
          console.log('sessionLss:', wrapup.evaluation.sessionLss);
          console.log('sessionKtl:', wrapup.evaluation.sessionKtl);
          console.log('sessionLf:', wrapup.evaluation.sessionLf);
          console.log('confidence:', wrapup.evaluation.confidence);
          console.log('reasoning:', wrapup.evaluation.reasoning);
        }
        console.log('\n--- Sources ---');
        if (wrapup.sources) {
          console.log('evaluation source:', wrapup.sources.evaluation);
        }
        console.log('\n--- Evidence ---');
        if (wrapup.evidence) {
          console.log('turnCount:', wrapup.evidence.turnCount);
          console.log('avgUnderstanding:', wrapup.evidence.avgUnderstanding);
          console.log('avgEngagement:', wrapup.evidence.avgEngagement);
          console.log('topConfusionPoints:', wrapup.evidence.topConfusionPoints);
          console.log('emotionalSignals:', wrapup.evidence.emotionalSignals);
        }
      } catch (e) {
        console.log('Error parsing wrapup:', e.message);
      }
    }
  });

  await prisma.$disconnect();
}

getSampleWrapup().catch(console.error);
