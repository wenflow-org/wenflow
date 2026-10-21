import {
  applyThinkingPolicyToBody,
  buildChatAuthHeaders,
  buildStreamOptions,
  resolveChatCompletionsUrl,
  stripStreamFields,
} from '../chat-protocol-adapter';

describe('chat protocol adapter', () => {
  describe('resolveChatCompletionsUrl', () => {
    it('已带 /chat/completions 的端点保持原样（含尾斜杠清理）', () => {
      expect(resolveChatCompletionsUrl('https://api.example.com/v1/chat/completions/'))
        .toBe('https://api.example.com/v1/chat/completions');
      expect(resolveChatCompletionsUrl('https://api.example.com/custom/chat/completions'))
        .toBe('https://api.example.com/custom/chat/completions');
    });

    it('以 /v1 结尾只补 chat/completions 后缀', () => {
      expect(resolveChatCompletionsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
      expect(resolveChatCompletionsUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    });

    it('裸域名补 /v1/chat/completions', () => {
      expect(resolveChatCompletionsUrl('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
      expect(resolveChatCompletionsUrl('https://api.example.com/gateway')).toBe('https://api.example.com/gateway/v1/chat/completions');
    });

    it('空值时退化为相对路径后缀（调用方仍会被 safe-http 拦下）', () => {
      expect(resolveChatCompletionsUrl('')).toBe('/v1/chat/completions');
    });
  });

  describe('buildChatAuthHeaders', () => {
    it('有密钥时带 Bearer，空密钥不带 Authorization', () => {
      expect(buildChatAuthHeaders(' sk-123 ')).toEqual({ Authorization: 'Bearer sk-123' });
      expect(buildChatAuthHeaders('')).toEqual({});
      expect(buildChatAuthHeaders(null)).toEqual({});
    });
  });

  describe('applyThinkingPolicyToBody', () => {
    it('策略字段全部写入', () => {
      const body: Record<string, unknown> = { max_tokens: 100 };
      applyThinkingPolicyToBody(body, {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
        maxTokens: 8192,
      });
      expect(body).toEqual({ max_tokens: 8192, thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    });

    it('策略为空时不触碰已有字段（模型不支持思考）', () => {
      const body: Record<string, unknown> = { max_tokens: 100, thinking: { type: 'disabled' } };
      applyThinkingPolicyToBody(body, {});
      expect(body).toEqual({ max_tokens: 100, thinking: { type: 'disabled' } });
    });

    it('maxTokens 为 undefined 时不覆盖预算', () => {
      const body: Record<string, unknown> = { max_tokens: 777 };
      applyThinkingPolicyToBody(body, { thinking: { type: 'enabled' } });
      expect(body.max_tokens).toBe(777);
    });
  });

  describe('stream helpers', () => {
    it('首趟带 usage 汇总，重试趟返回 null', () => {
      expect(buildStreamOptions(true)).toEqual({ stream_options: { include_usage: true } });
      expect(buildStreamOptions(false)).toBeNull();
    });

    it('非流式请求剥离 stream_options，流式请求保留', () => {
      const nonStream = { model: 'm', stream_options: { include_usage: true } } as Record<string, unknown>;
      stripStreamFields(nonStream);
      expect(nonStream.stream_options).toBeUndefined();

      const stream = { model: 'm', stream: true, stream_options: { include_usage: true } } as Record<string, unknown>;
      stripStreamFields(stream);
      expect(stream.stream_options).toEqual({ include_usage: true });
    });
  });
});
