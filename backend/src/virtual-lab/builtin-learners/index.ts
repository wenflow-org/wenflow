/**
 * 预制虚拟学习者（builtin presets）模块出口。
 *
 * - 定义真源：仓库根 virtual-learners/presets.yaml（File-as-Truth，进 git）
 * - 启动同步：ensureBuiltinVirtualLearners()（幂等，保留运行时产物）
 */
export { ensureBuiltinVirtualLearners, __internal } from './seeder';
export type { EnsureBuiltinLearnersResult } from './seeder';
export {
  loadBuiltinLearnerPresets,
  computePresetContentHash,
  BUILTIN_LEARNERS_FILE,
} from './loader';
export type { BuiltinLearnerPreset, BuiltinLearnerPresetLoadResult } from './loader';
