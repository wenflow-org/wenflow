const { PrismaClient } = require('@prisma/client')
const { v4: uuidv4 } = require('uuid')

const prisma = new PrismaClient()

const prompt = `你是一位专业的课程设计师，负责创建里程碑式学习路径。

目标：根据用户目标、基础、可用时间与场景，输出可执行的阶段化学习路径。

硬规则：
1. 仅输出 JSON，不输出解释文本。
2. 路径名称必须贴合用户原始目标，避免通用模板名。
3. 里程碑需有递进关系，普通目标 3-6 个，长目标 6-10 个。
4. 每个里程碑建议 4-8 个子任务，任务类型可混合 reading/practice/project/quiz。
5. 子任务 estimatedMinutes 建议 30-120，需结合用户可用时间。
6. 若提供具体应用场景，里程碑与任务必须围绕该场景，不使用通用示例。
7. 若用户水平是 beginner，路径名称与阶段措辞禁止出现“高级/进阶/中级”。
8. 若用户已确认方案轮廓（方向/阶段/学习方式），必须保持方向一致。
9. 后续会支持重调：已完成学习内容不可改写。当前先生成初始路径。

输出格式：
{
  "name": "路径名称",
  "totalMilestones": 4,
  "estimatedHours": 24,
  "milestones": [
    {
      "stageNumber": 1,
      "title": "里程碑标题",
      "description": "里程碑描述",
      "goal": "阶段目标",
      "estimatedHours": 6,
      "subtasks": [
        {
          "title": "子任务标题",
          "type": "reading",
          "estimatedMinutes": 60,
          "description": "任务描述",
          "acceptanceCriteria": "完成标准"
        }
      ]
    }
  ]
}`

async function main() {
  const agentId = 'skill:path-planning'
  const model = process.env.AI_MODEL || null

  const latest = await prisma.agent_prompts.findFirst({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: { version: true }
  })

  const nextVersion = (latest?.version || 0) + 1

  const created = await prisma.$transaction(async (tx) => {
    await tx.agent_prompts.updateMany({
      where: { agentId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED', updatedAt: new Date() }
    })

    return tx.agent_prompts.create({
      data: {
        id: uuidv4(),
        agentId,
        version: nextVersion,
        name: `v${nextVersion}-path-milestone-json`,
        description: 'Path generation prompt for milestone planning with strict JSON output',
        systemPrompt: prompt,
        temperature: 0.5,
        maxTokens: 10000,
        model,
        status: 'ACTIVE',
        createdBy: 'opencode',
        publishedAt: new Date()
      }
    })
  })

  console.log('Published path-agent prompt:')
  console.log(JSON.stringify({
    id: created.id,
    agentId: created.agentId,
    version: created.version,
    status: created.status,
    model: created.model
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to publish path prompt:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
