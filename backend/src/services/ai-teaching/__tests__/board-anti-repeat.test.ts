/**
 * 白板防复读（2026-10-31 用户走查）：共享白板常驻，板没变化不随消息重发。
 * getLastSentBoardRevision 决定「上次下发的板版本」，引擎据此跳过未变化板的挂载
 * （否则同一张板挂在相隔 10 分钟的两条导师消息下，滚动区被同图刷屏）。
 *
 * issue #243：本文件此前只喂「带 figures 的数组」，与引擎真实入参不同形——引擎先把历史
 * 过一遍 appendTimestamp 再交给守卫，而旧 appendTimestamp 会剥掉 figures，基线恒为 null。
 * 因此下面既保留纯函数用例，也补上「经 appendTimestamp 后仍可见」的真实入参形态；
 * 端到端链路（连续 3 轮只下发 1 次 / 换板照发 / 自己出图不二次挂板）见 board-attachment-engine.test.ts。
 */
import { getLastSentBoardRevision } from '../board-state';
import { appendTimestamp } from '../teaching-turn-shared';

describe('appendTimestamp · 业务字段不得被剥掉（#243 的根因）', () => {
  const boardFigure = { engine: 'svg', board: true, boardRevision: 2 };

  it('figures / figureSource / strategies 原样保留，timestamp 只补不覆盖', () => {
    const [kept] = appendTimestamp([{
      role: 'assistant',
      content: '先看板上',
      timestamp: '2026-10-31T10:00:00.000Z',
      figures: [boardFigure],
      figureSource: { trigger: 'board', reason: null, kindHint: 'concept-map', ruleWhy: 'x', matched: [] },
      strategies: ['scaffold'],
    }]);
    expect(kept.timestamp).toBe('2026-10-31T10:00:00.000Z');
    expect(kept.figures).toEqual([boardFigure]);
    expect(kept.figureSource).toMatchObject({ trigger: 'board' });
    expect(kept.strategies).toEqual(['scaffold']);
  });

  it('缺 timestamp 才补；role 归一为 user/assistant/system', () => {
    const [filled, student] = appendTimestamp([
      { role: 'assistant', content: 'a' },
      { role: 'learner', content: 'b' },
    ]);
    expect(typeof filled.timestamp).toBe('string');
    expect(filled.timestamp.length).toBeGreaterThan(0);
    expect(student.role).toBe('user');
  });

  it('不修改入参对象（复制而非原地写）', () => {
    const source: { role: string; content: string; timestamp?: string } = { role: 'assistant', content: 'x' };
    appendTimestamp([source]);
    expect(source.timestamp).toBeUndefined();
  });
});

describe('getLastSentBoardRevision · 引擎真实入参形态（appendTimestamp 之后）', () => {
  it('同一块板经 appendTimestamp 后基线仍读得到 → 守卫能判等', () => {
    const history = appendTimestamp([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '看板', figures: [{ board: true, boardRevision: 2 }] },
      { role: 'user', content: '继续' },
    ]);
    expect(getLastSentBoardRevision(history)).toBe(2);
  });
});

describe('getLastSentBoardRevision · 白板防复读的版本基线', () => {
  it('历史无白板图 → null（首轮开板照常下发）', () => {
    const msgs = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '讲一下', figures: [{ engine: 'svg', board: false, boardRevision: 3 }] },
    ];
    expect(getLastSentBoardRevision(msgs)).toBeNull();
  });

  it('最后一条白板图消息的 boardRevision → 作为基线', () => {
    const msgs = [
      { role: 'assistant', content: '第一轮', figures: [{ board: true, boardRevision: 1 }] },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '第二轮', figures: [{ board: true, boardRevision: 2 }] },
    ];
    expect(getLastSentBoardRevision(msgs)).toBe(2);
  });

  it('向后扫描：更晚的白板图覆盖更早的；其后无图消息不影响基线', () => {
    const msgs = [
      { role: 'assistant', content: '带板 v1', figures: [{ board: true, boardRevision: 1 }] },
      { role: 'assistant', content: '带板 v3', figures: [{ board: true, boardRevision: 3 }] },
      { role: 'assistant', content: '纯文字（板未变，未挂图）' },
      { role: 'user', content: '嗯' },
    ];
    expect(getLastSentBoardRevision(msgs)).toBe(3);
  });

  it('boardRevision 缺失（历史脏数据）→ null，宁可重发不可漏发', () => {
    const msgs = [{ role: 'assistant', content: '带板', figures: [{ board: true }] }];
    expect(getLastSentBoardRevision(msgs)).toBeNull();
  });

  it('空历史 → null', () => {
    expect(getLastSentBoardRevision([])).toBeNull();
  });
});
