/**
 * 裁判旁路诊断轨迹键值摘要单源测试（ADMIN_DEEP_SESSION_AUDIT C3）：
 * 800 字符截断 JSON → 阶段/状态/关键指标行；原文 JSON 保留
 */
import { describe, expect, it } from 'vitest';
import { traceRawJson, traceSummaryRows } from '../traceSummary';

describe('traceSummaryRows（键值摘要行）', () => {
  it('优先键命中中文标签，按序输出', () => {
    const rows = traceSummaryRows({ phase: 'goal', status: 'ok', decision: 'accept', score: 0.9 });
    const labels = rows.map((r) => r.label);
    const values = rows.map((r) => r.value);
    expect(labels).toEqual(['阶段', '状态', '决策', '得分']);
    expect(values).toEqual(['goal', 'ok', 'accept', '0.9']);
  });

  it('同义键只取一个（phase/stage 均存在时 phase 优先）', () => {
    const rows = traceSummaryRows({ phase: 'learning', stage: 'goal', verdict: 'pass' });
    const labels = rows.map((r) => r.label);
    expect(labels.filter((l) => l === '阶段').length).toBe(1);
    expect(labels).toContain('结论');
    expect(rows[0].value).toBe('learning');
  });

  it('布尔/数字标量正常转文本；对象压缩为 JSON', () => {
    const rows = traceSummaryRows({ retries: 3, budgetExhausted: true, payload: { a: 1, b: [1, 2, 3] } });
    const values = rows.map((r) => `${r.label}=${r.value}`);
    expect(values).toContain('重试次数=3');
    expect(values).toContain('预算耗尽=true');
    expect(values).toContain('payload={"a":1,"b":[1,2,3]}');
  });

  it('未命中的顶层标量键补足（最多共 6 行）', () => {
    const diagnostic: Record<string, unknown> = { provider: 'openai' };
    for (let i = 0; i < 10; i += 1) diagnostic[`key${i}`] = `v${i}`;
    const rows = traceSummaryRows(diagnostic);
    expect(rows.length).toBe(6);
    expect(rows[0].value).toBe('openai');
  });

  it('长文本截断 80 字符', () => {
    const rows = traceSummaryRows({ message: 'x'.repeat(120) });
    expect(rows[0].value.length).toBe(80);
  });

  it('空值/非对象不崩溃', () => {
    expect(traceSummaryRows(null)).toEqual([]);
    expect(traceSummaryRows(undefined)).toEqual([]);
    expect(traceSummaryRows({})).toEqual([]);
  });
});

describe('traceRawJson（原文保留）', () => {
  it('格式化输出原文', () => {
    expect(traceRawJson({ phase: 'goal', nested: { a: 1 } })).toBe('{\n  "phase": "goal",\n  "nested": {\n    "a": 1\n  }\n}');
  });

  it('空值 → 空串', () => {
    expect(traceRawJson(null)).toBe('');
    expect(traceRawJson(undefined)).toBe('');
  });
});
