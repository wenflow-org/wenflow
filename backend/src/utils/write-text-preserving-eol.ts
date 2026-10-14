/**
 * 文本回写工具：保持原文件行尾（EOL）。
 *
 * 背景（#11 行尾噪音）：Windows 检出（core.autocrlf=true）工作区文件为 CRLF，
 * 而确定性序列化器 / 编辑器回写统一用 LF——写回后 `git diff` 为空，但
 * `git status` 仍报 M（Git 认为 CRLF 工作区被改成了 LF）。写回时沿用原文件
 * EOL 即可消除该噪音，且不改动文件语义。
 */
import * as fs from 'fs';

export type Eol = '\r\n' | '\n';

/** 从文本推断主导 EOL；不含 CRLF 视为 LF */
export function detectEol(text: string): Eol {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** 把任意文本的换行归一为指定 EOL（幂等） */
export function withEol(text: string, eol: Eol): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return eol === '\n' ? normalized : normalized.replace(/\n/g, '\r\n');
}

/** 读取已存在文件的 EOL；文件不存在或读失败时回落 LF */
export async function readFileEol(filePath: string): Promise<Eol> {
  try {
    return detectEol(await fs.promises.readFile(filePath, 'utf-8'));
  } catch {
    return '\n';
  }
}

/** 写文本文件，沿用目标文件既有 EOL（目标不存在则按 LF 写入） */
export async function writeTextPreservingEol(filePath: string, text: string): Promise<void> {
  const eol = await readFileEol(filePath);
  await fs.promises.writeFile(filePath, withEol(text, eol), 'utf-8');
}
