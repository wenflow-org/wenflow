/**
 * 课堂早发正文（2026-11-01 课堂流畅度修复）：接线形状单测。
 *
 * 只验「该发什么、不该发什么、发失败怎么办」——推送闸门本身在引擎里，不在本层。
 * 用一个最小 onStream 收集器替代真实 SSE 通道，断言事件形状与 `PromptStreamEvent` 一致。
 */
import { emitEarlyReplyDelta, isEarlyReplyDeltaEnabled } from '../teaching-stream-emit';
import { runWithContext } from '../../../gateway/api-gateway/context';

type Captured = { type: string; text?: string };

/** 在带流式意向的请求上下文里跑 fn，收集 onStream 事件 */
async function withStream(fn: () => void, enabled = true): Promise<Captured[]> {
  const events: Captured[] = [];
  await runWithContext(
    { streamRequest: { enabled, onStream: (event) => events.push(event as Captured) } },
    async () => {
      fn();
    },
  );
  return events;
}

describe('emitEarlyReplyDelta：定稿正文作为 delta 早发', () => {
  it('有 onStream 时发出单个 delta 事件，文本为定稿正文', async () => {
    const events = await withStream(() => emitEarlyReplyDelta('好，我们先把「勾股定理」拆成两个直角边。'));
    expect(events).toEqual([{ type: 'delta', text: '好，我们先把「勾股定理」拆成两个直角边。' }]);
  });

  it('正文前后空白被裁掉后发出（避免空气泡与前导换行）', async () => {
    const events = await withStream(() => emitEarlyReplyDelta('  \n 这一轮先记住平方差公式。 \n '));
    expect(events).toEqual([{ type: 'delta', text: '这一轮先记住平方差公式。' }]);
  });

  it('非字符串 / 空串 / 纯空白一律不发（不产生空 delta）', async () => {
    for (const bad of [undefined, null, 42, {}, '', '   \n\t ']) {
      expect(await withStream(() => emitEarlyReplyDelta(bad as unknown))).toEqual([]);
    }
  });

  it('无流式意向（非流式 API 调用方）静默跳过，行为零变化', async () => {
    // 完全没有 request context（管道外调用）
    expect(() => emitEarlyReplyDelta('这句话不该被发出')).not.toThrow();
    // 有 context 但没有 streamRequest
    await runWithContext({}, async () => {
      expect(() => emitEarlyReplyDelta('这句话不该被发出')).not.toThrow();
    });
    // 声明了流式意向但没有出口（onStream 缺省）
    await runWithContext({ streamRequest: { enabled: true } }, async () => {
      expect(() => emitEarlyReplyDelta('这句话不该被发出')).not.toThrow();
    });
  });

  it('onStream 抛异常不冒泡（早发失败不影响回合）', async () => {
    await runWithContext(
      {
        streamRequest: {
          enabled: true,
          onStream: () => {
            throw new Error('SSE 写失败');
          },
        },
      },
      async () => {
        expect(() => emitEarlyReplyDelta('正文仍然要能返回给 final')).not.toThrow();
      },
    );
  });
});

describe('isEarlyReplyDeltaEnabled：A/B 与线上回退开关', () => {
  it('默认开（env 未设置 / 空串）', () => {
    expect(isEarlyReplyDeltaEnabled(undefined)).toBe(true);
    expect(isEarlyReplyDeltaEnabled(null)).toBe(true);
    expect(isEarlyReplyDeltaEnabled('')).toBe(true);
    expect(isEarlyReplyDeltaEnabled('1')).toBe(true);
    expect(isEarlyReplyDeltaEnabled('true')).toBe(true);
  });

  it('0/false/off/no 关（大小写与空白不敏感）', () => {
    for (const off of ['0', 'false', 'FALSE', ' off ', 'No', 'NO']) {
      expect(isEarlyReplyDeltaEnabled(off)).toBe(false);
    }
  });

  it('关掉之后不发任何 delta（行为回到 final 一次性出字）', async () => {
    const events: Captured[] = [];
    await runWithContext(
      { streamRequest: { enabled: true, onStream: (event) => events.push(event as Captured) } },
      async () => {
        const previous = process.env.TEACHING_EARLY_REPLY_DELTA;
        process.env.TEACHING_EARLY_REPLY_DELTA = '0';
        try {
          emitEarlyReplyDelta('这段正文不该被早发');
        } finally {
          if (previous === undefined) delete process.env.TEACHING_EARLY_REPLY_DELTA;
          else process.env.TEACHING_EARLY_REPLY_DELTA = previous;
        }
      },
    );
    expect(events).toEqual([]);
  });
});
