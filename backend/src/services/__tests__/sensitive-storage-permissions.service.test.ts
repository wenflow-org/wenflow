import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  auditSensitivePaths,
  isPosixModeTooOpen,
  isWindowsAclTooOpen,
  repairSensitivePaths
} from '../sensitive-storage-permissions.service'

describe('permission rules', () => {
  it('识别 POSIX 目录和文件的过宽权限', () => {
    expect(isPosixModeTooOpen(0o700, 'directory')).toBe(false)
    expect(isPosixModeTooOpen(0o755, 'directory')).toBe(true)
    expect(isPosixModeTooOpen(0o600, 'file')).toBe(false)
    expect(isPosixModeTooOpen(0o640, 'file')).toBe(true)
  })

  it('识别 Windows 宽泛主体', () => {
    expect(isWindowsAclTooOpen('BUILTIN\\Users:(RX)')).toBe(true)
    expect(isWindowsAclTooOpen('NT AUTHORITY\\SYSTEM:(F)')).toBe(false)
  })
})

const posixOnly = process.platform === 'win32' ? describe.skip : describe

posixOnly('sensitive storage permissions', () => {
  let directory: string
  let file: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wenflow-permissions-'))
    file = join(directory, 'secret.env')
    await writeFile(file, 'secret')
    await chmod(directory, 0o755)
    await chmod(file, 0o644)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('检测过宽权限并显式修复为 0700/0600', async () => {
    const targets = [
      { path: directory, kind: 'directory' as const },
      { path: file, kind: 'file' as const }
    ]
    expect((await auditSensitivePaths(targets, 'linux')).map(item => item.status))
      .toEqual(['too_open', 'too_open'])

    await repairSensitivePaths(targets, { apply: true, platform: 'linux' })
    expect((await auditSensitivePaths(targets, 'linux')).map(item => item.status))
      .toEqual(['ok', 'ok'])
  })

  it('未显式 apply 时拒绝修复', async () => {
    await expect(repairSensitivePaths([], { apply: false, platform: 'linux' }))
      .rejects.toThrow('--apply')
  })
})
