# WenFlow 管理端运营操作手册（ADMIN_OPERATIONS_MANUAL）

> 📌 类型：活规范（运营 SOP 单源，随代码核验）｜最后核验：2026-10-05。索引见 [doc/README.md](./README.md)。

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

- 管理端是**运营驾驶舱 + 排障台**，回答四类问题：教学闭环是否跑通、用户/学习者是否健康、Skill 是否在正常运行、成本是否异常（`manifest.ts:54-91`；`Overview.vue:1-251`）。
- 入口：访问 `/admin` 会重定向到 `/admin/overview`（`router/index.ts:204-207`）。
- 登录页 `/admin/login`（`router/index.ts:199-203`）：
  - 字段为**管理员账号 + 密码 + 「记住本机登录状态」勾选**（`Login.vue:20-77`）。
  - 勾选「记住」→ 登录标记与账号信息写 `localStorage`；不勾 → 写 `sessionStorage`（`Login.vue:215-217`）。**「已登录」标记键是 `wenflow_admin_session`**（值 `'1'`，`adminApi.ts:11, 40-41`）；`admin_user` 只存账号信息 JSON，不是登录判据（`Login.vue:216-217`）。
  - 实际会话凭据是 **HttpOnly Cookie**；JS 侧只存「已登录」标记与账号信息，不存 token（`adminApi.ts:186` `markAdminSession`、`adminApi.ts:165` `clearAdminSession`）。
  - 未登录访问受保护页 → 跳 `/admin/login?redirect=<原路径>`，登录后回到原深链（含二级页 query）；`safeRedirect` 只允许同源且以 `/admin/` 开头的地址，否则回落 `/admin/overview`（`router/index.ts:443-449`；`Login.vue:181-201`）。
  - 登录失败：凭证错误进顶部横幅；429 提示「登录尝试过于频繁」；无状态码或 5xx 提示「服务暂时不可用」（`Login.vue:221-233`）。
- 退出登录：右上角账户菜单 → 「退出登录」（`Shell.vue:216-222`）。
- 顶栏全局工具：**运营术语表**抽屉（「这是什么」词条，数据源 `GET /admin/glossary`，`Shell.vue:176-178`；`adminApi.ts:929-933`）、**密度切换**（compact/standard，localStorage 记忆，`Shell.vue:396-412`）、主题、刷新。
- 新建/重置用户密码规则：**≥8 位且同时含字母与数字**（`Users.vue:298-299`）。

### 1.2 页面地图（路由 → 一句话职责）

侧栏由 `manifest.ts:54-91` 单源定义，实际列出 **18 个场景 / 7 组**（⚠️ `manifest.ts:30` 注释仍写「19 项/7 组」，属注释滞后，以数组为准）。`/admin/:page?` 是唯一宿主路由（`router/index.ts:392-397`），组件注册见 `AdminConsole.vue:113-147`。

| 组 | 路由 | 场景 label | 一句话职责 | 组件 |
|---|---|---|---|---|
| 总览 | `/admin/overview` | 平台总览 | 全站健康一屏：KPI + 教学闭环 + 待办 + 事件流 | `Overview.vue` |
| 教学 | `/admin/people` | 用户与学习者 | 账号管理：角色、登录状态、软删/恢复、批量导出 | `People.vue`（内嵌 `Users.vue`） |
| 教学 | `/admin/learner-state` | 学习状态 | 学习者状态分布、风险与低置信群体排查、重算 | `LearnerCenter.vue` |
| 教学 | `/admin/teaching-sessions` | 教学会话 | 会话状态实时监视、缺总结/异常/建议定位 | `TeachingSessions.vue` |
| 教学 | `/admin/goal-conversations` | 目标对话 | 目标澄清会话、路径生成源头、重建/删除 | `GoalConversations.vue` |
| 教学 | `/admin/learning-paths` | 学习路径 | 路径治理：下线/恢复/删除、状态分布 | `OpsContent.vue` |
| 教学 | `/admin/memory-review` | 记忆与复习 | FSRS 到期积压、课内温故计划、概念归并审计 | `MemoryReview.vue` |
| 虚拟学习者 | `/admin/virtual-learners` | 虚拟学习者 | 合成画像压测教学闭环、运行/批量新建/回收 | `VirtualLearners.vue` |
| 虚拟学习者 | `/admin/virtual-learner-cards` | 学习者卡库 | 角色卡（账号+档案+故事池）导入导出 | `VirtualLearnerCards.vue` |
| Skill | `/admin/orchestrator` | 编排图 | 顶层 Agent 数据流转、字段血缘、治理 | `Orchestrator.vue` |
| Skill | `/admin/skills` | Skill 与提示词 | Skill 运行、模型路由、Prompt 评估 | `Skills.vue` |
| 观测 | `/admin/execution-logs` | 执行日志 | Skill 执行日志 + Trace 链路、失败定位 | `ExecLogs.vue` |
| 观测 | `/admin/token-cost` | 成本分析 | 模型/Skill/用户/模型维度 Token 与成本 | `TokenCost.vue` |
| 观测 | `/admin/audit-logs` | 审计日志 | 管理操作审计 + 管理员登录审计 | `AuditLogs.vue` |
| 系统 | `/admin/health-center` | 健康中心 | 服务可用性、漂移、对账、完成度 | `HealthCenter.vue` |
| 系统 | `/admin/api-config` | 模型与接入 | 模型供应商、路由、安全策略、外挂能力 | `ApiConfig.vue` |
| 系统 | `/admin/ops-center` | 系统工具 | 运维工具（时间推进/死信）、数据导出、会话安全 | `OpsCenter.vue` |
| 运营 | `/admin/ops-hub` | 运营中心 | 运营待办、反馈、成就、公告、站内通知 | `OpsHub.vue` |

**二级页**（不占独立侧栏项，经 `?view=&id=` 深链寻址，`AdminConsole.vue:149-160, 223`）：

| `view` 取值 | 二级页 | 组件 |
|---|---|---|
| `learner` | 学习者详情 | `LearnerDetail.vue` |
| `user` | `LearnerDetail.vue` 的别名（默认落「账号与许可」页签） | `LearnerDetail.vue` |
| `virtual` | 虚拟学习者画像 | `VirtualProfile.vue` |
| `session` / `session-real` | 会话座舱（虚拟会话控制台 / 真实会话只读监控） | `SessionCockpit.vue` |
| `path` | 路径详情 | `PathDetail.vue` |
| `skill` | Skill 详情 | `SkillDetail.vue` |

**隐藏场景**（不在侧栏但 URL 可达）：`/admin/skill-workbench`（Skill 工作台：核心文件清单与编译同步状态；「从 0 新建 Skill」**已迁出管理台、统一走 CLI** —— `PromptWorkbench.vue:24, 167-170`，`AdminConsole.vue:142-144` 的旧注释「新建 Skill 骨架生成的唯一入口」已过期）；`/admin/skills/:agentId+`（Skill 设计二级页，`router/index.ts:216-219`）。

**常见旧书签重定向**（`router/index.ts:208-390`）：`/admin/console/:page`、`/admin/users→people`、`/admin/learner-center|learner-models→learner-state`、`/admin/sessions?tab=`（→ teaching-sessions / goal-conversations / learning-paths）、`/admin/content|ops-content→learning-paths`、`/admin/prompt-eval→skills?tab=prompt-eval`、`/admin/health→health-center`、`/admin/traces|trace-waterfall|prompt-call-logs|event-center→execution-logs`、`/admin/batch-experiments→virtual-learners`、`/admin/feedback→ops-hub?tab=feedback`、`/admin/announcements|messages→ops-hub?tab=announce`、`/admin/notifications→ops-hub?tab=inapp`、`/admin/achievements|ops-achievements→ops-hub?tab=achievements`、`/admin/devtools→ops-center?tab=tools`、`/admin/export-data→ops-center?tab=export`、`/admin/session-security→ops-center?tab=security`、`/admin/models|addons|external-capabilities→api-config`。

### 1.3 全局交互方言（写一次，全站适用）

1. **页头 KPI 带（`.mk-kpi-grid` + `MkKpi`）**
   - 位置：页头之下、内容卡之上。同屏**只允许一条统计带**（撤带拍板），同一数字不在两处重复念。
   - 口径写法：`hint` = 一短句可见口径；悬停 `title` = 长解释。`tone`（ok/warn/bad）给数字着色；`clickable` 表示可点跳转（`MkKpi.vue:1-23`）。
   - **列表页可能没有 KPI 栅格**（撤带属正常设计），不据此判缺陷。

