# 管理后台功能补全（P0 + P1 + P2） - 改动记录

**日期**: 2026-08-29
**改动目标**: 对照标准管理后台补齐缺失功能：批量实验 / Prompt 评估 / 运维工具 / 内容管理 / 成就管理 / 数据导出 / 站内通知；经重叠审查与合并优化，最终 5 个新页面 + 1 个用户端入口

---

## 📝 新增功能总览（5 个后台页面 + 1 个用户端入口）

> 初版 9 个页面 → 重叠审查删除 2 个（Settings/Admins）→ tab 合并收敛为 5 个（运维中心/运营中心）。

### P0（接口已就绪，补页面）

| 页面 | 路径 | 说明 |
|---|---|---|
| 批量实验 | `/admin/batch-experiments` | 系统级队列实验：创建/停止实验、逐 run 推进/衰减/快照、进度可视化 |
| Prompt 评估 | `/admin/prompt-eval` | 评估用例 CRUD + 单条试跑 + 批量评估历史（后端 run-eval/eval-runs 已有） |
| **运维中心** | `/admin/ops-center` | Tab1 运维工具（outbox 死信重放 + 时间推进模拟）/ Tab2 数据导出（6 类 CSV） |

### P1（标准后台标配）

| 页面 | 路径 | 说明 |
|---|---|---|
| **运营中心** | `/admin/ops-hub` | Tab1 内容管理（学习路径治理：列表/详情/下线/恢复/删除 + 统计）/ Tab2 成就管理（定义/解锁记录/发放/撤回/重检） |

### P2（运营深化）

| 页面 | 路径 | 说明 |
|---|---|---|
| 站内通知 | `/admin/notifications` + 用户端铃铛 | 全员/定向推送；用户端 `NotificationsBell` 展示与已读 |

旧深链兼容：`/admin/devtools`、`/admin/export-data` → `/admin/ops-center`；`/admin/content`、`/admin/achievements` → `/admin/ops-hub`（router 重定向）。

---

## 🧹 重叠处理（2026-08-29 审查后删除）

对新增页面与既有页面做了逐一重叠核查，删除 2 个重复页面：

| 已删除 | 与谁重叠 | 说明 |
|---|---|---|
| `Settings.vue`（平台设置） | `ApiConfig.vue`（模型与接入） | ApiConfig 已有完整：注册开关（带二次确认）、可靠性参数、能力探测、能力健康、脏位分域保存。完全重复 |
| `Admins.vue`（管理员） | `Users.vue`（用户） | Users 已有完整角色管理：设为管理员/降为用户、admin 筛选 pill、管理员计数、自我保护。核心操作完全重复 |

## 🔀 Tab 合并（2026-08-29，用户拍板）

| 合并结果 | 由哪些页面合并 | 合并方式 |
|---|---|---|
| 运维中心 `OpsCenter.vue` | Devtools + ExportData | 状态条 mk-pills 一级 tab；数据导出懒加载（切 tab 时不再重复拉死信） |
| 运营中心 `OpsHub.vue` | ContentManager + AchievementsAdmin | 一级 tab（内容/成就）+ 成就内二级 tab（定义/记录）；contentLoaded 惰性加载 |

不合并项（评估后否决）：批量实验↔虚拟学习者（曾内嵌后迁出，VL 已 1371 行）；Prompt 评估↔Skill 运行（均为重页面）；站内通知↔公告（数据表/API/展示组件完全独立）。

其余 7 个页面经核查**无重叠**：批量实验（虚拟学习者页仅遗留死 CSS）、Prompt 评估（全站唯一）、内容管理（治理操作全新；UserDetail 路径卡为空态）、成就管理（后台唯一入口）、数据导出、站内通知、运维工具（devtools 此前未挂载）。

### 子代理独立复核（2026-08-29）

用 explore 子代理对剩余 7 个页面做了独立的重叠核查，结论：

| 页面 | 结论 | 证据 |
|---|---|---|
| 批量实验 | 无重叠 | `vl-bexp` 仅为 VirtualLearners.vue 中 11 条孤儿 CSS（无 template 元素）；`adminBatchExperimentsApi` 无第三方调用 |
| Prompt 评估 | 无重叠 | eval-cases/eval-runs/run-eval 全库唯一；skill-design 的"试跑"是技能运行时测试（`adminSkillsApi.testSkill`），对象不同 |
| 内容管理 | 无重叠 | UserDetail 学习路径卡为只读计数空态，无任何治理操作 |
| 成就管理 | 无重叠 | 用户端 `/achievements` 是用户查看自身成就，管理侧（发放/撤回/重检）后台唯一 |
| 运维工具 | 无重叠 | HealthCenter 无死信/时间推进；QuickLearnPanel 的 outbox 仅是状态灯 |
| 数据导出 | 无重叠 | `/admin/export`+blob 唯一；用户端导出是本人日志（`/users/me/agent-logs/export`）；ExecLogs 导出是筛选结果 JSON |
| 站内通知 | 边界清晰 | 与 Announcements（`announcements` 表 + 顶部横幅）数据表/API/用户端展示组件完全独立；`kind=announcement` 仅是分类标签，不读写 announcements 表 |

