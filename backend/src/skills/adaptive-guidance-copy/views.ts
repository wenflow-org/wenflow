/**
 * adaptive-guidance-copy 实际支持的页面视图（#187 的唯一真源）。
 *
 * 2026-11-06 收口前的病灶：skill 声明过 dashboard / learning-state / path-list / path-detail
 * 四个 view，但模型侧只有一处调用且硬编码 `view: 'dashboard'`——learning-state 页拿的是
 * dashboard 口径的文案（欢迎式 headline、第 2 条动作还是指向本页的「查看学习状态」自指深链），
 * path-list / path-detail 没有任何调用方。
 *
 * 现在两侧都按真实口径收口：
 *  - dashboard：DashboardGuidanceSnapshotService 生成（事件驱动快照）；
 *  - learning-state：LearningStateGuidanceService 生成（视图自己的口径）。
 * 路由校验、skill 入参、调用方共用本文件，避免三处各自抄一份 view 列表再漂移。
 */
export const GUIDANCE_VIEWS = ['dashboard', 'learning-state'] as const;

export type GuidanceView = (typeof GUIDANCE_VIEWS)[number];

export function isGuidanceView(value: unknown): value is GuidanceView {
  return typeof value === 'string' && (GUIDANCE_VIEWS as readonly string[]).includes(value);
}
