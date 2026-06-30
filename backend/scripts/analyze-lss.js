const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyzeLSS() {
  const sessions = await prisma.teaching_sessions.findMany({
    select: { id: true, wrapup: true, createdAt: true, endTime: true },
  });

  console.log('=== 总体统计 ===');
  console.log('总会话数:', sessions.length);

  const withWrapup = sessions.filter(s => s.wrapup);
  console.log('有 wrapup 数据的会话数:', withWrapup.length);

  const lssValues = [];
  const ktlValues = [];
  const lfValues = [];
  const confidenceValues = [];
  const sources = { model: 0, aiFallback: 0, failed: 0 };

  withWrapup.forEach(session => {
    try {
      const wrapup = JSON.parse(session.wrapup);
      if (wrapup.evaluation) {
        if (typeof wrapup.evaluation.sessionLss === 'number') {
          lssValues.push(wrapup.evaluation.sessionLss);
        }
        if (typeof wrapup.evaluation.sessionKtl === 'number') {
          ktlValues.push(wrapup.evaluation.sessionKtl);
        }
        if (typeof wrapup.evaluation.sessionLf === 'number') {
          lfValues.push(wrapup.evaluation.sessionLf);
        }
        if (typeof wrapup.evaluation.confidence === 'number') {
          confidenceValues.push(wrapup.evaluation.confidence);
        }
      }
      if (wrapup.sources && wrapup.sources.evaluation) {
        const src = wrapup.sources.evaluation;
        if (src === 'model') sources.model++;
        else if (src === 'ai-fallback') sources.aiFallback++;
        else if (src === 'failed') sources.failed++;
      }
    } catch (e) {}
  });

  console.log('\n=== LSS 分布 ===');
  console.log('有效 LSS 数据数:', lssValues.length);
  if (lssValues.length > 0) {
    const sorted = [...lssValues].sort((a, b) => a - b);
    const mean = lssValues.reduce((a, b) => a + b, 0) / lssValues.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = lssValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lssValues.length;
    const stdDev = Math.sqrt(variance);
    
    console.log('平均值:', mean.toFixed(2));
    console.log('中位数:', median.toFixed(2));
    console.log('标准差:', stdDev.toFixed(2));
    console.log('最小值:', Math.min(...lssValues).toFixed(2));
    console.log('最大值:', Math.max(...lssValues).toFixed(2));
    console.log('极端值 (=1.0):', lssValues.filter(v => v === 1.0).length);
    console.log('极端值 (=10.0):', lssValues.filter(v => v === 10.0).length);
    console.log('低压力 (1-4):', lssValues.filter(v => v >= 1 && v <= 4).length);
    console.log('中压力 (5-7):', lssValues.filter(v => v > 4 && v <= 7).length);
    console.log('高压力 (8-10):', lssValues.filter(v => v > 7 && v <= 10).length);
  }

  console.log('\n=== KTL 分布 ===');
  if (ktlValues.length > 0) {
    const mean = ktlValues.reduce((a, b) => a + b, 0) / ktlValues.length;
    console.log('平均值:', mean.toFixed(2));
    console.log('最小值:', Math.min(...ktlValues).toFixed(2));
    console.log('最大值:', Math.max(...ktlValues).toFixed(2));
  }

  console.log('\n=== LF 分布 ===');
  if (lfValues.length > 0) {
    const mean = lfValues.reduce((a, b) => a + b, 0) / lfValues.length;
    console.log('平均值:', mean.toFixed(2));
    console.log('最小值:', Math.min(...lfValues).toFixed(2));
    console.log('最大值:', Math.max(...lfValues).toFixed(2));
  }

  console.log('\n=== Confidence 分布 ===');
  if (confidenceValues.length > 0) {
    const mean = confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length;
    console.log('平均值:', mean.toFixed(2));
    console.log('低置信度 (<0.5):', confidenceValues.filter(v => v < 0.5).length);
    console.log('中置信度 (0.5-0.7):', confidenceValues.filter(v => v >= 0.5 && v <= 0.7).length);
    console.log('高置信度 (>0.7):', confidenceValues.filter(v => v > 0.7).length);
    console.log('保守评分标记 (=0.2):', confidenceValues.filter(v => v === 0.2).length);
  }

  console.log('\n=== Evaluation Source 分布 ===');
  console.log('model:', sources.model);
  console.log('ai-fallback:', sources.aiFallback);
  console.log('failed (conservative):', sources.failed);

  await prisma.$disconnect();
}

analyzeLSS().catch(console.error);
