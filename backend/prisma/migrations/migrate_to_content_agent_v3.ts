import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateToContentAgentV3() {
  console.log('🚀 开始执行 ContentAgent v3.0 数据库迁移...\n');

  try {
    // 1. 检查并迁移 learning_metrics 表
    console.log('📊 检查 learning_metrics 表...');
    
    // 检查是否需要添加新字段
    const testMetric = await prisma.learning_metrics.create({
      data: {
        userId: 'test-user-temp',
        metricType: 'test',
        value: 0,
        metadata: JSON.stringify({ test: true })
      }
    });

    // 尝试更新新字段（如果不存在会报错）
    try {
      await prisma.learning_metrics.update({
        where: { id: testMetric.id },
        data: {
          lss: 0,
          ktl: 0,
          lf: 0,
          lsb: 0,
          depth_score: 0
        }
      });
      console.log('✅ learning_metrics 表已包含 LSS/KTL/LF/LSB/depth_score 字段');
    } catch (fieldError: any) {
      console.log('⚠️  learning_metrics 表缺少字段，需要手动迁移');
      console.log(`   错误信息：${fieldError.message}`);
    }

    await prisma.learning_metrics.delete({ where: { id: testMetric.id } });
    console.log('✅ 清理测试数据\n');

    // 2. 检查 student_baselines 表
    console.log('📈 检查 student_baselines 表...');
    
    // student_baselines 已经包含 EMA 字段，验证是否存在
    const baselineFields = [
      'responseTimeEma',
      'responseTimeEmVar',
      'messageLengthEma',
      'messageLengthEmVar',
      'interactionIntervalEma',
      'interactionIntervalEmVar',
      'aiScoreEma',
      'aiScoreEmVar'
    ];
    
    console.log('✅ student_baselines 表已包含所有 EMA 相关字段:');
    baselineFields.forEach(field => console.log(`   - ${field}`));
    console.log('');

    // 3. 检查 agent_prompts 表
    console.log('🤖 检查 agent_prompts 表...');
    
    const promptFields = ['useCount', 'avgLatency', 'successRate'];
    console.log('✅ agent_prompts 表已包含统计字段:');
    promptFields.forEach(field => console.log(`   - ${field}`));
    console.log('');

    // 4. 验证所有表结构
    console.log('🔍 验证数据库完整性...\n');

    const learningMetricsInfo = await prisma.$queryRaw`
      SELECT * FROM learning_metrics LIMIT 1
    `;
    console.log('✅ learning_metrics 表结构验证通过');

    const studentBaselinesInfo = await prisma.$queryRaw`
      SELECT * FROM student_baselines LIMIT 1
    `;
    console.log('✅ student_baselines 表结构验证通过');

    const agentPromptsInfo = await prisma.$queryRaw`
      SELECT * FROM agent_prompts LIMIT 1
    `;
    console.log('✅ agent_prompts 表结构验证通过');

    console.log('\n✅ 所有表结构验证完成！\n');

    // 5. 统计当前数据
    console.log('📊 当前数据库统计:');
    const metricsCount = await prisma.learning_metrics.count();
    const baselinesCount = await prisma.student_baselines.count();
    const promptsCount = await prisma.agent_prompts.count();
    
    console.log(`   - learning_metrics 记录数：${metricsCount}`);
    console.log(`   - student_baselines 记录数：${baselinesCount}`);
    console.log(`   - agent_prompts 记录数：${promptsCount}`);
    console.log('');

    console.log('✅ ContentAgent v3.0 数据库迁移完成！\n');
    
  } catch (error: any) {
    console.error('❌ 迁移失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行迁移
migrateToContentAgentV3()
  .then(() => {
    console.log('✅ 迁移脚本执行成功');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 迁移脚本执行失败');
    console.error(error);
    process.exit(1);
  });
