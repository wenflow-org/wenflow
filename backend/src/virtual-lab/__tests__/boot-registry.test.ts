import { PrismaBootRegistry } from '../boot-registry'
import type { PrismaClient } from '@prisma/client'

/** 回归：Prisma SQLite 的 $queryRawUnsafe 把 INTEGER 列返回为 BigInt，
 *  Number.isFinite(BigInt) 恒 false 曾让 oldestLiveBoot 永远返回 null（快档被静默废掉）。 */
describe('PrismaBootRegistry.oldestLiveBoot', () => {
  const NOW = new Date('2026-10-02T16:00:00.000Z')

  function registryWithRows(rows: unknown) {
    const queryRawUnsafe = jest.fn().mockResolvedValue(rows)
    const executeRawUnsafe = jest.fn().mockResolvedValue(0)
    const registry = new PrismaBootRegistry({
      $queryRawUnsafe: queryRawUnsafe,
      $executeRawUnsafe: executeRawUnsafe
    } as unknown as Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>)
    return { registry, queryRawUnsafe }
  }

  it('BigInt 聚合值正确转 Number 并返回 Date', async () => {
    const { registry } = registryWithRows([{ min_boot: 1792000000000n }])
    const floor = await registry.oldestLiveBoot(NOW, 45 * 60 * 1000)
    expect(floor).toEqual(new Date(1792000000000))
  })

  it('无存活行（MIN=null）返回 null', async () => {
    const { registry } = registryWithRows([{ min_boot: null }])
    const floor = await registry.oldestLiveBoot(NOW, 45 * 60 * 1000)
    expect(floor).toBeNull()
  })

  it('空结果集返回 null', async () => {
    const { registry } = registryWithRows([])
    const floor = await registry.oldestLiveBoot(NOW, 45 * 60 * 1000)
    expect(floor).toBeNull()
  })
})
