import { isBenignConnectionError } from '../connection-errors';

describe('isBenignConnectionError（QA ISSUE-006）', () => {
  it('将客户端断开类 socket 错误判为可忽略', () => {
    for (const code of ['EPIPE', 'ECONNRESET', 'ECONNABORTED', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'EPROTO']) {
      expect(isBenignConnectionError({ code })).toBe(true);
    }
  });

  it('真实程序异常不判为可忽略', () => {
    expect(isBenignConnectionError(new Error('boom'))).toBe(false);
    expect(isBenignConnectionError({ code: 'API_GATEWAY_INTERNAL_ERROR' })).toBe(false);
    expect(isBenignConnectionError({ code: 'ENOENT' })).toBe(false);
    expect(isBenignConnectionError(null)).toBe(false);
    expect(isBenignConnectionError(undefined)).toBe(false);
    expect(isBenignConnectionError('EPIPE')).toBe(false);
    expect(isBenignConnectionError({ code: 42 })).toBe(false);
  });
});
