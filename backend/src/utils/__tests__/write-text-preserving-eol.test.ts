/**
 * write-text-preserving-eol 单测（#11 行尾噪音）
 *
 * Windows 检出（core.autocrlf=true）工作区文件为 CRLF；编辑器回写若统一用 LF，
 * `git diff` 为空但 `git status` 报 M。写回时沿用原文件 EOL 可消除该噪音。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectEol,
  withEol,
  readFileEol,
  writeTextPreservingEol,
} from '../write-text-preserving-eol';

let dir = '';

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-eol-'));
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectEol / withEol', () => {
  it('含 CRLF 视为 CRLF，否则 LF', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n');
    expect(detectEol('a\nb\n')).toBe('\n');
    expect(detectEol('')).toBe('\n');
  });

  it('withEol 归一且幂等', () => {
    expect(withEol('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
    expect(withEol('a\r\nb\r\n', '\n')).toBe('a\nb\n');
    expect(withEol(withEol('a\nb', '\r\n'), '\r\n')).toBe('a\r\nb');
  });
});

describe('writeTextPreservingEol', () => {
  it('沿用既有 CRLF 文件的 EOL，不引入 LF 行尾', async () => {
    const file = path.join(dir, 'crlf.yaml');
    fs.writeFileSync(file, 'a: 1\r\nb: 2\r\n', 'utf-8');
    await writeTextPreservingEol(file, 'a: 1\nb: 2\nc: 3\n');
    const raw = fs.readFileSync(file);
    expect(raw.toString('utf-8')).toBe('a: 1\r\nb: 2\r\nc: 3\r\n');
    expect(raw.includes(Buffer.from('\n')) && !raw.includes(Buffer.from('\r\n'))).toBe(false);
    expect(await readFileEol(file)).toBe('\r\n');
  });

  it('沿用既有 LF 文件，不擅自改成 CRLF', async () => {
    const file = path.join(dir, 'lf.yaml');
    fs.writeFileSync(file, 'a: 1\n', 'utf-8');
    await writeTextPreservingEol(file, 'a: 1\nb: 2\n');
    expect(fs.readFileSync(file, 'utf-8')).toBe('a: 1\nb: 2\n');
  });

  it('新文件按 LF 写入', async () => {
    const file = path.join(dir, 'new.yaml');
    await writeTextPreservingEol(file, 'a: 1\n');
    expect(fs.readFileSync(file, 'utf-8')).toBe('a: 1\n');
  });
});
