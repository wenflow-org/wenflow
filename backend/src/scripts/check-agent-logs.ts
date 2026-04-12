import prisma from '../config/database';

async function checkAgentLogs() {
  console.log('🔍 检查 agent 执行日志...\n');

  try {
    // 获取所有 agent 的日志统计
    const agentStats = await prisma.agent_call_logs.groupBy({
      by: ['agentId'],
      _count: true,
      _sum: {
        durationMs: true
      }
    });

    console.log('📊 各 Agent 调用统计:\n');
    for (const stat of agentStats) {
      console.log(`Agent: ${stat.agentId}`);
      console.log(`  调用次数：${stat._count}`);
      console.log(`  平均耗时：${stat._sum.durationMs ? Math.round(stat._sum.durationMs / stat._count) : 0}ms`);
      
      // 获取该 agent 的成功/失败统计
      const successCount = await prisma.agent_call_logs.count({
        where: { agentId: stat.agentId, success: true }
      });
      const failureCount = await prisma.agent_call_logs.count({
        where: { agentId: stat.agentId, success: false }
      });
      
      const successRate = stat._count > 0 
        ? (successCount / stat._count * 100).toFixed(1) 
        : 'N/A';
      
      console.log(`  成功：${successCount} (${successRate}%)`);
      console.log(`  失败：${failureCount}`);
      console.log('');
    }

    // 检查 goal-conversation-agent 的失败日志
    console.log('\n🔍 检查 goal-conversation-agent 的失败日志...\n');
    
    const errorLogs = await prisma.agent_call_logs.findMany({
      where: {
        agentId: 'goal-conversation-agent',
        success: false
      },
      orderBy: {
        calledAt: 'desc'
      },
      take: 10,
      select: {
        id: true,
        calledAt: true,
        userId: true,
        error: true,
        errorCode: true,
        durationMs: true,
        input: true,
        output: true
      }
    });

    if (errorLogs.length > 0) {
      console.log(`❌ 找到 ${errorLogs.length} 条失败日志:\n`);
      
      for (let i = 0; i < errorLogs.length; i++) {
        const log = errorLogs[i];
        console.log(`--- 日志 ${i + 1} ---`);
        console.log(`ID: ${log.id}`);
        console.log(`时间：${log.calledAt.toISOString()}`);
        console.log(`用户 ID: ${log.userId}`);
        console.log(`错误代码：${log.errorCode || 'N/A'}`);
        console.log(`错误信息：${log.error || 'N/A'}`);
        console.log(`输入预览：${log.input ? log.input.substring(0, 200) + '...' : 'N/A'}`);
        console.log(`耗时：${log.durationMs}ms\n`);
      }
    } else {
      console.log('✅ goal-conversation-agent 没有失败日志！');
    }

    // 检查所有 agent 的最近日志
    console.log('\n📋 最近 10 条日志:');
    const recentLogs = await prisma.agent_call_logs.findMany({
      orderBy: {
        calledAt: 'desc'
      },
      take: 10,
      select: {
        agentId: true,
        success: true,
        durationMs: true,
        calledAt: true,
        error: true
      }
    });

    recentLogs.forEach((log, index) => {
      const status = log.success ? '✅' : '❌';
      const errorInfo = log.error ? ` - ${log.error.substring(0, 50)}...` : '';
      console.log(`${index + 1}. ${status} ${log.agentId} - ${log.calledAt.toISOString()} - ${log.durationMs}ms${errorInfo}`);
    });

  } catch (error: any) {
    console.error('❌ 查询失败:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAgentLogs();
