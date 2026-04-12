/**
 * StudentBaseline 表创建脚本
 * 
 * 用途：
 * 1. 验证 StudentBaseline 表结构
 * 2. 为现有用户创建基线记录
 * 3. 测试基线数据 CRUD 操作
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 开始验证 StudentBaseline 表结构...\n');

  // 1. 检查表是否存在
  try {
    console.log(`✅ 检查 student_baselines 表...`);
    
    // 尝试查询表（如果表不存在会抛出错误）
    await prisma.$queryRaw`SELECT 1 FROM student_baselines LIMIT 1`;
    console.log(`✅ student_baselines 表存在\n`);
  } catch (error: any) {
    console.error(`❌ student_baselines 表不存在或未正确创建`);
    console.error(`错误信息：${error.message}`);
    return;
  }

  // 2. 检查 learning_sessions 表的新字段
  console.log('✅ 检查 learning_sessions 表结构...');
  try {
    const sample = await prisma.learning_sessions.findFirst({
      take: 1,
      select: {
        id: true,
        userId: true,
        goalId: true,
        messages: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    console.log('✅ learning_sessions 表包含新字段 (messages, state)\n');
  } catch (error: any) {
    console.error('❌ learning_sessions 表结构验证失败');
    console.error(`错误信息：${error.message}`);
  }

  // 3. 查询现有用户
  console.log('📊 查询现有用户...');
  const users = await prisma.users.findMany({
    select: {
      id: true,
      email: true,
      name: true,
    },
    take: 10,
  });
  console.log(`找到 ${users.length} 个用户\n`);

  // 4. 为没有基线的用户创建基线记录
  console.log('📝 检查并创建用户基线记录...');
  let createdCount = 0;
  let existingCount = 0;

  for (const user of users) {
    try {
      // 检查是否已有基线
      const existingBaseline = await prisma.student_baselines.findUnique({
        where: { userId: user.id },
      });

      if (existingBaseline) {
        console.log(`  ⏭️  用户 ${user.email} 已有基线记录`);
        existingCount++;
      } else {
        // 创建基线
        await prisma.student_baselines.create({
          data: {
            id: `sb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId: user.id,
            responseTimeEma: 10.0,
            responseTimeEmVar: 1.0,
            messageLengthEma: 50.0,
            messageLengthEmVar: 100.0,
            interactionIntervalEma: 5.0,
            interactionIntervalEmVar: 1.0,
            aiScoreEma: 0.5,
            aiScoreEmVar: 0.01,
            updateCount: 0,
          },
        });
        console.log(`  ✅ 为用户 ${user.email} 创建基线记录`);
        createdCount++;
      }
    } catch (error: any) {
      console.error(`  ❌ 处理用户 ${user.email} 时出错：${error.message}`);
    }
  }

  console.log(`\n📊 基线记录统计:`);
  console.log(`  - 新建：${createdCount}`);
  console.log(`  - 已有：${existingCount}`);
  console.log(`  - 总计：${createdCount + existingCount}\n`);

  // 5. 创建测试数据
  console.log('🧪 创建测试数据...');
  
  // 创建测试学习会话
  const testUser = users[0];
  if (testUser) {
    try {
const testSession = await prisma.learning_sessions.create({
          data: {
            id: `ls_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId: testUser.id,
            messages: JSON.stringify([
              {
                role: 'user',
                content: '我想学习 Python 编程',
                timestamp: new Date().toISOString(),
              },
              {
                role: 'assistant',
                content: '好的！Python 是一门很好的编程语言。让我了解一下你的学习目标...',
                timestamp: new Date().toISOString(),
              },
            ]),
            state: JSON.stringify({
              cognitive: 0.5,
              stress: 0.3,
              engagement: 0.7,
              anomaly: false,
              assessedAt: new Date().toISOString(),
            }),
            updatedAt: new Date()
          },
        });
      console.log(`✅ 创建测试学习会话：${testSession.id}`);
    } catch (error: any) {
      console.error(`❌ 创建测试会话失败：${error.message}`);
    }
  }

  // 6. 查询并显示基线数据示例
  console.log('\n📋 基线数据示例:');
  const baselineSample = await prisma.student_baselines.findMany({
    take: 3,
    include: {
      users: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  if (baselineSample.length > 0) {
    console.table(
      baselineSample.map((b) => ({
        '用户': b.users.email,
        '响应时间 EMA': `${b.responseTimeEma.toFixed(1)}s`,
        '消息长度 EMA': `${b.messageLengthEma.toFixed(0)}字符`,
        '互动间隔 EMA': `${b.interactionIntervalEma.toFixed(1)}分钟`,
        'AI 评分 EMA': `${(b.aiScoreEma * 100).toFixed(0)}%`,
        '更新次数': b.updateCount,
      }))
    );
  } else {
    console.log('  (无基线数据)');
  }

  console.log('\n✅ 验证完成！\n');
}

main()
  .catch((e) => {
    console.error('❌ 脚本执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
