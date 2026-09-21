/**
 * 教学会话消息子表存储（`teaching_session_messages`，大 JSON 增量化 #2）。
 *
 * 背景：teaching_sessions.messages 单列存整个消息数组，每回合整包 stringify
 * 写回（O(n) 写放大）。子表化后每回合 = INSERT 新增行（O(新增)）。
 *
 * 并发语义（替代旧「整包覆写」的 last-write-wins）：
 * - claimOperation 在水合后返回 `messagesBaseCount`（侧表行数 = 快照基线）；
 * - commitTeachingMessages 校验侧表当前行数 === 基线后仅 INSERT slice(baseCount)
 *   的新增消息，不一致抛 TeachingMessageBaseStaleError（仓储转 TEACHING_MESSAGE_BASE_STALE 冲突）。
 * - 伴学消息（appendPeerMessages）走「播种 + 直接 INSERT 行 + revision CAS」。
 *
 * 兼容（双读 + 惰性播种）：侧表有行即权威；旧会话回退解析 messages 列；
 * 首次写把列内容搬入侧表后置 null（原地回收）。
 */
import prisma from '../../config/database';
import type { TeachingSessionMessage } from './TeachingSessionRepository';

export interface TeachingMessageStoreClient {
  teaching_sessions: {
    findUnique(args: {
      where: { id: string };
      select: { messages: true };
    }): Promise<{ messages: string | null } | null>;
    update(args: { where: { id: string }; data: { messages: string | null } }): Promise<unknown>;
  };
  teaching_session_messages: {
    findMany(args: {
      where: { sessionId: string };
      orderBy?: { id: 'asc' };
      take?: number;
      select: { id: true; payload?: true };
    }): Promise<Array<{ id: number; payload?: string }>>;
    count(args: { where: { sessionId: string } }): Promise<number>;
    createMany(args: { data: Array<{ sessionId: string; payload: string }> }): Promise<unknown>;
  };
}

/** commit 基线与侧表行数不一致：快照漂移，调用方应按可重试冲突处理 */
export class TeachingMessageBaseStaleError extends Error {
  readonly code = 'TEACHING_MESSAGE_BASE_STALE';

  constructor(
    sessionId: string,
    readonly baseCount: number,
    readonly actualCount: number
  ) {
    super(`教学消息快照基线已变化（基线 ${baseCount}，侧表 ${actualCount}）: ${sessionId}`);
    this.name = 'TeachingMessageBaseStaleError';
  }
}

function parsePayload(payload: string): TeachingSessionMessage | null {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed as TeachingSessionMessage : null;
  } catch {
    return null;
  }
}

function toRows(sessionId: string, messages: TeachingSessionMessage[]) {
  return (messages || [])
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({ sessionId, payload: JSON.stringify(message) }));
}

/** 侧表无行（旧会话）时回退解析 messages 列；解析失败按空处理 */
function parseLegacyColumn(raw: string | null | undefined): TeachingSessionMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

/**
 * 读会话全部消息：侧表有行即权威；否则返回 null（调用方回退使用已解析的列内容）。
 */
export async function loadTeachingMessages(
  sessionId: string,
  db: TeachingMessageStoreClient = prisma as unknown as TeachingMessageStoreClient
): Promise<TeachingSessionMessage[] | null> {
  const rows = await db.teaching_session_messages.findMany({
    where: { sessionId },
    orderBy: { id: 'asc' },
    select: { id: true, payload: true }
  });
  if (rows.length === 0) return null;
  return rows
    .map((row) => parsePayload(String(row.payload ?? '')))
    .filter((message): message is TeachingSessionMessage => message !== null);
}

/**
 * 就地水合仓储记录的 messages 字段：侧表有行 → 覆写为权威内容；旧会话不动。
 * getById 等单会话读点必须调用（claim 的快照基线取自此）；列表读点可用
 * 「messages 为空才水合」的懒规则省查询。
 */
export async function hydrateTeachingSessionMessages(
  record: { id: string; messages: TeachingSessionMessage[] },
  db: TeachingMessageStoreClient = prisma as unknown as TeachingMessageStoreClient
): Promise<void> {
  const messages = await loadTeachingMessages(record.id, db);
  if (messages !== null) record.messages = messages;
}

/**
 * 惰性播种：侧表无行且列有内容 → 列搬入侧表并置 null（同调用方事务内执行时原子）。
 * 返回播种前侧表是否已有行。
 */
export async function ensureTeachingMessagesSeeded(
  sessionId: string,
  db: TeachingMessageStoreClient = prisma as unknown as TeachingMessageStoreClient
): Promise<boolean> {
  const existing = await db.teaching_session_messages.findMany({
    where: { sessionId },
    take: 1,
    select: { id: true }
  });
  if (existing.length > 0) return true;
  const session = await db.teaching_sessions.findUnique({ where: { id: sessionId }, select: { messages: true } });
  if (!session) throw new Error('会话不存在');
  const legacy = parseLegacyColumn(session.messages);
  if (legacy.length > 0) {
    await db.teaching_session_messages.createMany({ data: toRows(sessionId, legacy) });
    // 播种成功即冻结旧列并原地回收（读已切侧表）
    await db.teaching_sessions.update({ where: { id: sessionId }, data: { messages: null } });
  }
  return false;
}

/**
 * 回合提交（增量落库）：校验基线后仅 INSERT 新增消息，返回新增条数。
 * fullMessages 为「快照 + 本轮新增」的全量数组；基线不一致按快照漂移拒绝。
 * 必须在调用方事务内执行（与行 CAS/revision 递增同事务）。
 */
export async function commitTeachingMessages(
  sessionId: string,
  baseCount: number,
  fullMessages: TeachingSessionMessage[],
  db: TeachingMessageStoreClient = prisma as unknown as TeachingMessageStoreClient
): Promise<number> {
  if (!Number.isInteger(baseCount) || baseCount < 0) {
    throw new TeachingMessageBaseStaleError(sessionId, baseCount, -1);
  }
  await ensureTeachingMessagesSeeded(sessionId, db);
  const actual = await db.teaching_session_messages.count({ where: { sessionId } });
  if (actual !== baseCount || fullMessages.length < baseCount) {
    throw new TeachingMessageBaseStaleError(sessionId, baseCount, actual);
  }
  const additions = toRows(sessionId, fullMessages.slice(baseCount));
  if (additions.length > 0) {
    await db.teaching_session_messages.createMany({ data: additions });
  }
  return additions.length;
}

/** 伴学等「直接追加给定消息」路径：播种后 INSERT（并发防护由调用方 revision CAS 承担） */
export async function appendTeachingMessages(
  sessionId: string,
  messages: TeachingSessionMessage[],
  db: TeachingMessageStoreClient = prisma as unknown as TeachingMessageStoreClient
): Promise<void> {
  const rows = toRows(sessionId, messages);
  if (rows.length === 0) return;
  await ensureTeachingMessagesSeeded(sessionId, db);
  await db.teaching_session_messages.createMany({ data: rows });
}
