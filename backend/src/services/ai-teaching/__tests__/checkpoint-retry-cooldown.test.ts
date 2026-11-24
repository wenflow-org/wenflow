/**
 * 契约缺证据的强制出题：判错后的重测冷却（2026-11-24 真跑复盘）。
 *
 * 真跑样本：同一 KC「锁定钟点格读数」连续 2 个 cpId、4 次作答全部判错；
 * 第二次换题重测距离第一次判错仅 1 分钟，且课堂已进入 intervention（allowCheckpoint=false）。
 * 契约补证不能停，但必须先给辅导：本条把「隔几轮再测」写成代码判据。
 */
import {
  CHECKPOINT_RETRY_COOLDOWN_ASSISTANT_TURNS,
  hasOnlyAlreadyFailedGaps,
  isCheckpointRetryCoolingDown,
} from '../teaching-checkpoint';

const failedRow = {
  checkpointId: 'cp_1',
  passed: false,
  attempts: 2,
  conceptName: '锁定钟点格读数',
  submittedAt: '2026-11-24T04:39:20.000Z',
};

const assistantAt = (iso: string) => ({ role: 'assistant', timestamp: iso });
const userAt = (iso: string) => ({ role: 'user', timestamp: iso });

describe('isCheckpointRetryCoolingDown', () => {
  it('刚判错、教师还没有新的辅导回复 → 冷却中', () => {
    expect(isCheckpointRetryCoolingDown(
      { messages: [userAt('2026-11-24T04:39:20.000Z')] },
      { checkpointHistory: [failedRow] },
    )).toBe(true);
  });

  it('判错后只有 1 条教师回复（判错反馈本身）→ 仍冷却', () => {
    expect(isCheckpointRetryCoolingDown(
      { messages: [assistantAt('2026-11-24T04:39:48.000Z')] },
      { checkpointHistory: [failedRow] },
    )).toBe(true);
  });

  it('判错后 2 条教师回复（反馈 + 1 轮辅导）→ 仍冷却', () => {
    expect(isCheckpointRetryCoolingDown(
      {
        messages: [
          assistantAt('2026-11-24T04:39:48.000Z'),
          assistantAt('2026-11-24T04:40:16.000Z'),
        ],
      },
      { checkpointHistory: [failedRow] },
    )).toBe(true);
  });

  it('判错后 3 条教师回复（反馈 + 2 轮辅导）→ 解除冷却，允许契约补证重测', () => {
    expect(isCheckpointRetryCoolingDown(
      {
        messages: [
          assistantAt('2026-11-24T04:39:48.000Z'),
          assistantAt('2026-11-24T04:40:16.000Z'),
          assistantAt('2026-11-24T04:40:48.000Z'),
        ],
      },
      { checkpointHistory: [failedRow] },
    )).toBe(false);
  });

  it('最近一次检查点答对 → 不冷却（答对不需要先辅导）', () => {
    expect(isCheckpointRetryCoolingDown(
      { messages: [] },
      { checkpointHistory: [{ ...failedRow, passed: true }] },
    )).toBe(false);
  });

  it('判错行已作废（voided）→ 不参与冷却', () => {
    expect(isCheckpointRetryCoolingDown(
      { messages: [] },
      { checkpointHistory: [{ ...failedRow, voided: true }] },
    )).toBe(false);
  });

  it('旧历史缺 submittedAt → 不误冷却（不能因旧数据阻断契约补证）', () => {
    const { submittedAt, ...legacy } = failedRow;
    expect(submittedAt).toBeTruthy();
    expect(isCheckpointRetryCoolingDown(
      { messages: [] },
      { checkpointHistory: [legacy] },
    )).toBe(false);
  });

  it('冷却轮数可配置：4 轮时第 3 条回复后仍冷却', () => {
    expect(isCheckpointRetryCoolingDown(
      {
        messages: [
          assistantAt('2026-11-24T04:39:48.000Z'),
          assistantAt('2026-11-24T04:40:16.000Z'),
          assistantAt('2026-11-24T04:40:48.000Z'),
        ],
      },
      { checkpointHistory: [failedRow] },
      4,
    )).toBe(true);
  });

  it('默认冷却轮数是 3（判错反馈 + 2 轮辅导）', () => {
    expect(CHECKPOINT_RETRY_COOLDOWN_ASSISTANT_TURNS).toBe(3);
  });
});

describe('hasOnlyAlreadyFailedGaps（唯一缺口已判错 → 不再追打）', () => {
  const failed = {
    checkpointId: 'cp_1', passed: false, conceptName: '锁定钟点格读数',
    submittedAt: '2026-11-24T04:39:20.000Z',
  };
  const passed = { checkpointId: 'cp_2', passed: true, conceptName: '比较同钟点跨天高低' };

  it('唯一缺口就是已判错的 KC → true（本节诚实 met=false 收口）', () => {
    expect(hasOnlyAlreadyFailedGaps(['锁定钟点格读数'], { checkpointHistory: [failed] })).toBe(true);
  });

  it('还有一个从未判错的缺口 → false（仍需为它强制出题）', () => {
    expect(hasOnlyAlreadyFailedGaps(['锁定钟点格读数', '按钟点分组归堆人数'], { checkpointHistory: [failed] })).toBe(false);
  });

  it('缺口为空 / 没有判错历史 → false（不改变既有行为）', () => {
    expect(hasOnlyAlreadyFailedGaps([], { checkpointHistory: [failed] })).toBe(false);
    expect(hasOnlyAlreadyFailedGaps(['锁定钟点格读数'], { checkpointHistory: [] })).toBe(false);
  });

  it('判错行已作废 / 最近是答对 → 不算已判错', () => {
    expect(hasOnlyAlreadyFailedGaps(['锁定钟点格读数'], { checkpointHistory: [{ ...failed, voided: true }] })).toBe(false);
    expect(hasOnlyAlreadyFailedGaps(['锁定钟点格读数'], { checkpointHistory: [passed] })).toBe(false);
  });

  it('空格/标点/大小写差异按归一匹配（题面与 KC 名不是逐字节相同）', () => {
    expect(hasOnlyAlreadyFailedGaps([' 锁定 钟点格读数 '], { checkpointHistory: [failed] })).toBe(true);
  });
});