2. **贴表分布条（`MkDistBand`）**：教学组与多页统一标准件。
   - 位置：**列表卡上方、页面级**（「分段条在上」拍板）。
   - 点击分段或图例 = 下钻筛选下方表格，**再点同段取消**（`MkDistBand.vue:8-42, 78-86`）。
   - 图例恒显计数（含 0 值档），非零段才出色块；偏态保护：1 人也露出可点色标（段宽下限 3% + `min-width:14px`，`MkDistBand.vue:80-83`）。
   - 口径提示：分布条若副标标注「窗口 / 非全量」，表示只统计**当前已加载列表**；服务端全量的页面会在副标写明「服务端 group-by」。

3. **下划线页签（tabs）**：页内视图切换一律下划线 tabs（激活蓝字 + 2px 蓝下划线）；**胶囊 pills 只做筛选 chips，不做视图切换**（`HealthCenter.vue:836-854`；`ExecLogs.vue:28-30`；`Skills.vue:58-61`）。

4. **筛选 chips（pills）**：卡头左侧，单选切换，再点可取消。判例：KPI 已有孪生数字的筛选 pill **不再显计数**（同组数字不同屏念两遍）；计数只留给「无 KPI 孪生的筛选命中数」（`LearnerCenter.vue:63-68`；`TeachingSessions.vue:600-618`）。

5. **表格排序**：点可排序表头切换升降序，状态按页面 `storage-key` 写入 localStorage（`useTableSort`，如 `Users.vue:730-739`）。

6. **列显隐（`MkCols`）**：卡头右侧「列」菜单，隐藏项按页面 `storage-key` 持久化；关键列/操作列固定不可隐藏（如 `Users.vue:424-431`、`LearnerCenter.vue:297-308`）。

7. **抽屉与二级页**：实体详情一律走**二级页**（行点击或详情钮 → `?view=&id=`，可刷新/分享/前进后退），不再用抽屉；弹层只留给子实体（任务详情、干预提醒等）（`store.ts:194-229`；`PathDetail.vue:146-164`）。

8. **深链参数惯例**：
   - 二级页：`?view=<learner|user|virtual|session|session-real|path|skill>&id=<实体ID>`，可带 `includeTest=true`（覆盖数据范围，`AdminConsole.vue:223-233`）。
   - 旧 `?skill=<id>` 会被自动翻译成 `?view=skill&id=<id>`（`AdminConsole.vue:317-331`）。
   - 跨页排查意图（`store.ts:184-192`）跳执行日志时写入：`?agent=<SkillID>&status=<err|warn|ok>&cat=<错误类别>&range=<时间窗>`。
   - 页面内页签/子视图深链：`?tab=`（如 `skills`、`health-center`、`ops-hub`、`audit-logs`、`execution-logs`、`api-config`、`ops-center`）；Prompt 评估内层用 `?peTab=`。

9. **数据范围开关「仅真实 / 含测试」**：教学组六页（用户与学习者 / 学习状态 / 教学会话 / 目标对话 / 学习路径 / 记忆与复习）页头挂同一 `DataScopeToggle`，状态共享并写入 `localStorage: wf_include_virtual`，切换即清页面缓存并重拉（`DataScopeToggle.vue:1-38`；`live.ts:2124-2136`）。默认「仅真实」= 排除虚拟学习者与测试账号；「含测试」= 显式包含并在行内灰标。**成本分析页的同类开关是它自己的窗口口径**（`tokenCostFilters.includeTest`，`store.ts:260-264`；`TokenCost.vue:266-268`），不随上述共享态走。

---

## 2. 页面逐页手册（运营高频页详写）

### 2.1 平台总览（`/admin/overview`，`Overview.vue`）

**这页回答**：今天平台整体好不好、教学闭环哪一环断了、现在最该点哪里。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 今日调用 | `agents.todayCalls`，**真实用户口径**（虚拟/测试另计）。foot 显示超时数与「较昨日同时刻」趋势；hint 在全量 > 真实时标注「全量（含虚拟/测试）N 次」（`live.ts:1064-1071`） |
| 今日成功率 | 成功 / 今日调用；今日 0 调用显示「—」而非 100（卡标签单源 `TERMS.healthScore`＝「今日成功率」，`terms.ts:44-46`；`live.ts:1072-1077, 889-896`） |
| 用户活跃 | `users.activeToday`（今日有学习会话的用户）；foot 今日新增；hint 带总用户（`live.ts:1078-1084`） |
| 进行中对话 | `conversations.active` 快照（无同时刻对照）（`live.ts:1085-1091`） |
| 趋势 ▲▼ | 与**昨日同时刻等长窗口**比，基线 0 不给百分比、fall 落「昨日同时刻无对照」（`live.ts:1049-1063`） |
| 顶部结论 | 今日调用 = 0 → 「系统空闲 / 今日暂无调用 / 真实用户暂无调用」；成功率 < 80% 且失败 ≥ 3 → 红「需要关注」；成功率 < 90%（调用 ≥20）或失败 ≥ 3 → 琥珀；否则「运行平稳」（`live.ts:876-925`） |
| 教学闭环五环 | ① 目标对话 = `loop.conversationsActive`；② 路径规划 = `loop.pathsActive`（有失败时转 alert 并显示 `失败 N` = `loop.pathsFailed`）；③ 教学回合 = 教学会话 total（进页拉一次）；④ 课后评估 = `wrapup.evaluationModel + evaluationAiFallback`；⑤ 记忆复习 = memory-review `totals.due`（`Overview.vue:290-336`） |
| 状态条「健康」 | 健康中心清单的 error/warn 计数（60s 缓存）：0 异常绿、有 warn 琥珀、有 error 红、拉取失败弱琥珀（`Overview.vue:429-477`） |
| 状态条「仿真」 | 虚拟通道：系统失败率 ≥50% 红、≥20% 或存在失败黄、无会话灰；「未加载 / 加载失败」≠「空闲」（`Overview.vue:481-517`） |
| 最近事件 | 近 24h；默认隐藏虚拟/测试账号；相邻同类失败折叠为「执行失败 ×N（同因）」（`Overview.vue:587-627`） |

**常见操作**
1. 看今日是否异常：先读页头结论条，红/琥珀时点右侧「查看健康中心」或状态条上的「健康 / 仿真」入口（`Overview.vue:69-91`）。
2. 定位断点：点教学闭环某一环卡片，跳到对应页面；路径环有失败时点红色「失败 N」→ 学习路径并预筛失败（`Overview.vue:114-133, 337-347`）。
3. 追失败：点「最近事件」里红色/琥珀行，或点「待处理事项」的「去排查」，跳到执行日志并带该 Skill / 错误类别 / 近 7 天窗口筛选（`Overview.vue:575-584, 647-664`）。
4. 看谁在用：点「今日调用 / 成功率」→ 执行日志；点「用户活跃」→ 用户与学习者；点「进行中对话」→ 目标对话（`Overview.vue:547-553`）。

**空态 / 错误态**
- KPI 带随数据为空时整页走 `MkLoading` → `MkEmptyState`「真实数据暂不可用」+「重试」（`Overview.vue:242-250`）。
- 页头注记：正常「10s 自动刷新」；拉取失败展示旧数据时「展示上次成功数据」（琥珀）；连续失败 5 次熔断后变为可点「自动刷新已停止，点击恢复」（`Overview.vue:366-389, 666-706`）。
- 事件流全为测试/模拟账号时提示「近期动态均为测试/模拟/探针账号（默认隐藏）」（`Overview.vue:235`）。

**异常信号 → 下一步**
- 结论红 / 成功率骤降 → 健康中心看整体，执行日志按 `status=err` + 时间窗查。
- 路径环出现「失败 N」→ 学习路径预筛失败，逐条进详情。
- 记忆复习环「N 待办」持续增长 → 记忆与复习页按到期档排查。
- 仿真红 → 虚拟学习者页看失败率/卡死。

**联动**：KPI → 执行日志/用户与学习者/目标对话；闭环环 → 对应页；待办 → 执行日志（带 intent 筛选）；事件行 → 执行日志（带错误类别）。反向：执行日志支持 URL 参数还原筛选（见 §4）。

---

### 2.2 用户与学习者（`/admin/people`，`People.vue` + `Users.vue`）

