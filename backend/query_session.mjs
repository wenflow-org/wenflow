import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const s = await p.teaching_sessions.findUnique({ where: { id: 'st_1781758340834_hj7pzav_1_0' } })
if (!s) { console.log('NOT FOUND'); process.exit(0) }
console.log('status:', s.status)
console.log('topic:', s.topic)
console.log('knowledgeState:', s.knowledgeState?.substring(0, 1500))
const ts = s.teachingState ? JSON.parse(s.teachingState) : null
console.log('teachingState keys:', ts ? Object.keys(ts) : null)
console.log('sessionArtifacts endReason:', ts?.sessionArtifacts?.endReason)
const iks = ts?.sessionArtifacts?.initialKnowledgeState
console.log('initialKnowledgeState:', iks ? JSON.stringify(iks).substring(0,500) : 'none')
await p.$disconnect()
