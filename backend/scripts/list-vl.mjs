import { PrismaClient } from '../src/generated/client/index.js'
import dotenv from 'dotenv'
dotenv.config()
const p = new PrismaClient()
const id = process.argv[2] || 'c194e437-f96d-425b-bb1c-bcae2b2b7bce'
const exact = await p.virtual_learner_profiles.findUnique({ where: { id } })
console.log('exact', exact ? { id: exact.id, goal: String(exact.learningGoal||'').slice(0,80), userId: exact.userId } : null)
const list = await p.virtual_learner_profiles.findMany({
  take: 20,
  orderBy: { createdAt: 'desc' },
  select: { id: true, learningGoal: true, createdAt: true, userId: true }
})
console.log(JSON.stringify(list.map(x => ({
  id: x.id,
  goal: String(x.learningGoal||'').slice(0,60),
  createdAt: x.createdAt
})), null, 2))
await p.$disconnect()