**这页回答**：有哪些账号、谁在活跃、谁被删了、某个学习者注册多久/几条路径、怎么建号/停号/恢复。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 账号构成桶 | 数据 = 已加载行（默认上限 1000，后端总数在 `liveUsersTotal`）。默认「仅真实」只渲染真实用户单桶（含「其中管理员 N」）；切「含测试」后展示真实/虚拟/测试三分桶（互斥：虚拟 > 测试 > 其余真实）（`People.vue:38-74`） |
| 列表加载上限 | `limit: 1000`；后端总数 > 已加载时在桶 / 状态条 title 注明截断（`live.ts:1184-1194`） |
| 状态条（独立非嵌入时） | 共 N 人 · 真实 N · 测试/虚拟 N（含测试时）· 在线 N · 管理员 N（`Users.vue:3-20, 725-726`） |
| pills 计数 | 全部 / 管理员 / 普通用户 / 30 分钟在线 / 已删除；「30 分钟在线」= `lastLoginAt` 在 30 分钟内（`Users.vue:460-471`） |
| 「已删除」列表 | 独立数据源 `GET /admin/users?status=deleted`（`Users.vue:367-381`；`adminApi.ts:2014`） |
| 默认隐藏列 | 选择框、注册时间（列菜单可恢复）（`Users.vue:424-431`） |
| 等级 / XP | 等级由 XP 按公式 `floor(sqrt(xp/100))+1` 推导，展示「L2 · 进阶 · N 条路径」，悬停看 XP 与升级差（`Users.vue:118-123, 282-292`） |

**常见操作**
1. 找号：搜索框支持昵称 / 邮箱 / ID（`Users.vue:45, 748`）；或点 pills 快筛管理员 / 普通用户 / 30 分钟在线 / 已删除。
2. 新建用户：页头「新建用户」→ 填昵称、邮箱、初始密码、角色（`Users.vue:14, 204-249, 525-584`）。
3. 改角色：行 ⋯ 菜单 → 「设为管理员 / 降为用户」（**自己不可被降级/删除**，`Users.vue:155-161, 304-314, 660-681`）。
4. 停用 / 恢复：⋯ → 「删除」（软删，历史数据保留，可恢复）；已删除列表内 ⋯ → 「恢复」（`Users.vue:150-166, 683-723`）。
5. 批量：勾选（虚拟/测试账号不可勾）→ 底部批量条「导出 CSV」或「批量删除」（`Users.vue:194-202, 586-658`）。
6. 进详情：点行或「详情」→ 学习者详情二级页 `?view=user&id=`（`Users.vue:111, 147`）。

**空态 / 错误态**
- 加载失败显示「数据加载失败」+ 重试（`Users.vue:59-66`）。
- 已删除列表拉取失败**不静默**，toast 提示「已删除用户加载失败」——避免看起来像「没有已删用户」（`Users.vue:374-379`）。
- 筛选无结果显示「当前筛选无用户」+ 清除筛选（`Users.vue:176-183`）。

**异常信号 → 下一步**
- 真实用户构成异常（管理员数异常增长）→ 审计日志按「设为管理员」动作查。
- 「30 分钟在线」为 0 但今日调用不为 0 → 可能登录行为集中在更早时段，去执行日志/审计日志核对。
- 新账号注册后无路径/无会话 → 学习状态页搜该用户，或目标对话页确认是否发起澄清。

**联动**：点用户 → 学习者详情；向学习者详情下发 `includeTest`；`intent.quickAction='create-user'` 可直达并打开新建弹窗（`Users.vue:510-520`）。

---

### 2.3 学习状态（`/admin/learner-state`，`LearnerCenter.vue`）

**这页回答**：全体学习者的状态分布如何、谁需要关注、谁置信度低（证据不足）、要不要重算快照。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 学习者 | 后端总数；窗口上限 500，超过时状态条提示「仅加载前 500 位」。显示「N」或「N · 已载 M」（`LearnerCenter.vue:14-17, 376-383`） |
| 需关注 | `趋势=下降 ∨ 疲劳=高 ∨ 有风险摘要`（`isRisk`）。**疲劳=中且非需关注**归「观察」pill，不计入需关注（`LearnerCenter.vue:414-419`） |
| 低置信 | 在「有任务的快照」（`task 非空 且 confidence 非空`）中，置信度 < 50%（`evidenceLowConfidence`，阈值 0.5）。hint 带分母 `n=`（`LearnerCenter.vue:427, 438-444`；`evidence.ts:11`） |
| 平均置信度 | 同上「有任务的快照」集合的置信度均值；hint 注明其余无任务/无快照不入均值（`LearnerCenter.vue:445-455`） |
| 置信度分布（贴表条） | 五档 `< 25% / 25–49% / 50–74% / 75–89% / ≥ 90%`；分母 = 有任务的快照；副标写明「另 N 位无任务/无快照不计」（`LearnerCenter.vue:456-492`） |
| 风险摘要列 | `「X」等 N 个概念挣扎`（优先）→ 疲劳高风险 → `「X」等 N 个概念待巩固`（`LearnerCenter.vue:394-400`） |

**常见操作**
1. 看大盘：先读四张 KPI，再读「置信度分布」条。
2. 定位群体：点分布条某段只看该置信区间（再点取消）；或点「需关注 / 观察 / 低置信」pill；可与搜索叠加，点「清除筛选」一并清（`LearnerCenter.vue:486-527`）。
3. 干预：行内铃铛「干预」→ 弹窗可「查看学习详情 / 查看执行日志」、填标题与内容后「发送提醒」（站内通知，`kind=learning`，定向该用户）（`LearnerCenter.vue:203-238, 355-374`）。
4. 重算：行内旋转钮单条重算；卡头「全部重算」逐条重算（进度 N/M），结束统一刷新（`LearnerCenter.vue:78-86, 556-626`）。
5. 进详情：点行 / 详情钮 → 学习者详情二级页（带当前数据范围 `includeTest`）（`LearnerCenter.vue:315-317`）。

**空态 / 错误态**
- 快照加载失败 → `MkEmptyState` + 重试（`LearnerCenter.vue:93-100`）。
- 无匹配 → 「没有匹配的学习者」+ 清除筛选；无快照 → 「暂无学习者快照，产生学习行为后自动生成」（`LearnerCenter.vue:184-190`）。
- 置信列对无任务行显示「—」并不计入 KPI/分布（口径一致性，`LearnerCenter.vue:155-165, 426-429`）。

**异常信号 → 下一步**
- 「低置信」占比持续偏高（证据不足）→ 该群体完课证据少：去教学会话看是否大量中断/超时，或记忆与复习看是否无痕迹。
- 「需关注」集中于某路径/概念 → 进学习者详情看证据时间线与薄弱概念。
- 「全部重算」出现失败 → toast 报「N 成功 · N 失败」，失败多为该用户无快照或接口异常，可单个重试。

**联动**：`intent.statusFilter` 等跨页筛选；`liveIncludeVirtual` 共享口径；干预弹窗「查看执行日志」带空筛选直达执行日志（`LearnerCenter.vue:344-354`）。

---

### 2.4 教学会话（`/admin/teaching-sessions`，`TeachingSessions.vue`）

**这页回答**：谁在上课、会话状态如何、哪些会话异常（失败/超时/收尾失败）、哪些终态会话缺课后总结、哪些带教学建议。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 需关注 | 加载窗口内 `attention !== 'low'` 的会话数。attention：失败/超时，或「已完成但缺总结」→ 高；有高优建议 → 高；有建议 → 中；否则低（`TeachingSessions.vue:541-548, 747`） |
| 缺总结 | **仅终态会话**缺总结。终态集合 = `completed / failed / timeout / discarded / finalization_failed`；非终态（initializing/active/paused/finalizing）缺失是正常过程态（`TeachingSessions.vue:399-404, 744-758`） |
| 有建议 | 加载窗口内含可读建议（`hasAdvisory`，`shouldSuggest !== false` 且 priority 非 none/空）的会话数（`TeachingSessions.vue:534, 744`） |
| 状态分布（贴表条） | 四组 + 「其它」：进行中 = initializing/active/paused/finalizing；已完成 = completed；异常终态 = failed/finalization_failed/timeout；已废弃 = discarded/superseded。副标含「完结率 = completed / 窗口行数」（**窗口口径，非后端全量**）（`TeachingSessions.vue:648-668`） |
| pills「进行中」 | 单状态 `status=active`；与分布条「进行中」四状态合并档口径不同，两者互为唯一来源（`TeachingSessions.vue:605-618`） |
| 异常堆积 | 失败 + 收尾失败 + 超时合计 ≥ **10** 时「异常」chip 转红（阈值写进 title）（`TeachingSessions.vue:781-782`） |
| 互动列 | 时长 + 消息数 + 知识点；时长 ≥ **1500 秒（25 分钟）** 标红为挂机嫌疑；< 60 秒弱化（`TeachingSessions.vue:242-249, 833-842`） |
| 窗口 | `limit: 1000`；后端返回 total 且超过窗口时提示「后端共 N 条，仅显示最近 1000 条」（`TeachingSessions.vue:397, 413, 454-461`） |

