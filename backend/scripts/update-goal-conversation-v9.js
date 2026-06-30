const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const filePath = path.join(__dirname, 'publish-goal-conversation-prompt.js')
  const source = fs.readFileSync(filePath, 'utf8')
  const match = source.match(/const prompt = `([\s\S]*?)`\s*\n\s*async function main/)

  if (!match) {
    throw new Error('Prompt text not found in publish script')
  }

  const prompt = match[1]

  const updateResult = await prisma.agent_prompts.updateMany({
    where: {
      agentId: 'skill:goal-conversation',
      version: 9
    },
    data: {
      systemPrompt: prompt,
      updatedAt: new Date()
    }
  })

  const record = await prisma.agent_prompts.findFirst({
    where: {
      agentId: 'skill:goal-conversation',
      version: 9
    },
    select: {
      id: true,
      agentId: true,
      version: true,
      status: true,
      updatedAt: true,
      publishedAt: true
    }
  })

  console.log(JSON.stringify({
    updatedCount: updateResult.count,
    record
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to update v9 prompt:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
