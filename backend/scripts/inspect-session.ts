import prisma from '../src/config/database'

async function main() {
  const id = process.argv[2] || 'c194e437-f96d-425b-bb1c-bcae2b2b7bce'
  const rows: any = await prisma.$queryRawUnsafe(
    'SELECT id, virtualProfileId, userId, status, currentStage, goalConversationId, learningPathId, length(stageResults) as srLen, length(logs) as logLen, createdAt, updatedAt FROM virtual_sessions WHERE id = ?',
    id
  )
  console.log('session', JSON.stringify(rows, null, 2))
  if (rows?.[0]) {
    const sr: any = await prisma.$queryRawUnsafe(
      'SELECT substr(stageResults,1,800) as sr FROM virtual_sessions WHERE id = ?',
      id
    )
    console.log('stageResults-prefix', sr?.[0]?.sr)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