**常见操作**
1. 盯异常：点分布条「异常终态」段，或点转红的「异常」chip（可与其它筛选叠加）；行状态徽章红 = 失败/超时/已废弃等（`TeachingSessions.vue:105-113, 684-714, 819-825`）。
2. 找缺总结：点「缺总结」chip，只数终态缺失（`TeachingSessions.vue:600-618, 745-758`）。
3. 找有建议：点「有建议」chip → 服务端过滤 `onlyWithAdvisory`（`TeachingSessions.vue:96-104, 443-452`）。
4. 精筛：卡头右侧「高级筛选」→ 状态下拉（10 档枚举）/ 开始时间（近 7 天 / 近 30 天）；搜索主题/用户/邮箱/ID（`TeachingSessions.vue:124-153, 619-631`）。
5. 下钻：行「链路」→ 执行日志 Trace；「详情」/行点击 → 会话座舱（真实会话只读监控 `session-real`）（`TeachingSessions.vue:289-296, 813-814`）。

**空态 / 错误态**
- 加载失败显示错误条 + 重试；轮询失败保留旧数据不闪空态（`TeachingSessions.vue:158-161, 415-441`）。
- 深链 `?session=<id>` 未命中时提示「可能不在最近 1000 条内或已删除」（`TeachingSessions.vue:50-53, 786-807`）。
- `?session=` 命中后清参避免与座舱返回冲突（`TeachingSessions.vue:788-801`）。

**异常信号 → 下一步**
- 异常终态堆积（≥10 转红）→ 执行日志按该会话 `sessionId` 查全部调用（含失败）。
- 大量终态缺总结 → 课后总结链路问题，去执行日志按节点 `session-wrapup` + 失败态查该会话链路（`health-center.service.ts:463-657` 的 13 项 buildItem 清单里**没有**课后总结/`session-wrapup` 检查项，健康中心查不到此项）。
- 高关注会话 → 座舱看链路，或学习者详情看证据。

**联动**：自动 20s 轮询；`intent` 深链跳执行日志按 sessionId 归组；`useSessionDrill` 三跳转（学习者/链路/座舱，`useSessionDrill.ts:24-40`）。

---

### 2.5 目标对话（`/admin/goal-conversations`，`GoalConversations.vue`）

**这页回答**：谁在发起目标澄清、澄清到哪一步、路径是否生成、哪些对话停滞/被取消、要不要重建路径或删除会话。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 状态分布（贴表条） | **服务端全量** `stats/overview` 计数：进行中 = `active`；已完成 = `completed`；已取消 = `总数 − 进行中 − 已完成`（含用户取消 cancelled、失败 failed、无心跳回收 abandoned）。副标含「完结率」（`GoalConversations.vue:43-54, 295-299, 314-332`） |
| 点「已取消」筛选 | 取补集谓词：`status !== 'active' && status !== 'completed'`（与段计数同口径，点进去对得上）（`GoalConversations.vue:418-425`） |
| 停滞信号 | 加载窗口内 `status=active` 且 `updatedAt` 超过 **7 天**未更新；悬停「进行中」段时披露「其中 N 条超 7 天未更新（按加载窗口估算，非全量）」（`GoalConversations.vue:301-310, 314-323`） |
| 澄清进度 | 「N 轮」= 该会话 messages 中**学习者发言条数**（后端库内计数），无目标轮次分母，不造 meter（`GoalConversations.vue:163-168, 264-267`） |
| 阶段 | 四步过程点：创建 → 澄清 → 方案 → 完成；`stageIndex` 0 起（`statusText.ts:117-118`；`GoalConversations.vue:147-162`） |
| 窗口 | `limit: 1000`；`pagination.total` 大于窗口时提示截断（`GoalConversations.vue:363-367, 548-549`） |

**常见操作**
1. 找停滞：点分布条「进行中」段，看副标/悬停里的停滞条数，再按创建时间倒序看更新时间。
2. 找取消/失败：点「已取消」段。
3. 看路径：路径列「查看路径」→ 路径详情二级页 `?view=path&id=`（`GoalConversations.vue:177-182, 622-625`）。
4. 重建路径：行 ⋯ → 「重建路径」（`regeneratePath`，确认后覆盖当前路径；成功 toast 带路径名与版本）（`GoalConversations.vue:195, 627-647`）。
5. 删除会话：行 ⋯ → 「删除会话」（不可撤销，红色确认）（`GoalConversations.vue:196, 649-666`）。
6. 下钻：行「链路」/「详情」/行点击 → 执行日志 Trace / 会话座舱（`GoalConversations.vue:189-199, 611-613`）。

**空态 / 错误态**
- stats 拉取失败：顶部状态条「状态构成暂不可用」+ 重试，分布条隐藏，列表不受影响（`GoalConversations.vue:25-29, 582-601`）。
- 列表加载失败：行内错误 + 重试（不再伪装「暂无会话」）（`GoalConversations.vue:77-80, 568-577`）。
- `?goal=<id>` 未命中：toast「可能不在最近 1000 条内或已删除」（`GoalConversations.vue:369-401`）。

**异常信号 → 下一步**
- 「已取消」占比高 → 多半是无心跳回收（约 30 分钟无心跳自动 abandoned），可从故事行重新启动（`GoalConversations.vue:437-443`）。
- active 停滞多 → 学习者中断；去学习状态看该用户趋势/疲劳，或教学会话看后续是否继续。
- 路径未生成/失败 → 学习路径页筛选「生成失败」，进详情。

**联动**：重建路径写操作影响用户端可见路径；删除会话不可撤销；`includeTest` 共享口径。

---

### 2.6 学习路径（`/admin/learning-paths`，`OpsContent.vue` + `PathDetail.vue`）

**这页回答**：生成了多少路径、里程碑/任务规模、各状态占比、哪些生成失败、要不要下线/恢复/删除。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 路径总数 / 里程碑 / 任务 | 服务端 `stats`：`total` / `totalMilestones` / `totalTasks`；口径随页头「含测试」开关（`OpsContent.vue:13-23, 439-448`） |
| 状态分布（贴表条） | **服务端按状态 group-by 全平台计数**，非本页窗口：学习中(active) / 已完成(completed) / 生成失败(failed) / 已下线(archived) + 其它（枚举外聚合）（`OpsContent.vue:281-329`）。列表有 45s 页面级 TTL，统计每次进页重取（`live.ts:2099`） |
| 进度 | `completedMilestones / totalMilestones`，四舍五入百分；100% 绿、失败红、其余中性蓝（`OpsContent.vue:369-378`） |
| 难度 | 后端归一为 beginner/intermediate/advanced/unknown；存量约 35% 混入旧短词/自述整句，前端只认三档 + 少量别名，其余一律「未知」并把原文进悬停（`OpsContent.vue:379-404`） |
| 窗口 | 列表 `limit: 1000`，`pagination.total` 大时提示截断（`OpsContent.vue:420-428`） |

**常见操作**
1. 看失败：点分布条「生成失败」段，或从总览闭环「失败 N」跳入（自动预筛 failed，`OpsContent.vue:529-541`）。
2. 治理：行「下线 / 恢复」；⋯ → 「查看结构」（进详情）/「删除路径」（级联删除里程碑与子任务，不可撤销）（`OpsContent.vue:172-194, 450-516`）。
3. 进详情：点行 → 路径详情二级页 `?view=path&id=`（`OpsContent.vue:520-523`）。
4. 详情页动作：hero 可下线/恢复、刷新、查看学习者画像；主体为按阶段手风琴，点任务开任务详情弹层（`PathDetail.vue:8-121, 347-377`）。

