# Admin 视觉层设计语言（v3，2026-09-30）

> **v3 的来源**：`newui/UI-分支优化设计/index.html`（管理后台设计原型，单文件含全部 CSS 与 render 函数）。
> 2026-09-30 起以它为**设计语言源**，方法 =「读原型源码 → 逐类复刻 → 接真数据」（不靠截图比对）。
> 已按此法落地的页面：平台总览（0038b189）、教学会话 / 学习路径 / 目标对话 / 记忆复习（0e861d5c）、
> 壳层与原语规格（de510a98）、侧栏底部（d89734e7）。
> 配套文档：`doc/ADMIN_PAGE_TEMPLATES.md`（骨架与规则；现行视觉口径以本文 v3 为准）。
> v2（2026-09-25）把 v1 的数值升格为硬规则并完成 token 化——那层工作全部仍然有效；
> v3 改的是**规格取值与组件词汇**（下文逐条标注），不是推倒 v2 的守卫体系。

## 0. 一句话语言

**平的仪表台，原型即规格**：中性炭灰的面 + 1px 发丝线；蓝只许出现在"可交互/选中"上；
数字一律等宽；每页按原型的骨架节奏排——**页头 → KPI → 状态条 →（本页招牌块）→ 行卡**；
眯起眼看只剩灰阶、一团蓝和几段语义色——就是对的。

**交互蓝归一（2026-10-02，18f09fd3，依据 `WenFlow-Design-System` 设计体系包）**：
Admin 与用户侧统一 `--mk-blue = #2f6ae0`（暗色 `#5b8def` 不变）；hover/pressed 统一
`#1f57cc`（= `--mk-accent-deep`/`--mk-ghost-fg`/`--mk-rec-core` 同档）。旧 Admin 蓝
`#2c63d0` 与 main 分支遗留蓝 `#3478f6` 已全仓清除（字面量 + rgba 派生 + 死兜底）。
圆角阶梯维持含 10 的现行档（体系包建议砍 10，暂留档，待下次大视觉批次）。

## 0.5 硬规则（逐条可判，违反即打回）

### 圆角：4 档 + 特例（v3 修订：按钮/输入升到 8px）

| 档 | token | 值 | 用在 |
|---|---|---|---|
| 内芯 | `--mk-radius-xs` | 4px | 徽章直角变体、代码块、行内小 tag、图例色块（原型 sbl__sw 3px 的复刻取 4） |
| 控件 | `--mk-radius-md` | 8px | **按钮、输入、下拉、菜单项、搜索框**（v3 起按钮从 6 升 8，与输入框同档——原型 .btn = --r-md；v2 的"控件 6px"规则就此修订） |
| 面板 | `--mk-radius-xl` | 12px | 卡片、状态条、KPI 瓦片、空态图标底、菜单弹层 |
| 弹层 | `--mk-radius-modal` | 16px | 模态、抽屉、输入条（goal composer 16px） |
| 特例 | pill / 50% | 999px / 50% | 真·胶囊、头像、stageband、迷你进度条 |
| 特例 | 4K tier | ×1.15/×1.4 | 仅 `@media` 档位块内允许缩放值 |

禁止 5/7/9/10/13/22/26px 等中间档。`--mk-radius-sm(6)` 降级为"行内小芯片"档
（行内 ⋯、小 tag）；`--mk-radius-lg(10)` 保留给原型里 r-lg 的复刻件（loop__step/bucket）。

### 阴影：只有三档，面永远是平的

| 档 | token | 用在 |
|---|---|---|
| 平 | 无 | 卡片、状态条、KPI、表格（1px 发丝线就是全部质感） |
| 悬浮 | `--mk-shadow-sm` | 吸顶表头、粘性工具条 |
| 弹层 | `--mk-shadow-pop` / `--mk-shadow-modal` | 菜单、模态、抽屉、toast、登录壳 |

- 禁止彩色光晕与 hover 抬升——悬停只允许变背景/边框/文字色（v3 总览复刻已把
  hover 位移全部撤除，`:active` 只允许 `scale(0.98)` 类按压反馈）。
- **v3 修订**：选中/激活态不再用 `inset 0 0 0 1px` 单描边——描边胶囊（.mk-pill）
  的激活 = 浅蓝底 + 主色字 + 主色调边框（color-mix 44%）；分段控件灰底轨道语言**退役**
  （原型无分段轨道；切换控件一律描边胶囊或下划线页签，`.mk-seg` 仅存于遗留页不再新用）。

