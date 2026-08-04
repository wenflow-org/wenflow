import { resolve } from 'path'
import { resolveSqlitePath, validateRuntimeDatabaseUrls } from '../runtime-paths'

describe('resolveSqlitePath', () => {
  it('按 Schema 目录解析相对 SQLite URL', () => {
    const mainSchemaDir = resolve('backend', 'prisma')
    const systemSchemaDir = resolve('backend', 'prisma', 'system')

    expect(resolveSqlitePath('file:./dev.db', mainSchemaDir)).toBe(resolve(mainSchemaDir, 'dev.db'))
    expect(resolveSqlitePath('file:../system.db', systemSchemaDir)).toBe(resolve(systemSchemaDir, '../system.db'))
  })

  it('忽略非文件数据库和内存数据库', () => {
    expect(resolveSqlitePath('postgresql://localhost/db', process.cwd())).toBeNull()
    expect(resolveSqlitePath('file::memory:', process.cwd())).toBeNull()
  })

  it('移除 query 并解码路径', () => {
    expect(resolveSqlitePath('file:./my%20db.db?connection_limit=1', process.cwd()))
      .toBe(resolve(process.cwd(), 'my db.db'))
  })

  it('拒绝旧嵌套或歧义 SQLite URL', () => {
    expect(() => validateRuntimeDatabaseUrls('file:./prisma/dev.db', 'file:../system.db'))
      .toThrow('DATABASE_URL')
    expect(() => validateRuntimeDatabaseUrls('file:./dev.db', 'file:./system.db'))
      .toThrow('SYSTEM_DATABASE_URL')
    expect(() => validateRuntimeDatabaseUrls('file:/app/data/dev.db', 'file:/app/data/system.db'))
      .not.toThrow()
  })
})