**关键口径（路径详情）**
- 总体进度 = **已完成阶段 / 总阶段**；右侧「任务 X / Y」按子任务口径统计，两者分母不同（各带 title 说明）（`PathDetail.vue:29-38, 280-293`）。
- 当前阶段：优先「进行中」，否则第一个未完成；全完成给「全部阶段已完成」（`PathDetail.vue:296-310`）。
- 任务详情弹层只渲染接口真实返回字段（任务类型/预计用时/认知负荷/完成时间），原型有而接口没有的（验收点等）不硬造（`PathDetail.vue:87-121, 330-331`）。

**空态 / 错误态**
- 列表失败：错误条 + 重试（`OpsContent.vue:65-68`）。
- 详情失败：`MkEmptyState tone=error` + 重试；刷新失败保留旧数据只 toast（`PathDetail.vue:124-134, 256-260`）。
- 详情无阶段：提示「该路径尚未拆解出阶段」（`PathDetail.vue:41-46`）。

**异常信号 → 下一步**
- 「生成失败」段非零 → 进对应详情；失败通常需回目标对话页「重建路径」（后端无 admin 侧 replan 接口，详情页也不提供重规划，`PathDetail.vue:146-164`）。
- 「已下线」异常增长 → 审计日志看「下线路径」动作是谁在什么时候做的。
- 里程碑/任务数异常大 → 可能重复生成，核对目标对话与版本。

**联动**：目标对话「查看路径」→ 本页详情；学习者详情「学习路径」页签；总览闭环失败深链。

---

### 2.7 记忆与复习（`/admin/memory-review`，`MemoryReview.vue`）

**这页回答**：记忆层有多少痕迹、到期积压多少、谁的待复习最多、哪些概念同族重复待归并、需不需要人工归并/回滚。

**关键指标与口径**

| 指标 | 口径（代码） |
|---|---|
| 用户 | 全量「有记忆痕迹用户」数（后端统计，唯一在 KPI 出现）（`MemoryReview.vue:804-812, 971-980`） |
| 记忆痕迹 | 跨该用户全部 path 的痕迹总数（`MemoryReview.vue:813-816`） |
| 当前到期 | `totals.due`（到该复习而未复习条数）；副行「占痕迹 N%」。示警阈值：占痕迹 ≥ **20%** 或人均 ≥ **5** 条才转琥珀，阈值内是间隔复习常态积压（`MemoryReview.vue:602-619, 820-825`） |
| 需人工看 | `totals.ambiguous`（像但不确定的归并候选，不会自动执行）（`MemoryReview.vue:826-832`） |
| 待归并建议 | `totals.proposed`；副行「可自动 N · 已执行 N/N」（可自动 = 把握度 + 词面闸门都过；已执行/删除留快照可回滚）（`MemoryReview.vue:833-839`） |
| 列表 | 有痕迹用户，`limit: 50`，**按待复习（到期）量倒序**，暂无分页（`MemoryReview.vue:81-97, 976`） |
| 行内列 | 待复习（+占比条）/ 需人工看 / 薄弱项（强度 < 40% 条数）/ 平均记忆强度（FSRS 可提取率均值）/ 最近复习（`lastSeenAt` 最大值）（`MemoryReview.vue:99-160, 499-504`） |
| 到期时间轴（贴表条） | 六档：已逾期 / 今天 / 明天 / 2 天后 / 3 天后(3–4 天) / 5 天后(≥5 天)。窗口 = 最近 **200** 条痕迹（`extractionCount>0` 且 `dueAt` 非空），**非全量**；点某档只看该档有到期痕迹的学习者（`MemoryReview.vue:64-79, 621-738`） |
| 记忆强度分布 | 五桶 0–19 / 20–39 / 40–59 / 60–79 / 80–99%；只收有 `retrievability` 的条目，其余不进分母；默认收起（`MemoryReview.vue:39-62, 740-789`） |

**常见操作**
1. 看积压：读「当前到期」KPI 与到期时间轴；点「已逾期 / 今天」段定位最急的学习者。
2. 进明细：点行「明细」→ 页内明细态（`?userId=` 双向深链，可复制分享）（`MemoryReview.vue:155-158, 990-1017, 1038-1050`）。
3. 重新观察：行内或明细页头「重新观察」= 跑一次记忆复盘（只记录建议，不动 `memory_traces`）（`MemoryReview.vue:158, 186, 1055-1071`；`adminApi.ts:422-424`）。
4. 归并：明细「概念归并审计」——勾选建议（默认只勾「可自动」）→「执行选中（N）」会删除该用户重复记忆痕迹（**写操作**，留整行快照可回滚）；「需人工看」列表不会被执行，勾选执行前有二次确认（`MemoryReview.vue:312-450, 913-941`）。
5. 回滚：已执行归并列表「回滚」还原快照（写操作，红色确认）（`MemoryReview.vue:424-440, 943-965`）。
6. 进学习者：点行 → 学习者详情二级页（行点击跳详情，「明细」才进页内复盘）（`MemoryReview.vue:111-120`）。

**空态 / 错误态**
- 明细态失败有双层出口（页内红字 + toast），避免滚滚出视野无感知（`MemoryReview.vue:190-193`）。
- 无痕迹 → 「暂无记忆痕迹数据」；该学习者无痕迹时可从学习者详情「记忆与复习」页签看到空态「完成教学回合后自动生成」（`MemoryReview.vue:89-90`；`LearnerDetail.vue:750`）。
- 窗口拉取失败或队列为空 → 强度分布/到期轴整块隐藏，不留空卡（`MemoryReview.vue:48, 68, 791-792`）。

**异常信号 → 下一步**
- 「当前到期」持续超阈值 → 复习调度积压：看明细「课内温故计划」的负担预算/检索成功率（<70% 应收缩预算）（`MemoryReview.vue:851-875`）。
- 「需人工看」多 → 概念归并需人工核对；进明细逐条看 A/B 与理由。
- 「需回路径重学」> 0 → 连续没接上，去教学会话/学习路径看该概念所在课程。

**联动**：与学习状态「低置信」互补（记忆层 vs 快照层）；学习者详情「记忆与复习」页签复用同源接口。

---

### 2.8 健康中心（`/admin/health-center`，`HealthCenter.vue`）

**这页回答**：服务是否可用、配置与线上是否漂移、Skill 注册/生效是否对账、完成度分布如何、要不要一键修复。

**关键指标与口径**（概要四卡均为「需处理数」语义，0 = 好）

| 指标 | 口径（代码） |
|---|---|
| 检查异常 | 健康检查 `error` + `warn` 项数；`info` 是只读观测不计入（`HealthCenter.vue:57-66, 484-488`） |
| 漂移 | 卡标签 = `TERMS.driftContract`＝「漂移」（`HealthCenter.vue:68`；`terms.ts:18`）。值 = `drift.contract + drift.hash` 为需处理；`runtime` 只读遥测参考，不计入需处理（`HealthCenter.vue:67-75, 379-400`） |
| 对账异常 | `missingRegistration + zombieRegistration + missingActive + zombieActive + unwired`；`zombieSkillActive` 与健康检查「生效版本检查」同源，剔除避免重复计数（`HealthCenter.vue:76-84, 382-413`） |
| 完成度未达标 | `global.abnormalSkills`（未达 live 档的技能数）；副行「已上线 live/total · 共 N 个技能」，登记总数含外挂能力（`HealthCenter.vue:88-96, 376-393, 414-416`） |
| 服务卡 | 13 项检查按「基准真源」归域成卡（core.yaml / manifest / orchestration / skills.yaml / 双向对账 / db:managed / runtime），状态点取域内最高严重度（`HealthCenter.vue:116-139, 505-565`） |
| 告警事件流 | 只收 `error/warn` 检查项（口径同 KPI），全正常渲染一条「全部正常」（`HealthCenter.vue:159-199, 566-568`） |
| 刷新 | 60s 自动检测（`useSafePolling`）；`?refresh=1` 强制重算；`?check=<id>` 深链展开并滚动定位某检查行（`HealthCenter.vue:3-14, 596-612, 799-817`） |

**四个页签**（`?tab=`）：健康检查 / 漂移 / 对账 / 完成度，与概要 KPI 一一对应（`HealthCenter.vue:99-113, 439-454`）。

