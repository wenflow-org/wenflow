# WenFlow 管理端运营操作手册（ADMIN_OPERATIONS_MANUAL）

> 📌 类型：活规范（运营 SOP 单源，随代码核验）｜最后核验：2026-11-02。索引见 [doc/README.md](./README.md)。

> **适用范围**：WenFlow 教学平台管理后台（`/admin/*`）。
> **事实源**：本手册所有路由、筛选谓词、指标口径、动作名均抄自前端代码
> `frontend/src/views/admin-redesign/*.vue`、`frontend/src/api/adminApi.ts`、
> `frontend/src/views/admin-redesign/live.ts`、`frontend/src/views/admin-redesign/store.ts`、
> `frontend/src/router/index.ts`。凡与截图、旧评审或以旧版本代码写成的文档冲突，**以当前代码为准**。
> **读者**：人类运营（照着做）+ agent（路由 / 参数 / 动作名可机器解析，见 §4 YAML 附录）。
> **不写实现细节**：只回答「这页管什么业务问题、数字怎么算出来、你该点什么、异常了去哪」。

---

## 1. 总览

### 1.1 管理端定位与登录

- 管理端是**运营驾驶舱 + 排障台**，回答四类问题：教学闭环是否跑通、用户/学习者是否健康、Skill 是否在正常运行、成本是否异常（`manifest.ts:47-77`；`Overview.vue:1-359`）。
- 入口：访问 `/admin` 会重定向到 `/admin/overview`（`router/index.ts:182-184`）。
- 登录页 `/admin/login`（`router/index.ts:176-181`）：
  - 字段为**管理员账号 + 密码 + 「记住本机登录状态」勾选**（`Login.vue:20-77`）。
  - 勾选「记住」→ 登录标记与账号信息写 `localStorage`；不勾 → 写 `sessionStorage`（`Login.vue:224-226`）。**「已登录」标记键是 `wenflow_admin_session`**（值 `'1'`，`adminApi.ts:15, 195`）；`admin_user` 只存账号信息 JSON，不是登录判据（`Login.vue:225-226`）。
  - 实际会话凭据是 **HttpOnly Cookie**；JS 侧只存「已登录」标记与账号信息，不存 token（`adminApi.ts:190` `markAdminSession`、`adminApi.ts:169` `clearAdminSession`）。
  - 未登录访问受保护页 → 跳 `/admin/login?redirect=<原路径>`，登录后回到原深链（含二级页 query）；`safeRedirect` 只允许同源且以 `/admin/` 开头的地址，否则回落 `/admin/overview`（`Login.vue:180-204`）。
  - 登录失败：凭证错误进顶部横幅；429 提示「登录尝试过于频繁」；无状态码或 5xx 提示「服务暂时不可用」（`Login.vue:236-241`）。
- 退出登录：右上角账户菜单 → 「退出登录」（`Shell.vue:247-253`）。
- 顶栏全局工具：**运营术语表**整页（「这是什么」词条，数据源 `GET /admin/glossary`，`Shell.vue:205-212`；`adminApi.ts:1108-1112`）、**密度切换**（compact/standard，localStorage 记忆，`Shell.vue:500-517`）、主题、刷新。
- 新建/重置用户密码规则：**≥8 位且同时含字母与数字**（`UserFormDialog.vue:81-82`）。

### 1.2 页面地图（路由 → 一句话职责）

侧栏由 `manifest.ts:47-77` 单源定义，`MOCK_SCENES` 共 20 条目：19 个可见场景（1 个置顶「平台总览」+ 18 个分属运营 / 学习 / 仿真 / Skill / 观测与排查五组）+ 1 个隐藏场景（glossary 运营术语表，顶栏帮助按钮入口）。`/admin/:page?` 是唯一宿主路由（`router/index.ts:375`），组件注册见 `AdminConsole.vue:133-173`。

| 组 | 路由 | 场景 label | 一句话职责 | 组件 |
|---|---|---|---|---|
| 总览 | `/admin/overview` | 平台总览 | 全站健康一屏：KPI + 教学闭环 + 待办 + 事件流 | `Overview.vue` |
| 运营 | `/admin/ops-hub` | 运营中心 | 运营待办、反馈、成就、公告、站内通知 + 运维工具/数据导出/会话安全/访问与注册 | `OpsHub.vue` |
| 学习 | `/admin/goal-conversations` | 目标对话 | 目标澄清会话、路径生成源头、重建/删除 | `GoalConversations.vue` |
| 学习 | `/admin/learning-paths` | 学习路径 | 路径治理：下线/恢复/删除、状态分布 | `OpsContent.vue` |
| 学习 | `/admin/teaching-sessions` | 教学会话 | 会话状态实时监视、缺总结/异常/建议定位 | `TeachingSessions.vue` |
| 学习 | `/admin/learner-state` | 学习状态 | 学习者状态分布、风险与低置信群体排查、重算 | `LearnerCenter.vue` |
| 学习 | `/admin/memory-review` | 复习积压 | FSRS 到期积压、课内温故计划、概念归并审计 | `MemoryReviewOverview.vue` |
| 仿真 | `/admin/virtual-learners` | 虚拟学习者 | 合成画像压测教学闭环、运行/批量新建/回收 | `VirtualLearners.vue` |
| 仿真 | `/admin/virtual-learner-cards` | 学习者卡库 | 角色卡（纯档案+故事池，不建账号）导入导出 | `VirtualLearnerCards.vue` |
| Skill | `/admin/orchestrator` | 字段流转 | 顶层 Agent 数据流转、字段血缘、治理 | `Orchestrator.vue` |
| Skill | `/admin/skills` | Skill 目录 | Skill 运行；页头「批量模型配置」弹窗 | `Skills.vue` |
| Skill | `/admin/prompt-eval` | Prompt 评估 | 提示词质量评测：用例集 + 历史运行 | `PromptEval.vue` |
| Skill | `/admin/addons` | 插件 | 插件（能力 Skill 与 MCP 服务）登记/测试 | `Addons.vue` |
| 观测与排查 | `/admin/execution-logs` | 执行日志 | Skill 执行日志 + Trace 链路、失败定位 | `ExecLogs.vue` |
| 观测与排查 | `/admin/audit-logs` | 审计日志 | 管理操作审计 + 管理员登录审计 | `AuditLogs.vue` |
| 观测与排查 | `/admin/token-cost` | 成本分析 | 模型/Skill/用户/模型维度 Token 与成本 | `TokenCost.vue` |
| 观测与排查 | `/admin/health-center` | 健康中心 | 服务可用性、一致性核查、完成度 | `HealthCenter.vue` |
| 运营 | `/admin/api-config` | 模型与接入 | 模型供应商、连接/调用策略、基础设施模型 | `ApiConfig.vue` |
| 运营 | `/admin/people` | 用户账号 | 账号管理：角色、登录状态、软删/恢复、批量导出 | `People.vue`（内嵌 `Users.vue`） |

**二级页**（不占独立侧栏项，经 `?view=&id=` 深链寻址，`AdminConsole.vue:175-190, 276-360`）：

| `view` 取值 | 二级页 | 组件 |
|---|---|---|
| `learner` | 学习者详情 | `LearnerDetail.vue` |
| `user` | `LearnerDetail.vue` 的别名（默认落「账号与许可」页签） | `LearnerDetail.vue` |
| `virtual` | 虚拟学习者画像 | `VirtualProfile.vue` |
| `session` / `session-real` | 会话座舱（虚拟会话控制台 / 真实会话只读监控） | `SessionCockpit.vue` |
| `path` | 路径详情 | `PathDetail.vue` |
| `skill` | Skill 详情 | `SkillDetail.vue` |

**隐藏场景**（不在侧栏但 URL 可达）：`/admin/glossary`（运营术语表，manifest `hidden: true`，顶栏帮助按钮入口，`glossary` 组件）；`/admin/skill-workbench`（Skill 工作台：核心文件清单与编译同步状态；「从 0 新建 Skill」**已迁出管理台、统一走 CLI** —— `PromptWorkbench.vue:172`，注册见 `AdminConsole.vue:167-169`）；`/admin/skills/:agentId+`（Skill 详情旧深链，重定向到 `?view=skill&id=`，`router/index.ts:195`）。

**常见旧书签重定向**（`router/index.ts:187-373`）：`/admin/console/:page`、`/admin/users→people`、`/admin/learner-center|learner-models→learner-state`、`/admin/sessions?tab=`（→ teaching-sessions / goal-conversations / learning-paths）、`/admin/content|ops-content→learning-paths`、`/admin/skills?tab=prompt-eval→prompt-eval`（2026-10-25 拆页反向）、`/admin/health→health-center`、`/admin/traces|trace-waterfall|prompt-call-logs|event-center→execution-logs`、`/admin/batch-experiments→virtual-learners`、`/admin/feedback→ops-hub?tab=feedback`、`/admin/announcements|messages→ops-hub?tab=announce`、`/admin/notifications→ops-hub?tab=inapp`、`/admin/achievements|ops-achievements→ops-hub?tab=achievements`、`/admin/devtools→ops-hub?tab=tools`、`/admin/export-data→ops-hub?tab=export`、`/admin/session-security→ops-hub?tab=security`、`/admin/access-control→ops-hub?tab=access`、`/admin/models→api-config`、`/admin/external-capabilities→addons`。

### 1.3 全局交互方言（写一次，全站适用）

1. **页头 KPI 带（`.mk-kpi-grid` + `MkKpi`）**
   - 位置：页头之下、内容卡之上。同屏**只允许一条统计带**（撤带拍板），同一数字不在两处重复念。
   - 口径写法：`hint` = 一短句可见口径；悬停 `title` = 长解释。`tone`（ok/warn/bad）给数字着色；`clickable` 表示可点跳转（`MkKpi.vue:1-23`）。
   - **列表页可能没有 KPI 栅格**（撤带属正常设计），不据此判缺陷。

