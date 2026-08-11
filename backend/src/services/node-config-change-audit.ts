/**
 * node_config_changes 审计写入助手（P2 审计补强）
 *
 * 复用 health-center writeHealthFixAudit 的写入形态（changeType/targetTable/targetId/
 * before/after/actorId/actorRole/reason，before/after 为 JSON 字符串），
 * 供编排保存 / prune / scaffold 等写操作共用（避免各处重复拼装）。
 *
 * 结构类型最小化（不强制 PrismaClient 全类型），便于单测注入替身。
 */

import { createHash } from 'crypto';

export interface NodeConfigChangeAuditInput {
  changeType: string;
  targetTable: string;
  targetId: string;
  agentId?: string;
  fieldId?: string;
  before?: unknown;
  after?: unknown;
  actorId?: string;
  actorRole?: string;
  reason?: string;
}

export interface NodeConfigChangeWriter {
  node_config_changes: {
    create(args: { data: Record<string, unknown> }): Promise<{ id?: string }>;
  };
}

export async function writeNodeConfigChange(
  db: NodeConfigChangeWriter,
  input: NodeConfigChangeAuditInput,
): Promise<string> {
  const fallbackId = `${input.changeType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jsonOrNull = (value: unknown): string | null =>
    value === undefined || value === null ? null : JSON.stringify(value);
  const created = await db.node_config_changes.create({
    data: {
      id: fallbackId,
      changeType: input.changeType,
      targetTable: input.targetTable,
      targetId: input.targetId,
      agentId: input.agentId ?? null,
      fieldId: input.fieldId ?? null,
      before: jsonOrNull(input.before),
      after: jsonOrNull(input.after),
      actorId: input.actorId ?? 'admin',
      actorRole: input.actorRole ?? 'admin',
      reason: input.reason ?? null,
    },
  });
  return (created && (created as { id?: string }).id) || fallbackId;
}

/** 文本摘要（编排保存审计 before/after 用）：行数 + 字符数 + sha1 短哈希 */
export function summarizeTextDigest(content: string): { lineCount: number; charCount: number; sha1: string } {
  return {
    lineCount: content.split('\n').length,
    charCount: content.length,
    sha1: createHash('sha1').update(content, 'utf-8').digest('hex').slice(0, 12),
  };
}
