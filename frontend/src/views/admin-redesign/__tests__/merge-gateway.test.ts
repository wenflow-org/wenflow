import { describe, expect, it } from 'vitest';
import { mergeGatewayPairsForExecLogs } from '../live';
import type { TraceSpan } from '../store';

function span(over: Partial<TraceSpan> & { id: string }): TraceSpan {
  return {
    traceId: 'tr:' + over.id,
    agent: 'a1',
    stage: 'a1',
    ts: 1,
    title: '执行完成',
    startMs: 0,
    durationMs: 10,
    status: 'ok',
    kind: 'call',
    detail: '',
    ...over,
  } as TraceSpan;
}

describe('mergeGatewayPairsForExecLogs', () => {
  it('skill 行 + 网关行（同 session 同时间窗口）→ 合并为一行，网关信息补入', () => {
    const spans: TraceSpan[] = [
      span({
        id: 's1',
        execLayer: 'skill' as const,
        agent: 'path-planning',
        stage: 'Path',
        sessionId: 'sess1',
        ts: 1000,
        durationMs: 38000,
        traceId: 'log:s1',
      }),
      span({
        id: 'g1',
        execLayer: 'api-gateway' as const,
        agent: 'api-gateway',
        stage: 'API 网关 · path-planning',
        sessionId: 'sess1',
        ts: 1000,
        durationMs: 38000,
        model: 'deepseek-v4-flash',
        promptTokens: 6052,
        completionTokens: 2896,
        statusCode: 200,
      }),
    ];
    const out = mergeGatewayPairsForExecLogs(spans);
    expect(out.length).toBe(1);
    expect(out[0].execLayer).toBe('skill');
    expect(out[0].model).toBe('deepseek-v4-flash');
    expect(out[0].promptTokens).toBe(6052);
    expect(out[0].completionTokens).toBe(2896);
    expect(out[0].statusCode).toBe(200);
    expect(out[0].gatewayDurMs).toBe(38000);
    expect(out[0].traceId).toBe('tr:g1');
  });

  it('不同 session 的 skill/网关行不合并', () => {
    const spans: TraceSpan[] = [
      span({ id: 's1', execLayer: 'skill' as const, agent: 'path-planning', stage: 'Path', sessionId: 'a', ts: 1000 }),
      span({ id: 'g1', execLayer: 'api-gateway' as const, agent: 'api-gateway', stage: 'API 网关 · path-planning', sessionId: 'b', ts: 1000 }),
    ];
    expect(mergeGatewayPairsForExecLogs(spans).length).toBe(2);
  });

  it('agent 不匹配的网关行不合并', () => {
    const spans: TraceSpan[] = [
      span({ id: 's1', execLayer: 'skill' as const, agent: 'goal-conversation', stage: 'Goal', sessionId: 'a', ts: 1000 }),
      span({ id: 'g1', execLayer: 'api-gateway' as const, agent: 'api-gateway', stage: 'API 网关 · path-planning', sessionId: 'a', ts: 1000 }),
    ];
    expect(mergeGatewayPairsForExecLogs(spans).length).toBe(2);
  });

  it('时间差超过窗口不合并', () => {
    const spans: TraceSpan[] = [
      span({ id: 's1', execLayer: 'skill' as const, agent: 'path-planning', stage: 'Path', sessionId: 'a', ts: 0, durationMs: 5000 }),
      span({ id: 'g1', execLayer: 'api-gateway' as const, agent: 'api-gateway', stage: 'API 网关 · path-planning', sessionId: 'a', ts: 100000, durationMs: 5000 }),
    ];
    expect(mergeGatewayPairsForExecLogs(spans).length).toBe(2);
  });

  it('空数组 / 无网关行 → 原样返回', () => {
    expect(mergeGatewayPairsForExecLogs([]).length).toBe(0);
    const onlySkill = [span({ id: 's1', execLayer: 'skill' as const }), span({ id: 's2' })];
    expect(mergeGatewayPairsForExecLogs(onlySkill)).toBe(onlySkill);
  });
});