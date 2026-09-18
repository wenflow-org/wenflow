/**
 * 上线载荷的对话历史裁剪（走查 B-3）：
 * 历史消息只保留 `{ role, content }` —— `analysis` / `meta` / 时间戳都不发。
 *
 * 依据：
 * - teaching-turn 的规则里 `analysis.*`（第 87/104/108/109 条）指的是**本轮要产出的**
 *   analysis，不是历史消息的；上一轮分析另走 `analysisStage` 单独字段；
 * - skill 输入契约就是 `{ role, content }`（`TeachingTurnInput.messages`）；
 * - `session-wrapup` 才需要"含 analysis 标注"的消息，它自己的输入另处组装，不受影响。
 */
import { toWireMessages, type TeachingTurnInput } from '../index';

const msg = (over: Record<string, unknown>) => ({ role: 'assistant', content: 'x', ...over }) as unknown as TeachingTurnInput['messages'][number];

describe('toWireMessages（历史消息瘦身）', () => {
  it('丢掉 analysis / meta / 时间戳，只留 role+content', () => {
    const out = toWireMessages([
      msg({
        role: 'assistant',
        content: '你好',
        timestamp: '2026-09-18T05:36:10.000Z',
        analysis: { understanding: 0.7, confusionPoints: ['甲', '乙'], emotionalState: 'neutral', loadIndex: 0.4 },
        meta: { draftMs: 1200, editingCount: 2 },
      }),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: '你好' }]);
    expect(Object.keys(out[0])).toEqual(['role', 'content']);
  });

  it('保留顺序与条数（模型看到的对话文本不变）', () => {
    const out = toWireMessages([
      msg({ role: 'user', content: 'A' }),
      msg({ role: 'assistant', content: 'B' }),
      msg({ role: 'user', content: 'C' }),
    ]);
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual(['user:A', 'assistant:B', 'user:C']);
  });

  it('显著更小：带 analysis 的历史明显长于裁剪后', () => {
    const withAnalysis = [
      msg({ analysis: { understanding: 0.6, confusionPoints: ['日期格式统一性约束', '透视表求和口径'], emotionalState: 'confused', loadIndex: 0.55, rsmAttempts: [{ method: 'x', outcome: 'stuck' }] } }),
    ];
    expect(JSON.stringify(withAnalysis).length).toBeGreaterThan(JSON.stringify(toWireMessages(withAnalysis)).length + 80);
  });

  it('非数组输入安全返回空数组', () => {
    expect(toWireMessages(undefined as unknown as TeachingTurnInput['messages'])).toEqual([]);
  });
});