**常见操作**
1. 响应告警：概要卡转琥珀/红 → 点该卡切到对应页签；健康检查页签内异常项默认展开，点检查行展开明细（`HealthCenter.vue:53-113, 210-260`）。
2. 一键修复：仅 `action='fixable'` 项显示「修复」，共 **4 个 id**：`w4-corehash` / `field-routing` / `field-routing-contract`（契约漂移）/ `snapshots`（`backend/src/services/health-center.service.ts:463, 476, 489, 518`；`backend/src/routes/admin/health-center.ts:64`）；点前二次确认，执行前自动备份、结果写审计日志；成功进入「最近修复」卡（本次会话内存，刷新即清，权威在审计日志与后端备份目录）（`HealthCenter.vue:223-235, 144-157, 758-797`；`adminApi.ts:899-905`）。
3. 手动项：「查看 →」按检查项语义跳转：字段路由/契约类 → 编排图漂移页签；参数/契约/yaml 类 → Skill 工作台；其余留在本页展开定位（`HealthCenter.vue:726-743`）。
4. 漂移处理：契约漂移 → 编排图「去同步」；哈希漂移 → Skill 工作台「去发布」；运行时漂移只读，配置同步后不再新增（`HealthCenter.vue:284-302, 719-724`）。

**空态 / 错误态**
- 报告加载失败 → `MkEmptyState tone=error` + 重试（`HealthCenter.vue:17-28`）。
- 漂移无异常 → 页签常驻，显示 ok 空态「全部一致」而非隐藏整段（`HealthCenter.vue:266-273`）。
- 修复失败 → toast 带后端 `fixHint`（`HealthCenter.vue:791-796`）。

**异常信号 → 下一步**
- 任一 KPI > 0：点卡进对应页签；error 项优先。
- 对账缺项/僵尸 → Skill 与提示词页看该 Skill 状态，或健康检查页签展开对应行。
- 完成度未达 live → 完成度页签看分布，定位卡在 draft/handler-ready 的技能。

**联动**：总览状态条「健康」来自本页同一清单；编排图 KPI「哈希漂移」点击跳本页；健康中心「查看 →」跳编排图/工作台/执行日志。

---

### 2.9 其余页面速查表（路由 / 职责 / 关键口径）

| 页面 | 路由 | 职责 | 关键口径（代码） |
|---|---|---|---|
| 虚拟学习者 | `/admin/virtual-learners` | 合成画像运行/批量新建/回收 | KPI：完成率、失败率、并发、今日调用、速率（`VirtualLearners.vue:34-71`）。「活动会话」= 进行中 + 创建中（含卡死），全库口径。「回收卡死（N）」先干跑确认清单再把卡死会话批量标失败（写操作）（`VirtualLearners.vue:13-17, 624-637`） |
| 学习者卡库 | `/admin/virtual-learner-cards` | 角色卡导入/导出（账号+档案+故事池，不经编译链） | 卡库导出接口计数「当前自建卡 N 张」；YAML 卡片表单（`VirtualLearnerCards.vue:5-47`） |
| 编排图 | `/admin/orchestrator` | 顶层 Agent 数据流转/字段血缘/治理 | 页签：总览 / 字段旅程 / 字段路由 / 治理（`?tab=` 兼容）。KPI：阶段、Skill、阶段交接、未解析、哈希漂移（`Orchestrator.vue:15-33, 271-276`） |
| Skill 与提示词 | `/admin/skills` | Skill 运行/模型路由/Prompt 评估 | 页签：`run` / `model-routing` / `prompt-eval`；`?tab=` 与内层 `?peTab=`。KPI：Skill 数、live 数、成功率、平均耗时、空闲（`Skills.vue:20-50, 58-61, 370`） |
| 执行日志 | `/admin/execution-logs` | 日志 + Trace 链路排障 | 页签：日志 / Trace 链路。筛选：状态 pills(err/warn/ok)、测试、时间窗(15m/1h/today/yesterday/week/month/all)、节点(Skill)、关键词、Trace ID、sessionId、错误类别。URL 参数：`agent/status/cat/range/q/trace/session/test`（`ExecLogs.vue:18-30, 411-426, 816`） |
| 成本分析 | `/admin/token-cost` | Token 与成本透视 | 时间窗 7/30/90 天；KPI：调用成本、单次调用均值、总 Token、失败调用。按 Skill / 按用户（支持搜索，单次上限 100，可「查看全部」）/ 按模型排行；CSV 导出（`TokenCost.vue:43-119, 283-345, 418-434`） |
| 审计日志 | `/admin/audit-logs` | 管理操作 + 管理员登录审计 | 页签：操作审计 / 登录审计（`?tab=login`）。时间窗 today/yesterday/week/month/all；「失败 TOP」chip 下钻。登录审计行可跳「会话安全」（`AuditLogs.vue:405-409, 80-92, 250-253`） |
| 模型与接入 | `/admin/api-config` | 供应商/路由/安全/外挂 | 页签：接入与验证 / 模型路由 / 调用与健康 / 安全与访问 / 模型总览 / 外挂能力（`?tab=`）。KPI：API 密钥、模型清单、默认路由(x/3)、注册模型、漂移提示（`ApiConfig.vue:22-38, 660-667`） |
| 系统工具 | `/admin/ops-center` | 运维/导出/会话安全 | 页签：运维工具 / 数据导出 / 会话安全（`?tab=tools|export|security`）。运维工具含时间推进（不写库预览）与 outbox 死信重放（按事件类型整批，写操作）；数据导出范围多选 chips（导出为只读，不产生审计记录）（`OpsCenter.vue:16-21, 158-197, 387-401`） |
| 运营中心 | `/admin/ops-hub` | 运营待办/反馈/成就/公告/站内通知 | 页签：运营待办 / 反馈 / 成就 / 公告 / 站内通知（`?tab=`）；未访问页签计数显「待访问」而非 0（`OpsHub.vue:18-23`） |
| 学习者详情（二级页） | `?view=learner` 或 `?view=user` | 单学习者画像/证据/预测/路径/会话/记忆/操作记录 | 会话窗口「该学习者最近 20 条教学会话」；记忆页签空态「完成教学回合后自动生成」（`LearnerDetail.vue:672, 750, 873, 1083`） |
| 会话座舱（二级页） | `?view=session` / `session-real` | 虚拟会话控制台 / 真实会话只读监控 | 虚拟侧动作：自动驾驶启停、推进一步、自动推进、生成 Path、启动 Learn、重开本课、生成终局总结、评审/接受/按意见重规划、终止实验、按原输入重跑（`SessionCockpit.vue:104-148, 624-626`）。真实会话为只读监控（`TeachingSessions.vue:813-814`） |
| 虚拟学习者画像（二级页） | `?view=virtual` | 单虚拟人故事池/运行记录/会话控制 | 故事池可按样本类型生成/批量运行/批量启停/批量删除（写操作）；运行记录含正确率、教学闭环定位（`VirtualProfile.vue:89-95, 490-498`） |
| Skill 详情（二级页） | `?view=skill` | 单 Skill 契约/运行时/提示词/指标 | 页签制；Prompt 弹层**仅供查看与起草**，底部「前往设计页编辑 →」跳 `/admin/skills/<id>?tab=protocol` 设计页，草稿保存与发布在那里完成（`SkillDetail.vue:507, 523, 528, 1080-1083`） |
| Skill 工作台（隐藏） | `/admin/skill-workbench` | 核心文件清单/编译同步 | 「核心文件」「已同步」「待编译发布」「无 Prompt」计数（`PromptWorkbench.vue:10-13`） |

---

## 3. 运营 SOP 配方（step-by-step）

### SOP-1 新用户注册后，去哪确认「人进来了、开始学了」

1. 打开 `/admin/overview`，看「最近事件」是否有「新用户注册：<邮箱>」（`live.ts:1004-1006`）。⚠️ 默认过滤虚拟/测试账号。
2. 打开 `/admin/people`，搜索昵称/邮箱/ID，确认账号存在、角色、注册时间、路径/会话数（`Users.vue:45, 748`）。
3. 打开 `/admin/learner-state`，搜同一用户：有快照则看当前进度/趋势/疲劳/置信；无快照显示该用户尚未产生学习行为（`LearnerCenter.vue:71, 498-520`）。
4. 打开 `/admin/goal-conversations`，搜该用户：确认是否发起目标澄清、阶段与「N 轮」（`GoalConversations.vue:62, 515-527`）。
5. 若长时间无任何记录：检查是否被误判为测试账号（命名约定），或注册后未登录。

### SOP-2 某学习者「长期低置信」怎么排查