2. **贴表分布条（`MkDistBand`）**：教学组与多页统一标准件。
   - 位置：**列表卡上方、页面级**（「分段条在上」拍板）。
   - 点击分段或图例 = 下钻筛选下方表格，**再点同段取消**（`MkDistBand.vue:20-48, 77-90`）。
   - 图例恒显计数（含 0 值档），非零段才出色块；偏态保护：1 人也露出可点色标（段宽下限 3% + `min-width:14px`，`MkDistBand.vue:95-97, 112`）。
   - 口径提示：分布条若副标标注「窗口 / 非全量」，表示只统计**当前已加载列表**；服务端全量的页面会在副标写明「服务端 group-by」。

3. **下划线页签（tabs）**：页内视图切换一律下划线 tabs（激活蓝字 + 2px 蓝下划线）；**胶囊 pills 只做筛选 chips，不做视图切换**（`HealthCenter.vue:88-108`；`ExecLogs.vue:49-51`；`AuditLogs.vue:49-66`）。

4. **筛选 chips（pills）**：卡头左侧，单选切换，再点可取消。判例：KPI 已有孪生数字的筛选 pill **不再显计数**（同组数字不同屏念两遍）；计数只留给「无 KPI 孪生的筛选命中数」（`LearnerCenter.vue:584-590`；`TeachingSessions.vue:76-120`）。

5. **表格排序**：点可排序表头切换升降序，状态按页面 `storage-key` 写入 localStorage（`useTableSort`，如 `Users.vue:674-690`）。

6. **列显隐（`MkCols`）**：卡头右侧「列」菜单，隐藏项按页面 `storage-key` 持久化；关键列/操作列固定不可隐藏（如 `Users.vue:60-63, 410-433`、`LearnerCenter.vue:395-405`）。

7. **抽屉与二级页**：实体详情一律走**二级页**（行点击或详情钮 → `?view=&id=`，可刷新/分享/前进后退），不再用抽屉；弹层只留给子实体（任务详情、干预提醒等）（`store.ts:289-331`；`PathDetail.vue:48-50`）。

8. **深链参数惯例**：
   - 二级页：`?view=<learner|user|virtual|session|session-real|path|skill>&id=<实体ID>`，可带 `includeTest=true`（查看虚拟/测试账号明细，`AdminConsole.vue:283-298`）。
   - 旧 `?skill=<id>` 会被自动翻译成 `?view=skill&id=<id>`（`AdminConsole.vue:405-420`）。
   - 跨页排查意图（`store.ts:230-241`）跳执行日志时写入：`?agent=<SkillID>&status=<err|warn|ok>&cat=<错误类别>&range=<时间窗>`。
   - 页面内页签/子视图深链：`?tab=`（如 `skills`、`health-center`、`ops-hub`、`audit-logs`、`execution-logs`、`api-config`、`prompt-eval`）；Prompt 评估内层用 `?peTab=`。

9. **数据范围（已退役）**：教学组六页（用户账号 / 学习状态 / 教学会话 / 目标对话 / 学习路径 / 复习积压）曾共享「仅真实 / 含测试」页头开关 `DataScopeToggle`（写 `localStorage: wf_include_virtual`），**2026-10-21 用户拍板「没有测试，测试只是备注」后退役**：组件已删除，`wf_include_virtual` 不再读写；口径只剩一条——虚拟学习者归自己的域（虚拟学习者页），其余账号一律照常计入，测试/审计账号行内加「测试」备注（`live.ts:2384-2386`；`Users.vue:406-409`）。`?includeTest=` 仅作为二级页深链参数保留（查看特定虚拟/测试账号明细用），不再是页级共享开关。成本分析页只有自己的时间窗口径（`tokenCostFilters = { days: 7 }`，`store.ts:352`），不含同类开关。

---

## 2. 页面逐页手册（运营高频页详写）

### 2.1 平台总览（`/admin/overview`，`Overview.vue`）

**这页回答**：今天平台整体好不好、教学闭环哪一环断了、现在最该点哪里。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 今日调用 | `agents.todayCalls`，**真实用户口径**（虚拟/测试另计）。foot 显示超时数与「较昨日同时刻」趋势；hint 在全量 > 真实时标注「全量（含虚拟/测试）N 次」（`live.ts:1147-1178`） |
| 今日成功率 | 成功 / 今日调用；今日 0 调用显示「—」而非 100（卡标签单源 `TERMS.healthScore`＝「今日成功率」，`terms.ts:46`；`live.ts:1179-1185`） |
| 用户活跃 | `users.activeToday`（今日有学习会话的用户）；foot 今日新增；hint 带总用户（`live.ts:1186-1193`） |
| 目标对话 | `conv.active + conv.completed + conv.cancelled` 总量；foot 显示累计完成（`live.ts:1194-1210`） |
| 趋势 ▲▼ | 与**昨日同时刻等长窗口**比，基线 0 不给百分比、fall 落「昨日同时刻无对照」（`live.ts:1145-1158`） |
| 顶部结论 | 今日调用 = 0 → 「系统空闲 / 今日暂无调用 / 真实用户暂无调用」；成功率 < 80% 且失败 ≥ 3 → 红「需要关注」；成功率 < 90%（调用 ≥20）或失败 ≥ 3 → 琥珀；否则「运行平稳」（`live.ts:967-1021`） |
| 教学闭环五环 | ① 目标对话 = `loop.conversationsActive`；② 路径规划 = `loop.pathsActive`（有失败时转 alert 并显示 `失败 N` = `loop.pathsFailed`）；③ 教学回合 = 教学会话 total（进页拉一次）；④ 课后评估 = `wrapup.evaluationModel + evaluationAiFallback`；⑤ 记忆复习 = memory-review `totals.due`（`Overview.vue:418-482`） |
| 状态条「健康」 | 健康中心清单的 error/warn 计数（60s 缓存）：0 异常绿、有 warn 琥珀、有 error 红、拉取失败弱琥珀（`Overview.vue:672-684`） |
| 状态条「仿真」 | 虚拟通道：系统失败率 ≥50% 红、≥20% 或存在失败黄、无会话灰；「未加载 / 加载失败」≠「空闲」（`Overview.vue:730-750`） |
| 最近事件 | 近 24h；默认隐藏虚拟/测试账号；相邻同类失败折叠为「执行失败 ×N（同因）」（`Overview.vue:1023-1090`） |

**常见操作**
1. 看今日是否异常：先读页头结论条，红/琥珀时点右侧「查看健康中心」或状态条上的「健康 / 仿真」入口（`Overview.vue:77-118`）。
2. 定位断点：点教学闭环某一环卡片，跳到对应页面；路径环有失败时点红色「失败 N」→ 学习路径并预筛失败（`Overview.vue:144-166, 484-524`）。
3. 追失败：点「最近事件」里红色/琥珀行，或点「待处理事项」的「去排查」，跳到执行日志并带该 Skill / 错误类别 / 近 7 天窗口筛选（`Overview.vue:1058-1064, 1108-1145`）。
4. 看谁在用：点「今日调用 / 成功率」→ 执行日志；点「用户活跃」→ 用户账号；点「目标对话」→ 目标对话（`Overview.vue:923-940`）。

**空态 / 错误态**
- KPI 带随数据为空时整页走 `MkLoading` → `MkEmptyState`「真实数据暂不可用」+「重试」（`Overview.vue:346-357`）。
- 页头注记：正常态不显示刷新注记（10s 轮询）；拉取失败展示旧数据时「展示上次成功数据」（琥珀）；连续失败 5 次熔断后变为可点「自动刷新已停止 · 恢复刷新」（`Overview.vue:8-22, 1148-1190`）。
- 事件流全为测试/模拟账号时提示「动态均来自测试 / 模拟账号」（`Overview.vue:331-338`）。

**异常信号 → 下一步**
- 结论红 / 成功率骤降 → 健康中心看整体，执行日志按 `status=err` + 时间窗查。
- 路径环出现「失败 N」→ 学习路径预筛失败，逐条进详情。
- 记忆复习环「N 待办」持续增长 → 复习积压页按到期量排查。
- 仿真红 → 虚拟学习者页看失败率/卡死。

**联动**：KPI → 执行日志/用户账号/目标对话；闭环环 → 对应页；待办 → 执行日志（带 intent 筛选）；事件行 → 执行日志（带错误类别）。反向：执行日志支持 URL 参数还原筛选（见 §4）。

---

### 2.2 用户账号（`/admin/people`，`People.vue` + `Users.vue`）

**这页回答**：有哪些账号、谁在活跃、谁被删了、某个学习者注册多久/几条路径、怎么建号/停号/恢复。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 账号口径 | 无分桶、无口径开关：列表 = 全部非虚拟账号（后端已排除虚拟学习者）；测试/审计账号照常列出、行内以「测试」备注标识，虚拟学习者归自己的域（`Users.vue:406-409`） |
| 列表加载上限 | `limit: 1000`；后端总数 > 已加载时在状态条 title 注明截断（`live.ts:1299-1305`） |
| 状态条（独立非嵌入时） | 共 N 人（截断时「共 TOTAL 人 · 当前显示 M」）· 近 7 天活跃 N；title 另含管理员数与注册开关（`Users.vue:3-20`） |
| pills 计数 | 全部 / 管理员 / 普通用户 / 近 7 天活跃 / 近 7 日新增 / 从未登录 / 已删除；「近 7 天活跃」= `lastLoginAt` 在 7 天内（`Users.vue:465-472, 374`） |
| 「已删除」列表 | 独立数据源 `GET /admin/users?status=deleted`（`Users.vue:331-370`；`adminApi.ts:2273-2276`） |
| 默认隐藏列 | 选择框（列菜单可恢复）（`Users.vue:60-63, 410-433`） |
| 等级 / XP | 等级由 XP 按公式 `floor(sqrt(xp/100))+1` 推导，展示「L2 · 进阶 · N 条路径」，悬停看 XP 与升级差（`learner-profile.ts:76-83, 101-102`；展示见 `Users.vue:139`） |

