import prisma from '../src/config/database'

async function main() {
  const id = 'c194e437-f96d-425b-bb1c-bcae2b2b7bce'
  const tables = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%virtual%'"
  )
  console.log('tables', tables)

  // search id in common columns
  for (const t of tables as any[]) {
    const name = t.name
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM ${name} WHERE id = ? OR cast(id as text) = ? LIMIT 3`,
        id,
        id
      )
      if (Array.isArray(rows) && rows.length) {
        console.log('found in', name, JSON.stringify(rows).slice(0, 300))
      }
    } catch (e: any) {
      // ignore
    }
  }

  const sessions = await (prisma as any).virtual_learner_sessions
    ?.findMany?.({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, profileId: true, status: true, currentStage: true, currentPhase: true, createdAt: true }
    })
    .catch(() => null)

  if (sessions) console.log('sessions', JSON.stringify(sessions, null, 2))
  else {
    // try raw
    try {
      const s = await prisma.$queryRawUnsafe(
        "SELECT id, profileId, status, currentStage, createdAt FROM virtual_learner_sessions ORDER BY createdAt DESC LIMIT 10"
      )
      console.log('sessions-raw', s)
    } catch (e: any) {
      console.log('sessions-err', e.message)
    }
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
