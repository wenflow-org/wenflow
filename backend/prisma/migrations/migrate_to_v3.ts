import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateToV3() {
  console.log('开始数据库迁移到 v3.0...\n');
  
  try {
    // 1. 检查 learning_metrics 表是否需要新字段
    console.log('【1】检查 learning_metrics 表字段...');
    
    const lmColumns = await prisma.$queryRaw`
      SELECT name FROM pragma_table_info('learning_metrics')
    ` as any[];
    
    const hasLSS = lmColumns.some((col: any) => col.name === 'lss');
    const hasKTL = lmColumns.some((col: any) => col.name === 'ktl');
    const hasLF = lmColumns.some((col: any) => col.name === 'lf');
    const hasLSB = lmColumns.some((col: any) => col.name === 'lsb');
    
    if (!hasLSS || !hasKTL || !hasLF || !hasLSB) {
      console.log('  添加 LSS/KTL/LF/LSB 字段...');
      
      if (!hasLSS) {
        await prisma.$executeRaw`
          ALTER TABLE learning_metrics ADD COLUMN lss REAL;
        `;
        console.log('    ✅ 添加 lss 字段');
      }
      
      if (!hasKTL) {
        await prisma.$executeRaw`
          ALTER TABLE learning_metrics ADD COLUMN ktl REAL;
        `;
        console.log('    ✅ 添加 ktl 字段');
      }
      
      if (!hasLF) {
        await prisma.$executeRaw`
          ALTER TABLE learning_metrics ADD COLUMN lf REAL;
        `;
        console.log('    ✅ 添加 lf 字段');
      }
      
      if (!hasLSB) {
        await prisma.$executeRaw`
          ALTER TABLE learning_metrics ADD COLUMN lsb REAL;
        `;
        console.log('    ✅ 添加 lsb 字段');
      }
      
      console.log('  ✅ 学习状态指标字段添加成功');
    } else {
      console.log('  ✓ learning_metrics 表字段已完整');
    }
    
    // 2. 检查 student_baselines 表（应该已经存在 EMA 字段）
    console.log('\n【2】检查 student_baselines 表字段...');
    
    const sbColumns = await prisma.$queryRaw`
      SELECT name FROM pragma_table_info('student_baselines')
    ` as any[];
    
    const hasResponseTimeEma = sbColumns.some((col: any) => col.name === 'responseTimeEma');
    const hasAiScoreEma = sbColumns.some((col: any) => col.name === 'aiScoreEma');
    const hasUpdateCount = sbColumns.some((col: any) => col.name === 'updateCount');
    
    if (hasResponseTimeEma && hasAiScoreEma && hasUpdateCount) {
      console.log('  ✓ student_baselines 表字段已完整');
    } else {
      console.log('  ⚠️ student_baselines 表缺少部分 EMA 字段（可能需要手动添加）');
    }
    
    // 3. 检查 agent_prompts 表的统计字段
    console.log('\n【3】检查 agent_prompts 表字段...');
    
    const apColumns = await prisma.$queryRaw`
      SELECT name FROM pragma_table_info('agent_prompts')
    ` as any[];
    
    const hasUseCount = apColumns.some((col: any) => col.name === 'useCount');
    const hasAvgLatency = apColumns.some((col: any) => col.name === 'avgLatency');
    const hasSuccessRate = apColumns.some((col: any) => col.name === 'successRate');
    
    if (hasUseCount && hasAvgLatency && hasSuccessRate) {
      console.log('  ✓ agent_prompts 表字段已完整');
    } else {
      console.log('  ⚠️ agent_prompts 表缺少部分统计字段');
    }
    
    // 4. 验证所有必需的表都存在
    console.log('\n【4】验证必需的表...');
    
    const tables = await prisma.$queryRaw`
      SELECT name FROM sqlite_master WHERE type='table'
    ` as any[];
    
    const requiredTables = [
      'agent_prompts',
      'agent_call_logs',
      'learning_metrics',
      'student_baselines',
      'learning_sessions'
    ];
    
    for (const table of requiredTables) {
      const exists = tables.some((t: any) => t.name === table);
      console.log(`  ${exists ? '✅' : '❌'} ${table}`);
    }
    
    console.log('\n✅ 数据库迁移完成！');
    
  } catch (error) {
    console.error('❌ 迁移失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行迁移
if (require.main === module) {
  migrateToV3()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { migrateToV3 };