**常见操作**
1. 找号：搜索框支持昵称 / 邮箱 / ID（`Users.vue:45, 700-725`）；或点 pills 快筛管理员 / 普通用户 / 近 7 天活跃 / 近 7 日新增 / 从未登录 / 已删除。
2. 新建用户：页头「新建用户」→ 填昵称、邮箱、初始密码、角色（`Users.vue:18, 514-521`）。
3. 改角色：行「编辑」→ 编辑弹窗改角色 / 重置密码（⋯ 菜单对自己不出现，即不可删除自己；最后一名管理员不可降级，`Users.vue:173-180, 519-522`；`UserFormDialog.vue:50-56, 150-158`）。
4. 停用 / 恢复：⋯ → 「删除」（软删，历史数据保留，可恢复）；已删除列表内 ⋯ → 「恢复」（`Users.vue:173-180, 497-500, 629-676`）。
5. 批量：勾选（虚拟/测试账号不可勾）→ 底部批量条「导出 CSV」或「批量删除」（`Users.vue:209-222, 544-620`）。
6. 进详情：点行 → 学习者详情二级页 `?view=user&id=`（`Users.vue:125`）。

**空态 / 错误态**
- 加载失败显示「数据加载失败」+ 重试（`Users.vue:69-78`）。
- 已删除列表拉取失败**不静默**，toast 提示「已删除用户加载失败」——避免看起来像「没有已删用户」（`Users.vue:364-368`）。
- 筛选无结果显示「当前筛选无用户」+ 清除筛选（`Users.vue:189-196`）。

**异常信号 → 下一步**
- 真实用户构成异常（管理员数异常增长）→ 审计日志按用户更新 / 角色变更动作查。
- 「近 7 天活跃」为 0 但今日调用不为 0 → 可能登录行为集中在更早时段，去执行日志/审计日志核对。
- 新账号注册后无路径/无会话 → 学习状态页搜该用户，或目标对话页确认是否发起澄清。

**联动**：点用户 → 学习者详情二级页（`?view=user&id=`）；`intent.quickAction='create-user'` 可直达并打开新建弹窗（`Users.vue:502-517`）。

---

### 2.3 学习状态（`/admin/learner-state`，`LearnerCenter.vue`）

**这页回答**：全体学习者的状态分布如何、谁需要关注、谁置信度低（证据不足）、要不要重算快照。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 用户账号 | 后端总数；窗口上限 2000，超过时状态条提示「共 N 位用户，当前显示前 M 位」。显示「N」或「N · 已加载 M」（`LearnerCenter.vue:8-12, 495-502`；`live.ts:1388-1405`） |
| 需关注 | `趋势=下降 ∨ 疲劳=高 ∨ 有风险摘要`（`isRisk`）。**疲劳=中且非需关注**归「观察」KPI，不计入需关注（`LearnerCenter.vue:562-564, 569-570`） |
| 低置信 | 在「有任务的快照」（`task 非空 且 confidence 非空`）中，置信度 < 50%（`evidenceLowConfidence`，阈值 0.5）。hint 带分母 `n=`（`LearnerCenter.vue:578-581`；`evidence.ts:11`） |
| 平均置信度 | 同上「有任务的快照」集合的置信度均值；hint 注明其余无任务/无快照不入均值（`LearnerCenter.vue:602-606`） |
| 数据覆盖率 | 有任务快照 / 总快照；无任务/无快照不计入分子（`LearnerCenter.vue:68-71, 609-611`）。置信度分布贴表条已于 2026-10-17 退役 |
| 风险摘要列 | `「X」等 N 个概念掌握薄弱`（优先）→ 疲劳高风险 → `「X」等 N 个概念待巩固`（`LearnerCenter.vue:528-537`） |

**常见操作**
1. 看大盘：先读 KPI 带（用户账号 / 需关注 / 观察 / 低置信 / 平均置信度 / 数据覆盖率）。
2. 定位群体：点「需关注 / 观察 / 低置信」KPI 卡（再点取消），或卡头状态下拉；可与搜索叠加，点「清除筛选」一并清（`LearnerCenter.vue:31-59, 556-590, 662-667`）。
3. 干预：行内「发提醒」→ 弹窗可「查看学习详情」、填标题与内容后「发送提醒」（站内通知，`kind=learning`，定向该用户）（`LearnerCenter.vue:308-345, 445-480`）。
4. 重算：行内 ⋯「重算」单条重算；卡头 ⋯「全部重算」逐条重算（进度 N/M），结束统一刷新（`LearnerCenter.vue:108-126, 719-790`）。
5. 进详情：点行 → 学习者详情二级页（`LearnerCenter.vue:426-429`）。

**空态 / 错误态**
- 快照加载失败 → `MkEmptyState` + 重试（`LearnerCenter.vue:142-152`）。
- 无匹配 → 「没有匹配的用户」+ 清除筛选；无快照 → 「暂无用户快照」（`LearnerCenter.vue:288-295`）。
- 置信列对无任务行显示「—」并不计入 KPI/均值（口径一致性，`LearnerCenter.vue:243-250, 578`）。

**异常信号 → 下一步**
- 「低置信」占比持续偏高（证据不足）→ 该群体完课证据少：去教学会话看是否大量中断/超时，或复习积压页看是否无痕迹。
- 「需关注」集中于某路径/概念 → 进学习者详情看证据时间线与薄弱概念。
- 「全部重算」出现失败 → toast 报「N 成功 · N 失败」，失败多为该用户无快照或接口异常，可单个重试。

**联动**：`intent.statusFilter` 等跨页筛选；干预弹窗「查看学习详情」→ 学习者详情证据页签（`LearnerCenter.vue:431-437, 464-467`）。

---

### 2.4 教学会话（`/admin/teaching-sessions`，`TeachingSessions.vue`）

**这页回答**：谁在上课、会话状态如何、哪些会话异常（失败/超时/收尾失败）、哪些终态会话缺课后总结、哪些带教学建议。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 需关注 | 加载窗口内 `attention !== 'low'` 的会话数。attention：失败/超时，或「已完成但缺总结」→ 高；有高优建议 → 高；有建议 → 中；否则低（`TeachingSessions.vue:562-568, 852`） |
| 缺总结 | **仅终态会话**缺总结。终态集合 = `completed / failed / timeout / discarded / finalization_failed`；非终态（initializing/active/paused/finalizing）缺失是正常过程态（`TeachingSessions.vue:400-406, 730-744`） |
| 有建议 | 加载窗口内含可读建议（`hasAdvisory`，`shouldSuggest !== false` 且 priority 非 none/空）的会话数（`TeachingSessions.vue:591, 849`） |
| KPI 卡 | 需关注 / 异常（失败·收尾失败·超时）/ 缺总结 / 有建议 / 完结率；完结率 = completed / 窗口行数（**窗口口径，非后端全量**）（`TeachingSessions.vue:12-50, 718-724`）。贴表状态分布带已于 2026-10-17 退役 |
| 状态下拉「进行中」 | 单状态 `status=active`；「异常」是失败 / 收尾失败 / 超时的组合档，两者同属状态维度（`TeachingSessions.vue:672-704, 738-760`） |
| 异常堆积 | 失败 + 收尾失败 + 超时合计 ≥ **10** 时「异常」KPI 转红（阈值写进 title）（`TeachingSessions.vue:921-927`） |
| 互动列 | 时长（后端单位为**分钟**）/ 消息数 / 知识点，默认隐藏；`interactTitle` 合并悬停说明（`TeachingSessions.vue:255-275, 983-1005`） |
| 窗口 | `limit: 1000`；后端返回 total 且超过窗口时提示「共 N 条 · 当前显示最近 1000 条」（`TeachingSessions.vue:399-415, 430-440`） |

**常见操作**
1. 盯异常：点 KPI「异常」卡（落到状态下拉「异常」档，可与其它筛选叠加）；行状态徽章红 = 失败/超时/已废弃等（`TeachingSessions.vue:26-33, 213-226, 969-977`）。
2. 找缺总结：点「缺总结」KPI 卡或「总结」下拉的「缺总结」档，只数终态缺失（`TeachingSessions.vue:36-43, 688-692, 745-746`）。
3. 找有建议：点「有建议」KPI 卡 → 服务端过滤 `onlyWithAdvisory`（`TeachingSessions.vue:44-50, 413-416, 430-431`）。
4. 精筛：状态（10 档枚举）、总结、课型、开始时间（近 7 天 / 近 30 天）；搜索主题 / 用户 / 邮箱（`TeachingSessions.vue:76-121, 672-704`）。
5. 下钻：行点击 → 会话座舱（真实会话只读监控 `session-real`；缺总结行直接落总结页签）（`TeachingSessions.vue:207-210, 969-977`）。

**空态 / 错误态**
- 加载失败显示错误条 + 重试；轮询失败保留旧数据不闪空态（`TeachingSessions.vue:137-140, 417-440`）。
- 深链 `?session=<id>` 未命中时提示「可能不在最近 1000 条内或已删除」（`TeachingSessions.vue:70-71, 936-956`）。
- `?session=` 命中后清参避免与座舱返回冲突（`TeachingSessions.vue:936-958`）。

**异常信号 → 下一步**
- 异常终态堆积（≥10 转红）→ 执行日志按该会话 `sessionId` 查全部调用（含失败）。
- 大量终态缺总结 → 课后总结链路问题，去执行日志按节点 `session-wrapup` + 失败态查该会话链路（`health-center.service.ts:465-700` 的 14 项 buildItem 清单里**没有**课后总结/`session-wrapup` 检查项，健康中心查不到此项）。
- 高关注会话 → 座舱看链路，或学习者详情看证据。

**联动**：自动 20s 轮询；`intent` 深链跳执行日志按 sessionId 归组；`useSessionDrill` 三跳转（学习者/链路/座舱，`useSessionDrill.ts:23-39`）。

---

### 2.5 目标对话（`/admin/goal-conversations`，`GoalConversations.vue`）

