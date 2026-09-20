/**
 * 检查点共享常量与解析（AITeachingCoordinator/teaching-checkpoint 共用，避免循环依赖）
 */
export const CHECKPOINT_MIN_TURNS = 4;
/** 触发检查点所需"上一轮确有进展"的理解度门槛 */
export const CHECKPOINT_TRIGGER_MIN_UNDERSTANDING = 0.6;

export function parseSessionArtifacts(teachingState: Record<string, any> | null | undefined) {
  return teachingState?.sessionArtifacts || {};
}
