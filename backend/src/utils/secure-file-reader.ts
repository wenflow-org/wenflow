import { constants } from 'fs';
import { open, realpath } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

export async function readFileWithinRoots(options: {
  filePath: unknown;
  allowedRoots: unknown;
  baseDirectory?: string;
  maxFileSize?: unknown;
}): Promise<string> {
  if (typeof options.filePath !== 'string' || !options.filePath.trim() || options.filePath.includes('\0')) {
    throw new Error('文件路径无效');
  }
  if (!Array.isArray(options.allowedRoots) || options.allowedRoots.length === 0) {
    throw new Error('文件读取未配置允许目录');
  }

  const hasConfiguredMax = options.maxFileSize !== undefined && options.maxFileSize !== null;
  const configuredMax = Number(options.maxFileSize);
  if (hasConfiguredMax && (!Number.isSafeInteger(configuredMax) || configuredMax <= 0)) {
    throw new Error('文件大小上限配置无效');
  }
  const maxFileSize = hasConfiguredMax ? configuredMax : DEFAULT_MAX_FILE_SIZE;
  const baseDirectory = resolve(options.baseDirectory || process.cwd());
  const requestedPath = isAbsolute(options.filePath)
    ? resolve(options.filePath)
    : resolve(baseDirectory, options.filePath);

  let roots: string[];
  try {
    roots = await Promise.all(options.allowedRoots.map(async root => {
      if (typeof root !== 'string' || !root.trim() || root.includes('\0')) {
        throw new Error('允许目录配置无效');
      }
      const configuredRoot = isAbsolute(root) ? resolve(root) : resolve(baseDirectory, root);
      return realpath(configuredRoot);
    }));
  } catch (error) {
    if (error instanceof Error && error.message === '允许目录配置无效') throw error;
    throw new Error('允许目录不可用');
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch {
    throw new Error('文件不存在或不可访问');
  }
  if (!roots.some(root => isPathWithinRoot(root, canonicalPath))) {
    throw new Error('文件路径不在允许范围内');
  }

  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(canonicalPath, constants.O_RDONLY | noFollow);
  } catch {
    throw new Error('文件不存在或不可访问');
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('只允许读取常规文件');
    if (stat.size > maxFileSize) throw new Error('文件大小超过允许上限');

    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset <= maxFileSize) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxFileSize + 1 - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (offset > maxFileSize) throw new Error('文件大小超过允许上限');
    return Buffer.concat(chunks, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}