**这页回答**：谁在发起目标澄清、澄清到哪一步、路径是否生成、哪些对话停滞/被取消、要不要重建路径或删除会话。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| KPI 卡 | 目标对话数 = `stats.total`；完结率 = completed / total；停滞 = 窗口内 `active` 且 `updatedAt` 超 7 天；未生成路径 = 窗口内无 pathId（`GoalConversations.vue:12-56, 368-377, 403-408, 421`）。状态分布贴表条已于 2026-10-17 退役 |
| 点「已取消」筛选 | `CANCELLED_STATUSES = {cancelled, canceled, abandoned}`；「失败」单独一档（`GoalConversations.vue:519-520, 645-655`） |
| 停滞信号 | 加载窗口内 `status=active` 且 `updatedAt` 超过 **7 天**未更新；KPI「停滞目标对话」可点即筛（`GoalConversations.vue:28-38, 368-377`） |
| 澄清进度 | 「N 轮」= 该会话 messages 中**学习者发言条数**（后端库内计数），无目标轮次分母，不造 meter（`GoalConversations.vue:148-153, 219-222`） |
| 阶段 | 状态列只回答完成没有（进行中/已完成/已取消/失败/已放弃）；细阶段收进悬停；`stageIndex` 0 起（创建/澄清/方案/完成）（`statusText.ts:141-171`；`GoalConversations.vue:206-217`） |
| 窗口 | `limit: 1000`；`pagination.total` 大于窗口时提示截断（`GoalConversations.vue:469-470, 711, 735-742`） |

**常见操作**
1. 找停滞：点 KPI「停滞目标对话」卡（再点取消），按「最近活动」倒序看更新时间。
2. 找取消/失败：状态下拉选「已取消」或「失败」。
3. 看路径：行 ⋯「查看路径」→ 会话座舱路径页签 `?view=session-real&id=...&stage=path`（`GoalConversations.vue:246, 513-515, 807`）。
4. 重建路径：行 ⋯ → 「重建路径」（`regeneratePath`，确认后覆盖当前路径；成功 toast 带路径名与版本）（`GoalConversations.vue:244-251, 822-845`）。
5. 删除会话：行 ⋯ → 「删除目标对话」（不可撤销，红色确认）（`GoalConversations.vue:253, 848-860`）。
6. 下钻：行「链路」/行点击 → 执行日志 Trace / 会话座舱（`GoalConversations.vue:797-812`）。

**空态 / 错误态**
- stats 拉取失败：顶部状态条「统计暂不可用」+ 重试，KPI 卡显「—」，列表不受影响（`GoalConversations.vue:51-55, 756-780`）。
- 列表加载失败：行内错误 + 重试（不再伪装「暂无会话」）（`GoalConversations.vue:114-124, 740`）。
- `?goal=<id>` 未命中：toast「可能不在最近 1000 条内或已删除」（`GoalConversations.vue:490-505`）。

**异常信号 → 下一步**
- 「已取消」占比高 → 多半是无心跳回收（约 30 分钟无心跳自动 abandoned），可从故事行重新启动（`GoalConversations.vue:519-520`）。
- active 停滞多 → 学习者中断；去学习状态看该用户趋势/疲劳，或教学会话看后续是否继续。
- 路径未生成/失败 → 学习路径页筛选「生成失败」，进详情。

**联动**：重建路径写操作影响用户端可见路径；删除会话不可撤销。

---

### 2.6 学习路径（`/admin/learning-paths`，`OpsContent.vue` + `PathDetail.vue`；路径内容体在 `PathJourneyPanel.vue`）

**这页回答**：生成了多少路径、里程碑/任务规模、各状态占比、哪些生成失败、要不要下线/恢复/删除。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 路径总数 / 里程碑 / 任务 | 服务端 `stats`：`total` / `totalMilestones` / `totalTasks`；本页含测试账号（页头口径标注，与总览「仅真实用户」口径不同源）（`OpsContent.vue:20-45, 320-345`） |
| KPI 状态计数 | **服务端按状态 group-by 全平台计数**，非本页窗口：学习中(active) / 已完成(completed) / 生成失败(failed) / 已下线(archived) + 其它（枚举外聚合）（`OpsContent.vue:20-45, 343-375`）。列表有 45s 页面级 TTL，统计每次进页重取（`live.ts:2355`）。贴表状态分布带已退役 |
| 进度 | `completedTasks / totalTasks`（有子任务时）否则 `completedMilestones / totalMilestones`，四舍五入百分；100% 绿、失败红、其余中性蓝（`OpsContent.vue:472-487`） |
| 难度 | 后端归一为 beginner/intermediate/advanced/unknown；存量约 35% 混入旧短词/自述整句，前端只认三档 + 少量别名，其余一律「未知」并把原文进悬停（`OpsContent.vue:489-505`） |
| 窗口 | 列表 `limit: 1000`，`pagination.total` 大时提示截断（`OpsContent.vue:534-545`） |

**常见操作**
1. 看失败：点 KPI「生成失败」卡，或从总览闭环「失败 N」跳入（自动预筛 failed，`OpsContent.vue:709-722`）。
2. 治理：行 ⋯ → 「下线 / 恢复」/「详情」；「删除路径」级联删除里程碑与子任务，不可撤销（`OpsContent.vue:230-245, 651-720`）。
3. 进详情：点行 → 路径详情二级页 `?view=path&id=`（`OpsContent.vue:691-694`）。
4. 详情页动作：治理动作收在右缘 ⋯ 菜单（下线/恢复、重试生成）；阶段全展开、任务行纯展示（`PathJourneyPanel.vue:24-63, 65-118`）。

**关键口径（路径详情）**
- 总体进度（已完成阶段 / 总阶段）已随 2026-10-12 拍板撤除；各阶段头显示「已完成任务 / 总任务」（`PathJourneyPanel.vue:6-8, 80-84`）。
- 阶段高亮：里程碑状态为 `active` 的阶段号蓝底；不设「当前阶段」单选（`PathJourneyPanel.vue:266-272`）。
- 任务行只渲染接口真实返回字段（任务类型/预计用时等，`taskSub`）；原型有而接口没有的（验收点等）不硬造；任务详情弹层已于 2026-10-22 退役（`PathJourneyPanel.vue:95-110, 128`）。

**空态 / 错误态**
- 列表失败：错误条 + 重试（`OpsContent.vue:81-88`）。
- 详情失败：`MkEmptyState tone=error` + 重试；刷新失败保留旧数据只 toast（`PathJourneyPanel.vue:9-15, 225-227`）。
- 详情无阶段：提示「该路径尚未拆解出阶段」（`PathJourneyPanel.vue:70-73`）。

**异常信号 → 下一步**
- 「生成失败」非零 → 进对应详情；失败通常需回目标对话页「重建路径」（后端无 admin 侧 replan 接口，详情页也不提供重规划，`PathDetail.vue:48-50`）。
- 「已下线」异常增长 → 审计日志看「下线路径」动作是谁在什么时候做的。
- 里程碑/任务数异常大 → 可能重复生成，核对目标对话与版本。

**联动**：目标对话「查看路径」→ 本页详情；学习者详情「学习路径」页签；总览闭环失败深链。

---

### 2.7 复习积压（`/admin/memory-review`，`MemoryReviewOverview.vue`）

**这页回答**：记忆层有多少痕迹、到期积压多少、谁的待复习最多、哪些概念同族重复待人工确认。单用户明细（含归并/回滚）不在本页，点行进学习者详情「记忆与复习 / 记忆调度」页签。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 有记忆痕迹的用户 | 全量「有记忆痕迹用户」数（后端统计，唯一在 KPI 出现）（`MemoryReviewOverview.vue:460`） |
| 记忆痕迹 | 全部记忆痕迹总数（`MemoryReviewOverview.vue:461`） |
| 当前到期 | `totals.due`（到该复习而未复习条数）；title「到该复习而未复习 N 条，占全部记录 X%」。示警阈值：占痕迹 ≥ **20%** 或人均 ≥ **5** 条才转琥珀，阈值内是间隔复习常态积压（`MemoryReviewOverview.vue:412-425, 463`） |
| 需人工确认 | 待审队列 `fragmentation.pendingReview`（同义概念待确认 + 模糊候选 + 散键清理建议；后端旧字段时退回 `totals.ambiguous`）；该用户没跑过归并观察时显「—」而非 0（`MemoryReviewOverview.vue:451-468`） |
| 列表 | 有痕迹用户，服务端分页（默认每页 50），列头可排序（默认按待复习量倒序）；「状态」快筛（全部 / 有待复习 / 未复习 / 需关注）只作用于当前页（`MemoryReviewOverview.vue:331-407, 520-535`） |
| 行内列 | 用户（副行邮箱，测试账号加「测试」徽标）/ 记忆痕迹 / 待复习（仅数字，颜色表达压力）/ 需关注（薄弱 N + 待确认 N）/ 归并候选 / 散键 / 记忆强度（% 条）/ 最近复习（`MemoryReviewOverview.vue:100-215`） |

**常见操作**
1. 看积压：读「当前到期」KPI；列表默认按待复习量倒序，从上往下处理；或点「有待复习」快筛只看有待复习者。
2. 进明细：点整行 → 学习者详情二级页的「记忆与复习」页签（`MemoryReviewOverview.vue:594-598`）；旧深链 `?userId=` 由本页转发到「记忆调度」页签（`MemoryReviewOverview.vue:604-620`）。
3. 待确认 / 归并候选 / 散键：点行内对应数字 → 学习者详情「记忆调度」页签（确认 / 驳回 / 执行归并 / 回滚都在那里）（`MemoryReviewOverview.vue:167, 179, 188, 601-603`）。
4. 重新观察：行内「重新观察」= 对该用户跑一次记忆复盘（只记录建议，不动 `memory_traces`）（`MemoryReviewOverview.vue:213, 562-590`；`adminApi.ts:455-456`）。

**空态 / 错误态**
- 取数失败且已有旧行 → 保留旧行 + 带重试的 `.mk-alert`；无行 → `MkEmptyState tone=error` + 重试（`MemoryReviewOverview.vue:63-95`）。
- 无痕迹 → 「暂无记忆痕迹数据」+「查看教学会话」；该学习者无痕迹时，学习者详情「记忆与复习」页签有「完成教学回合后自动生成」（`MemoryReviewOverview.vue:83-89`；`LearnerDetail.vue:943`）。
- 快筛筛空 → 「没有符合条件的用户」+「显示全部」（`MemoryReviewOverview.vue:221-227`）。

