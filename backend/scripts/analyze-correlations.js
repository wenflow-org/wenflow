const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyzeCorrelations() {
  const sessions = await prisma.teaching_sessions.findMany({
    select: { id: true, wrapup: true, messages: true },
  });

  console.log('=== LSS 与对话数据的相关性分析 ===\n');

  const data = [];
  
  sessions.forEach(session => {
    try {
      const wrapup = JSON.parse(session.wrapup);
      const messages = JSON.parse(session.messages);
      
      if (!wrapup || !wrapup.evaluation || !wrapup.evaluation.sessionLss || !wrapup.evidence) return;
      
      const lss = wrapup.evaluation.sessionLss;
      const evidence = wrapup.evidence;
      
      const confusionCount = evidence.topConfusionPoints ? evidence.topConfusionPoints.length : 0;
      const avgUnderstanding = evidence.avgUnderstanding;
      const turnCount = evidence.turnCount || 0;
      const frustrated = evidence.emotionalSignals ? evidence.emotionalSignals.frustrated : 0;
      
      let analysisCount = 0;
      let sumUnderstanding = 0;
      let confusionPointsInMessages = 0;
      
      messages.forEach(msg => {
        if (msg.analysis) {
          analysisCount++;
          if (typeof msg.analysis.understanding === 'number') {
            sumUnderstanding += msg.analysis.understanding;
          }
          if (Array.isArray(msg.analysis.confusionPoints)) {
            confusionPointsInMessages += msg.analysis.confusionPoints.length;
          }
        }
      });
      
      const avgUnderstandingFromMessages = analysisCount > 0 ? sumUnderstanding / analysisCount : null;
      
      data.push({
        lss,
        confusionCount,
        avgUnderstanding,
        turnCount,
        frustrated,
        avgUnderstandingFromMessages,
        confusionPointsInMessages,
        confidence: wrapup.evaluation.confidence,
        source: wrapup.sources && wrapup.sources.evaluation ? wrapup.sources.evaluation : 'unknown',
      });
    } catch (e) {}
  });

  console.log('有效数据点数:', data.length);
  
  if (data.length > 0) {
    const lowLss = data.filter(d => d.lss >= 1 && d.lss <= 4);
    const midLss = data.filter(d => d.lss > 4 && d.lss <= 7);
    const highLss = data.filter(d => d.lss > 7 && d.lss <= 10);
    
    console.log('\n--- 低压力组 (LSS 1-4) ---');
    console.log('样本数:', lowLss.length);
    if (lowLss.length > 0) {
      console.log('平均困惑点数:', (lowLss.reduce((s, d) => s + d.confusionCount, 0) / lowLss.length).toFixed(2));
      console.log('平均理解度:', (lowLss.reduce((s, d) => s + (d.avgUnderstanding || 0), 0) / lowLss.length).toFixed(2));
      console.log('平均对话轮次:', (lowLss.reduce((s, d) => s + d.turnCount, 0) / lowLss.length).toFixed(2));
      console.log('平均挫败信号:', (lowLss.reduce((s, d) => s + d.frustrated, 0) / lowLss.length).toFixed(2));
    }
    
    console.log('\n--- 中压力组 (LSS 5-7) ---');
    console.log('样本数:', midLss.length);
    if (midLss.length > 0) {
      console.log('平均困惑点数:', (midLss.reduce((s, d) => s + d.confusionCount, 0) / midLss.length).toFixed(2));
      console.log('平均理解度:', (midLss.reduce((s, d) => s + (d.avgUnderstanding || 0), 0) / midLss.length).toFixed(2));
      console.log('平均对话轮次:', (midLss.reduce((s, d) => s + d.turnCount, 0) / midLss.length).toFixed(2));
      console.log('平均挫败信号:', (midLss.reduce((s, d) => s + d.frustrated, 0) / midLss.length).toFixed(2));
    }
    
    console.log('\n--- 高压力组 (LSS 8-10) ---');
    console.log('样本数:', highLss.length);
    if (highLss.length > 0) {
      console.log('平均困惑点数:', (highLss.reduce((s, d) => s + d.confusionCount, 0) / highLss.length).toFixed(2));
      console.log('平均理解度:', (highLss.reduce((s, d) => s + (d.avgUnderstanding || 0), 0) / highLss.length).toFixed(2));
      console.log('平均对话轮次:', (highLss.reduce((s, d) => s + d.turnCount, 0) / highLss.length).toFixed(2));
      console.log('平均挫败信号:', (highLss.reduce((s, d) => s + d.frustrated, 0) / highLss.length).toFixed(2));
    }
    
    console.log('\n--- Source 分布 ---');
    const bySource = {
      model: data.filter(d => d.source === 'model'),
      aiFallback: data.filter(d => d.source === 'ai-fallback'),
      failed: data.filter(d => d.source === 'failed'),
    };
    
    Object.entries(bySource).forEach(([source, items]) => {
      if (items.length > 0) {
        const avgLss = items.reduce((s, d) => s + d.lss, 0) / items.length;
        const avgConf = items.reduce((s, d) => s + d.confidence, 0) / items.length;
        console.log(`${source}: ${items.length} 个 (平均LSS: ${avgLss.toFixed(2)}, 平均confidence: ${avgConf.toFixed(2)})`);
      }
    });
  }

  await prisma.$disconnect();
}

analyzeCorrelations().catch(console.error);
