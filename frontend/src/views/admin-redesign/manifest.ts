/**
 * Admin 控制台：场景清单（侧栏单一数据源）
 *
 * 导航一级收敛（阶段 1，2026-09-19）：低频页折入 tab 宿主，侧栏由 19 项/6 组收敛为 14 项/6 组。
 * - 运营中心（ops-hub）成为 tab 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知；
 *   feedback / ops-achievements / messages 场景下线（其 URL 重定向到对应 tab）。
 * - 模型与接入（api-config）成为 tab 宿主：接入与模型 · 外挂能力；addons 场景下线。
 * - 系统工具（ops-center）成为 tab 宿主：运维工具 · 数据导出 · 会话安全；session-security 场景下线。
 * - 记忆与复习（memory-review）由「观测」移入「教学」；Skill 组本阶段保持不变。
 *
 * 阶段 2（2026-09-19）：虚拟学习者独立成组（个体实验 / 规模实验）；
 * 2026-09-22：组名「虚拟实验」→「虚拟学习者」（组名跟随主页面，消除命名错位），
 * 「批量实验」由 virtual-learners 的 tab 提升为独立场景；侧栏 15 项/7 组。
 *
 * 阶段 3（2026-09-19）：健康中心折入「Skill 运行」（skills）宿主 tab：
 * Skill 运行 · 健康检查 · 漂移 · 对账；health-center 场景下线（URL 重定向到 ?tab=health）；
 * 侧栏由 15 项/7 组收敛为 14 项/7 组。
 *
 * 2026-09-29（用户拍板）：上一步回退——健康中心折入后那三个 tab 是同一份报表的三刀
 * （后端一次返回 13 项检查，其中 6 项 baseline-drift / 5 项 consistency；前端按手写维度切三个 view，
 * 结果唯一 error 级的「参数一致性 19 处」只出现在健康检查里，漂移 tab 却显示 0 项需处理）。
 * 合一成独立页并归入「系统」组；skills 只留 Skill 运行 / 模型路由 两个 tab。侧栏 17 项/7 组。
 * （同日收尾：参数一致性语义重分类为 consistency——它是 core↔definition 镜像的对等比对，
 *   不是「配置改了没生效」的方向性漂移；19 处镜像滞后已按 b905880c 的 32k 预算同步归零。）
 */

export interface MockSceneDef {
  id: string
  label: string
  group: string
  /** 窄屏（≤860px）折叠为 64px 图标栏时显示的单字图标 */
  glyph: string
  /** 可选静态徽章；live 模式由 Shell 用真实计数覆盖 */
  badge?: string
  /** 置顶独立入口（D5 导航优化）：渲染在分组上方（如平台总览=驾驶舱入口） */
  pinned?: boolean
}

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', glyph: '览', pinned: true },
  // 教学组：真实学习者 / 会话 / 复习（虚拟学习者已独立成组）
  { id: 'people', label: '用户与学习者', group: '教学', glyph: '人' },
  // 2026-09-29 用户拍板拆回独立页：2026-09-04 曾合并为「学习会话」宿主（sessions，已下线、URL 重定向兼容），
  // 三域口径互异且入口层级深一层，教学会话 / 目标对话 / 学习路径各自占一个侧栏入口
  { id: 'teaching-sessions', label: '教学会话', group: '教学', glyph: '教' },
  { id: 'goal-conversations', label: '目标对话', group: '教学', glyph: '话' },
  { id: 'learning-paths', label: '学习路径', group: '教学', glyph: '径' },
  { id: 'memory-review', label: '记忆与复习', group: '教学', glyph: '忆' },
  // 虚拟学习者组：个体实验 / 规模实验
  { id: 'virtual-learners', label: '虚拟学习者', group: '虚拟学习者', glyph: '拟' },
  { id: 'batch-experiments', label: '批量实验', group: '虚拟学习者', glyph: '批' },
  // Skill 组：健康中心已于 2026-09-29 抽出为独立场景（系统组），本组只剩编排图/Skill/Prompt 评估
  // 场景下线，Skill 组由 4 项收敛为 3 项（orchestrator · skills · prompt-eval）。
  // label 带上「提示词」关键词（2026-09 定位收敛：管理台=轻运营调整，改 prompt 的
  // 动线从这里进——新人搜「提示词」能落到正确入口，不再误入 Prompt 评估）
  { id: 'orchestrator', label: '编排图', group: 'Skill', glyph: '流' },
  { id: 'skills', label: 'Skill 与提示词', group: 'Skill', glyph: '能' },
  { id: 'prompt-eval', label: 'Prompt 评估', group: 'Skill', glyph: '评' },
  // 观测组：Token 成本并入执行日志第三 tab（成本分析）；记忆与复习移出后只剩日志双子页
  // 2026-09-29 用户拍板拆回独立页：成本分析从执行日志宿主 tab 释放（原 2026-09-04 并入）
  { id: 'execution-logs', label: '执行日志', group: '观测', glyph: '志' },
  { id: 'token-cost', label: '成本分析', group: '观测', glyph: '费' },
  { id: 'audit-logs', label: '审计日志', group: '观测', glyph: '审' },
  // 系统组：原「配置」组改名；模型与接入成为 tab 宿主（接入与模型 · 外挂能力）；
  // 系统工具成为 tab 宿主（运维工具 · 数据导出 · 会话安全）
  // 2026-09-29 用户拍板：健康中心从 skills 宿主 tab 释放，回独立场景并归入系统组
  //（「健康检查/漂移/对账」三个 tab 本就是同一份报表的三刀，合一后独立成页）
  { id: 'health-center', label: '健康中心', group: '系统', glyph: '康' },
  { id: 'api-config', label: '模型与接入', group: '系统', glyph: '安' },
  { id: 'ops-center', label: '系统工具', group: '系统', glyph: '维' },
  // 运营组：运营中心为 tab 宿主（运营待办 · 反馈 · 成就 · 公告 · 站内通知）
  { id: 'ops-hub', label: '运营中心', group: '运营', glyph: '营' }
]