1. `/admin/learner-state` 搜索该用户，读置信列与风险摘要（`LearnerCenter.vue:155-167`）。低置信 = 有任务的快照中置信度 < 50%（`evidence.ts:11`）。
2. 点行「详情」进入学习者详情，看「证据」时间线：低置信且 `signal` 偏 struggle/incomplete 才是问题；domain 类证据（goal/path）不套学习成败语义（`evidence.ts:1-40`）。
3. 看该用户教学会话：`/admin/teaching-sessions` 搜索，找中断/超时/重复失败的会话（`TeachingSessions.vue:115, 696-718`）。
4. 若会话大量缺总结 → 去执行日志按 `sessionId` 查 `session-wrapup` 失败。
5. 若概念挣扎集中 → 从学习者详情页点「记忆与复习 →」（概览）或记忆痕迹行的「复习」按钮，深链到 `/admin/memory-review?userId=<id>`（**记忆与复习页没有搜索框**，只能这样进具体用户）（`LearnerDetail.vue:335, 719, 743, 1311-1314`）；在该页看薄弱项与「需回路径重学」（`MemoryReview.vue:99-105, 231-236`）。
6. 处置：必要时行内「干预」发站内提醒（`LearnerCenter.vue:355-374`）；数据疑似陈旧时单条「重算」快照。

### SOP-3 教学会话卡住 / 异常怎么处置

1. `/admin/teaching-sessions`，点「异常」chip 或分布条「异常终态」，看失败/超时/收尾失败会话（`TeachingSessions.vue:105-113, 648-665, 781-782`）。
2. 点会话「链路」进执行日志，按该 `sessionId` 看全链路失败点（`useSessionDrill.ts:30-33`）。
3. 点「详情」进座舱看会话当前页签与日志（真实会话只读）（`TeachingSessions.vue:289-296`）。
4. 若异常堆积 ≥10（chip 转红）→ 优先处理最新失败，判断是上游模型超时还是调用方中止（执行日志 `errorCategory`）。
5. 终态缺总结单独处理：点「缺总结」chip，进执行日志按节点 `session-wrapup` + 失败态查该会话链路（健康中心 13 项检查不含课后总结项，勿去那里找）。

### SOP-4 健康中心告警怎么响应

1. `/admin/health-center`，先读四张概要卡（0 = 好）。有异常时对应卡着色（`HealthCenter.vue:57-96`）。
2. 点异常卡切到对应页签：健康检查 / 漂移 / 对账 / 完成度（`HealthCenter.vue:427-429`）。
3. 健康检查页签：error 项排最前，点行展开明细；`fixable` 项点「修复」（自动备份 + 审计），`manual` 项点「查看 →」跳对应面板（`HealthCenter.vue:210-235, 726-743`）。
4. 漂移页签：契约漂移去编排图同步；哈希漂移去 Skill 工作台编译发布；运行时漂移只读、可忽略（`HealthCenter.vue:284-302, 719-724`）。
5. 修复后确认「最近修复」卡有备份目录与审计号（`HealthCenter.vue:144-157`）。
6. 若 KPI 仍 > 0：按页签明细逐项确认或把诊断信息（含检查 id）交研发；60s 后自动复检。

### SOP-5 记忆复习到期积压 / 归并怎么处理

1. `/admin/memory-review`，读「当前到期」与副行占比；≥20% 或人均 ≥5 才转警示（`MemoryReview.vue:602-619`）。
2. 点到期时间轴「已逾期 / 今天」段，筛出最急的学习者（`MemoryReview.vue:64-79, 710-738`）。
3. 点某行「明细」进复盘：先看「课内温故计划」的检索成功率与「需回路径重学」（`MemoryReview.vue:196-239, 851-875`）。
4. 看「同族重复」与「概念归并审计」：默认只勾「可自动执行」的建议；点「执行选中」前看清「需人工确认」警告（`MemoryReview.vue:286-450, 913-924`）。
5. 执行后如发现归并错误，用「已执行归并」列表「回滚」（写操作）（`MemoryReview.vue:943-965`）。
6. 不建议在未核对 A/B 前批量执行「需人工确认」项。

### SOP-6 路径生成失败怎么追

1. `/admin/overview` 教学闭环「路径规划」出现红色「失败 N」→ 点它跳学习路径并预筛 failed（`Overview.vue:114-133, 337-347`）。
2. `/admin/learning-paths`：看失败行，点「去详情」进路径详情（`OpsContent.vue:178-183`）。
3. 路径详情看状态与阶段；重规划需回目标对话：回 `/admin/goal-conversations` 搜该用户/会话，行 ⋯「重建路径」（`GoalConversations.vue:627-647`）。
4. 追根因：执行日志按该会话 `sessionId` 或 `goal-conversation`/`path-planning` 节点查失败（`ExecLogs.vue:90`）。

### SOP-7 成本异常怎么查

1. `/admin/token-cost`，选时间窗 7/30/90 天；读「调用成本 / 单次调用均值 / 总 Token / 失败调用」（`TokenCost.vue:43-119`）。
2. 看「按 Skill 成本明细」，定位消耗最高的 Skill（`TokenCost.vue:167-187`）。
3. 看「按用户排行」：搜索具体用户 ID/昵称/邮箱；点「查看全部」展开到上限 100（`TokenCost.vue:209-221, 297-345`）。
4. 看「按模型排行」核对模型分布；失败调用偏高时点失败 KPI 或去执行日志按 `status=err` 查。
5. 必要时「导出 CSV」（Skill 明细 / 用户排行 / 模型排行）（`TokenCost.vue:15-16, 418-434`）。

### SOP-8 虚拟学习者跑批卡死怎么回收

1. `/admin/virtual-learners`，看「回收卡死（N）」按钮与「卡死」列（`VirtualLearners.vue:13-17, 201-204`）。
2. 点「回收卡死」→ 干跑确认清单 → 确认后把超阈值无写入且无活跃租约的会话批量标记为失败（写操作）（`VirtualLearners.vue:13-14`）。
3. 或在画像页/批量条对指定实例清理卡死（`VirtualLearners.vue:328-337, 723-734`）。
4. 回收后在列表看失败率与失败数，必要时进画像页对失败会话重试（续传保留进度）。

---

## 4. 机器可读附录（YAML 速查表）

> 供 agent 直接解析。`route` 为深链地址；`subpage` 为二级页 `view` 取值；`filters` 为可用筛选参数（URL 或页面控件）；`actions` 为动作名（`destructive:true` 属破坏性，见 §5）。
> 参数来源：`store.ts:184-192`、`AdminConsole.vue:223-233`、各页面 `route.query` 与 API 封装。

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
  scope_param: includeTest   # true = 覆盖数据范围（含虚拟/测试）
legacy_alias:
  skill_param: "?skill=<id> -> ?view=skill&id=<id>"
data_scope:
  name: liveIncludeVirtual
  values: {false: 仅真实, true: 含测试}
  storage_key: wf_include_virtual
  pages: [people, learner-state, teaching-sessions, goal-conversations, learning-paths, memory-review]
  note: token-cost 的同类开关为独立窗口口径（tokenCostFilters.includeTest）