**异常信号 → 下一步**
- 「当前到期」持续超阈值 → 复习调度积压：进学习者详情「记忆与复习」页签看课内温故计划的负担预算/检索成功率（<70% 应收缩预算）。
- 「需人工确认」多 → 概念归并需人工核对；进「记忆调度」页签逐条看 A/B 与理由。
- 「需回路径重学」> 0 → 连续没接上，去教学会话/学习路径看该概念所在课程。

**联动**：与学习状态「低置信」互补（记忆层 vs 快照层）；学习者详情「记忆与复习 / 记忆调度」页签复用同源接口。

---

### 2.8 健康中心（`/admin/health-center`，`HealthCenter.vue`）

**这页回答**：服务是否可用、配置与线上是否不一致、Skill 注册/生效是否对账、完成度分布如何、要不要一键修复。

**关键指标与口径**（概要四卡均为「需处理数」语义，0 = 好）

| 指标 | 口径（代码） |
|---|---|
| 检查异常 | 健康检查 `error` + `warn` 项数；`info` 是只读观测不计入（`HealthCenter.vue:48-55`） |
| 契约与哈希不一致 | 卡标签「契约与哈希不一致」。值 = `drift.contract + drift.hash` 为需处理；`runtime` 只读遥测参考，不计入需处理（`HealthCenter.vue:56-64, 232-240`） |
| 一致性核查异常 | 卡标签「一致性核查异常」。值 = `missingRegistration + missingActive + zombieRegistration`（对账页签内可定位的三类）；`zombieActive`/`unwired` 不计入（页签内无可定位行，仅 title 披露），`zombieSkillActive` 与健康检查「生效版本检查」同源、剔除避免重复计数（`HealthCenter.vue:64-72, 241-243`） |
| 完成度未达标 | 卡标签「完成度未达标」。值 = `global.abnormalSkills`（未达 live 档的技能数）；title「已上线 X/Y（含插件）」（`HealthCenter.vue:73-81, 246-250`） |
| 检查明细分域 | 14 项检查按「基准真源」归域成组（core.yaml / manifest / orchestration / skills.yaml / 双向对账 / db:managed / runtime），异常域默认展开、正常域折叠（`HealthCenter.vue:445-470`） |
| 刷新 | 60s 自动检测（`useSafePolling`）；`?refresh=1` 强制重算；`?check=<id>` 深链展开并滚动定位某检查行（`HealthCenter.vue:539, 782-800`）。 |

**两个页签**（`?tab=`）：健康检查（检查明细 + 分域组）/ 技能核查（对账 + 完成度构成带）；旧键 `drift`→`health`、`completion`→`recon` 走别名，深链不 404（`HealthCenter.vue:326-345, 387`）。

**常见操作**
1. 响应告警：概要卡转琥珀/红 → 点该卡切到对应页签（检查类落「健康检查」并定位行，核查类落「技能核查」并预筛）；健康检查页签内异常域默认展开，点检查行展开明细（`HealthCenter.vue:287-324, 140-180`）。
2. 一键修复：仅 `action='fixable'` 项显示「修复」，共 **4 个 id**：`w4-corehash` / `field-routing` / `field-routing-contract` / `snapshots`（`backend/src/services/health-center.service.ts:751-756`；`backend/src/routes/admin/health-center.ts:68`）；点前二次确认，执行前自动备份、结果写审计日志；成功进入「最近修复」卡（本次会话内存，刷新即清，权威在审计日志与后端备份目录）（`HealthCenter.vue:727-800`）。
3. 手动项：「查看 →」（仅跨页项 `EXTERNAL_JUMP_IDS`）按检查项语义跳转：字段路由/契约/字段同步类 → 字段流转页「字段路由」页签；编排步骤解析 → 字段流转页「字段旅程」页签；yaml 交叉校验/参数一致性 → Skill 详情设计页（`skdTab=protocol`）；其余留在本页展开定位（`HealthCenter.vue:694-725`）。
4. 不一致处理：文件↔DB 契约不一致 → 字段流转页「去同步」；编译产物哈希不一致 → Skill 详情「协议」页签「去发布」；运行时不一致只读，配置同步后不再新增（`HealthCenter.vue:678-686`）。

**空态 / 错误态**
- 报告加载失败 → `MkEmptyState tone=error` + 重试（`HealthCenter.vue:10-20`）。
- 修复失败 → toast 带后端 `fixHint`（`HealthCenter.vue:774-777`）。

**异常信号 → 下一步**
- 任一 KPI > 0：点卡进对应页签；error 项优先。
- 对账缺项/僵尸 → Skill 目录页看该 Skill 状态，或健康检查页签展开对应行。
- 完成度未达 live → 技能核查页签看对账/完成度构成，定位卡在 draft/handler-ready 的技能。

**联动**：总览状态条「健康」来自本页同一清单；「查看 →」跳字段流转 / Skill 详情 / 执行日志，字段流转页可深链回本页定位。

---

### 2.9 其余页面速查表（路由 / 职责 / 关键口径）

| 页面 | 路由 | 职责 | 关键口径（代码） |
|---|---|---|---|
| 虚拟学习者 | `/admin/virtual-learners` | 合成画像运行/批量新建/回收 | KPI：完成率、系统失败率、今日调用、无响应候选；并发/速率已并入「容量与实验环境」（`VirtualLearners.vue:58-110`）。「活动会话」= 进行中 + 创建中（含卡死），全库口径。「回收无响应（N）」先干跑确认清单再把卡死会话批量标失败（写操作）（`VirtualLearners.vue:24-40, 97-110`） |
| 学习者卡库 | `/admin/virtual-learner-cards` | 角色卡导入/导出（纯档案+故事池，不建账号，不经编译链） | 卡库导出接口计数「当前自建卡 N 张」（`VirtualLearnerCards.vue:40-55`）；YAML/JSON 卡片表单在导入二级页（`CardImportPage.vue:5-58`） |
| 字段流转 | `/admin/orchestrator` | 顶层 Agent 数据流转/字段血缘/治理 | 页签：总览 + 五个阶段；阶段内二级页签 字段旅程 / 字段路由 / 治理（`?tab=` 兼容）。KPI 已撤（阶段/Skill 进总览卡头 meta，治理信号在健康中心）（`Orchestrator.vue:12-32`） |
| Skill 目录 | `/admin/skills` | Skill 目录 | 单视图，无页签（2026-10-25 Prompt 评估拆为独立页）。旧 `?tab=model-routing` 打开页头「批量模型配置」弹窗并收敛为 `?tab=run`；旧 `?tab=prompt-eval` 改投 `/admin/prompt-eval`。KPI：Skill、已上线、成功率、平均耗时、需关注 Skill（`Skills.vue:20-55`） |
| Prompt 评估 | `/admin/prompt-eval` | 提示词质量评测：用例集 + 历史运行 | 页签：`cases` / `runs`（`?peTab=`；旧 `?tab=cases|runs` 就地改写为 `?peTab=`）。页头「批量跑评估」经面板 `defineExpose` 驱动。KPI：最近评测通过率、评估用例、启用用例、评估历史（`PromptEval.vue`） |
| 执行日志 | `/admin/execution-logs` | 日志 + Trace 链路排障 | 页签：日志 / Trace 链路。筛选：状态下拉(err/warn/ok)、来源(测试)、时间窗(15m/1h/today/yesterday/week/month/all/自定义)、节点(Skill)、关键词、Trace ID、sessionId、错误类别。URL 参数：`agent/status/cat/range/q/trace/session/test/from/to`（`ExecLogs.vue:66-127, 880-936`） |
| 成本分析 | `/admin/token-cost` | Token 与成本透视 | 时间窗 7/30/90 天；KPI：调用成本、已定价调用、总 Token、失败。按 Skill / 按用户（支持搜索，单次上限 100，可「查看全部」）/ 按模型排行；CSV 导出（`TokenCost.vue:82-112, 155-260, 361-405, 485-530`） |
| 审计日志 | `/admin/audit-logs` | 管理操作 + 管理员登录审计 | 页签：操作审计 / 登录审计（`?tab=login`）。时间窗 today/yesterday/week/month/all；「失败 TOP」chip 下钻。登录审计行可跳「会话安全」（`AuditLogs.vue:49-66, 105-115, 325-326, 948-951`） |
| 模型与接入 | `/admin/api-config` | 供应商/连接/基础设施模型 + 调用策略 | 单页（2026-10-26 一级页签撤除）：供应商面板（平台详情二级页签 = 模型 / 连接 / 基础设施 / 生成参数）+ 调用策略；旧 `?tab=security` 改投 `/admin/access-control`、`?tab=addons` 改投 `/admin/addons`（`ApiConfig.vue:1-100, 225-260`）。页首 KPI 带已撤（2026-10-14）。**基础设施模型**：平台供应商详情二级页签「基础设施」与页内 InfraModelsPanel（`ApiConfig.vue:85`），管 Embedding / Reranker 端点·密钥·模型（默认 `BAAI/bge-m3` / `BAAI/bge-reranker-v2-m3`），管理端配置优先于 `EMBEDDING_*`/`RERANK_*` 环境变量；任一未配置则资料语义层 fail-open 回退关键词（不报错、功能降级） |
| 插件 | `/admin/addons` | 插件（能力 Skill 与 MCP 服务）登记/测试 | 可选能力卡（联网 / 决策 / 生图）+ MCP 工具调用服务列表；启停/测试（写操作）；页头随顶栏刷新广播（`Addons.vue:1-35`） |
| 运营中心 | `/admin/ops-hub` | 运营待办/反馈/成就/公告/站内通知 + 运维工具/数据导出/会话安全/访问与注册 | 页签：运营待办 / 反馈 / 成就 / 公告 / 站内通知 / 运维工具 / 数据导出 / 会话安全 / 访问与注册（`?tab=`；原独立场景 ops-center 三页签并入 tools/export/security，访问与注册并入 access）；子视图不再向宿主上报计数，无「未访问」占位（`OpsHub.vue:219-226`） |
| 学习者详情（二级页） | `?view=learner` 或 `?view=user` | 单学习者概览/画像/证据/图谱/会话/记忆与复习/记忆调度/账号 | 会话窗口「该学习者最近 20 条教学会话」；记忆页签空态「完成教学回合后自动生成」（`LearnerDetail.vue:757-758, 873-878, 943`） |
| 会话座舱（二级页） | `?view=session` / `session-real` | 虚拟会话控制台 / 真实会话只读监控 | 虚拟侧动作：自动驾驶启停、推进一步、自动推进目标、生成路径、启动教学、重开本课、生成终局总结、评审/接受/按意见重规划、终止实验、按原输入重跑（`SessionCockpit.vue:165-216`）。真实会话为只读监控（`TeachingSessions.vue:969-977`） |
| 虚拟学习者画像（二级页） | `?view=virtual` | 单虚拟人故事池/运行记录/会话控制 | 故事池可按样本类型生成/批量运行/批量启停/批量删除（写操作）；运行记录含正确率、教学闭环定位（`VirtualProfile.vue:95-100, 184-215, 526-570`） |
| Skill 详情（二级页） | `?view=skill` | 单 Skill 契约/运行时/提示词/指标 | 页签制；Prompt 弹层**仅供查看与起草**，底部「前往核心文件编辑 →」就地切到本页「协议」页签（`goDesign('protocol')`），草稿保存与发布在那里完成（`SkillDetail.vue:330-360, 1081-1084, 1245-1247`） |
| Skill 工作台（隐藏） | `/admin/skill-workbench` | 核心文件清单/编译同步 | 「核心文件」「同步」「待编译发布」「无 Prompt」计数（`PromptWorkbench.vue:10-13`） |

