/**
 * 检查点共享常量与解析（AITeachingCoordinator/teaching-checkpoint 共用，避免循环依赖）
 */
export const CHECKPOINT_MIN_TURNS = 4;
/** 触发检查点所需"上一轮确有进展"的理解度门槛 */
export const CHECKPOINT_TRIGGER_MIN_UNDERSTANDING = 0.6;
/**
 * 同一检查点重答上限（2026-10-03 完结课堂裸审计 P1 实证）：同一道题被逐轮原样重发，最极端
 * 36 次/节、50/60 节课中招，学员每次照合同答同一选项——「答错保留 pendingCheckpoint」缺上限，
 * 课堂在同一个确认点上空转直到 LEARN_AUTO_TURN_CAP=40 才停。达到该次数仍未通过即强制消费
 * pendingCheckpoint（老师可换题/推进），不再原地循环。
 */
export const CHECKPOINT_MAX_ATTEMPTS = 2;

export function parseSessionArtifacts(teachingState: Record<string, any> | null | undefined) {
  return teachingState?.sessionArtifacts || {};
}
