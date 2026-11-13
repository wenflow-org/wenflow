/**
 * 黑盒实验里「哪些技能该用冻结的模拟器路由」的判定。
 *
 * 背景（2026-11-13 7 例 mini-batch 实证）：
 * `executeSimulatorSkill` 原来对所有仿真技能都套 `simulatorRuntime(snapshot, stage)`，
 * 而快照只冻结了 goal/teaching 两个**主模拟器**的路由。于是每次调用
 * `virtual-learner-epistemic-grounding`（BEAGLE 认知判决）都会命中
 * `API route provider changed: expected skill:virtual-learner-learn-turn-simulator,
 * received skill:virtual-learner-epistemic-grounding`，被 catch 后恒降级为 null。
 *
 * 结果：7/7 个 case 的认知判决全部失效（日志计数 19-87 次/例），学习者认知信号缺失，
 * 裁判只能看到表现、看不到根因。冻结路由的语义应只覆盖「被冻结的那个模拟器」，
 * 旁路辅助 skill 走平台正常路由解析。
 */
export type SimulatorStage = 'goal' | 'teaching'

const STAGE_SIMULATOR_NAMES: Record<SimulatorStage, string> = {
  goal: 'virtual-learner-goal-dialogue-simulator',
  teaching: 'virtual-learner-learn-turn-simulator',
}

/** 该 skill 是否就是本阶段被冻结路由的主模拟器。 */
export function shouldFreezeSimulatorRoute(skillName: string, stage: SimulatorStage): boolean {
  const expected = STAGE_SIMULATOR_NAMES[stage]
  const actual = String(skillName || '').trim()
  return Boolean(expected && actual === expected)
}
