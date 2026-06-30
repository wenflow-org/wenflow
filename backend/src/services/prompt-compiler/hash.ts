/**
 * Prompt Compiler — Hash 工具
 * ============================================================
 * 用于:
 *  - sourceHash: SHA256(systemPrompt 源文本)
 *  - compileContextHash: SHA256(routing 表对应 agent 行的稳定 JSON)
 *
 * stable JSON 关键:
 *  - 字段顺序固定 (按 key 字母序)
 *  - 仅纳入会影响编译结果的字段, 不含 timestamps / id
 */

import { createHash } from 'crypto';

/**
 * 计算字符串 SHA256 (hex 输出, 取前 16 字符简短表达)
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * sha256 短指纹 (前 16 字符, 用于日志/admin diff)
 */
export function sha256Short(input: string): string {
  return sha256(input).slice(0, 16);
}

/**
 * 对对象做 stable JSON 序列化 (key 按字母序, 数组保持原序)
 * 用于 compileContextHash — 同样的 routing 数据无论 key 顺序如何, hash 必须一致
 */
export function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((v) => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return '{' + parts.join(',') + '}';
}

/**
 * 对对象 stable JSON 后再 sha256
 */
export function sha256Object(obj: any): string {
  return sha256(stableStringify(obj));
}
