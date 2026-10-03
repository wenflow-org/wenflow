/**
 * 检查点重答上限（2026-10-03 完结课堂裸审计 P1）
 *
 * 背景：同一道检查点被逐轮原样重发——实测最极端 36 次/节、50/60 节完结课中招，
 * 学员每次照合同答同一选项，课堂在同一个确认点上空转到 LEARN_AUTO_TURN_CAP 才停。
 * 直接消费 pendingCheckpoint 会丢反馈；无上限重答会造成循环。resolveCheckpointConsumption
 * 给出「答对即消费 / 答错到顶强制消费 / 否则保留重答」的确定性决策。
 */
import { resolveCheckpointConsumption } from '../teaching-checkpoint';
import { CHECKPOINT_MAX_ATTEMPTS } from '../checkpoint-shared';

describe('resolveCheckpointConsumption 检查点消费决策', () => {
  it('答对 → 消费，且不标记到顶', () => {
    expect(resolveCheckpointConsumption(true, 1)).toEqual({ consume: true, exhausted: false });
    expect(resolveCheckpointConsumption(true, 5)).toEqual({ consume: true, exhausted: false });
  });

  it('答错但未到上限 → 保留（允许重答）', () => {
    expect(CHECKPOINT_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(resolveCheckpointConsumption(false, 1)).toEqual({ consume: false, exhausted: false });
  });

  it('答错且同一 cpId 累计作答达上限 → 强制消费，打破同一题循环', () => {
    expect(resolveCheckpointConsumption(false, CHECKPOINT_MAX_ATTEMPTS)).toEqual({ consume: true, exhausted: true });
    expect(resolveCheckpointConsumption(false, CHECKPOINT_MAX_ATTEMPTS + 3)).toEqual({ consume: true, exhausted: true });
  });

  it('上限恰好是「允许重答一次、第二次答错即消费」的语义', () => {
    // 第 1 次答错：attempts=1 → 保留；第 2 次答错：attempts=2 → 消费
    expect(resolveCheckpointConsumption(false, 1).consume).toBe(false);
    expect(resolveCheckpointConsumption(false, 2).consume).toBe(true);
  });
});