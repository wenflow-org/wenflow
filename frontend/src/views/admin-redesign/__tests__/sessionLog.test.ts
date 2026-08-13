/**
 * 会话日志格式化单源测试（ADMIN_DEEP_SESSION_AUDIT C1）：
 * 原始 JSON 直出 → 阶段徽章 + 摘要文本 + 耗时；error 行显眼标注；原文保留
 * 实测样本：{"timestamp":"...","phase":"virtual-reply","durationMs":25659,"details":{...}}
 */
import { describe, expect, it } from 'vitest';
import { fmtDurationMs, isErrorLog, parseLogEntry } from '../sessionLog';

describe('isErrorLog（error 行标注）', () => {
  it('phase/type 命中错误档', () => {
    expect(isErrorLog({ phase: 'error' })).toBe(true);
    expect(isErrorLog({ type: 'failed' })).toBe(true);
    expect(isErrorLog({ phase: 'err' })).toBe(true);
    expect(isErrorLog({ type: 'exception' })).toBe(true);
  });

  it('level/severity 命中错误档', () => {
    expect(isErrorLog({ level: 'error' })).toBe(true);
    expect(isErrorLog({ severity: 'critical' })).toBe(true);
  });

  it('布尔标记', () => {
    expect(isErrorLog({ error: true })).toBe(true);
    expect(isErrorLog({ ok: false })).toBe(true);
  });

  it('正常行不误标', () => {
    expect(isErrorLog({ phase: 'virtual-reply', durationMs: 25659 })).toBe(false);
    expect(isErrorLog({ phase: 'learning-step', ok: true })).toBe(false);
    expect(isErrorLog({})).toBe(false);
  });
});

describe('fmtDurationMs（耗时表达）', () => {
  it('毫秒 → 秒（一位小数）', () => {
    expect(fmtDurationMs(25659)).toBe('25.7s');
    expect(fmtDurationMs(1000)).toBe('1.0s');
  });

  it('不足 1 秒 → ms', () => {
    expect(fmtDurationMs(812)).toBe('812ms');
    expect(fmtDurationMs(0)).toBe('0ms');
  });

  it('≥1 分钟 → 分秒', () => {
    expect(fmtDurationMs(60000)).toBe('1 分钟');
    expect(fmtDurationMs(128000)).toBe('2 分 08 秒');
  });

  it('非法/空值 → 空串', () => {
    expect(fmtDurationMs(null)).toBe('');
    expect(fmtDurationMs(undefined)).toBe('');
    expect(fmtDurationMs(-5)).toBe('');
    expect(fmtDurationMs('abc')).toBe('');
  });
});

describe('parseLogEntry（可读行视图）', () => {
  it('实测样本：阶段 + 摘要 + 耗时 + 原文', () => {
    const view = parseLogEntry({
      timestamp: '2026-08-12T14:38:27.211Z',
      phase: 'virtual-reply',
      durationMs: 25659,
      details: { message: '学习者回复生成完成' }
    });
    expect(view.phase).toBe('virtual-reply');
    expect(view.durationText).toBe('25.7s');
    expect(view.text).toBe('学习者回复生成完成');
    expect(view.isError).toBe(false);
    expect(view.rawJson).toContain('"phase": "virtual-reply"');
  });

  it('error 行：message 提取 + 标注', () => {
    const view = parseLogEntry({ phase: 'error', message: 'Provider request retry budget exhausted' });
    expect(view.isError).toBe(true);
    expect(view.text).toBe('Provider request retry budget exhausted');
    expect(view.phase).toBe('error');
  });

  it('无 message 有阶段：只显示阶段徽章，text 空串不兜底整行 JSON', () => {
    const view = parseLogEntry({ phase: 'learning-step', durationMs: 300 });
    expect(view.phase).toBe('learning-step');
    expect(view.text).toBe('');
    expect(view.durationText).toBe('300ms');
  });

  it('全字段兜底：无阶段时给整行 JSON 截断预览', () => {
    const view = parseLogEntry({ foo: 1, bar: 'baz' });
    expect(view.text.length).toBeGreaterThan(0);
    expect(view.text.length).toBeLessThanOrEqual(160);
    expect(view.phase).toBe('');
  });

  it('原文 JSON 无删减、details 内 message 也参与摘要', () => {
    const view = parseLogEntry({ phase: 'wrapup', details: { text: '总结已生成' } });
    expect(view.text).toBe('总结已生成');
    expect(view.rawJson).toContain('"wrapup"');
  });

  it('空对象不崩溃', () => {
    const view = parseLogEntry({});
    expect(view.phase).toBe('');
    expect(view.isError).toBe(false);
    expect(view.rawJson).toBe('{}');
  });
});
