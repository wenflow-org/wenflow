/* eslint-disable @typescript-eslint/no-explicit-any -- 测试夹具：session 只用时长计算需要的字段 */
/**
 * #172-4 暂停时长被计入学习时长（回归）。
 *
 * 缺陷：computeEffectiveDurationMinutes 原按 `session.status === 'paused'` 判「暂停中」，
 * 但收束受理（claimFinalization，TeachingSessionRepository.ts:1326）在受理时就把状态置
 * `finalizing`，所以收束路径上该分支恒不成立——pausedAt → 收束这一段根本没被扣，
 * 污染 wrapup.duration / teaching_sessions.duration / durationMinutes（最多约 60 分钟）。
 *
 * 口径：判暂停只认 artifacts.pausedAt（pausedAt 非空 = 有一段未结算的暂停），不再看 status。
 */
import { computeEffectiveDurationMinutes } from '../teaching-session-views';
import { runWithSimulatedClock } from '../../virtual-lab/simulation-clock-context';
import type { TeachingSessionRecord } from '../TeachingSessionRepository';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const MINUTE = 60 * 1000;
const at = (minutesBeforeNow: number) => new Date(NOW.getTime() - minutesBeforeNow * MINUTE);

function buildSession(overrides: {
  status: string;
  startTime: Date;
  endTime?: Date | null;
  messages?: Array<{ role: 'user' | 'assistant'; timestamp: string }>;
  artifacts?: Record<string, any>;
}): TeachingSessionRecord {
  return {
    id: 'sess_paused_172_4',
    userId: 'u1',
    taskId: 't1',
    subject: '数学',
    topic: '一元一次方程',
    taskType: 'practice',
    mode: 'tutor',
    status: overrides.status,
    messages: (overrides.messages || []).map((message) => ({
      role: message.role,
      content: '…',
      timestamp: message.timestamp,
    })),
    knowledgeState: [],
    teachingState: { sessionArtifacts: overrides.artifacts || {} },
    wrapup: null,
    advisory: null,
    startTime: overrides.startTime,
    endTime: overrides.endTime ?? null,
    duration: null,
    revision: 3,
    openKey: null,
    operationId: null,
    operationKind: null,
    operationLeaseExpiresAt: null,
    createdAt: overrides.startTime,
    updatedAt: NOW,
  } as unknown as TeachingSessionRecord;
}

const minutes = (session: TeachingSessionRecord, clock: Date = NOW) =>
  runWithSimulatedClock(clock, () => computeEffectiveDurationMinutes(session));

describe('#172-4 收束路径的暂停段扣除（按 artifacts.pausedAt，不按 status）', () => {
  it('status=finalizing 且 pausedAt 早于收束 30 分钟 → 有效时长不含这 30 分钟', () => {
    // 墙钟 90 分钟，其中最后 30 分钟处于暂停（pausedAt = 收束前 30 分钟）
    const session = buildSession({
      status: 'finalizing',
      startTime: at(90),
      artifacts: { pausedAt: at(30).toISOString() },
    });

    // 90 - 30 = 60；修复前该分支因 status !== 'paused' 恒不命中，会算成 90
    expect(minutes(session)).toBe(60);
  });

  it('同一份数据在 status=paused 与 status=finalizing 下结果一致（口径与状态解耦）', () => {
    const base = {
      startTime: at(90),
      artifacts: { pausedAt: at(30).toISOString() },
    };
    expect(minutes(buildSession({ ...base, status: 'finalizing' })))
      .toBe(minutes(buildSession({ ...base, status: 'paused' })));
  });

  it('idle 封顶仍按消息间隔生效：封顶值不被暂停扣除改写', () => {
    // 消息只覆盖到暂停前（16:30~17:30 共 60 分钟），暂停后到收束的 30 分钟无消息。
    // 封顶 = 60 + 60 = 120 > raw(60) → 仍取 raw。
    const messages = [at(90), at(80), at(70), at(60), at(50), at(40), at(30)].map((timestamp, index) => ({
      role: (index % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
      timestamp: timestamp.toISOString(),
    }));
    const session = buildSession({
      status: 'finalizing',
      startTime: at(90),
      messages,
      artifacts: { pausedAt: at(30).toISOString() },
    });
    expect(minutes(session)).toBe(60);
  });

  it('已结算的暂停段（pausedAt=null）仍按 pausedDurationMs 扣除，不重复计', () => {
    const session = buildSession({
      status: 'finalizing',
      startTime: at(90),
      artifacts: { pausedAt: null, pausedDurationMs: 30 * MINUTE },
    });
    expect(minutes(session)).toBe(60);
  });

  it('已收束会话（endTime 非空）重生成总结时不按「现在」越扣越多', () => {
    // 暂停在 T-30，收束在 T（endTime），而「现在」已过 10 天——终点取 endTime，仍是 60。
    const session = buildSession({
      status: 'completed',
      startTime: at(90),
      endTime: NOW,
      artifacts: { pausedAt: at(30).toISOString() },
    });
    expect(minutes(session)).toBe(60);
  });

  it('悬挂 pausedAt（暂停→24h 超时→后续回合恢复，pausedAt 没被结算）被「暂停后消息」收口，不越扣越多', () => {
    // 墙钟 90 分钟：先学（T-89..T-88 两条消息，都在暂停前）、暂停（pausedAt = T-70，陈旧），
    // 70 分钟未回来，T-10 由回合恢复继续。pausedAt 之后有且只有一条「暂停后消息」（T-10）→
    // 暂停段在此收口，扣除 60 分钟 → 有效时长 30。否则会把 60 分钟按 now-pausedAt 一路扣下去，
    // 把真实会话压成 1 分钟。
    const messages = [at(89), at(88), at(10)].map((timestamp, index) => ({
      role: (index % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
      timestamp: timestamp.toISOString(),
    }));
    const session = buildSession({
      status: 'finalizing',
      startTime: at(90),
      messages,
      artifacts: { pausedAt: at(70).toISOString() },
    });
    expect(minutes(session)).toBe(30);
  });
});
