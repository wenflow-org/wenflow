import type { PathTopology } from './learning.types';

/**
 * 路径拓扑策略的唯一来源（2026-11-25）。
 *
 * 背景：`subject` 引入后，stopping 豁免、透镜互异、交付物取法、阶段锚粒度这些差异
 * 一度散落在 planner / coordinator / core / 前端四处各自写 `topology === 'subject'`。
 * 每加一个拓扑就要改四处，正是「面多加水」的根源。这里把**语义差异**集中成一张策略表，
 * 消费方只问策略，不再判断具体拓扑字符串。
 *
 * 注意区分：
 * - 拓扑差异（本表）：不同拓扑的教学形态本来就不同，属于产品语义；
 * - case 差异（禁止）：按 case id、学科名、关键词给某条路径开白名单——一律不写。
 */
export interface PathTopologyPolicy {
  /** 末阶段是否必须 serves=stopping（没有单一收口作品的拓扑豁免）。 */
  requiresStoppingRationale: boolean;
  /** 阶段透镜是否必须互异（单作品拓扑允许 hub 回捞，教材/多单元拓扑不允许）。 */
  requiresUniqueStageLens: boolean;
  /** 是否要求 hub 概念被非首阶段回捞（单作品/主线类拓扑的贯穿要求）。 */
  requiresHubReuseInLaterStages: boolean;
  /** 交付物是否取末阶段 goal（单作品拓扑）；否则取路径级 firstDeliverable。 */
  deliverableFromLastStage: boolean;
  /** 阶段 goal 是否只允许单元级锚（册次/全书范围留在路径层）。 */
  stageGoalUnitAnchorOnly: boolean;
}

export const PATH_TOPOLOGY_POLICY: Record<PathTopology, PathTopologyPolicy> = {
  exploratory: {
    requiresStoppingRationale: true,
    // 起步段围绕一条主线展开，hub 回捞是设计意图。
    requiresUniqueStageLens: false,
    requiresHubReuseInLaterStages: true,
    deliverableFromLastStage: false,
    stageGoalUnitAnchorOnly: false,
  },
  builder: {
    requiresStoppingRationale: true,
    // builder 以「一个贯穿作品」递进，hub 回捞是设计意图，不要求逐阶段换透镜。
    requiresUniqueStageLens: false,
    requiresHubReuseInLaterStages: true,
    deliverableFromLastStage: true,
    stageGoalUnitAnchorOnly: false,
  },
  exam: {
    requiresStoppingRationale: true,
    requiresUniqueStageLens: false,
    requiresHubReuseInLaterStages: true,
    deliverableFromLastStage: false,
    stageGoalUnitAnchorOnly: false,
  },
  diagnostic: {
    requiresStoppingRationale: true,
    requiresUniqueStageLens: false,
    requiresHubReuseInLaterStages: true,
    deliverableFromLastStage: false,
    stageGoalUnitAnchorOnly: false,
  },
  subject: {
    // 一学期教材/多单元平行：没有单一收口作品，末单元不是全书终评。
    requiresStoppingRationale: false,
    // 每个单元必须自带一副透镜，复用会把多章压成同一节课。
    requiresUniqueStageLens: true,
    // 多单元平行没有贯穿主线，不要求回捞 hub。
    requiresHubReuseInLaterStages: false,
    deliverableFromLastStage: false,
    // 册次/全书范围属于路径级信息，挂在单元阶段上会把「这一单元学到哪」读成「整册学到哪」。
    stageGoalUnitAnchorOnly: true,
  },
};

export function resolvePathTopologyPolicy(topology: unknown): PathTopologyPolicy {
  const value = typeof topology === 'string' ? topology.trim() : '';
  const key = (value in PATH_TOPOLOGY_POLICY ? value : 'diagnostic') as PathTopology;
  return PATH_TOPOLOGY_POLICY[key];
}
