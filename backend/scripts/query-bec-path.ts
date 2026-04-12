import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 查找最近的商务英语学习路径
  const path = await prisma.learning_paths.findFirst({
    where: {
      title: { contains: 'BEC' }
    },
    include: {
      milestones: {
        include: {
          subtasks: true
        },
        orderBy: { stageNumber: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  if (path) {
    console.log('=== 学习路径基本信息 ===');
    console.log('ID:', path.id);
    console.log('标题:', path.title);
    console.log('创建时间:', path.createdAt);
    console.log('Deadline:', path.deadline);
    console.log('Deadline Text:', path.deadlineText);
    console.log('状态:', path.status);
    console.log('用户ID:', path.userId);
    console.log('');
    
    console.log('=== 阶段信息 ===');
    console.log('阶段数量:', path.milestones.length);
    path.milestones.forEach(milestone => {
      console.log(`阶段 ${milestone.stageNumber}: ${milestone.title} - 任务数: ${milestone.subtasks.length}`);
    });
    console.log('');
    
    console.log('=== 总任务数 ===');
    let totalTasks = 0;
    path.milestones.forEach(milestone => {
      totalTasks += milestone.subtasks.length;
    });
    console.log('总任务数:', totalTasks);
    console.log('');
    
    console.log('=== Anderson 标注情况 ===');
    let annotatedTasks = 0;
    const cognitiveStats: Record<string, number> = {};
    const knowledgeStats: Record<string, number> = {};
    
    path.milestones.forEach(milestone => {
      milestone.subtasks.forEach(task => {
        if (task.cognitiveLevel) {
          annotatedTasks++;
          cognitiveStats[task.cognitiveLevel] = (cognitiveStats[task.cognitiveLevel] || 0) + 1;
        }
        if (task.knowledgeType) {
          knowledgeStats[task.knowledgeType] = (knowledgeStats[task.knowledgeType] || 0) + 1;
        }
      });
    });
    
    console.log('已标注任务数:', annotatedTasks);
    console.log('标注率:', (annotatedTasks / totalTasks * 100).toFixed(1) + '%');
    console.log('');
    
    console.log('认知层级分布:');
    Object.entries(cognitiveStats).forEach(([level, count]) => {
      console.log(`- ${level}: ${count}个任务 (${(count/annotatedTasks*100).toFixed(1)}%)`);
    });
    console.log('');
    
    console.log('知识类型分布:');
    Object.entries(knowledgeStats).forEach(([type, count]) => {
      console.log(`- ${type}: ${count}个任务`);
    });
    
    // 输出第一个阶段的前几个任务示例
    console.log('');
    console.log('=== 第一阶段任务示例 ===');
    const firstMilestone = path.milestones[0];
    if (firstMilestone) {
      console.log(`阶段名称: ${firstMilestone.title}`);
      console.log(`阶段目标: ${firstMilestone.goal}`);
      console.log('');
      firstMilestone.subtasks.slice(0, 5).forEach(task => {
        console.log(`- ${task.title}`);
        console.log(`  认知层级: ${task.cognitiveLevel || '未标注'}`);
        console.log(`  知识类型: ${task.knowledgeType || '未标注'}`);
        console.log(`  核心概念: ${task.coreConcept || '未标注'}`);
        console.log(`  类型: ${task.taskType}`);
        console.log(`  预计时间: ${task.estimatedMinutes}分钟`);
        console.log(`  标注置信度: ${task.annotationConfidence || '未标注'}`);
        console.log('');
      });
    }
    
    // 时间约束分析
    console.log('=== 时间约束分析 ===');
    console.log('用户指定时间: 9个月');
    console.log('Deadline存储状态:', path.deadline ? '已存储' : '未存储');
    console.log('DeadlineText:', path.deadlineText || '未存储');
    console.log('');
    
    // 阶段合理性分析
    console.log('=== 阶段合理性分析 ===');
    console.log('当前阶段数:', path.milestones.length);
    console.log('推荐阶段数范围: 4-6个');
    console.log('评估:', path.milestones.length >= 4 && path.milestones.length <= 6 ? '✅ 合理' : '⚠️ 需关注');
    console.log('');
    
    // 任务密度分析
    console.log('=== 任务密度分析 ===');
    const avgTasksPerMilestone = totalTasks / path.milestones.length;
    console.log('平均每阶段任务数:', avgTasksPerMilestone.toFixed(1));
    console.log('推荐值: 3-5个');
    console.log('评估:', avgTasksPerMilestone <= 5 ? '✅ 合理' : '⚠️ 任务过多');
    console.log('');
    
    // 阶段任务分布
    console.log('=== 各阶段任务分布 ===');
    path.milestones.forEach(milestone => {
      const avgTimePerTask = milestone.subtasks.reduce((sum, task) => sum + task.estimatedMinutes, 0) / milestone.subtasks.length;
      console.log(`阶段${milestone.stageNumber}: ${milestone.subtasks.length}个任务, 平均${avgTimePerTask.toFixed(0)}分钟/任务`);
    });
    
  } else {
    console.log('未找到商务英语学习路径');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());