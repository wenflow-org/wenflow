# 管理后台功能补全（P0 + P1 + P2） - 改动记录

**日期**: 2026-08-29
**改动目标**: 对照标准管理后台补齐缺失功能：批量实验 / Prompt 评估 / 运维工具 / 管理员管理 / 平台设置 / 内容管理 / 成就管理 / 数据导出 / 站内通知

---

## 📝 新增功能总览（9 个后台页面 + 1 个用户端入口）

### P0（接口已就绪，补页面）

| 页面 | 路径 | 说明 |
|---|---|---|
| 批量实验 | `/admin/batch-experiments` | 系统级队列实验：创建/停止实验、逐 run 推进/衰减/快照、进度可视化 |
| Prompt 评估 | `/admin/prompt-eval` | 评估用例 CRUD + 单条试跑 + 批量评估历史（后端 run-eval/eval-runs 已有） |
| 运维工具 | `/admin/devtools` | outbox 死信查看/重放、时间推进模拟（画像衰减预览） |

### P1（标准后台标配）

| 页面 | 路径 | 说明 |
|---|---|---|
| 管理员 | `/admin/admins` | 管理员列表、提升/移除（复用用户角色 API） |
| 平台设置 | `/admin/settings` | 聚合注册开关、模型可靠性参数、AI 能力探测 |
| 内容管理 | `/admin/content` | 学习路径全局治理：列表/详情/下线/恢复/删除 + 统计 |
| 成就管理 | `/admin/achievements` | 成就定义、解锁记录、手动发放/撤回/重检 |

### P2（运营深化）

| 页面 | 路径 | 说明 |
|---|---|---|
| 数据导出 | `/admin/export-data` | 用户/会话/反馈/目标对话/执行日志/审计日志 CSV 导出（UTF-8 BOM） |
| 站内通知 | `/admin/notifications` + 用户端铃铛 | 全员/定向推送；用户端 `NotificationsBell` 展示与已读 |

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

- `manifest.ts`：新增 9 个场景（含新分组「运维」）
- `AdminConsole.vue`：注册 9 个新异步页面组件
- `adminApi.ts`：新增 `adminAchievementsApi` / `adminLearningContentApi` / `adminDevtoolsApi` / `adminNotificationsApi`，补全 `adminPromptOpsApi` 的 eval-cases/eval-runs/run-eval
- 新增页面：`BatchExperiments.vue` / `PromptEval.vue` / `Devtools.vue` / `Admins.vue` / `Settings.vue` / `ContentManager.vue` / `AchievementsAdmin.vue` / `ExportData.vue` / `Notifications.vue`
- 用户端：`components/NotificationsBell.vue`（通知铃铛，接入 `V2Nav.vue`）

## 🧪 验证结果

- 后端 `tsc --noEmit` 通过；前端 `vue-tsc` 新文件零错误
- `vite build` 构建成功（新页面均为独立异步 chunk）
- 后端 jest：`1506 passed / 5 failed`，与改动前基线**完全一致**（零回归；5 个失败为预先存在的 skills-file/terminology-guard 等 suite）
- 前端 admin-redesign 测试：`270 passed / 10 failed`，比基线（266/14）**更好**（修复了 manifest 分组与 shell 导航的过时断言）
- Playwright 实测：9 个新页面全部渲染正常，无整页错误；内容管理/成就/通知/导出/运维 API 均 200 实测通过

## ⚠️ 注意事项

- `REAL_USER_WHERE` 的用法：它已含 `isVirtualLearner: false` 与 `NOT` 数组，直接作为 where 使用，**不要**展开 `.NOT`
- devtools 路由内部自带 `/devtools` 前缀，挂载点是 `/api/admin`（不是 `/api/admin/devtools`）
- 后端重启已执行（ts-node-dev），新路由即时生效