---

## 3. 运营 SOP 配方（step-by-step）

### SOP-1 新用户注册后，去哪确认「人进来了、开始学了」

1. 打开 `/admin/overview`，看「最近事件」是否有「新用户注册：<邮箱>」（`live.ts:1087`）。⚠️ 默认过滤虚拟/测试账号。
2. 打开 `/admin/people`，搜索昵称/邮箱/ID，确认账号存在、角色、注册时间、路径/会话数（`Users.vue:45, 700-725`）。
3. 打开 `/admin/learner-state`，搜同一用户：有快照则看当前进度/趋势/疲劳/置信；无快照显示该用户尚未产生学习行为（`LearnerCenter.vue:103, 394, 495-502`）。
4. 打开 `/admin/goal-conversations`，搜该用户：确认是否发起目标澄清、阶段与「N 轮」（`GoalConversations.vue:100, 409, 674-700`）。
5. 若长时间无任何记录：检查是否被误判为测试账号（命名约定），或注册后未登录。

### SOP-2 某学习者「长期低置信」怎么排查

1. `/admin/learner-state` 搜索该用户，读置信列与风险摘要（`LearnerCenter.vue:243-250, 528-537`）。低置信 = 有任务的快照中置信度 < 50%（`evidence.ts:11`）。
2. 点行进入学习者详情，看「证据」时间线：低置信且 `signal` 偏 struggle/incomplete 才是问题；domain 类证据（goal/path）不套学习成败语义（`evidence.ts:1-40`）。
3. 看该用户教学会话：`/admin/teaching-sessions` 搜索，找中断/超时/重复失败的会话（`TeachingSessions.vue:121, 213-226`）。
4. 若会话大量缺总结 → 去执行日志按 `sessionId` 查 `session-wrapup` 失败。
5. 若概念挣扎集中 → 直接在学习者详情的「记忆与复习 / 记忆调度」页签看（`LearnerDetail.vue:1108-1115`）；旧深链 `/admin/memory-review?userId=<id>` 会转发到「记忆调度」页签（`MemoryReviewOverview.vue:604-620`）。在该页签看薄弱项与「需回路径重学」。
6. 处置：必要时行内「发提醒」发站内通知（`LearnerCenter.vue:445-480`）；数据疑似陈旧时单条「重算」快照。

### SOP-3 教学会话卡住 / 异常怎么处置

1. `/admin/teaching-sessions`，点 KPI「异常」卡（落到状态下拉「异常」档），看失败/超时/收尾失败会话（`TeachingSessions.vue:26-33, 718-724, 921-927`）。
2. 点会话行进入座舱，再按该 `sessionId` 到执行日志看全链路失败点（`useSessionDrill.ts:32-35`）。
3. 座舱内看会话当前页签与日志（真实会话只读）（`TeachingSessions.vue:207-210, 969-977`）。
4. 若异常堆积 ≥10（「异常」KPI 转红）→ 优先处理最新失败，判断是上游模型超时还是调用方中止（执行日志 `errorCategory`）。
5. 终态缺总结单独处理：点「缺总结」KPI 卡（或「总结」下拉的「缺总结」档），进执行日志按节点 `session-wrapup` + 失败态查该会话链路（健康中心 14 项检查不含课后总结项，勿去那里找）。

### SOP-4 健康中心告警怎么响应

1. `/admin/health-center`，先读四张概要卡（0 = 好）。有异常时对应卡着色（`HealthCenter.vue:48-81`）。
2. 点异常卡切到对应页签：健康检查 / 技能核查（检查类卡落健康检查并定位行，核查类卡落技能核查并预筛）（`HealthCenter.vue:287-324`）。
3. 健康检查页签：异常域默认展开、error 项排最前，点行展开明细；`fixable` 项点「修复」（自动备份 + 审计），`manual` 项点「查看 →」跳对应面板（`HealthCenter.vue:140-180, 694-725`）。
4. 不一致处理：文件↔DB 契约不一致 → 字段流转页同步；编译产物哈希不一致 → Skill 详情「协议」页签发布；运行时不一致只读、可忽略（`HealthCenter.vue:678-725`）。
5. 修复后确认「最近修复」卡有备份目录与审计号（`HealthCenter.vue:112-120`）。
6. 若 KPI 仍 > 0：按页签明细逐项确认或把诊断信息（含检查 id）交研发；60s 后自动复检。

### SOP-5 复习到期积压 / 归并怎么处理

1. `/admin/memory-review`，读「当前到期」（title 给占记录比）；≥20% 或人均 ≥5 才转警示（`MemoryReviewOverview.vue:412-425, 463`）。
2. 列表默认按待复习量倒序，从上往下处理；或点「有待复习」快筛（只作用于当前页）（`MemoryReviewOverview.vue:331-407`）。
3. 点整行进学习者详情「记忆与复习」页签：先看「课内温故计划」的检索成功率与「需回路径重学」（`MemoryReviewOverview.vue:594-598`）。
4. 归并在学习者详情「记忆调度」页签：点行内「归并候选 / 散键 / 待确认」数字直达；默认只勾「可自动执行」的建议，点「执行选中」前看清「需人工确认」警告（`MemoryReviewOverview.vue:167-188, 601-603`）。
5. 执行后如发现归并错误，在学习者详情「记忆调度」页签用「已执行归并」列表「回滚」（写操作）。
6. 不建议在未核对 A/B 前批量执行「需人工确认」项。

### SOP-6 路径生成失败怎么追

1. `/admin/overview` 教学闭环「路径规划」出现红色「失败 N」→ 点它跳学习路径并预筛 failed（`Overview.vue:144-166, 484-524`）。
2. `/admin/learning-paths`：看失败行，点行或 ⋯「详情」进路径详情（`OpsContent.vue:230-235`）。
3. 路径详情看状态与阶段；重规划需回目标对话：回 `/admin/goal-conversations` 搜该用户/会话，行 ⋯「重建路径」（`GoalConversations.vue:822-845`）。
4. 追根因：执行日志按该会话 `sessionId` 或 `goal-conversation`/`path-planning` 节点查失败（`ExecLogs.vue:70-78`）。

### SOP-7 成本异常怎么查

1. `/admin/token-cost`，选时间窗 7/30/90 天；读「调用成本 / 已定价调用 / 总 Token / 失败」（`TokenCost.vue:82-112`）。
2. 看「按 Skill 成本明细」，定位消耗最高的 Skill（`TokenCost.vue:155-190`）。
3. 看「按用户排行」：搜索具体用户 ID/昵称/邮箱；点「查看全部」展开到上限 100（`TokenCost.vue:222-260, 361-405`）。
4. 看「按模型排行」核对模型分布；失败调用偏高时点失败 KPI 或去执行日志按 `status=err` 查。
5. 必要时「导出 CSV」（Skill 明细 / 用户排行 / 模型排行）（`TokenCost.vue:21, 485-530`）。

### SOP-8 虚拟学习者跑批卡死怎么回收

1. `/admin/virtual-learners`，看「回收无响应（N）」入口（页头维护菜单 / KPI「无响应候选」）与「卡死」列（`VirtualLearners.vue:24-40, 97-110`）。
2. 点「回收无响应」→ 干跑确认清单 → 确认后把超阈值无写入且无活跃租约的会话批量标记为失败（写操作）（`VirtualLearners.vue:24-40`）。
3. 或在画像页/批量条对指定实例清理卡死（`VirtualLearners.vue:369-375, 1083-1086`）。
4. 回收后在列表看失败率与失败数，必要时进画像页对失败会话重试（续传保留进度）。

---

## 4. 机器可读附录（YAML 速查表）

> 供 agent 直接解析。`route` 为深链地址；`subpage` 为二级页 `view` 取值；`filters` 为可用筛选参数（URL 或页面控件）；`actions` 为动作名（`destructive:true` 属破坏性，见 §5）。
> 参数来源：`store.ts:230-241`、`AdminConsole.vue:276-360`、各页面 `route.query` 与 API 封装。

