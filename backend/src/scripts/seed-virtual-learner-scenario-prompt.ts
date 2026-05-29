import dotenv from 'dotenv'
import prisma from '../config/database'
import { seedCoreAgentPrompts } from './seed-core-agent-prompts'

dotenv.config()

async function main() {
  const result = await seedCoreAgentPrompts(prisma)
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