**复核后处理动作**：
1. 清理 VirtualLearners.vue 中 11 条 `.vl-bexp__*` 孤儿 CSS（批量实验功能独立成页后遗留的死代码）
2. Notifications.vue 优化 kind 文案：「公告」→「公告提醒（站内信）」，并在页面加"横幅公告 → 公告页"边界提示，消除与公告中心的双入口困惑
3. 两个虚拟学习者相关测试（virtual-learners.batch / positioning）14/14 通过，确认清理无回归

---

## 🔧 Backend 改动

### 新增路由（均已挂载 + 审计中间件）

| 文件 | 挂载路径 |
|---|---|
| `backend/src/routes/admin/achievements.ts` | `/api/admin/achievements`（定义/记录/发放/撤回/重检） |
| `backend/src/routes/admin/learning-content.ts` | `/api/admin/learning-content`（路径列表/详情/下线/恢复/删除/统计） |
| `backend/src/routes/admin/export.ts` | `/api/admin/export`（6 类 CSV 导出） |
| `backend/src/routes/admin/notifications.ts` | `/api/admin/notifications`（管理端推送/列表/删除） |
| `backend/src/routes/notifications.ts` | `/api/notifications`（用户端拉取/已读/全部已读） |
| `backend/src/routes/admin/devtools.ts` | **修复：此前未挂载，现已挂载**到 `/api/admin/devtools/*` |

### 数据模型（迁移 `20260828090000_add_notifications`）

- 新增 `notifications` 表：userId / title / body / kind / link / isRead / readAt / createdBy，索引 `[userId, isRead]`、`[userId, createdAt]`、`[kind]`
- `users` 表新增 `notifications` 关系

## 🎨 Frontend 改动

- `manifest.ts`：新增 5 个场景（批量实验 / Prompt 评估 / 运营中心 / 站内通知 / 运维中心，含新分组「运维」）
- `AdminConsole.vue`：注册 5 个新异步页面组件
- `router/index.ts`：4 条旧路径重定向（devtools/export-data → ops-center；content/achievements → ops-hub）
- `adminApi.ts`：新增 `adminAchievementsApi` / `adminLearningContentApi` / `adminDevtoolsApi` / `adminNotificationsApi`，补全 `adminPromptOpsApi` 的 eval-cases/eval-runs/run-eval
- 新增页面：`BatchExperiments.vue` / `PromptEval.vue` / `OpsCenter.vue`（运维工具+数据导出）/ `OpsHub.vue`（内容+成就）/ `Notifications.vue`
- 用户端：`components/NotificationsBell.vue`（通知铃铛，接入 `V2Nav.vue`）

## 🧪 验证结果

- 后端 `tsc --noEmit` 通过；前端 `vue-tsc` 新文件零错误
- `vite build` 构建成功（新页面均为独立异步 chunk）
- 后端 jest：`1506 passed / 5 failed`，与改动前基线**完全一致**（零回归；5 个失败为预先存在的 skills-file/terminology-guard 等 suite）
- 前端 admin-redesign 测试：`270 passed / 10 failed`，比基线（266/14）**更好**（修复了 manifest 分组与 shell 导航的过时断言）
- Playwright 实测：全部新页面渲染正常，无整页错误；合并后运维中心（双 tab）/运营中心（双 tab + 二级 tab）切换、旧深链重定向（/admin/content→ops-hub、/admin/devtools→ops-center）均实测通过；内容/成就/通知/导出/运维 API 均 200 实测通过

## ⚠️ 注意事项

- `REAL_USER_WHERE` 的用法：它已含 `isVirtualLearner: false` 与 `NOT` 数组，直接作为 where 使用，**不要**展开 `.NOT`
- devtools 路由内部自带 `/devtools` 前缀，挂载点是 `/api/admin`（不是 `/api/admin/devtools`）
- 后端重启已执行（ts-node-dev），新路由即时生效