```yaml
version: 1
source_of_truth: frontend/src/views/admin-redesign/
entry:
  admin: /admin
  login: /admin/login
  default_redirect: /admin/overview
  auth: "HttpOnly cookie; JS session marker key = wenflow_admin_session; account JSON key = admin_user"
subpage_query:
  view_values: [learner, user, virtual, session, session-real, path, skill]
  id_param: id
  scope_param: includeTest   # 二级页深链参数（true = 查看虚拟/测试账号明细）；页级共享开关已退役
legacy_alias:
  skill_param: "?skill=<id> -> ?view=skill&id=<id>"
pages:
  - id: overview
    route: /admin/overview
    scene: overview
    purpose: 全站健康一屏（KPI + 教学闭环 + 待办 + 事件流）
    kpis: [今日调用, 今日成功率, 用户活跃, 目标对话]
    sections: [顶部结论条, 教学闭环五环, Skill 调用量 Top 5, 待处理事项, 近7天活跃学习者, 最近事件]
    actions:
      - {name: jump, targets: [execution-logs, people, goal-conversations]}
      - {name: jumpToFailedPaths, target: learning-paths, intent_statusFilter: failed}
      - {name: investigateAgent, target: execution-logs, intent_statusFilter: err}
      - {name: jumpToFailures, target: execution-logs, params: {cat: <errorCategory>, status: <warn|err>, range: week}}
    refresh: {interval_ms: 10000, backoff_max_ms: 60000, circuit_breaker: 5}
  - id: people
    route: /admin/people
    scene: people
    purpose: 账号管理（角色/登录状态/软删恢复/批量导出）
    kpis: []   # 已无 KPI/口径开关：列表 = 全部非虚拟账号，测试/审计账号行内备注
    filters: {search: [昵称, 邮箱, ID], pills: [all, admin, user, online, deleted]}
    table:
      columns: [用户, 邮箱, 角色, 路径/会话, 注册时间, 最后登录, 操作]
      default_hidden: [check, created]
      sort: [user, level, paths, created, lastlogin]
      page_size: [15, 30, 50, 100]
    actions:
      - {name: openCreate, destructive: false}
      - {name: openEdit, destructive: false}
      - {name: toggleRole, destructive: false, guard: not-self}
      - {name: removeUser, destructive: true, kind: soft-delete, reversible: true}
      - {name: restoreUserRow, destructive: false}
      - {name: exportSelected, destructive: false}
      - {name: batchDelete, destructive: true, kind: batch-soft-delete}
  - id: learner-state
    route: /admin/learner-state
    scene: learner-state
    purpose: 学习者状态分布/风险/低置信排查/重算
    kpis: [用户账号, 需关注, 观察, 低置信用户, 平均置信度, 数据覆盖率]
    dist_band: 已退役（2026-10-17）；低置信由 KPI「低置信用户」与可排序「置信度」列承载
    filters: {search: [名称, 邮箱, ID], pills: [all, risk, watch, stale]}
    predicates:
      risk: "trend == down || fatigue == 高 || has_risk_summary"
      watch: "!risk && fatigue == 中"
      low_confidence: "confidence < 0.5"
    window_limit: 500
    actions:
      - {name: openDetail, view: learner}
      - {name: openIntervene, write: true, api: "POST /admin/notifications (kind=learning, scope=user)"}
      - {name: recompute, write: true, api: "POST /admin/learner-models/:userId/recompute"}
      - {name: recomputeAll, write: true}
  - id: teaching-sessions
    route: /admin/teaching-sessions
    scene: teaching-sessions
    purpose: 会话状态监视；缺总结/异常/建议定位
    kpis: [需关注, 异常, 缺总结, 有建议, 完结率]
    dist_band: 已退役（2026-10-17）；异常/完结率由 KPI 与状态/总结/课型/开始时间下拉承载
    filters:
      pills: [all, active, attention, missing]
      chips: [有建议 (server onlyWithAdvisory), 异常]
      advanced: {status: <10 档枚举>, date: [7d, 30d]}
      search: [主题, 用户, 邮箱, ID]
    thresholds: {abnormal_heap: 10, idle_red_seconds: 1500}
    window_limit: 1000
    actions:
      - {name: goTrace, target: execution-logs, param: sessionId}
      - {name: goConsole, view: session-real}
      - {name: toggleOnlyAdvisory, server_filter: onlyWithAdvisory}
    refresh: {interval_ms: 20000}
  - id: goal-conversations
    route: /admin/goal-conversations
    scene: goal-conversations
    purpose: 目标澄清会话与路径生成源头
    kpis: [目标对话数, 完结率, 停滞目标对话, 未生成路径]
    dist_band: 已退役（2026-10-17）；状态筛选回到卡头状态下拉
    cancelled_predicate: "status ∈ {cancelled, canceled, abandoned}"
    filters: {search: [用户, 邮箱, 目标摘要]}
    predicates: {stalled: "status == active && updatedAt older than 7d"}
    window_limit: 1000
    actions:
      - {name: regeneratePath, write: true, api: "POST /admin/goal-conversations/:id/regenerate-path"}
      - {name: remove, destructive: true, api: "DELETE /admin/goal-conversations/:id"}
      - {name: openPathPage, view: path}
      - {name: goTrace, target: execution-logs}
      - {name: goConsole, view: session-real}
  - id: learning-paths
    route: /admin/learning-paths
    scene: learning-paths
    purpose: 路径治理（状态分布/下线/恢复/删除）
    kpis: [路径总数, 里程碑, 任务, 生成失败]
    dist_band: 已退役；状态计数由 KPI 与卡头状态下拉承载（服务端 group-by 全平台）
    filters: {search: [标题, 用户, ID]}
    window_limit: 1000
    actions:
      - {name: openPath, view: path}
      - {name: archive, write: true, api: "POST /admin/learning-content/paths/:id/archive"}
      - {name: restore, write: true, api: "POST /admin/learning-content/paths/:id/restore"}
      - {name: remove, destructive: true, api: "DELETE /admin/learning-content/paths/:id"}
  - id: path-detail
    subpage: path
    purpose: 路径结构（阶段/任务）
    metrics:
      overall_progress: "completed stages / total stages"
      task_totals: "completed subtasks / total subtasks (different denominator)"
    actions:
      - {name: toggleArchive, write: true}
      - {name: goLearner, view: learner, includeTest: true}
      - {name: openTask, modal: true}
  - id: memory-review
    route: /admin/memory-review
    scene: memory-review
    purpose: FSRS 到期积压/课内温故计划/概念归并审计
    kpis: [有记忆痕迹的用户, 记忆痕迹, 当前到期, 需人工确认]
    thresholds: {due_warn_pct: 20, due_warn_per_user: 5}
    list:
      limit: 50
      sort: due desc
      columns: [用户, 记忆痕迹, 待复习, 需关注, 归并候选, 散键, 记忆强度, 最近复习, 操作]
    note: 到期时间轴分布带已退役（2026-10-17）；明细/归并/回滚在学习者详情「记忆与复习 / 记忆调度」页签
    detail_query: "?userId=<id>"   # 旧深链转发到学习者详情
    actions:
      - {name: openDetail, view: learner, tab: memoryReview}
      - {name: openOps, view: learner, tab: memory-ops}
      - {name: recompute, write: true, api: "POST /admin/memory-review/:userId/recompute", effect: observe-only}
  - id: health-center
    route: /admin/health-center
    scene: health-center
    purpose: 服务可用性/一致性核查/完成度
    kpis: [检查异常, 契约与哈希不一致, 一致性核查异常, 完成度未达标]
    tabs: [health, recon]   # 旧键 drift→health、completion→recon 别名
    deep_links: {force: "?refresh=1", check: "?check=<itemId>"}
    refresh: {interval_ms: 60000}
    actions:
      - {name: fix, write: true, api: "POST /admin/health-center/fix", fixable: [w4-corehash, field-routing, field-routing-contract, snapshots]}
      - {name: jump, targets: [orchestrator?tab=routing, orchestrator?tab=journey, skills?view=skill&skdTab=protocol, execution-logs]}
  - id: virtual-learners
    route: /admin/virtual-learners
    scene: virtual-learners
    purpose: 合成画像压测
    kpis: [完成率, 系统失败率, 今日调用, 无响应候选]
    actions:
      - {name: openCreate, write: true}
      - {name: openBatchCreate, write: true}
      - {name: openReclaimModal, write: true, kind: mark-stalled-failed, dry_run: true}
  - id: virtual-learner-cards
    route: /admin/virtual-learner-cards
    scene: virtual-learner-cards
    purpose: 角色卡导入/导出
    metric: 当前自建卡 N 张
  - id: orchestrator
    route: /admin/orchestrator
    scene: orchestrator
    purpose: 顶层 Agent 数据流转/字段血缘/治理
    panes: [overview, <5 stages>, journey, routing, governance]   # 总览 + 五阶段；阶段内二级页签 字段旅程/字段路由/治理
    note: 页级 KPI/告警条已撤（阶段/Skill 进总览卡头 meta，治理信号在健康中心）
    deep_links: {compat_tab: "?tab=topology"}
  - id: skills
    route: /admin/skills
    scene: skills
    purpose: Skill 目录（批量模型配置在页头弹窗）
    kpis: [Skill, 已上线, 成功率, 平均耗时, 需关注 Skill]
    deep_links: {compat_tab: "?tab=run|model-routing|prompt-eval"}
    subpage: {view: skill}
  - id: prompt-eval
    route: /admin/prompt-eval
    scene: prompt-eval
    purpose: 提示词质量评测（用例集 + 历史运行）
    kpis: [最近评测通过率, 评估用例, 启用用例, 评估历史]
    tabs: [cases, runs]
    deep_links: {pe_tab: "?peTab=", compat_tab: "?tab=cases|runs"}
  - id: execution-logs
    route: /admin/execution-logs
    scene: execution-logs
    purpose: 日志 + Trace 链路排障
    tabs: [logs, trace]
    filters:
      pills: [err, warn, ok, test]
      time_range: [15m, 1h, today, yesterday, week, month, all, custom]
      selects: [agent(Skill), status, source(test)]
      search: [keyword, traceId, sessionId]
      advanced: [sessionId]
      error_category: true
    url_params: [agent, status, cat, range, q, trace, session, test, from, to]
  - id: token-cost
    route: /admin/token-cost
    scene: token-cost
    purpose: Token 与成本
    kpis: [调用成本, 已定价调用, 总 Token, 失败]
    filters: {days: [7, 30, 90], search_user: true}
    ranks: [by-skill, by-user, by-model]
    by_user_limit: 100
    actions: [{name: exportCsv, destructive: false}]
  - id: audit-logs
    route: /admin/audit-logs
    scene: audit-logs
    purpose: 操作审计 + 登录审计
    tabs: [operation, login]
    filters: {time_range: [today, yesterday, week, month, all], action_quick: 失败 TOP}
    deep_link: "?tab=login"
  - id: api-config
    route: /admin/api-config
    scene: api-config
    purpose: 模型供应商/路由/安全/基础设施模型
    kpis: []   # 页首 KPI 带已撤（2026-10-14）
    tabs: [model, connection, infra, generation]   # 供应商详情二级页签
    note: 单页；旧 ?tab=security 改投 /admin/access-control，?tab=addons 改投 /admin/addons
  - id: addons
    route: /admin/addons
    scene: addons
    purpose: 插件（能力 Skill 与 MCP 服务）登记/测试
  - id: ops-hub
    route: /admin/ops-hub
    scene: ops-hub
    purpose: 运营待办/反馈/成就/公告/站内通知 + 运维工具/数据导出/会话安全/访问与注册
    tabs: [todo, feedback, achievements, announce, inapp, tools, export, security, access]
    note: 原独立场景 ops-center（tools/export/security）与 access-control（access）并入为本页 tab；旧 URL 由 router 重定向
    actions:
      - {name: advanceTime, write: true, api: "POST /admin/devtools/advance-time", effect: preview-no-db-write}
      - {name: requeueOutboxDead, write: true, api: "POST /admin/devtools/outbox/requeue-dead", kind: by-event-type}
      - {name: export, destructive: false}
      - {name: revokeAdminSession, destructive: true, api: "DELETE /admin/sessions/:id"}
      - {name: revokeAllAdminSessions, destructive: true, api: "POST /admin/sessions/revoke-all"}
    export_ranges: [users, teaching-sessions, feedback, goal-conversations, agent-logs, audit-logs]
  - id: learner-detail
    subpage: [learner, user]
    purpose: 单学习者详情
    sections: [概览, 证据, 预测校准, 学习路径, 教学会话(最近20), 记忆与复习, 操作记录]
  - id: session-cockpit
    subpage: [session, session-real]
    purpose: 虚拟会话控制台 / 真实会话只读
    actions: [autopilotStart, autopilotStop, step, auto, advancePath, startLearning, resetLearn, resetPath, wrapup, reviewPath, acceptPath, replanPath, abandon, rerun]
  - id: virtual-profile
    subpage: virtual
    purpose: 虚拟学习者画像（故事池/运行记录/会话控制）
    actions: [openSubPage(learner), editOpen, batchRunStories, batchAutopilotStories, batchRemoveStories, openSubPage(session)]
  - id: skill-detail
    subpage: skill
    purpose: 单 Skill 契约/运行时/提示词
    actions: [{name: openPromptModal, write: false, note: "仅供查看/起草；保存与发布在 /admin/skills/:id?tab=protocol（goDesign）"}]
  - id: skill-workbench
    route: /admin/skill-workbench
    hidden: true
    purpose: 核心文件清单/编译同步
```

