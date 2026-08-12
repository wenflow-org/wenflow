/**
 * yaml-file-cache（mtime 失效解析缓存）单测
 *
 * - 命中：文件未变 → parse 只执行一次，返回同一对象
 * - mtime 变化失效：文件内容变更 → 重新解析
 * - size 兜底：mtime 被强制相同但 size 不同 → 仍失效（Windows 文件系统
 *   mtime 精度兜底）
 * - 可绕过：文件不存在不缓存，每次透传解析
 * - clearYamlFileCache 强制失效
 * - parse 抛错不写入缓存
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cachedFileParse, clearYamlFileCache } from '../yaml-file-cache';

describe('yaml-file-cache', () => {
  let dir = '';
  let file = '';

  beforeEach(() => {
    clearYamlFileCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-yaml-cache-'));
    file = path.join(dir, 'test.yaml');
  });

  afterEach(() => {
    clearYamlFileCache();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('命中：文件未变时 parse 只执行一次，返回同一对象', () => {
    fs.writeFileSync(file, 'version: 1\n', 'utf-8');
    const parse = jest.fn(() => fs.readFileSync(file, 'utf-8'));
    const first = cachedFileParse(file, parse);
    const second = cachedFileParse(file, parse);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('mtime 变化后失效：文件内容变更触发重新解析', () => {
    fs.writeFileSync(file, 'v1', 'utf-8');
    const parse = jest.fn(() => fs.readFileSync(file, 'utf-8'));
    const first = cachedFileParse(file, parse);
    fs.writeFileSync(file, 'v2-longer-content', 'utf-8');
    const second = cachedFileParse(file, parse);
    expect(first).toBe('v1');
    expect(second).toBe('v2-longer-content');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('size 兜底：mtime 相同但 size 变化仍失效（低精度文件系统）', () => {
    fs.writeFileSync(file, 'abc', 'utf-8');
    const parse = jest.fn(() => fs.readFileSync(file, 'utf-8'));
    cachedFileParse(file, parse);
    const before = fs.statSync(file);
    fs.writeFileSync(file, 'abcdef', 'utf-8');
    fs.utimesSync(file, before.atime, before.mtime); // 强制恢复旧 mtime
    const second = cachedFileParse(file, parse);
    expect(second).toBe('abcdef');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('可绕过：文件不存在不缓存，每次透传解析', () => {
    const parse = jest.fn(() => {
      throw new Error('no such file');
    });
    expect(() => cachedFileParse(file, parse)).toThrow('no such file');
    expect(() => cachedFileParse(file, parse)).toThrow('no such file');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('文件创建后正常进入缓存', () => {
    const parse = jest.fn(() => {
      if (!fs.existsSync(file)) throw new Error('no such file');
      return fs.readFileSync(file, 'utf-8');
    });
    expect(() => cachedFileParse(file, parse)).toThrow('no such file');
    fs.writeFileSync(file, 'created', 'utf-8');
    const first = cachedFileParse(file, parse);
    const second = cachedFileParse(file, parse);
    expect(first).toBe('created');
    expect(second).toBe('created');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('clearYamlFileCache 强制重新解析', () => {
    fs.writeFileSync(file, 'v1', 'utf-8');
    const parse = jest.fn(() => fs.readFileSync(file, 'utf-8'));
    cachedFileParse(file, parse);
    clearYamlFileCache();
    cachedFileParse(file, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('parse 抛错不写入缓存：后续调用重新解析', () => {
    fs.writeFileSync(file, 'bad', 'utf-8');
    let attempts = 0;
    const parse = jest.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('yaml broken');
      return 'recovered';
    });
    expect(() => cachedFileParse(file, parse)).toThrow('yaml broken');
    const value = cachedFileParse(file, parse);
    expect(value).toBe('recovered');
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