### 焦点环：全站一圈

`--mk-focus-ring`（亮 `rgba(44,99,208,.18)` / 暗 `rgba(91,141,239,.32)`），
输入族 = 蓝边 + ring；按钮族 = 纯 ring。禁止自写第二圈。
已登记例外：运行态脉冲动画（RunStateBadge / RunStageBar / VirtualLearnerRunningBar）。

### 控件高度

| 档 | 值 | 用在 |
|---|---|---|
| sm | 28 | 表格行内按钮（`.mk-btn--sm`）、图例小按钮 |
| md | 34 | 工具栏/页头默认按钮（`.mk-btn`，v3 对齐原型 .btn 的 34px）、筛选输入/下拉 |
| lg | 36-40 | 页头主操作、登录主按钮（原型 login 40） |

（v2 的 28/32/36 三档中，md 实测已落在 34-35px——本条是把既成事实写进规则。）

### 色彩角色

中性炭灰做面；**蓝 = 交互**（链接、选中、主按钮、焦点、分布条的"正常/进行中"段）；
**绿/琥珀/红 = 语义**（徽章、状态点、趋势 ▲▼、分布条的"完成/到期/失败"段），禁止当装饰。
页面 scoped 的私写色按 `design:check` 棘轮只降不升（2026-09-30 存量 **464**，v2 收官时 649）。

### 数字

数据数字一律 `font-variant-numeric: tabular-nums`；标识符/耗时/字节数用 `--mk-mono`。
图表色唯一来源：`components/mk/chartPalette.ts`（echarts 图）；原型的轻量图
（barchart/stageband/meter）用 DOM 复刻，柱与段色走语义 token。

## 1. 层级（Typography hierarchy）

文本仍只有**三个角色 token**（micro 12 / body 14 / emphasis 15，档位覆写见 main.css）。
v3 修订两条：

1. **卡片标题升到 emphasis 档**：`mk-card__title` 15/700 墨色（v2 时是 body 14/700；
   原型 .card__title = --fs-emp）。页头与 hero 标题用**展示档 24px**（原型 --fs-24，
   `MkPageHead` / `MkDetailHero` 已落），KPI 数值 28px/700——两者都是展示型字号，不占文本档。
2. **卡头规格**：`mk-card__head` padding **12×16**（v2 的 11×16 修订）、gap 8；
   `mk-card__sub/meta` 12px faint。

同一视口内 ≤3 个文本档；档位块只覆写三个角色 token（design:check 规则 13 硬失败）。

## 2. 节奏（Spacing rhythm）

| 项 | 值 | 备注 |
|---|---|---|
| `.mk-page` 内边距 | **20 / 20 / 48** | v3 对齐原型 .view；左右 20 与顶栏 20 成同一条竖线；底部 48 是滚动呼吸位 |
| `.mk-page--fill` 底部 | 20 | fill 页不随页面滚动，48 会白扣表格可视高度 |
| 卡间距 | 16 | 不变 |
| `.mk-card__head` | **12×16** | 见上 |
| `.mk-status` | 9×14 / min-h 48 | 不变（与原型 .statusbar 同款） |
| `.mk-table` th/td | **10×16** | v3 对齐原型 .tbl；表头与单元格左右必须同档 |

**页面骨架节奏（v3 新增，每页按此排）**：
列表页 = 页头 → KPI → 状态条 →（本页招牌块：分布条/桶组）→ 主表卡（toolbar+table+pager）。
总览 = 页头 → KPI → 状态条 → 教学闭环 → Row A（图 1.6fr + 事件 1fr）→ Row B 三小卡（auto-fit 280）。

## 3. 透气（Density）

- comfortable 档：总览类页面**一张大图 + 少量小卡**，不做四张同构趋势图并排
  （2026-09-30 总览重排实证：四图并排是"节奏不对"的主因）。
- 表格行高不低于 40px；compact 档不变。
- 新页面禁止把 KPI、筛选、表格塞进同一张卡。

## 4. 质感（Material）

- 卡片 0 阴影 + 1px line + radius 12；不加渐变/玻璃。原型唯一渐变=登录 aside 品牌底
  与 barchart 柱体（蓝→62% 混面），均已 token/color-mix 表达。
