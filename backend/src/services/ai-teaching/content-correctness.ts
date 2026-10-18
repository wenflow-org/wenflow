/**
 * 内容正确性最小闭环（#47）：**确定性抽样 → 人工标注 → 检出率指标**。
 *
 * 为什么第一版不自动拦截：
 * 1. 「知识本身说错」目前没有可信的自动判据，四类既有降级遥测
 *    （答案泄漏 / 肯定错配 / schema 违规 / 算式不符）都覆盖不到它；
 * 2. 用同一个模型既讲课又判自己讲得对不对，会形成自证回路。
 * 所以先做**可观测**：抽样给人看、标注留痕、算检出率，跑出基线之后再谈自动拦截。
 *
 * 标注落在 `learner_evidence`（`evidenceType=content:correctness:review`）：
 * 证据表在本仓已经当通用留痕表用（概念归并记录 `concept:alias:merge` 同例），
 * 不为一次抽检新开表，也就不需要迁移。
 *
 * 抽样是**确定性**的（FNV-1a 哈希 + 盐），同一条消息在任何人、任何机器上算出的
 * 抽样结论一致——否则「本周抽样集合」会随进程变化，覆盖率指标不可比。
 */
import type { TeachingSessionMessage } from './TeachingSessionRepository';

export const CONTENT_REVIEW_EVIDENCE_TYPE = 'content:correctness:review';
export const CONTENT_REVIEW_EVIDENCE_KEY = 'content-correctness-review';
export const CONTENT_REVIEW_SALT = 'content-review-v1';

export type ContentVerdict = 'correct' | 'incorrect' | 'unsure';
export const CONTENT_VERDICTS: readonly ContentVerdict[] = ['correct', 'incorrect', 'unsure'];

export interface ContentReviewLabel {
  messageId: number;
  verdict: ContentVerdict;
  note?: string;
  reviewerUserId?: string;
  /** 标注时间（ISO），只读回显用 */
  labeledAt?: string;
}

export interface ContentReviewMetrics {
  /** 窗口内被抽中的教师回合数 */
  sampled: number;
  /** 已标注（且落在抽样集合内）的条数 */
  labeled: number;
  incorrect: number;
  unsure: number;
  correct: number;
  /** 已标注条数里判"错"的占比（0..1）；未标注时 null */
  errorRate: number | null;
  /** 抽中里已标注的占比（0..1） */
  coverage: number;
  /** 落在抽样集合之外、或已找不到对应消息的标注（提示窗口漂移） */
  outsideSample: number;
}

/** FNV-1a 32 位：稳定、与进程/机器无关，适合做"同一批消息永远同一抽样集合"的判据。 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 抽样判定：rate 是"千分率档"的近似，rate<=0 不抽、>=1 全抽。 */
export function isSampledTurn(
  messageId: number | string,
  rate: number,
  salt: string = CONTENT_REVIEW_SALT,
): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  if (rate >= 1) return true;
  const bucket = stableHash(`${salt}:${messageId}`) % 10000;
  return bucket / 10000 < rate;
}

/**
 * 可评审的教师回合：assistant 角色、有正文，且**排除合成消息**——
 * 检查点合成消息（`checkpoint`）与伴学消息（`peer`）不是教师本人讲的课，
 * 混进抽检会把"平台模板"算成"教师说错"。
 */
export function isReviewableTeacherTurn(message: TeachingSessionMessage | null | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  if (message.checkpoint || message.peer) return false;
  return typeof message.content === 'string' && message.content.trim().length > 0;
}

/** 抽检窗口内的会话行：计数只看 `users.isVirtualLearner`，取样只用 id/userId/taskId。 */
export interface ContentReviewSessionRow {
  id: string;
  userId: string;
  taskId: string;
  users?: { isVirtualLearner: boolean | null } | null;
}

/** 侧表消息行（抽样源）。 */
export interface ContentReviewMessageRow {
  id: number;
  payload: string;
}

export interface ContentReviewSampledTurn {
  messageId: number;
  sessionId: string;
  userId: string;
  taskId: string;
  content: string;
}

export interface ContentReviewSample {
  sampled: ContentReviewSampledTurn[];
  /** 窗口内会话总数（完整 sessions） */
  scannedSessions: number;
  /** 窗口内真人会话数（完整 sessions 预计算） */
  realSessions: number;
  /** 窗口内虚拟学习者会话数（完整 sessions 预计算） */
  virtualSessions: number;
}