pages:
  - id: overview
    route: /admin/overview
    scene: overview
    purpose: 全站健康一屏（KPI + 教学闭环 + 待办 + 事件流）
    kpis: [今日调用, 今日成功率, 用户活跃, 进行中对话]
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
    kpis: [账号构成桶（真实/虚拟/测试）]
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
    kpis: [学习者, 需关注, 低置信, 平均置信度]
    dist_band:
      title: 置信度分布
      bins: ["< 25%", "25–49%", "50–74%", "75–89%", ">= 90%"]
      denominator: 有任务的快照 (task && confidence != null)
      click: filter table (toggle)
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
    kpis: [需关注, 缺总结, 有建议]
    dist_band:
      title: 会话状态分布
      groups:
        running: [initializing, active, paused, finalizing]
        completed: [completed]
        abnormal: [failed, finalization_failed, timeout]
        retired: [discarded, superseded]
        other: 枚举外
      scope: 已加载窗口（最近 1000 条），非后端全量
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
    kpis: [状态分布（服务端 group-by）]
    dist_band:
      title: 目标对话状态分布
      bins: [active, completed, cancelled]
      cancelled_predicate: "status != active && status != completed"
      scope: 服务端全量 stats
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
    kpis: [路径总数, 里程碑, 任务]
    dist_band:
      title: 路径状态分布
      bins: [active, completed, failed, archived, other]
      scope: 服务端 group-by 全平台
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
    kpis: [用户, 记忆痕迹, 当前到期, 需人工看, 待归并建议]
    thresholds: {due_warn_pct: 20, due_warn_per_user: 5}
    dist_band:
      title: 到期时间轴
      bins: [over(已逾期), today, tmrw, d2, d3(3-4天), d5(>=5天)]
      window_limit: 200
    list:
      limit: 50
      sort: due desc
      columns: [学习者, 待复习, 需人工看, 薄弱项, 平均记忆强度, 最近复习, 操作]
    detail_query: "?userId=<id>"
    actions:
      - {name: openDetail, write: false}
      - {name: recompute, write: true, api: "POST /admin/memory-review/:userId/recompute", effect: observe-only}
      - {name: applySelected, destructive: true, api: "POST /admin/memory-review/:userId/apply", reversible: true}
      - {name: rollbackOne, destructive: true, api: "POST /admin/memory-review/:userId/rollback", reversible: true}
  - id: health-center
    route: /admin/health-center
    scene: health-center
    purpose: 服务可用性/漂移/对账/完成度
    kpis: [检查异常, 漂移, 对账异常, 完成度未达标]
    tabs: [health, drift, recon, completion]
    deep_links: {force: "?refresh=1", check: "?check=<itemId>"}
    refresh: {interval_ms: 60000}
    actions:
      - {name: fix, write: true, api: "POST /admin/health-center/fix", fixable: [w4-corehash, field-routing, field-routing-contract, snapshots]}
      - {name: jump, targets: [orchestrator?tab=drift, skill-workbench, execution-logs]}
  - id: virtual-learners
    route: /admin/virtual-learners
    scene: virtual-learners
    purpose: 合成画像压测
    kpis: [完成率, 失败率, 并发, 今日调用, 速率]
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
    purpose: 编排/字段血缘/治理
    kpis: [阶段, Skill, 阶段交接, 未解析, 哈希漂移]
    panes: [overview, journey, routing, governance]
    deep_links: {compat_tab: "?tab=topology"}
  - id: skills
    route: /admin/skills
    scene: skills
    purpose: Skill 运行/模型路由/Prompt 评估
    kpis: [Skill, live, 成功率, 平均耗时, 空闲]
    tabs: [run, model-routing, prompt-eval]
    deep_links: {tab: "?tab=", pe_tab: "?peTab="}
    subpage: {view: skill}
  - id: execution-logs
    route: /admin/execution-logs
    scene: execution-logs
    purpose: 日志 + Trace 链路排障
    tabs: [logs, trace]
    filters:
      pills: [err, warn, ok, test]
      time_range: [15m, 1h, today, yesterday, week, month, all]
      selects: [agent(Skill), ]
      search: [keyword, traceId, sessionId]
      advanced: [sessionId]
      error_category: true
    url_params: [agent, status, cat, range, q, trace, session, test]
  - id: token-cost
    route: /admin/token-cost
    scene: token-cost
    purpose: Token 与成本
    kpis: [调用成本, 单次调用均值, 总 Token, 失败调用]
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
    purpose: 模型供应商/路由/安全/外挂
    kpis: [API 密钥, 模型清单, 默认路由, 注册模型, 漂移提示]
    tabs: [connection, routing, runtime, security, overview, addons]
    deep_link: {addons: "?tab=addons"}
  - id: ops-center
    route: /admin/ops-center
    scene: ops-center
    purpose: 运维/导出/会话安全
    tabs: [tools, export, security]
    actions:
      - {name: advanceTime, write: true, api: "POST /admin/devtools/advance-time", effect: preview-no-db-write}
      - {name: requeueOutboxDead, write: true, api: "POST /admin/devtools/outbox/requeue-dead", kind: by-event-type}
      - {name: export, destructive: false}
      - {name: revokeAdminSession, destructive: true, api: "DELETE /admin/sessions/:id"}
      - {name: revokeAllAdminSessions, destructive: true, api: "POST /admin/sessions/revoke-all"}
    export_ranges: [users, teaching-sessions, feedback, goal-conversations, agent-logs, audit-logs]
  - id: ops-hub
    route: /admin/ops-hub
    scene: ops-hub
    purpose: 运营待办/反馈/成就/公告/站内通知
    tabs: [todo, feedback, achievements, announce, inapp]
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
    actions: [openSubPage(learner), quickLearnOpen, editOpen, batchRunStories, batchAutopilotStories, batchRemoveStories, openSubPage(session)]
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
| 删除用户 / 批量删除用户 | 用户与学习者 行 ⋯ / 批量条 | 软删：账号无法登录，历史数据保留 | 可恢复（已删除列表「恢复」） |
| 删除路径 | 学习路径 行 ⋯ | 级联删除全部里程碑与子任务 | **不可撤销** |
| 下线路径 / 恢复路径 | 学习路径 行；路径详情 hero | 用户端不可继续 / 立即可见可学 | 可逆（互相切换） |
| 删除目标对话会话 | 目标对话 行 ⋯ | 删除该 Goal 会话 | **不可撤销**（页面明确标注） |
| 重建路径 | 目标对话 行 ⋯ | 重新生成并**覆盖当前路径** | 不可逆（旧版本被覆盖） |
| 执行概念归并 | 记忆与复习 明细 | 删除该用户重复记忆痕迹 | 留快照可回滚（页面内） |
| 回滚归并 | 记忆与复习 明细 | 还原合并前状态 | 已回滚不再重复回滚 |
| 回收卡死会话 | 虚拟学习者 页头「回收卡死」 | 把卡死会话标记为失败 | 不可逆（先干跑清单） |
| 强制下线管理员会话 / 批量吊销 | 系统工具 · 会话安全 | 被下线者立即失去后台访问 | 需重新登录；**不能下线自己当前会话**（后端 409） |
| outbox 死信重放 | 系统工具 · 运维工具 | 按事件类型**整批**重新入队处理 | 视事件而定 |
| 健康中心一键修复 | 健康中心 | 备份后改配置/编译产物/DB 对账 | 结果写审计日志；有备份目录 |
| 编辑并发布 Prompt / 保存运行时配置 | Skill 设计页（`/admin/skills/:id`；`SkillDetail` 二级页的 Prompt 弹层仅查看/起草） / 模型与接入 | 直接改线上生效的提示词或路由 | 需按既有发布链回滚 |

> 数据导出（系统工具 · 数据导出、用户批量 CSV）为**只读**操作，不产生审计记录、不含敏感字段（密码哈希、API Key）（`OpsCenter.vue:196-197`）。

### 5.2 确认分级

- **无确认（即时）**：所有筛选 / 排序 / 列显隐 / 搜索 / 翻页 / 展开收起 / 下钻 / 复制深链 / 导出 CSV / 刷新。
- **单次确认（普通）**：设为/降为管理员（降级标 danger）、恢复用户、恢复路径、重算快照、重新观察、重建路径（覆盖前提示）、健康中心修复（说明影响范围）。
- **红色确认（破坏性）**：删除类（用户/路径/会话/批量删除）、执行归并、回滚归并、下线路径、回收卡死、吊销会话。部分页面用 `busy` 态锁定提交中防误关（如新建用户弹窗，`Users.vue:481-485`）。

### 5.3 误触防范（本手册约束 agent 与人类共同遵守）

1. **禁止探针点击破坏性按钮**：审计/走查只做非破坏性交互（筛选、排序、展开、收起、下钻、列显隐、搜索、翻页、重试）；不点删除 / 下线 / 回收 / 清空 / 吊销类。
2. **写请求红线**：非处置任务不发 `POST / PUT / PATCH / DELETE`（含站内提醒、重算、修复、归并、导出提交）。本手册 §4 中 `write:true` / `destructive:true` 的动作仅在实际运营处置时使用。
3. **删除前确认三件事**：对象正确（用户/路径 ID 对得上）、影响面（级联/覆盖）、可逆性（是否可恢复）。
4. **不可逆优先降级**：路径治理优先「下线」而非「删除」；用户优先「删除（软删）」而非物理清除；归并先只勾「可自动」。
5. **批量操作先看干跑**：回收卡死、死信重放、批量删除/归并均有清单或范围提示，确认范围再执行。
6. **管理员自我保护**：不能删除/降级自己（`Users.vue:155-165, 304-314`）；不能吊销自己的当前会话（后端 409，`adminApi.ts:1970-1973`）。

---

*本手册为运营口径单源；页面改版后请按「三件套」门禁同步更新本文件与 `doc/README.md` 登记。*
