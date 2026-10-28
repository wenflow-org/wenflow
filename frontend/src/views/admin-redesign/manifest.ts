/**
 * Admin 控制台：场景清单（侧栏单一数据源）
 *
 * 2026-10-27 用户「账号与接入组不要了，组内页面移到运营」：导航收成 5 组 + 置顶
 * （运营 → 学习 → 仿真 → Skill → 观测与排查）；撤掉第 6 组，模型与接入 /
 * 用户账号并入「运营」组（组内追加在运营中心之后）；访问与注册同日再并入运营中心宿主 tab。
 * 组内条目按运营日循环排列：总览看待办 → 运营中心处置 → 回到业务域核对。
 * 场景 id 与 URL 一律未改（改名只动 label/group），旧深链与书签继续可达。
 *
 * 分组归属：
 * - 运营：运营中心（tab 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知 · 运维工具 · 数据导出 · 会话安全 · 访问与注册）
 *   + 模型与接入 / 用户账号（2026-10-27 并入：接哪个上游、账号怎么管）
 * - 学习：目标对话 / 学习路径 / 教学会话 / 学习状态 / 复习积压（跨用户待复习榜）
 * - 仿真：虚拟学习者（运行态）/ 学习者卡库（配置态）
 * - Skill：字段流转 / Skill 目录 / Prompt 评估 / 插件
 * - 观测与排查：执行日志 / 审计日志 / 成本分析 / 健康中心
 *
 * 已下线场景（URL 由 router 改投，不占侧栏）：feedback / ops-achievements / messages /
 * session-security / access-control / ops-center / batch-experiments / skill-workbench（隐藏二级页）。
 */

import type { Component } from 'vue'
import {
  Activity, BookOpen, ClipboardCheck, Coins, FlaskConical, HeartPulse, History, IdCard, LayoutDashboard,
  Megaphone, MessagesSquare, Plug, Puzzle, Route, ScrollText, ShieldCheck, Sparkles,
  Target, Users, Workflow,
} from 'lucide-vue-next'

export interface MockSceneDef {
  id: string
  label: string
  group: string
  /** 窄屏（≤860px）折叠为 64px 图标栏时显示的单字图标 */
  glyph: string
  /** 线性图标（侧栏条目 17px + 文字；折叠轨同用） */
  icon: Component
  /** 可选静态徽章；live 模式由 Shell 用真实计数覆盖 */
  badge?: string
  /** 置顶独立入口：渲染在分组上方（平台总览 = 驾驶舱入口） */
  pinned?: boolean
  /** 隐藏场景：不进侧栏/分组，仅供顶栏帮助按钮跳转与页头标题回显（如运营术语表） */
  hidden?: boolean
  /** 检索词：顶栏页面搜索除 label/组名外也匹配这里（搜「密钥」「日志」可直达） */
  keywords?: string[]
}

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', glyph: '览', icon: LayoutDashboard, pinned: true, keywords: ['驾驶舱', '待办', '健康'] },
  // 隐藏场景：壳层帮助按钮（CircleHelp）跳 /admin/glossary，不占侧栏席位
  { id: 'glossary', label: '运营术语表', group: '帮助', glyph: '术', icon: BookOpen, hidden: true, keywords: ['术语', '名词'] },
  // 运营组：tab 宿主（运营待办 · 反馈 · 成就 · 公告 · 站内通知 · 运维工具 · 数据导出 · 会话安全）
  { id: 'ops-hub', label: '运营中心', group: '运营', glyph: '营', icon: Megaphone, keywords: ['待办', '反馈', '公告', '站内通知', '运维', '导出', '会话安全'] },
  // 学习组：排列＝学习流程（目标对话 → 学习路径 → 教学会话），工作台性质的学习状态收在流程尾
  { id: 'goal-conversations', label: '目标对话', group: '学习', glyph: '话', icon: Target, keywords: ['目标', '对话', '澄清'] },
  { id: 'learning-paths', label: '学习路径', group: '学习', glyph: '径', icon: Route, keywords: ['路径', '生成', '失败'] },
  { id: 'teaching-sessions', label: '教学会话', group: '学习', glyph: '教', icon: MessagesSquare, keywords: ['课堂', '会话', '评估'] },
  { id: 'learner-state', label: '学习状态', group: '学习', glyph: '态', icon: Activity, keywords: ['学习者', '干预', '疲劳', '风险'] },
  // 复习积压：按用户汇总的跨用户待复习榜；单用户明细在学习者详情「记忆与复习」页签
  { id: 'memory-review', label: '复习积压', group: '学习', glyph: '忆', icon: History, keywords: ['复习', '积压', '到期', '记忆'] },
  // 仿真组：实例（虚拟学习者）+ 身份池（学习者卡库）
  { id: 'virtual-learners', label: '虚拟学习者', group: '仿真', glyph: '拟', icon: FlaskConical, keywords: ['仿真', '实例', '故事'] },
  { id: 'virtual-learner-cards', label: '学习者卡库', group: '仿真', glyph: '卡', icon: IdCard, keywords: ['卡库', '角色卡', '身份池'] },
  // Skill 组：字段流转（管线/字段路由）+ Skill 目录 + Prompt 评估 + 插件
  { id: 'orchestrator', label: '字段流转', group: 'Skill', glyph: '流', icon: Workflow, keywords: ['编排', '管线', '字段路由', '旅程'] },
  { id: 'skills', label: 'Skill 目录', group: 'Skill', glyph: '能', icon: Sparkles, keywords: ['技能', '目录', '模型路由'] },
  { id: 'prompt-eval', label: 'Prompt 评估', group: 'Skill', glyph: '评', icon: ClipboardCheck, keywords: ['评估', '用例', '通过率'] },
  { id: 'addons', label: '插件', group: 'Skill', glyph: '插', icon: Puzzle, keywords: ['密钥', 'MCP', '联网', '决策', '生图', '外挂'] },
  // 观测与排查：两份日志相邻，成本分析接在其后；健康中心 13 项全是排查项，与日志同一动线
  { id: 'execution-logs', label: '执行日志', group: '观测与排查', glyph: '志', icon: ScrollText, keywords: ['日志', '失败', '链路', '调用'] },
  { id: 'audit-logs', label: '审计日志', group: '观测与排查', glyph: '审', icon: ShieldCheck, keywords: ['审计', '登录', '操作记录'] },
  { id: 'token-cost', label: '成本分析', group: '观测与排查', glyph: '费', icon: Coins, keywords: ['成本', 'Token', '用量', '单价'] },
  { id: 'health-center', label: '健康中心', group: '观测与排查', glyph: '康', icon: HeartPulse, keywords: ['健康', '检查', '一致性', '漂移'] },
  // 原「账号与接入」组（2026-10-27 并入运营）：接哪个上游、账号怎么管
  // （访问与注册同日并入运营中心宿主 tab，不再单列侧栏）
  { id: 'api-config', label: '模型与接入', group: '运营', glyph: '模', icon: Plug, keywords: ['密钥', '上游', '单价', '模型', '供应商'] },
  { id: 'people', label: '用户账号', group: '运营', glyph: '人', icon: Users, keywords: ['用户', '账号', '角色', '密码'] }
]