- 暗色：中性炭灰阶梯 bg(#141415) < 侧栏(#1b1c1f) < surface(#202124) < 表头条带(#282a2e)；
  台阶 ≥6 个 sRGB 级。KPI 卡与普通卡同面（v3 起，白面/暗面一致，不再用蓝灰底区分）。
- 禁止：页面私写色值、透明度叠透明度、radius 混用相邻两档。

## 5. 守卫与演进（v3 增补复刻方法）

- `npm run design:check`：hex/死类/圆角/阴影/字号棘轮，只降不升。
- 视觉层改动只允许发生在 token / 原语层；页面 scoped 只允许布局与**原型复刻件**。
- **复刻方法（v3 钉死）**：对齐原型 = 读 `newui/**/index.html` 的 render 函数与 CSS，
  逐类移植（类名保留原型名、非 mk- 前缀、页面 scoped），数据接真实接口；
  **不做截图目测比对**。移植时对照 §9 偏离清单，不照搬原型的假数据/假按钮。
- 数值迭代：改共享层 → 真机对比 → 全站生效；永不逐页追。

## 6. 组件词汇表（原型类 ↔ admin 承载，v3 新增）

| 原型类 | admin 承载 | 层 |
|---|---|---|
| `pageTitle` | `MkPageHead`（h1 24 + sub 12 + actions 右） | 原语组件 |
| `.statusbar` | `.mk-status`（点色/粗体标题/meta/sep/右端动作，min-h 48） | 原语 |
| `.btn / .btn--sm` | `.mk-btn / .mk-btn--sm` | 原语 |
| `.card/.card__head/.card__title/.card__sub/.card__tools/.card__body` | `.mk-card` 族（title 15/700） | 原语 |
| `.grid + .card > .kpi` | `MkKpi`（白面、数值 28/700、foot 可带 ▲▼ 趋势）+ `.mk-kpi-grid` | 原语组件 |
| `.tabs / .subtabs` | `MkSubTabs`（下划线式，9×12） | 原语组件 |
| `.chips / .chip` | `.mk-pills / .mk-pill`（描边胶囊；激活=蓝底蓝字蓝调边） | 原语 |
| `.tbl` | `.mk-table`（10×16；fixed 档列宽走 `--mk-col-*`） | 原语 |
| `.pager` | `Pagination.vue` | 原语组件 |
| `.empty` | `MkEmptyState` | 原语组件 |
| `.drawer/.modal/.ovl` | `.mk-drawer/.mk-modal` | 原语 |
| `.field/.input/.select` | `.mk-filter__input/.mk-filter__select`、`.mk-field` | 原语 |
| `.stageband/.stageband__legend/.sbl` | 页面本地复刻（TeachingSessions / OpsContent / MemoryReview） | 页面 |
| `.buckets/.bucket` | 页面本地复刻（GoalConversations） | 页面 |
| `.loop` | 页面本地复刻（Overview 教学闭环） | 页面 |
| `.barchart` | 页面本地复刻（Overview 近 7 天活跃）；echarts 重图仍走 MkChart | 页面 |
| `.feed/.feedrow` | 页面本地复刻（Overview 最近事件；健康中心告警流） | 页面 |
| `.ranklist/.rankrow`、`.meterrow/.meter` | 页面本地复刻（Overview Row B） | 页面 |
| `.hero` | `MkDetailHero`（24px 标题） | 原语组件 |
| `.statstrip`（L2 详情页 hero 下的一行分格读数） | LearnerDetail 页面本地复刻（四格：进度/阶段/任务/最近会话） | 页面 |
| L2 详情骨架（hero + statstrip + subtabs） | UserDetail / LearnerDetail 已按此骨架（318da349 起） | 页面 |
| `.login*` | `Login.vue` 页面复刻（分栏品牌 aside + 表单 panel） | 页面 |
| `odg-*` | `DataFlowGraph`（orch-odg-*） | 页面 |

分布条/桶组/事件流的色彩语义（全站统一）：蓝=进行中/正常，绿=已完成/正常收尾，
琥珀=到期/需关注/超时，红=失败/异常，faint=已废弃/已下线/其它。

## 7. 壳层（v3 新增条目）

- 侧栏 **244px**（原型 --nav-w；≥1440 起各档 +36 供 4K zoom 补偿），扁平导航：
  分组标签大写字距 0.12em、子项不缩进、裸 17px 线性图标（无芯片底）、
  选中 = 整行 `--mk-blue-bg` 胶囊 + 主色字 600（无左条、无内缩）。
- 侧栏底部 = **唯一一行「收起导航」**（图标+文字，nav__item 同款）；品牌行删除。
- 刷新/术语/密度/主题四钮在**顶栏右侧**（34px 图标钮）；顶栏 56px 毛玻璃、左右 20px。
- 侧栏与顶栏的硬编码色已 token 化（--mk-side-* 六 token）。

## 8. 洼地与批次状态（v3 更新）

| 批次 | 对象 | 状态 |
|---|---|---|
| v2 §6 全部条目 | SessionCockpit/VirtualProfile/LearnerDetail/KPI/Login/Overview/Shell/图表 | ✅ 维持 |
| 09-30 #1 | 壳层+原语规格（de510a98） | ✅ 按钮 8px/600、卡题 15、KPI 白面 28、表格 10×16、胶囊描边化、页 20/20/48 |
| 09-30 #2 | 侧栏底部 + pinned 选中色修复（d89734e7） | ✅ |
| 09-30 #3-5 | 总览三连（d2319116/9f42050f/0038b189） | ✅ 状态条+闭环条+源码级复刻；brief-* 卡语言退役 |
| 09-30 #6 | 四教学页分布条/桶组（0e861d5c） | ✅ stageband/buckets 三态色语义全站统一 |
| 10-01 | 健康中心 service 卡+事件流、登录页分栏复刻 | 进行中（本批次） |

当前全站私写 hex 存量 **464**（基线棘轮已同步；v2 收官 649 → 09-29 505 → 09-30 464）。

## 9. 与原型的已登记偏离（复刻时不照搬的部分）

1. **微字号下限 12px**：原型 11px（图例帽/柱值/时间列）一律用 `--mk-fs-micro`（12px）——
   本仓辅助文字下限 12px，且规则 16 棘轮禁止新增 <12px。
2. **按钮字号 14px**：原型 .btn 与 .btn--sm 同为 12px（字号不承载层级，高度才是）；
   我们保留 14/12 两级，密集管理台里 12px 中文按钮标签偏小。
3. **侧栏宽度档位**：原型恒 244px；我们 244 基档 + 各断点 +36（4K zoom 补偿，沿 v2 档位体系）。
4. **总览第三张小卡**：原型「学习状态分布」→ 我们「模型与失败」（后端暂无学习状态聚合口径），
   meterrow 视觉同构、数据真实。
5. **登录 aside 的「当前来源 IP」**：原型硬编码假信息，禁止照搬；三条安全要点写真实机制。
6. **假动作按钮**：原型「手动生成路径」等无真实流程的按钮不上页面；每个按钮必须接真实行为。
7. **KPI 趋势 foot 暂缓**：原型四卡全带 ▲▼；曾用「今日 vs 昨日全日」实现过，
   2026-10-01 凌晨实测 ▼-97%/▼-100%——自然日的部分窗口与全日直接相比必然失真，
   已下线。等后端提供「昨日同时刻」同期窗口再恢复。
8. **L2/L3 详情页的模板分工**（2026-10-01 勘察）：
   - UserDetail / LearnerDetail = 标准 L2（MkDetailHero + 状态条/MkKpi + MkSubTabs），已对齐；
   - VirtualProfile 头部**有意**只留身份信息（2026-09-27 决策「数量即 tab 角标，不单设 KPI 行」），
     不加 statstrip——复刻时不要替它补；
   - SessionCockpit 是 **T3 驾驶舱自有模板**（cp-topbar + RunStageBar 已覆盖原型
     session-detail 的 hero/stepper 职责，且多出日志/瀑布/自动驾控等监控面），
     不按 L2 详情改造；
   - SkillDesignPage 是**编辑工作台**（sdp-head + mk-pills 页签），原型 skill-detail
     是只读视图——工作台不降级成只读页。

## 10. 内容宽度（v3 更新数值）

| 形态 | 宽度 | 实现 |
|---|---|---|
| 表格列表 / 观测台 | 通栏 | 不加限宽 |
| 表单 / 设置 | 限宽 1200px 居中 | `.mk-card--narrow` / `.mk-narrow` |
| 弹窗 / 抽屉 | 档位放大 | `--mk-modal-w-*` / `--mk-drawer-w-*` |

实测（1440 视口）：1440 − 侧栏 260（≥1440 档）− 页面左右 20×2 = **卡宽 1140px**。
侧栏基档 244（<1440），≥1440 为 260、≥1920 为 276（档位见 Shell.vue）。