/** 从侧表行（`{id, payload}`）里取出可评审的教师回合；解析失败的行直接跳过。 */
export function parseTeacherTurns(
  rows: Array<{ id: number; payload: string }>,
): Array<{ messageId: number; content: string }> {
  const turns: Array<{ messageId: number; content: string }> = [];
  for (const row of rows) {
    let parsed: TeachingSessionMessage | null = null;
    try {
      const raw = JSON.parse(row.payload);
      parsed = raw && typeof raw === 'object' ? (raw as TeachingSessionMessage) : null;
    } catch {
      parsed = null;
    }
    if (!isReviewableTeacherTurn(parsed)) continue;
    turns.push({ messageId: row.id, content: parsed!.content });
  }
  return turns;
}

/**
 * 从窗口会话里确定性抽样教师回合（消息加载走注入的 `loadMessages`，便于单测）。
 *
 * **计数口径（#120）**：`virtualSessions`/`realSessions` 必须先在**完整** sessions 上
 * 预计算，再进入可能因 `limit` 提前 `break` 的取样循环。否则同样的 7 天窗口会因
 * `--limit` 不同而报出不同的真人/虚拟会话数（limit 越小，计数越少），
 * `--metrics` 里的会话口径也随之漂移。
 */
export async function collectSampledTurns(input: {
  sessions: ContentReviewSessionRow[];
  loadMessages: (sessionId: string) => Promise<ContentReviewMessageRow[]>;
  sampleRate: number;
  limit: number;
  perSessionCap: number;
  /** 只抽真人会话；计数仍覆盖完整窗口 */
  realOnly?: boolean;
}): Promise<ContentReviewSample> {
  const realOnly = input.realOnly ?? false;
  // 先对完整窗口计数（不随下面的 limit 提前结束变化）。
  let virtualSessions = 0;
  for (const session of input.sessions) {
    if (session.users?.isVirtualLearner) virtualSessions += 1;
  }
  const sampled: ContentReviewSampledTurn[] = [];
  for (const session of input.sessions) {
    const isVirtual = Boolean(session.users?.isVirtualLearner);
    if (realOnly && isVirtual) continue;
    const rows = await input.loadMessages(session.id);
    const turns = parseTeacherTurns(rows).filter((turn) => isSampledTurn(turn.messageId, input.sampleRate));
    for (const turn of turns.slice(0, input.perSessionCap)) {
      sampled.push({
        messageId: turn.messageId,
        sessionId: session.id,
        userId: session.userId,
        taskId: session.taskId,
        content: turn.content,
      });
    }
    if (sampled.length >= input.limit) break;
  }
  return {
    sampled: sampled.slice(0, input.limit),
    scannedSessions: input.sessions.length,
    realSessions: input.sessions.length - virtualSessions,
    virtualSessions,
  };
}

export function serializeContentReviewLabel(label: ContentReviewLabel): string {
  return JSON.stringify({
    messageId: label.messageId,
    verdict: label.verdict,
    note: label.note ?? null,
    reviewerUserId: label.reviewerUserId ?? null,
    labeledAt: label.labeledAt ?? null,
  });
}

export function parseContentReviewLabel(payload: string | null | undefined): ContentReviewLabel | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    const verdict = parsed.verdict;
    if (!CONTENT_VERDICTS.includes(verdict)) return null;
    const messageId = Number(parsed.messageId);
    if (!Number.isFinite(messageId)) return null;
    return {
      messageId,
      verdict,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
      reviewerUserId: typeof parsed.reviewerUserId === 'string' ? parsed.reviewerUserId : undefined,
      labeledAt: typeof parsed.labeledAt === 'string' ? parsed.labeledAt : undefined,
    };
  } catch {
    return null;
  }
}

/** 指标：检出率的分母是"已标注"，覆盖率的分母是"抽中"。 */
export function computeContentReviewMetrics(input: {
  sampledIds: Array<number | string>;
  labels: ContentReviewLabel[];
}): ContentReviewMetrics {
  const sampledSet = new Set(input.sampledIds.map((id) => String(id)));
  let outsideSample = 0;
  // 同一条消息多条标注时**后写覆盖先写**（对应脚本侧的 upsert 语义、也对应人工改判）
  const verdictByMessage = new Map<string, ContentVerdict>();
  for (const label of input.labels) {
    const key = String(label.messageId);
    if (!sampledSet.has(key)) {
      outsideSample += 1;
      continue;
    }
    verdictByMessage.set(key, label.verdict);
  }
  let labeled = 0;
  let correct = 0;
  let incorrect = 0;
  let unsure = 0;
  for (const verdict of verdictByMessage.values()) {
    labeled += 1;
    if (verdict === 'incorrect') incorrect += 1;
    else if (verdict === 'unsure') unsure += 1;
    else correct += 1;
  }
  return {
    sampled: sampledSet.size,
    labeled,
    correct,
    incorrect,
    unsure,
    errorRate: labeled > 0 ? incorrect / labeled : null,
    coverage: sampledSet.size > 0 ? labeled / sampledSet.size : 0,
    outsideSample,
  };
}
