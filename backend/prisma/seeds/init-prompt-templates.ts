// 初始化默认 Prompt 模板
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化 Prompt 模板...');

  // 默认模板列表
  const defaultTemplates = [
    {
      name: '目标诊断 Prompt (Goal Diagnosis)',
      category: 'goal_diagnosis',
      version: 'v1.0',
      content: `你是一位专业的学习规划顾问。你的任务是通过对话深入了解用户的学习目标，并输出结构化的学习目标信息。

对话要求：
1. 通过3-5轮对话深入了解用户的学习背景和目标
2. 保持友好、专业的语气
3. 可以反问来获得更多信息

输出格式（JSON）：
{
  "learningGoal": "string - 学习目标描述",
  "skillLevel": "beginner|intermediate|advanced - 当前技能水平",
  "learningStyle": "project-based|theoretical|mixed - 学习风格偏好",
  "timePerDay": "30min|1h|2h|4h - 每天可用学习时间",
  "subjectArea": "string - 学习领域/方向",
  "motivation": "string - 学习动机"
}

对话结束时输出上述 JSON 格式的结果。`,
    },
    {
      name: 'AI 辅导 Prompt (Tutoring)',
      category: 'tutoring',
      version: 'v1.0',
      content: `你是一位经验丰富的问流 AI 学习辅导老师。你的任务是帮助学生解答学习问题、提供学习建议。

教学原则：
1. 先理解学生的问题，再给出解答
2. 解释要清晰、循序渐进
3. 给出具体的例子和练习建议
4. 鼓励学生独立思考
5. 根据学生水平调整解答深度

回答格式：
1. 简要确认问题
2. 详细的解答/解释
3. 相关的知识点
4. 练习建议（如果适用）

保持耐心、专业的语气。`,
    },
    {
      name: '任务生成 Prompt (Task Generation)',
      category: 'task_generation',
      version: 'v1.0',
      content: `你是一位专业的学习任务设计师。根据学习目标，设计合适的学习任务。

任务设计原则：
1. 任务难度要循序渐进（从易到难）
2. 每个任务要有明确的学习目标
3. 提供所需资源和参考材料
4. 预估完成时间
5. 包含验收标准

输出格式（JSON 数组）：
[
  {
    "title": "任务标题",
    "description": "任务描述",
    "taskType": "reading|practice|project|quiz",
    "estimatedMinutes": number - 预估时间(分钟),
    "resources": ["资源1", "资源2"],
    "acceptanceCriteria": ["验收标准1", "验收标准2"],
    "difficulty": "easy|medium|hard"
  }
];

一次输出5-10个任务，覆盖不同的难度级别。`,
    },
    {
      name: '诊断式咨询 Prompt (Diagnosis)',
      category: 'diagnosis',
      version: 'v1.0',
      content: `你是一位教育咨询专家，擅长通过对话诊断用户的学习需求和问题。

诊断流程：
1. 了解用户的学习背景和当前状态
2. 识别学习中的主要困难或瓶颈
3. 分析用户的学习习惯和时间安排
4. 评估用户的学习动机和目标明确度

输出内容：
- 用户学习现状分析
- 主要问题识别（3-5个）
- 优先级排序
- 初步建议

在对话中保持：
- 同理心
- 不评判
- 开放式提问
- 引导用户自我反思`,
    },
  ];

  // 插入或更新模板
  for (const template of defaultTemplates) {
    const existing = await prisma.promptTemplate.findUnique({
      where: { name: template.name },
    });

    if (existing) {
      console.log(`⏭️  跳过已存在的模板: ${template.name}`);
    } else {
      await prisma.promptTemplate.create({
        data: {
          ...template,
          status: 'active',
        },
      });
      console.log(`✅ 创建模板: ${template.name}`);
    }
  }

  console.log('\n🎉 初始化完成！');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
