import { teachingContextCompressionService } from '../TeachingContextCompressionService';

function makeMessage(role: 'user' | 'assistant', content: string, i: number) {
  return { role, content, timestamp: new Date().toISOString(), textLength: content.length, id: `m${i}` } as any;
}

describe('TeachingContextCompressionService（压缩窗口 40k + 可见对话修复）', () => {
  it('短会话不压缩（原样返回）', () => {
    const messages = [0, 1, 2].map((i) => makeMessage(i % 2 === 0 ? 'user' : 'assistant', '你好', i));
    const result = teachingContextCompressionService.compress(messages);
    expect(result.compressed).toBe(false);
    expect(result.messages).toHaveLength(3);
  });

  it('超过 40k token 阈值且消息数足够时压缩（保留最近 12 条 + system recap）', () => {
    const longText = '这是一个用于拉长 token 估算的测试消息内容。'.repeat(200); // ~200*20=4000 字符 ≈ 1000 tokens
    const messages = Array.from({ length: 40 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', longText, i)
    );
    const result = teachingContextCompressionService.compress(messages);
    expect(result.compressed).toBe(true);
    expect(result.recap).toBeTruthy();
    // 压缩产物 = [system recap, ...recent 12]
    expect(result.messages[0].role).toBe('system');
    expect(result.messages.filter((m) => m.role !== 'system')).toHaveLength(12);
    expect(result.estimatedTokens).toBeGreaterThanOrEqual(28000);
  });

  it('压缩后可见对话段（visibleDialogueContext 消费侧）只含最近 12 条、无 system recap', () => {
    const longText = 'x'.repeat(4000);
    const messages = Array.from({ length: 40 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', longText, i)
    );
    const result = teachingContextCompressionService.compress(messages);
    expect(result.compressed).toBe(true);
    const visible = result.messages.filter((m) => m.role !== 'system');
    expect(visible).toHaveLength(12);
    expect(visible[0].role).not.toBe('system');
    // recap 文本单独携带（scenario.contextCompression），不混入可见对话
    expect(result.recap).toContain('此前课堂已进行');
  });
});
