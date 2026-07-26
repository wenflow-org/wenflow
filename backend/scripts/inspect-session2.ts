import prisma from '../src/config/database'

function j(v: any) {
  return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? Number(val) : val), 2)
}

async function main() {
  const id = process.argv[2] || 'c194e437-f96d-425b-bb1c-bcae2b2b7bce'
  const rows: any = await prisma.$queryRawUnsafe(
    'SELECT id, virtualProfileId, status, currentStage, goalConversationId, length(stageResults) as srLen, length(logs) as logLen FROM virtual_sessions WHERE id = ?',
    id
  )
  console.log('meta', j(rows))
  const full: any = await prisma.$queryRawUnsafe(
    'SELECT stageResults, logs FROM virtual_sessions WHERE id = ?',
    id
  )
  let sr = full?.[0]?.stageResults
  let logs = full?.[0]?.logs
  if (typeof sr === 'string') {
    try {
      sr = JSON.parse(sr)
    } catch {}
  }
  if (typeof logs === 'string') {
    try {
      logs = JSON.parse(logs)
    } catch {}
  }
  console.log(
    'goal',
    j({
      keys: sr?.goal ? Object.keys(sr.goal) : [],
      lastRuntimeEnvelope: sr?.goal?.lastRuntimeEnvelope || null,
      learnerStateKeys: sr?.goal?.learnerState ? Object.keys(sr.goal.learnerState) : []
    })
  )
  const logArr = Array.isArray(logs) ? logs : []
  console.log('logs.count', logArr.length)
  for (const item of logArr.slice(-12)) {
    const output = item?.details?.output || {}
    console.log(
      'log',
      j({
        phase: item.phase,
        hasEnvelope: !!output.runtimeEnvelope,
        env: output.runtimeEnvelope?.businessState || null,
        mode: output.runtimeEnvelope?.contextUpdate?.mode || null,
        reply: String(output.reply || '').slice(0, 100)
      })
    )
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
