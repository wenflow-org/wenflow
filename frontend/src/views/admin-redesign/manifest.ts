/**
 * Admin 控制台：场景清单（侧栏单一数据源）
 *
 * 导航一级收敛（阶段 1，2026-09-19）：低频页折入 tab 宿主，侧栏由 19 项/6 组收敛为 14 项/6 组。
 * - 运营中心（ops-hub）成为 tab 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知
 *   · 运维工具 · 数据导出 · 会话安全；
 *   feedback / ops-achievements / messages 场景下线（其 URL 重定向到对应 tab）。
 * - 模型与接入（api-config）成为 tab 宿主：接入与模型 · 外挂能力；addons 场景下线。
 *   （2026-10-19 反转：「外挂能力」从该宿主拆回独立页并归入 Skill 组——见下方 Skill 组注释）
 * - 系统工具（ops-center）2026-10-16 解散并入运营中心（三页签挂 ops-hub）；session-security 场景同日退役。
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
 *
 * 2026-10-04（用户拍板）：「批量实验」场景整体下线。其运行态能力已被「虚拟学习者」页吸收
 * （批量新建 / 并发配额 / 全局限速 / 实例流水），资产输入归「学习者卡库」；且建页至今
 * batch_experiments / batch_experiment_runs 两表始终 0 行（空占位页）。侧栏「虚拟学习者」
 * 组收敛为 2 项：虚拟学习者（运行态）+ 学习者卡库（配置态）；旧 URL
 * /admin/batch-experiments 重定向到 /admin/virtual-learners。侧栏 19 项/7 组。
 */

import type { Component } from 'vue'
import {
  Activity, BookOpen, Coins, FlaskConical, HeartPulse, History, IdCard, LayoutDashboard,
  Megaphone, MessagesSquare, Plug, Puzzle, Route, ScrollText, ShieldCheck, Sparkles,
  Target, Users, Workflow,
} from 'lucide-vue-next'

