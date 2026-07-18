import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { isPathWithinRoot, readFileWithinRoots } from '../secure-file-reader'

describe('secure file reader', () => {
  let workspace: string
  let allowed: string
  let outside: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'wenflow-file-reader-'))
    allowed = join(workspace, 'uploads')
    outside = join(workspace, 'uploads-private')
    await mkdir(allowed)
    await mkdir(outside)
    await writeFile(join(allowed, 'lesson.txt'), '安全内容')
    await writeFile(join(outside, 'secret.txt'), 'secret')
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('读取允许目录内的常规文件', async () => {
    await expect(readFileWithinRoots({
      filePath: './uploads/lesson.txt',
      allowedRoots: ['./uploads'],
      baseDirectory: workspace,
      maxFileSize: 1024
    })).resolves.toBe('安全内容')
  })

  it('拒绝相邻前缀目录和目录穿越', async () => {
    await expect(readFileWithinRoots({
      filePath: './uploads-private/secret.txt',
      allowedRoots: ['./uploads'],
      baseDirectory: workspace
    })).rejects.toThrow('允许范围')

    await expect(readFileWithinRoots({
      filePath: './uploads/../uploads-private/secret.txt',
      allowedRoots: ['./uploads'],
      baseDirectory: workspace
    })).rejects.toThrow('允许范围')
  })

  it('拒绝通过符号链接逃逸允许目录', async () => {
    await symlink(outside, join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(readFileWithinRoots({
      filePath: './uploads/escape/secret.txt',
      allowedRoots: ['./uploads'],
      baseDirectory: workspace
    })).rejects.toThrow('允许范围')
  })

  it('拒绝目录和超出字节上限的文件', async () => {
    await writeFile(join(allowed, 'large.txt'), '12345')
    await expect(readFileWithinRoots({
      filePath: allowed,
      allowedRoots: [allowed],
      maxFileSize: 10
    })).rejects.toThrow('常规文件')
    await expect(readFileWithinRoots({
      filePath: join(allowed, 'large.txt'),
      allowedRoots: [allowed],
      maxFileSize: 4
    })).rejects.toThrow('大小')
  })

  it('无效的文件大小配置安全失败', async () => {
    await expect(readFileWithinRoots({
      filePath: join(allowed, 'lesson.txt'),
      allowedRoots: [allowed],
      maxFileSize: 0
    })).rejects.toThrow('配置无效')
  })

  it('文件或允许目录不可用时不泄露绝对路径', async () => {
    const missingFile = join(allowed, 'private-name.txt')
    const missingRoot = join(workspace, 'private-root')
    const captureError = async (promise: Promise<unknown>): Promise<Error> => {
      try {
        await promise
        throw new Error('expected promise to reject')
      } catch (error) {
        return error as Error
      }
    }
    const fileError = await captureError(readFileWithinRoots({
      filePath: missingFile,
      allowedRoots: [allowed]
    }))
    const rootError = await captureError(readFileWithinRoots({
      filePath: join(allowed, 'lesson.txt'),
      allowedRoots: [missingRoot]
    }))

    expect(fileError.message).toBe('文件不存在或不可访问')
    expect(rootError.message).toBe('允许目录不可用')
    expect(fileError.message).not.toContain(workspace)
    expect(rootError.message).not.toContain(workspace)
  })

  it('使用路径边界而不是字符串前缀', () => {
    expect(isPathWithinRoot(resolve(allowed), resolve(allowed, 'lesson.txt'))).toBe(true)
    expect(isPathWithinRoot(resolve(allowed), resolve(outside, 'secret.txt'))).toBe(false)
  })
})
