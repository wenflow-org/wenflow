/**
 * 伴学触发判定单测（2026-09-25 设计调整）：
 * ① helpKeywords 收紧——「怎么/为什么」几乎逢问必中，删去（真课实测两轮两弹）；
 * ② 会话内冷却——最近 N 条老师消息已带 peerMessage 则不再自动触发（model-control 越过冷却）。
 */
import { PeerTriggerService } from '../PeerTriggerService';
import type { TeachingSessionRecord } from '../TeachingSessionRepository';

const service = new PeerTriggerService();

type Msg = Partial<TeachingSessionRecord['messages'][number]> & { role: string; content: string };

function sessionWith(messages: Msg[]): TeachingSessionRecord {
  return { id: 'teaching_test', messages } as unknown as TeachingSessionRecord;
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    control: { shouldTriggerPeer: false },
    analysis: { understanding: 0.8, cognitiveLevel: 'understand' },
    ...overrides,
  } as Parameters<PeerTriggerService['shouldTrigger']>[1];
}

describe('PeerTriggerService（伴学触发）', () => {
  it('含「怎么/为什么」的普通提问不再触发（关键词收紧后）', () => {
    const session = sessionWith([{ role: 'assistant', content: '老师讲解' }]);
    expect(service.shouldTrigger(session, output(), '这个怎么流动？为什么珍珠会沉底？')).toBe(false);
  });

  it('显式求助词仍触发', () => {
    const session = sessionWith([{ role: 'assistant', content: '老师讲解' }]);
    expect(service.shouldTrigger(session, output(), '这里我搞不懂，帮我讲讲')).toBe(true);
  });

  it('冷却：最近 2 条老师消息已带 peerMessage → 不触发；冷却期过后恢复', () => {
    const inCooldown = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师最新讲解' },
    ]);
    expect(service.shouldTrigger(inCooldown, output(), '我搞不懂这一步')).toBe(false);

    const cooled = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师讲解一' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师讲解二' },
    ]);
    expect(service.shouldTrigger(cooled, output(), '我搞不懂这一步')).toBe(true);
  });

  it('model-control 越过冷却（教学模型显式要求）', () => {
    const inCooldown = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'assistant', content: '老师最新讲解' },
    ]);
    expect(service.shouldTrigger(inCooldown, output({ control: { shouldTriggerPeer: true } }), '继续')).toBe(true);
  });
});