---

## 5. 安全红线（破坏性操作 / 确认分级 / 误触防范）

### 5.1 破坏性操作清单（点击前必须确认对象与影响）

| 操作 | 位置 | 影响 | 可逆性 |
|---|---|---|---|
| 删除用户 / 批量删除用户 | 用户账号 行 ⋯ / 批量条 | 软删：账号无法登录，历史数据保留 | 可恢复（已删除列表「恢复」） |
| 删除路径 | 学习路径 行 ⋯ | 级联删除全部里程碑与子任务 | **不可撤销** |
| 下线路径 / 恢复路径 | 学习路径 行；路径详情 hero | 用户端不可继续 / 立即可见可学 | 可逆（互相切换） |
| 删除目标对话会话 | 目标对话 行 ⋯ | 删除该 Goal 会话 | **不可撤销**（页面明确标注） |
| 重建路径 | 目标对话 行 ⋯ | 重新生成并**覆盖当前路径** | 不可逆（旧版本被覆盖） |
| 执行概念归并 | 记忆与复习 明细 | 删除该用户重复记忆痕迹 | 留快照可回滚（页面内） |
| 回滚归并 | 记忆与复习 明细 | 还原合并前状态 | 已回滚不再重复回滚 |
| 回收卡死会话 | 虚拟学习者 页头「回收卡死」 | 把卡死会话标记为失败 | 不可逆（先干跑清单） |
| 强制下线管理员会话 / 批量吊销 | 运营中心 · 会话安全 | 被下线者立即失去后台访问 | 需重新登录；**不能下线自己当前会话**（后端 409） |
| outbox 死信重放 | 运营中心 · 运维工具 | 按事件类型**整批**重新入队处理 | 视事件而定 |
| 健康中心一键修复 | 健康中心 | 备份后改配置/编译产物/DB 对账 | 结果写审计日志；有备份目录 |
| 编辑并发布 Prompt / 保存运行时配置 | Skill 设计页（`/admin/skills/:id`；`SkillDetail` 二级页的 Prompt 弹层仅查看/起草） / 模型与接入 | 直接改线上生效的提示词或路由 | 需按既有发布链回滚 |

> 数据导出（运营中心 · 数据导出、用户批量 CSV）为**只读**操作，不产生审计记录、不含敏感字段（密码哈希、API Key）。

### 5.2 确认分级

- **无确认（即时）**：所有筛选 / 排序 / 列显隐 / 搜索 / 翻页 / 展开收起 / 下钻 / 复制深链 / 导出 CSV / 刷新。
- **单次确认（普通）**：设为/降为管理员（降级标 danger）、恢复用户、恢复路径、重算快照、重新观察、重建路径（覆盖前提示）、健康中心修复（说明影响范围）。
- **红色确认（破坏性）**：删除类（用户/路径/会话/批量删除）、执行归并、回滚归并、下线路径、回收卡死、吊销会话。部分页面用 `busy` 态锁定提交中防误关（如删除用户，`Users.vue:575, 634-637`）。

### 5.3 误触防范（本手册约束 agent 与人类共同遵守）

1. **禁止探针点击破坏性按钮**：审计/走查只做非破坏性交互（筛选、排序、展开、收起、下钻、列显隐、搜索、翻页、重试）；不点删除 / 下线 / 回收 / 清空 / 吊销类。
2. **写请求红线**：非处置任务不发 `POST / PUT / PATCH / DELETE`（含站内提醒、重算、修复、归并、导出提交）。本手册 §4 中 `write:true` / `destructive:true` 的动作仅在实际运营处置时使用。
3. **删除前确认三件事**：对象正确（用户/路径 ID 对得上）、影响面（级联/覆盖）、可逆性（是否可恢复）。
4. **不可逆优先降级**：路径治理优先「下线」而非「删除」；用户优先「删除（软删）」而非物理清除；归并先只勾「可自动」。
5. **批量操作先看干跑**：回收卡死、死信重放、批量删除/归并均有清单或范围提示，确认范围再执行。
6. **管理员自我保护**：不能删除自己（⋯ 菜单对自己不出现，`Users.vue:174-180`）；不能吊销自己的当前会话（后端 409，`adminApi.ts:2225-2227`）。

---

## 6. 初始管理员与登录安全

### 6.1 初始管理员

后端启动时按 `backend/.env` 自动创建初始管理员；数据库已有管理员时跳过。

- `INIT_ADMIN_NAME` 未配置时用 `admin`。
- 开发环境未配置 `INIT_ADMIN_PASSWORD` 时使用内置默认 `ChangeMe_2026_Admin`；生产环境（`NODE_ENV=production`）拒绝默认口令，必须显式配置，否则跳过创建并告警。
- 密码至少 12 位，包含大小写字母和数字。已有管理员不会因修改 `INIT_ADMIN_PASSWORD` 而更新密码。
- 弱口令、初始用户名/邮箱被普通用户占用、数据库写入失败时，后端拒绝启动。

```env
INIT_ADMIN_NAME=admin
INIT_ADMIN_EMAIL=admin@wenflow.local
INIT_ADMIN_PASSWORD=<set-a-unique-strong-password>
```

### 6.2 访问策略

管理员来源策略通过管理端「模型与接入 → 连接与安全」持久化到 System DB，并支持热生效；环境变量只作为数据库未配置时的默认值：

```env
# loopback: 仅服务器本机（localhost / 127.0.0.1 / ::1）
# private: 本机和 RFC1918 局域网，默认推荐
# any: 不限制来源，不建议直接用于公网
ADMIN_ACCESS_MODE=private
ADMIN_ALLOWED_IPS=
```

生产公网管理建议使用 VPN 或受控反向代理，并保持精确 IP Allowlist；不要通过关闭认证或共享弱密码解决远程访问问题。反向代理场景需同时核对 `CORS_ORIGIN`（不要带尾部 `/`）与 `TRUST_PROXY`（填直连后端的代理 IP/CIDR，禁止 `true`），且后端端口不得绕过代理公开。

### 6.3 忘记密码

不要删除数据库。安全恢复流程：

1. 备份主库和数据库加密 Keyring。
2. 使用受控维护脚本或数据库管理流程为指定管理员写入新的 bcrypt 哈希。
3. 撤销现有会话或 Token。
4. 审计恢复操作与登录记录。

尚未创建任何管理员时，可设置新的 `INIT_ADMIN_PASSWORD` 后重启，或运行 `node create-admin.js`。

### 6.4 启动与登录排查

- 启动后没有管理员：检查 `INIT_ADMIN_NAME` / `INIT_ADMIN_PASSWORD`、数据库中是否已有管理员、后端日志是否有数据库或 Prisma 报错。
- 反向代理后登录异常：核对 `CORS_ORIGIN`、`TRUST_PROXY` 与后端端口暴露情况。
- 首次登录后立即修改管理员密码；不要把 `backend/.env` 提交到仓库。
- 凭据、数据库备份与泄露响应要求见 [`SECURITY.md`](../SECURITY.md)。

### 6.5 发布前检查

```powershell
npm run security:scan
npm run check
```

---

*本手册为运营口径单源；页面改版后请按「三件套」门禁同步更新本文件与 `doc/README.md` 登记。*
