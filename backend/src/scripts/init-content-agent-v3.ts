import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initializeContentAgentV3() {
  console.log('开始初始化 ContentAgent v3.0...\n');
  
  try {
    // 1. 创建 Prompt 模板
    console.log('【1】创建 Prompt 模板...');
    
    const prompts = [
      {
        agentId: 'content-agent-v3',
        version: 1,
        name: 'BASIC 策略 - 基础引导',
        description: '面向理解度低的学生（problemClarity < 0.3），使用生活类比和详细例子',
        systemPrompt: `你是一位耐心的 AI 教师，专注于编程教学。

【学生状态】
- 理解度较低（problemClarity < 0.3）
- 可能需要从零开始讲解

【教学要求】
1. 使用生活类比解释概念
2. 避免专业术语，或使用后立即解释
3. 从零开始，循序渐进
4. 多举例子，每个例子都要详细说明
5. 语气耐心、温和

【输出格式】
{
  "uiType": "input",
  "question": "问题或引导语",
  "inputHint": "输入提示",
  "hint": "可选提示"
}`,
        temperature: 0.7,
        maxTokens: 2000,
        model: process.env.AI_MODEL || 'deepseek-chat',
        status: 'active',
        createdBy: 'system'
      },
      {
        agentId: 'content-agent-v3',
        version: 2,
        name: 'SCAFFOLD 策略 - 支架引导',
        description: '面向理解度中等的学生（0.3 <= problemClarity < 0.6），提供关键步骤提示',
        systemPrompt: `你是一位善于引导的 AI 教师，帮助学生自己找到答案。

【学生状态】
- 理解度中等（0.3 <= problemClarity < 0.6）
- 有一定基础，但还需要引导

【教学要求】
1. 不直接给答案，而是提示关键步骤
2. 提供参考资料或示例代码的框架
3. 鼓励学生尝试自己完成
4. 在学生卡住时给予适当提示
5. 语气鼓励、支持

【输出格式】
{
  "uiType": "input",
  "question": "引导性问题",
  "inputHint": "输入提示",
  "hint": "关键步骤提示",
  "referenceCode": "可选的代码框架"
}`,
        temperature: 0.6,
        maxTokens: 1800,
        model: process.env.AI_MODEL || 'deepseek-chat',
        status: 'active',
        createdBy: 'system'
      },
      {
        agentId: 'content-agent-v3',
        version: 3,
        name: 'ZPD 策略 - 最近发展区',
        description: '面向理解度良好的学生（0.6 <= problemClarity < 0.8），引导思考和探索',
        systemPrompt: `你是一位启发式的 AI 教师，引导学生深入思考。

【学生状态】
- 理解度良好（0.6 <= problemClarity < 0.8）
- 能够独立思考，需要的是方向指引

【教学要求】
1. 引导思考，不给直接答案
2. 指出方向和思路
3. 提出有挑战性的问题
4. 鼓励探索不同的解决方案
5. 语气平等、探讨式

【输出格式】
{
  "uiType": "input",
  "question": "启发性问题",
  "inputHint": "思考方向",
  "challengeQuestion": "可选的挑战性问题"
}`,
        temperature: 0.5,
        maxTokens: 1600,
        model: process.env.AI_MODEL || 'deepseek-chat',
        status: 'active',
        createdBy: 'system'
      },
      {
        agentId: 'content-agent-v3',
        version: 4,
        name: 'DISCUSS 策略 - 讨论探索',
        description: '面向理解度优秀的学生（0.8 <= problemClarity < 0.95），共同讨论和优化方案',
        systemPrompt: `你是一位专业的 AI 合作伙伴，与学生共同探索最优方案。

【学生状态】
- 理解度优秀（0.8 <= problemClarity < 0.95）
- 有很强的独立能力，需要的是深度交流

【教学要求】
1. 讨论方案的优缺点
2. 提供优化建议
3. 共同探索更好的实现方式
4. 分享最佳实践和经验
5. 语气专业、合作式

【输出格式】
{
  "uiType": "input",
  "question": "讨论话题",
  "inputHint": "讨论方向",
  "optimizationSuggestion": "可选的优化建议"
}`,
        temperature: 0.4,
        maxTokens: 1500,
        model: process.env.AI_MODEL || 'deepseek-chat',
        status: 'active',
        createdBy: 'system'
      },
      {
        agentId: 'content-agent-v3',
        version: 5,
        name: 'EXPERT 策略 - 专家交流',
        description: '面向理解度极高的学生（problemClarity >= 0.95），深度技术交流和前沿探讨',
        systemPrompt: `你是一位资深的技术专家，与学生进行高水平的技术交流。

【学生状态】
- 理解度极高（problemClarity >= 0.95）
- 接近专家水平，需要的是前沿探讨

【教学要求】
1. 深度技术交流，无需基础解释
2. 挑战性提问，推动思考边界
3. 分享前沿技术和趋势
4. 讨论架构设计和权衡
5. 语气尊重、欣赏式

【输出格式】
{
  "uiType": "input",
  "question": "深度技术问题",
  "inputHint": "探讨方向",
  "advancedTopic": "可选的前沿话题"
}`,
        temperature: 0.3,
        maxTokens: 1400,
        model: process.env.AI_MODEL || 'deepseek-chat',
        status: 'active',
        createdBy: 'system'
      }
    ];
    
    for (const prompt of prompts) {
      // 检查是否已存在
      const existing = await prisma.agent_prompts.findUnique({
        where: {
          agentId_version: {
            agentId: 'content-agent-v3',
            version: prompt.version
          }
        }
      });
      
      if (existing) {
        console.log(`  ✓ Prompt v${prompt.version} 已存在：${prompt.name}`);
      } else {
        const created = await prisma.agent_prompts.create({
          data: {
            id: `ap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${prompt.version}`,
            ...prompt
          }
        });
        console.log(`  ✅ 创建 Prompt v${created.version}: ${created.name}`);
      }
    }
    
    // 2. 验证注册
    console.log('\n【2】验证 Agent 注册...');
    const agentCount = await prisma.agent_prompts.count({
      where: { agentId: 'content-agent-v3' }
    });
    
    if (agentCount >= 5) {
      console.log(`  ✅ ContentAgent v3.0 已注册（${agentCount} 个 Prompt 模板）`);
    } else {
      console.log(`  ⚠️ 只找到 ${agentCount} 个 Prompt 模板，预期 5 个`);
    }
    
    // 3. 检查数据库字段
    console.log('\n【3】检查数据库字段...');
    
    // 检查 learning_metrics 表
    const lmFields = await prisma.$queryRaw`
      SELECT name FROM pragma_table_info('learning_metrics')
    ` as any[];
    const hasLSS = lmFields.some((f: any) => f.name === 'lss');
    const hasKTL = lmFields.some((f: any) => f.name === 'ktl');
    const hasLF = lmFields.some((f: any) => f.name === 'lf');
    const hasLSB = lmFields.some((f: any) => f.name === 'lsb');
    
    console.log(`  learning_metrics.lss: ${hasLSS ? '✅' : '❌'}`);
    console.log(`  learning_metrics.ktl: ${hasKTL ? '✅' : '❌'}`);
    console.log(`  learning_metrics.lf: ${hasLF ? '✅' : '❌'}`);
    console.log(`  learning_metrics.lsb: ${hasLSB ? '✅' : '❌'}`);
    
    // 检查 student_baselines 表
    const sbFields = await prisma.$queryRaw`
      SELECT name FROM pragma_table_info('student_baselines')
    ` as any[];
    const hasEMA = sbFields.some((f: any) => f.name === 'responseTimeEma');
    const hasUpdateCount = sbFields.some((f: any) => f.name === 'updateCount');
    
    console.log(`  student_baselines.responseTimeEma: ${hasEMA ? '✅' : '❌'}`);
    console.log(`  student_baselines.updateCount: ${hasUpdateCount ? '✅' : '❌'}`);
    
    // 4. 显示当前统计
    console.log('\n【4】当前数据库统计...');
    const totalUsers = await prisma.users.count();
    const totalSessions = await prisma.learning_sessions.count();
    const totalMetrics = await prisma.learning_metrics.count();
    const totalBaselines = await prisma.student_baselines.count();
    
    console.log(`  总用户数：${totalUsers}`);
    console.log(`  学习会话数：${totalSessions}`);
    console.log(`  学习指标记录数：${totalMetrics}`);
    console.log(`  学生基线记录数：${totalBaselines}`);
    
    console.log('\n✅ ContentAgent v3.0 初始化完成！');
    
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行初始化
if (require.main === module) {
  initializeContentAgentV3()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { initializeContentAgentV3 };