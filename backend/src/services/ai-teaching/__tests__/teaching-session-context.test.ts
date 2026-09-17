/**
 * 教学会话作用域（AsyncLocalStorage）——让收束期的 aux skill 调用自动带上 sessionId。
 *
 * 背景（审计 §5.2 P2 尾巴）：这些 aux（learner-state-review / concept-consolidator /
 * concept-load-estimator / replan-attribution）此前不传 sessionId，LLM 成本落在"(无会话)"栏。
 */
import { runWithTeachingSession, currentTeachingSessionId } from '../teaching-session-context';

describe('teaching-session-context', () => {
  it('作用域外为 null（不编造归属）', () => {
    expect(currentTeachingSessionId()).toBeNull();
  });

  it('作用域内可见；同步返回值透传', () => {
    const value = runWithTeachingSession('sess-1', () => {
      expect(currentTeachingSessionId()).toBe('sess-1');
      return 42;
    });
    expect(value).toBe(42);
    expect(currentTeachingSessionId()).toBeNull();
  });

  it('跨 await 传播（fire-and-forget 的异步链仍能看到会话）', async () => {
    const seen: Array<string | null> = [];
    await runWithTeachingSession('sess-2', async () => {
      await Promise.resolve();
      seen.push(currentTeachingSessionId());
      await new Promise((resolve) => setTimeout(resolve, 0));
      seen.push(currentTeachingSessionId());
    });
    expect(seen).toEqual(['sess-2', 'sess-2']);
  });

  it('嵌套时取最内层会话', () => {
    runWithTeachingSession('outer', () => {
      runWithTeachingSession('inner', () => {
        expect(currentTeachingSessionId()).toBe('inner');
      });
      expect(currentTeachingSessionId()).toBe('outer');
    });
  });

  it('空 sessionId 不进入作用域（保持旧行为）', () => {
    runWithTeachingSession('', () => {
      expect(currentTeachingSessionId()).toBeNull();
    });
  });
});