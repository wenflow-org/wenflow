/**
 * 白板防复读（2026-10-31 用户走查）：共享白板常驻，板没变化不随消息重发。
 * getLastSentBoardRevision 决定「上次下发的板版本」，引擎据此跳过未变化板的挂载
 * （否则同一张板挂在相隔 10 分钟的两条导师消息下，滚动区被同图刷屏）。
 */
import { getLastSentBoardRevision } from '../board-state';

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