export interface MockSceneDef {
  id: string
  label: string
  group: string
  /** 窄屏（≤860px）折叠为 64px 图标栏时显示的单字图标 */
  glyph: string
  /** 线性图标（newui/admin 原型壳：侧栏条目 17px 线性图标 + 文字；折叠轨同用） */
  icon: Component
  /** 可选静态徽章；live 模式由 Shell 用真实计数覆盖 */
  badge?: string
  /** 置顶独立入口（D5 导航优化）：渲染在分组上方（如平台总览=驾驶舱入口） */
  pinned?: boolean
  /** 隐藏场景（2026-10-10）：不进侧栏/分组，仅供顶栏帮助按钮跳转与页头标题回显（如运营术语表） */
  hidden?: boolean
}

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', glyph: '览', icon: LayoutDashboard, pinned: true },
  // 运营术语表（2026-10-10 用户拍板：83 条词条是参考资料不是弹层，抽屉退役改整页）。
  // 隐藏场景：壳层帮助按钮（CircleHelp）跳 /admin/glossary，不占侧栏席位
  { id: 'glossary', label: '运营术语表', group: '帮助', glyph: '术', icon: BookOpen, hidden: true },
  // 教学组：真实学习者 / 会话 / 复习（虚拟学习者已独立成组）
  { id: 'people', label: '用户与学习者', group: '教学', glyph: '人', icon: Users },
  // 2026-09-29 用户拍板拆回独立页：2026-09-04 曾合并为「学习会话」宿主（sessions，已下线、URL 重定向兼容），
  // 三域口径互异且入口层级深一层，目标对话 / 学习路径 / 教学会话各自占一个侧栏入口。
  // 排列＝学习流程（2026-10-11 走查「重新排序」）：Goal 目标对话 → Path 学习路径 → Learn 教学会话；
  // 原顺序把 Learn（教学会话）排在 Goal / Path 之前，与实际链路相反。
  // 「学习状态」2026-10-15 用户拍板挪到教学会话之后（观测/工作台性质，不属学习流程链路，收在流程尾）。
  // 「记忆与复习」2026-10-12 用户拍板退役（并入学习者详情「记忆与复习」页签），侧栏项随之撤除；
  // 场景注册保留为重定向 shim 接旧深链。
  { id: 'goal-conversations', label: '目标对话', group: '教学', glyph: '话', icon: Target },
  { id: 'learning-paths', label: '学习路径', group: '教学', glyph: '径', icon: Route },
  { id: 'teaching-sessions', label: '教学会话', group: '教学', glyph: '教', icon: MessagesSquare },
  // 2026-10-04 用户拍板拆回独立页：学习状态从 people 宿主 tab 释放（同 2026-09-29 教学三页先例），
  // 一屏工作台（观测栏 + 排查表格）自成入口；旧 ?tab=state / learner-center / learner-models 深链重定向兼容
  { id: 'learner-state', label: '学习状态', group: '教学', glyph: '态', icon: Activity },
  // 「记忆与复习」2026-10-12 一度随独立页退役，同日恢复跨用户总览（按待复习量排序的用户
  // 列表 + 到期时间轴）；单用户明细在学习者详情「记忆与复习 / 记忆调度」页签
  { id: 'memory-review', label: '记忆与复习', group: '教学', glyph: '忆', icon: History },
  // 虚拟学习者组：运行态（虚拟学习者）+ 配置态（学习者卡库）；「批量实验」2026-10-04 下线
  { id: 'virtual-learners', label: '虚拟学习者', group: '虚拟学习者', glyph: '拟', icon: FlaskConical },
  { id: 'virtual-learner-cards', label: '学习者卡库', group: '虚拟学习者', glyph: '卡', icon: IdCard },
  // Skill 组：健康中心已于 2026-09-29 抽出为独立场景（系统组）。
  // 「Prompt 评估」2026-10-04 折入 skills 宿主「Prompt 评估」页签，本组收敛为 2 项
  // （orchestrator · skills）；旧 URL /admin/prompt-eval 在 router 重定向。
  // 2026-10-19 用户拍板：「外挂能力」从 api-config 宿主拆回独立页并入本组（第 3 项）。
  // label 带上「提示词」关键词（2026-09 定位收敛：管理台=轻运营调整，改 prompt 的
  // 动线从这里进——新人搜「提示词」落到本组；评估动线现同在 skills 宿主页签内）
  { id: 'orchestrator', label: '编排图', group: 'Skill', glyph: '流', icon: Workflow },
  { id: 'skills', label: 'Skill 与提示词', group: 'Skill', glyph: '能', icon: Sparkles },
  // 「插件」2026-10-19 用户拍板拆回独立页，2026-10-20 定名：「外挂能力」统一叫「插件」——
  // 这一页列的是可选能力与 MCP 服务（每项能力本身就是一条 Skill），关系更近 Skill，故归入本组；
  // 旧深链 /admin/addons 与 /admin/external-capabilities 本就是本页路径，?tab=addons 由路由改投。
  { id: 'addons', label: '插件', group: 'Skill', glyph: '插', icon: Puzzle },
  // 观测组：Token 成本并入执行日志第三 tab（成本分析）；记忆与复习移出后只剩日志双子页
  // 2026-09-29 用户拍板拆回独立页：成本分析从执行日志宿主 tab 释放（原 2026-09-04 并入）
  { id: 'execution-logs', label: '执行日志', group: '观测', glyph: '志', icon: ScrollText },
  { id: 'token-cost', label: '成本分析', group: '观测', glyph: '费', icon: Coins },
  { id: 'audit-logs', label: '审计日志', group: '观测', glyph: '审', icon: ShieldCheck },
  // 系统组：原「配置」组改名；模型与接入成为 tab 宿主（接入与模型 · 外挂能力）
  // 2026-09-29 用户拍板：健康中心从 skills 宿主 tab 释放，回独立场景并归入系统组
  //（「健康检查/漂移/对账」三个 tab 本就是同一份报表的三刀，合一后独立成页）
  // 2026-10-16 用户拍板：「系统工具」场景解散并入运营中心（ops-hub 的运维工具/数据导出/
  // 会话安全三页签）；ops-center 从侧栏撤除，旧 URL 在 router 重定向到对应 tab。
  { id: 'health-center', label: '健康中心', group: '系统', glyph: '康', icon: HeartPulse },
  { id: 'api-config', label: '模型与接入', group: '系统', glyph: '安', icon: Plug },
  // 运营组：运营中心为 tab 宿主（运营待办 · 反馈 · 成就 · 公告 · 站内通知
  //          · 2026-10-16 并入的运维工具 / 数据导出 / 会话安全）
  { id: 'ops-hub', label: '运营中心', group: '运营', glyph: '营', icon: Megaphone }
]
