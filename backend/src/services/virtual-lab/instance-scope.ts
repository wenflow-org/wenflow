/**
 * 虚拟学习者「实例」的标记与取数范围（2026-11-09 统一）
 *
 * 卡库（身份池）与实例同处 `virtual_learner_profiles` 一张表，靠 `profile` JSON 里的标记区分：
 *   - `derivedFrom`：选角派生（`card-import.service.cloneCardsToLearners`，身份克隆的唯一写入点）
 *   - `origin`     ：批量实验直接建号（`batch-experiment.service.createLearner`，不经身份克隆、没有来源卡）
 * 两个键任一存在 = 实例；模板卡两个键都不写。
 *
 * 为什么不用「userId 是否为空」区分：预置一键加载与早期导入的模板卡同样带账号（历史库里
 * 它们当年被直接当学习者跑过），只有标记能把身份池与实例分开。
 *
 * 此前判定字面量在列表侧（`virtual-learner-profile.repo`）与会话读侧（`virtual-session.repo`）
 * 各写一份、靠注释声明「同源」；批量实验这条建号路径漏了标记，于是它建的实例既不在列表、
 * 不进统计，也进不了清理向导（成为孤儿数据）。这里收敛成一份，并把写入侧的键名也放同一处，
 * 新增建号路径时只改这一个文件。
 */
import type { Prisma } from '@prisma/client'

/** 派生实例的来源标记键（身份克隆） */
export const DERIVED_FROM_KEY = 'derivedFrom'
/** 批量实验建号的来源标记键 */
export const BATCH_ORIGIN_KEY = 'origin'

export const INSTANCE_MARKER_KEYS = [DERIVED_FROM_KEY, BATCH_ORIGIN_KEY] as const

/** profile JSON 子串判定（`profile` 不是独立列，故按 JSON 子串匹配；schema 受共享生成物约束不便改列） */
export const INSTANCE_PROFILE_WHERE: Prisma.virtual_learner_profilesWhereInput = {
  OR: INSTANCE_MARKER_KEYS.map((key) => ({ profile: { contains: `"${key}"` } })),
}

/** 会话读侧的同源范围（通过关系过滤到实例）；全量聚合与列表必须同一范围，否则「列表 0 人、完成率却有数」 */
export const INSTANCE_SESSION_WHERE: Prisma.virtual_sessionsWhereInput = {
  virtual_learner_profiles: INSTANCE_PROFILE_WHERE,
}

/**
 * 批量实验建号时写进 profile 的实例标记（写入侧与判定侧同源）。
 * 语义是「这个实例由某次批量实验创建」，不冒充「从某张卡派生」——卡详情页的「派生自」链接
 * 与「本卡派生数」都按 `derivedFrom.profileId` 指向来源卡，批量实例没有来源卡，不该写那个键。
 */
export function batchExperimentOrigin(runId: string): Record<string, unknown> {
  return { [BATCH_ORIGIN_KEY]: { kind: 'batch-experiment', runId } }
}
