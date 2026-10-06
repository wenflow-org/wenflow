# Admin 视觉层设计语言（v4，2026-10-02）

> 📌 类型：活规范（⛔ 禁归档，守卫硬引用）｜最后核验：2026-10-03
>
> **2026-10-03 台账对账**：规则层（§0–§7.5）逐条与代码复核，全部一致，未改；只更新了
> 落地台账类条目——§2 总览骨架（Row B 两卡）、§6 组件词汇表（`.stageband` 升共享原语、
> `.barchart` 退役→`OvBars`、`.tabs` 下划线页签、`.statstrip` 五页、`meterrow` 归属）、
> §8 hex 存量 464→218 并补 10-03 四批、§9.4（两卡）与 §9.7（趋势已恢复）。
> 本次复核未动的登记项：§7.5.2/§7.5.7 的暗色红口径自相矛盾（见 §7.5.2 待体系包补档）。
>
> **v4 相对 v3 的变更**：接入 `WenFlow-Design-System` 设计体系包，把设计语言
> 收敛为一套「友好而平」（Warm-Flat）。数值全部来自 `develop` 实测，非新增发明。
> 已落地：`frontend/src/styles/tokens.css`（`--wf-*` 唯一令牌层）。
> v4 关闭了 v3 §0 遗留的「圆角暂留 10px」声明（§0.5），退役了 v3 §7 明文写下的
> 「顶栏毛玻璃」（§7），并新增 §7.5 把跨端规则与令牌层治理补上——
> v3 及以前本文只管 Admin，而全部视觉漂移都在它管不到的守卫盲区里。
> 批次台账见 §8，文档索引见 `doc/README.md`。

> **v3 的来源**：`newui/UI-分支优化设计/index.html`（管理后台设计原型，单文件含全部 CSS 与 render 函数）。
> 2026-09-30 起以它为**设计语言源**，方法 =「读原型源码 → 逐类复刻 → 接真数据」（不靠截图比对）。
> 已按此法落地的页面：平台总览（0038b189）、教学会话 / 学习路径 / 目标对话 / 记忆复习（0e861d5c）、
> 壳层与原语规格（de510a98）、侧栏底部（d89734e7）。
> 配套文档：`doc/NEWUI-PROTOTYPES.md`（双原型登记 + 原型值残留规则）。
> ~~`doc/ADMIN_PAGE_TEMPLATES.md`（v1 模板规范）已存档（2026-10-02）——骨架节奏与组件词汇由本文承接。~~
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

**令牌层归一（2026-10-02，批次 A/B/C，依据体系包）**：新建
`frontend/src/styles/tokens.css` 作为 `--wf-*` 唯一事实源；`--mk-*`、
`--color-*`、`--neutral-*`、`--radius-*`、`--shadow-*` 全部降为指向 `--wf-*`
的**别名**——别名不是第二套语言，只是历史调用名的转接。改设计值只改一处。

**圆角阶梯收口（2026-10-02，批次 C）**：上文 v3 的「圆角维持含 10、暂留档」声明
在此**关闭**——那个「下次大视觉批次」就是本批。阶梯现已唯一为
**4 / 6 / 8 / 12 / 16 / 999**（内芯 / 芯片 / 控件 / 面板 / 卡片·弹层 / 胶囊）。
`--mk-radius-lg` 10→12、`--mk-radius-xl` 12→16；同时删掉 `admin-surface.css`
对 `--radius-md` 的越权覆盖（12px→回落 8px），用户侧与 Admin 侧控件圆角首次统一。
**全站卡片圆角 +4px**，属有意的观感变更。

## 0.5 硬规则（逐条可判，违反即打回）

### 圆角：唯一阶梯 6 档（v4 收口：砍 10、卡片抬 16）

| 档 | token | 值 | 用在 |
|---|---|---|---|
| 内芯 | `--mk-radius-xs` | 4px | 徽章直角变体、代码块、行内小 tag、图例色块（原型 sbl__sw 3px 的复刻取 4） |
| 芯片 | `--mk-radius-sm` | 6px | 行内小芯片（行内 ⋯、小 tag） |
| 控件 | `--mk-radius-md` | 8px | **按钮、输入、下拉、菜单项、搜索框** |
| 面板 | `--mk-radius-lg` | 12px | 次级面板、原型里 r-lg 的复刻件（loop__step/bucket） |
| 卡片·弹层 | `--mk-radius-xl` | 16px | **卡片**、状态条、KPI 瓦片、空态图标底、菜单弹层、模态、抽屉 |
| 胶囊 | `--mk-radius-pill` | 999px | 真·胶囊、头像、stageband、迷你进度条（圆形元素可用 50%） |
| 特例 | 4K tier | ×1.15/×1.4 | 仅 `@media` 档位块内允许缩放值 |

**禁止 5/7/9/10/11/13/14/18/20/22/26px 等一切中间档**——v4 已删除 `--mk-radius-lg(10)`
这一档。历史上「10 保留给复刻件」的例外随该档一起取消；复刻件改用 12px。

守卫 `scripts/check-design-system.mjs` 的 `RADIUS_OK` 白名单已同步为
`0 / 4 / 6 / 8 / 12 / 16 / 999 / 50%`（v3 漏了 8px，导致写 `8px` 反被报错，
v4 修正）。

### 阴影：只有三档，面永远是平的

| 档 | token | 值 | 用在 |
|---|---|---|---|
| 平 | `--wf-shadow-xs` | `none` | **卡片、状态条、KPI、表格**（1px 发丝线就是全部质感） |
| 悬浮 | `--mk-shadow-sm` | `0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)` | 吸顶表头、粘性工具条 |
| 浮层 | `--mk-shadow-pop` | `0 16px 40px rgba(15,23,42,.16)` | 菜单、弹层、粘性悬浮控件 |
| 模态 | `--mk-shadow-modal` | `0 24px 64px rgba(15,23,42,.22)` | 模态、抽屉、toast、登录壳 |

- **v4 收口**：v3 实际存在**四档**（多一条 `--mk-shadow-drawer = -16px 0 48px rgba(15,23,42,.18)`），
  且 `--shadow-md/-lg/-xl` 映射混乱（md 与 lg 同指 pop）。现在：drawer 并入 pop
  （两者语义都是「弹层」，X 方向偏移是规范外的第四档），md 降为悬浮档。
  `--shadow-xs` 从「指向 sm」改为 `none`——规范语义是「面永远是平的」。
- 禁止彩色光晕与 hover 抬升——悬停只允许变背景/边框/文字色（v3 总览复刻已把
  hover 位移全部撤除，`:active` 只允许 `scale(0.98)` 类按压反馈）。
  **v4 实测发现三处漏网**并已清除：`.mk-kpi--clickable`（MkKpi.vue）、`.ld-related__item`
  （LearnerDetail.vue）、`.metric-card`（learning-components.css）仍在 hover 时 `translateY`；
  前两处的位移已换成 `:active { scale(0.98) }`。
- **v3 修订**：选中/激活态不再用 `inset 0 0 0 1px` 单描边——描边胶囊（.mk-pill）
  的激活 = 浅蓝底 + 主色字 + 主色调边框（color-mix 44%）；分段控件灰底轨道语言**退役**
  （原型无分段轨道；切换控件一律描边胶囊或下划线页签，`.mk-seg` 仅存于遗留页不再新用）。

### 焦点环：全站一圈

`--mk-focus-ring` = `0 0 0 3px` + 亮 `rgba(47,106,224,.18)` / 暗 `rgba(91,141,239,.32)`，
输入族 = 蓝边 + ring；按钮族 = 纯 ring。禁止自写第二圈。

> **v4 更正**：v3 此处写的亮色值是 `rgba(44,99,208,.18)` —— 那是旧 Admin 蓝
> `#2c63d0`，与 §0「旧蓝已全仓清除」的声明矛盾（文档漏改）。代码里的实际值一直是
> `rgba(47,106,224,.18)`（`#2f6ae0` @18%），v4 把文档对齐到代码。
>
> 另注：体系包 `--wf-focus-ring` 是**纯颜色**令牌（亮 20% / 暗 32%），
> 本仓这枚是**合成环**（3px 宽度 + 亮 18% / 暗 32%），形状不同故未合并。
> 亮色 18% vs 规范 20% 的差异尚在体系包侧待确认，暂按实测值保留。
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

文本仍只有**三个角色 token**（micro 12 / body 14 / emphasis 15；档位覆写在 `styles/mk-primitives.css` 的 `:root` —— 1440 档 12.5/14.5/15.5、1920 档 13/15/16，**不在 main.css**）。
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
| `.mk-table` th/td | **10×16**（≥1600）；**≤1599 中宽档 padding-inline 12** | v3 对齐原型 .tbl；表头与单元格左右必须同档。中宽档收窄为各页 scoped 判例（Skills / VirtualLearners），密集表在 ≤1599 回收列宽 |

**页面骨架节奏（v3 新增，每页按此排）**：
列表页 = 页头 → KPI → 状态条 →（本页招牌块：分布条/桶组）→ 主表卡（toolbar+table+pager）。
总览 = 页头 → KPI → 状态条 → 教学闭环 → 动作带（Row B 两小卡：Skill 调用量 Top 5 + 待处理事项）→ 图 + 事件（Row A：图 1.6fr + 事件 1fr；原型第三卡「学习状态分布」不落，见 §9.4）。

## 3. 透气（Density）

- comfortable 档：总览类页面**一张大图 + 少量小卡**，不做四张同构趋势图并排
  （2026-09-30 总览重排实证：四图并排是"节奏不对"的主因）。
- 表格行高不低于 40px；compact 档不变。
  - **例外登记（2026-10-06 审核 #198）**：全局紧凑密度档（`html[data-density='compact']`，Shell 顶栏开关）
    下数据表行高实测 30.3px，低于本条的 40px。该档是用户主动选择的密度档，其目的就是「一屏多看几行」，
    把它抬回 40px 等于取消该功能。故登记为例外：**仅** `[data-density='compact']` 生效时允许表格行高低于 40px；
    默认档（comfortable）仍必须 ≥40px。
- 新页面禁止把 KPI、筛选、表格塞进同一张卡。

## 4. 质感（Material）

- 卡片 0 阴影 + 1px line + **radius 16**（v4：随 §0.5 圆角收口由 12 抬到 16）；
  不加渐变/玻璃。原型唯一渐变=登录 aside 品牌底与 barchart 柱体（蓝→62% 混面），
  均已 token/color-mix 表达。
- **材质一律平面**：不使用亚克力 / 毛玻璃浮层。v4 已把 v3 §7 明文写下的
  「顶栏 56px 毛玻璃 + 86% 半透明 + `backdrop-filter: blur(8px)`」退役，
  顶栏改为不透明 `--mk-surface` + 1px 下缘发丝线（见 §7）。
- **v4 实测清理**：`backdrop-filter` 在全仓剩 15 处（其中 3 处是显式 `none` 的退役写法），
  逐个删除；主按钮的 135deg 渐变底（17 个文件 34 处）改为纯色；
  彩色光晕投影（品牌色 `box-shadow`）清零，仅保留 `inset` 与 `0 0 0 Npx` 焦点环两类。
- 暗色：中性炭灰阶梯 bg(#141415) < 侧栏(#1b1c1f) < surface(#202124) < 表头条带(#282a2e)；
  台阶 ≥6 个 sRGB 级。KPI 卡与普通卡同面（v3 起，白面/暗面一致，不再用蓝灰底区分）。
- 禁止：页面私写色值、透明度叠透明度、radius 混用相邻两档。

## 5. 守卫与演进（v3 增补复刻方法）

- `npm run design:check`：hex/死类/圆角/阴影/字号棘轮，只降不升。
  圆角/阴影的扫描面含 `src/styles/*.css`（2026-10-02 补，此前只扫 `.vue`，见 §7.5.6）。
  另含三条**硬失败**规则（非棘轮，恒须为 0）：规则 17 禁渐变主按钮、规则 18 禁
  `backdrop-filter`、规则 19 档位令牌的定义值必须落在阶梯上。
  治理面已于 v4 扩到用户侧，见 §7.5.3。
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
| `.tabs` | 顶层视图切换 = **下划线页签**（宿主页实现，如 `Users.vue` 的账号/学习状态；`.mk-pills` 不再承担视图切换，只留筛选/多标签过滤） | 页面 |
| `.subtabs` | `MkSubTabs`（下划线式，9×12；抽屉/弹窗内部内容分区） | 原语组件 |
| `.chips / .chip` | `.mk-pills / .mk-pill`（描边胶囊；激活=蓝底蓝字蓝调边） | 原语 |
| `.tbl` | `.mk-table`（10×16；fixed 档列宽走 `--mk-col-*`） | 原语 |
| `.pager` | `Pagination.vue` | 原语组件 |
| `.empty` | `MkEmptyState`（大块居中空态）；筛选后 0 行的卡内表格/列表用 `.mk-empty--line`（**一行式内联空态**：单句「为什么空 + 现状结论」，不占最小高度，CM7） | 原语组件 / 原语 |
| `.skd-tbd`（96px 虚线占位块） | 页面本地复刻（SkillDetail 试跑页签：后端暂不下发逐步执行链路时的占位灰块——testSkill 暂只回最终输出；与 `.mk-empty--line` 的一行式空态是不同事实，同页「样例输出」卡未跑/无输出亦复用此块） | 页面 |
| `.drawer/.modal/.ovl` | `.mk-drawer/.mk-modal` | 原语 |
| `.field/.input/.select` | `.mk-filter__input/.mk-filter__select`、`.mk-field` | 原语 |
| `.stageband/.stageband__legend/.sbl` | **共享原语**（`mk-primitives.css`；2026-10-03 由 TeachingSessions / OpsContent / MemoryReview 三处逐字 scoped 拷贝收敛，见 §8 10-03 行） | 原语 |
| `.buckets/.bucket` | 页面本地复刻（GoalConversations / LearnerDetail） | 页面 |
| `.loop` | 页面本地复刻（Overview 教学闭环） | 页面 |
| ~~`.barchart`~~ | **已退役**：Overview 近 7 天活跃改用统一柱图组件 `OvBars`（2026-10-02 P1#2，零值「·」+ 今日列高亮内建）；echarts 重图仍走 MkChart | — |
| `.feed/.feedrow` | 页面本地复刻（Overview 最近事件；健康中心告警流） | 页面 |
| `.ranklist/.rankrow` | 页面本地复刻（Overview Row B / LearnerCenter / ApiConfig 等） | 页面 |
| `.meterrow/.meter` | 页面本地复刻（LearnerCenter / LearnerDetail / DayTimeline） | 页面 |
| `.hero` | `MkDetailHero`（24px 标题） | 原语组件 |
| `.statstrip`（L2 详情页 hero 下的一行分格读数） | **共享原语** `MkStatStrip`（`layout="grid"`，2026-10-05 批次五 CM2 收敛页私有复刻，`components/mk/MkStatStrip.vue:124-127`）；现消费四处：LearnerDetail / UserAccountPane（原 UserDetail 抽出的账号面）/ VirtualProfile / SessionCockpit。**PathDetail 不渲染**（2026-10-02 用户拍板撤除，原型路径详情本无此带） | 原语组件 |
| L2 详情骨架（hero + statstrip + subtabs） | LearnerDetail 已按此骨架（318da349 起；原独立 UserDetail 页并入其「账号与许可」页签，由 UserAccountPane 承载） | 页面 |
| `.login*` | `Login.vue` 页面复刻（分栏品牌 aside + 表单 panel） | 页面 |
| `odg-*` | `DataFlowGraph`（orch-odg-*） | 页面 |

分布条/桶组/事件流的色彩语义（全站统一）：蓝=进行中/正常，绿=已完成/正常收尾，
琥珀=到期/需关注/超时，红=失败/异常，faint=已废弃/已下线/其它。

## 7. 壳层（v3 新增条目）

- 侧栏 **244px**（原型 --nav-w；≥1440 起各档 +36 供 4K zoom 补偿），扁平导航：
  分组标签大写字距 0.12em、子项不缩进、裸 17px 线性图标（无芯片底）、
  选中 = 整行 `--mk-blue-bg` 胶囊 + 主色字 600（无左条、无内缩）。
- 侧栏底部 = **唯一一行「收起导航」**（图标+文字，nav__item 同款）；品牌行删除。
- 刷新/术语/密度/主题四钮在**顶栏右侧**（34px 图标钮）；顶栏 56px、左右 20px。
- 顶栏材质：**不透明平面**（`--mk-surface`）+ 1px 下缘发丝线（`--mk-line`）。
  2026-10-02（批次 D）**退役**原「顶栏 56px 毛玻璃 + 86% 半透明 + `backdrop-filter: blur(8px)`」：
  与 §0 Posture rules「材质一律平面、不使用亚克力 / 毛玻璃浮层」直接冲突，
  且半透明底在去掉模糊后会「透出但糊」，比纯平面更脏。分层改由发丝线承担
  ——这正是 §0 的「1px 发丝线就是全部质感」。已同步改 `Shell.vue`。
- 侧栏与顶栏的硬编码色已 token 化（--mk-side-* 六 token）。

## 7.5 用户侧（v4 新增：本文此前只管 Admin）

v3 及以前的本文档只约束 `src/views/admin-redesign/`。但 2026-10-02 的审计发现一个
结构性问题：**用户侧的视觉漂移完全在守卫治理面之外**——守卫的 `isGoverned()` 只认
`admin-redesign/` 与 `components/mk/`，于是 admin 侧早已 100% 合规（圆角/阴影基线为 0），
而 `views/v2/**`、`components/user|chat|learning|ui/**`、`HomeNext`、`VisionNext`
以及全局的 `design-system.css` / `learning-components.css` 全部无人看守。

本文档**不因此扩权到用户侧的页面细节**（那属于 §6 的复刻职责），只补三条跨端规则——
它们在两端同时成立，差别只在承载类名：

| 规则 | Admin 侧 | 用户侧 |
|---|---|---|
| 主按钮纯色无投影 | `.mk-btn--primary` | `.btn-primary` / `.uc-btn--primary` / `.ob__cta` 等 |
| 材质平面，无毛玻璃 | `.mk-shell__top` | `.v2nav-bar` / `.uc-dialog-mask` 等 |
| 悬停不位移 | `.mk-kpi--clickable` | `.peerfab` / `.kp-btn` / `.hn-btn` 等 |

### 7.5.1 令牌层：唯一事实源

`frontend/src/styles/tokens.css` 是 `--wf-*` 唯一令牌层（167 枚）。加载顺序由
`main.css` 顶部第一行 `@import` 保证——**必须早于** `design-system.css`、
`admin-surface.css`、`main.css` 自身块，因为别名要指向已定义的令牌。

```
tokens.css :root        ← 设计语言定义处
tokens.css [dark]
design-system.css       :root + [dark]   ← 别名 + 语义角色
admin-surface.css       :root + [dark]   ← 别名 + 语义角色
learning-components.css
main.css                :root + html[data-theme='dark']
admin-theme.css
```

> **级联陷阱（2026-10-02 修复）**：`:root` 与 `[data-theme='dark']` 特异性都是 (0,1,0)，
> 只差源码顺序。`admin-surface.css` 在 `design-system.css` **之后**加载，于是它的 `:root`
> 浅色字面量把对方的暗色值整片盖掉——暗色下曾出现近白悬停面 (`#f6f9ff`) 与浅色发丝线
> (`#e1e8f2`)。修法是在每个自己给了字面量的文件里补暗色块，与 `design-system.css`
> 保持一字不差的双写法 `[data-theme="dark"], .dark`（`theme.ts` 对 `<html>` 同时打
> 属性与 class，两条触发路径都活着，少写一个就漏一种）。
>
> 凡是某文件 `:root` 里给了**不随 `--mk-*` 自动翻转**的字面量，它就必须在自己的暗色块里
> 补一份。`admin-surface.css` 删掉 `--radius-md: 12px` 与 `--transition-normal: 0.22s ease`
> 两处越权覆盖后，本文件已不再有能力改写令牌层的值。

### 7.5.2 语义状态色的白字可读性（v4 发现的规范缺口）

规范的 `--wf-color-{success,progress,warning,efficient,danger}` 族都是**浅底文字色**
或状态标识色，**没有一档是为「实心底 + 白字」设计的**。实测：

| 规范令牌 | 对白字 | 结论 |
|---|---|---|
| `--wf-color-success` `#31b16f` | 2.75:1 | ✗ |
| `--wf-color-success-dark` `#28965a` | 3.75:1 | ✗（大字勉强） |
| `--wf-color-warning` `#f4aa46` | 1.97:1 | ✗ |
| `--wf-color-efficient` `#f39c12` | 2.19:1 | ✗ |
| `--wf-color-efficient-dark` `#d68910` | 2.82:1 | ✗ |
| `--wf-color-danger` `#ef7578` | 2.81:1 | ✗ |
| `--wf-color-danger-dark` `#d95054` | 4.02:1 | ✗（差一点） |

v4 的处理：实心状态按钮**不复用语义文字色令牌**，改用两个本仓既有的实底档——
`#15803d`（绿，6.13:1，对应 `--mk-green-fill`）与 `#d97706`（橙/琥珀，4.52:1），
红用 `--wf-color-danger-dark`。判据：按钮文字 12–13px 属**小字**，按 WCAG AA 正文
4.5:1 判，不能按大字 3:1 放行。

> **待体系包补档**：`--wf-color-*-fill`（实心语义底色族）。补齐后上列字面量应改回令牌引用。
> 登记位置：`tokens.css` 的「别名层映射表 · 尚未转接」段。

### 7.5.3 治理面已扩到用户侧（v4）

守卫 `isGoverned()` 现覆盖 `views/v2/`、`components/user|chat|learning|ui/`、`HomeNext`、
`VisionNext`；`HEX_CSS_TARGETS` 增补 `design-system.css`、`learning-components.css`。
另新增两条**硬失败**规则（非棘轮，必须恒为 0）：

- **规则 17**：禁渐变主按钮（`linear-gradient(~135deg, 蓝→深蓝)`，要求**两个及以上**蓝色端）。
  不误伤 `90deg` 进度条渐变与 `100deg` 骨架 shimmer——前者以渐变编码完成度语义，
  后者是加载动效，都不在「主按钮渐变」之列。已知边界：角度只查 125/135deg，
  115/145deg 画法相同但不覆盖。
- **规则 18**：禁 `backdrop-filter`（值不为字面 `none` 时；`none !important` 视为豁免，
  `var(...)` **不**豁免——那正是把材质改个名的后门）。毛玻璃材质整体退役，没有例外档。

### 7.5.4 「指令在目标面上可执行」：isAdminGoverned（v4 新增的第二个谓词）

治理面扩大后暴露一类新错误：**规则会给出在该文件上无法执行的整改建议**。
规则 5/6 的建议是「改用 `<MkLoading>` / `.mk-skeleton`」，而这两个原语定义在
`mk-primitives.css`——该文件只被 `AdminConsole.vue` 与 `SkillDesignPage.vue` **懒加载**，
用户侧路由从不加载它。

已实证的既有缺陷：`V2LearningPage.vue:123` 已经在用 `<MkLoading>`，但在 `/v2/*` 下
`.mk-spinner` 与 `.mk-loading` 两个类**零命中**，转圈根本不显示。照着规则 5 的报错去改
用户侧页面，只会把同一个坏组件换一个地方用。

因此守卫新增 `isAdminGoverned()`（= `ADMIN_PREFIX || MK_PREFIX`），规则 5/6 的闸门
收窄到 admin。**待产品决策**（不在守卫职责内）：
- **(a)** 把 `mk-primitives.css` 提为全局加载。原语层本就不专属 admin，
  且本节 §7.5 要求用户侧复用同一套原语——这与 (a) 一致；
- **(b)** 用户侧自建 loading/skeleton 原语，规则 5/6 对用户侧永久关闭。

### 7.5.5 规则 7 必须认识 Vue <Transition>（v4 修的误报）

扩面后规则 7（死 CSS）一次性冒出 80 条，其中 **53 条是 Vue `<Transition name="x">`
的运行时钩子类**（`x-enter-active` / `x-leave-from` / `x-move` / `x-enter-to` …）。
这些类由框架在过渡期间**动态挂到元素上**，模板源码里永远不会字面出现——
按「语料里没出现即死」判是结构性误报。

把 53 条写进棘轮基线，等于把三分之二的假阳性永久合法化，正是棘轮机制要防的失败模式。
v4 改为扫出 `<Transition name>` 的静态 name 集合 + Vue 约定的钩子后缀段做排除，
真实死 CSS 从 80 降到 **27**（8 个文件）。教训记此：**扩大治理面前，先验一遍新规则
在自己身上会不会误报**，否则一次 `--update` 就把误报固化成「现状」。

### 7.5.6 规则 14/15 从未扫过 `src/styles/*.css`（v4 的渲染层复核查出）

**这是本轮最值得记的一条：一个「已 100% 合规」的结论，实际是「没扫」。**

规则 14/15（圆角 / 阴影棘轮）原本长在「遍历 `.vue` 的 scoped `<style>` 块」那个循环里。
`src/styles/*.css` 根本不是 `.vue`，从未进入过那个循环 —— 而 admin 的圆角几乎**全部**
写在 `mk-primitives.css` 里。于是：

- 守卫长期报 `radius 基线 = 0`，被读作「admin 圆角 100% 合规」；
- 实际渲染层在 `/admin/health-center` 实测出 `.mk-minibar` 是 `99px`（阶梯是
  4/6/8/12/16/999），守卫报 0。

**怎么发现的**：不是靠读代码，是靠渲染层复核 —— 打开页面，对 `getComputedStyle`
出来的每个元素算 `border-radius` / `box-shadow`，再按阶梯判。源码扫描与渲染扫描
是两种不同的证据，前者会漏掉自己没遍历到的文件类型。

扩面后首次扫描查出 **4 处圆角 + 6 处阴影** 字面量档外，全部当场修掉（没有写进基线）：

| 文件 | 原值 | 改为 | 说明 |
|---|---|---|---|
| `mk-primitives.css` `.mk-minibar`/`__fill` | `99px` ×2 | `999px` | 6px 高的条上两者都被 clamp 到 3px，**渲染零差别**，改的是记法 |
| `mk-primitives.css` `.mk-status` @2800 | `14px` | 删除 | 基础档已是 `--mk-radius-xl`=16；这句 14px 是批次 C 抬 xl 后留下的**回归**（超大屏上把圆角从 16 缩回 14） |
| `admin-theme.css` `.admin-session-validation-card` | `14px` | `var(--mk-radius-xl)` | 它是卡，与 `.mk-card` 同族 |
| `admin-theme.css` 同卡 ×2（浅/暗） | `0 18px 48px …` | `var(--mk-shadow-pop)` / 删除暗色副本 | 18/48 是三档之外的第四档；暗色副本删除即可，token 自动翻转 |
| `mk-primitives.css` `.mk-seg__item--active` | `0 1px 2px rgba(23,32,51,.1)` | `var(--mk-shadow-sm)` | raised 档的职责；色值 23,32,51 不在调色板里 |

同时**新增规则 19**（硬失败）：档位令牌的**定义值**必须落在阶梯上。
理由是 14/15 现在放行 `var(--radius-*)` 这类转发（三支别名是同一条阶梯的转发），
只查引用处会让「往别名链里塞 13px」在每一处引用上都合法通过 —— 必须钉死链的起点。
圆角按字面比对阶梯；阴影没有「几条固定字符串」可比，改按规范 §0 那条真正硬的要求判：
**全中性**（把 rgba 通道乘 alpha 看推偏量，规范自己的 slate 阴影推偏 ≤2，彩色光晕上百）。

### 7.5.7 渲染层视觉回归（2026-10-02，亮/暗双档 × 10 页）

批次 C/D 都是「按数据改」的，改完必须回到浏览器确认观感。方法：playwright 起
1440×900 双档上下文，注入会话 cookie，逐页截图 + 跑三个渲染层探针
（对比度 / 退役材质 / 圆角档）。脚本与截图存于仓库外临时目录，不入库。

**通过项**：

| 检查 | 结果 |
|---|---|
| 退役材质（`backdrop-filter` / 135° 蓝渐变主按钮 / 彩色发光） | **全站 0**，亮暗两档都是 0 |
| 对比度 · 亮色档（8 页） | **0 失败** |
| Admin 顶栏材质 | 不透明平面 + 1px 发丝线，毛玻璃已退 ✓ |
| 卡片圆角观感 | 16px 统一，无塌陷、无突兀 |

> 探针本身踩了两个坑，记此备查：① 半透明底若不当成不透明算，10% 蓝底会被当成
> 满色蓝，凭空造出一批假阳性 —— 必须把背景链**自下而上合成**到不透明再比；
> ② 「阴影 RGB 三通道不等」不能当彩色判据，因为**规范自己的阴影就带色**
> （`--wf-shadow-*` 用 slate `rgba(15,23,42,…)`），要算预乘后的染色量，
> 且 0 模糊的是描边环不是阴影。

**未通过项（暗色档 2 处，全站性）**：

| 现象 | 实测 | 判据 |
|---|---|---|
| 主按钮白字 | `#fff` on `#5b8def` = **3.23:1** | 正文需 4.5:1 |
| 暗色 muted 次要文字 | `rgb(122,126,133)` on `rgb(32,33,36)` = **3.95:1** | 正文需 4.5:1 |

亮色档同一颗主按钮是 `#fff` on `#2f6ae0` = **4.93:1，通过**；问题只出在暗色档的
`--wf-color-primary`（`#5b8def`）。这是 **§7.5.2 那个规范缺口的延伸**：
体系给的交互蓝在亮色档够白字，在暗色档不够 —— 因为暗色档为了让蓝在深底上「够亮」，
把明度提上去了，代价是压不住白字。**待体系包补档**，不建议在本仓私自把暗色蓝调深
（会与 `WenFlow-Design-System` 的定义分叉）。

---

## 8. 洼地与批次状态（v4 更新）

| 批次 | 对象 | 状态 |
|---|---|---|
| v2 §6 全部条目 | SessionCockpit/VirtualProfile/LearnerDetail/KPI/Login/Overview/Shell/图表 | ✅ 维持 |
| 09-30 #1 | 壳层+原语规格（de510a98） | ✅ 按钮 8px/600、卡题 15、KPI 白面 28、表格 10×16、胶囊描边化、页 20/20/48 |
| 09-30 #2 | 侧栏底部 + pinned 选中色修复（d89734e7） | ✅ |
| 09-30 #3-5 | 总览三连（d2319116/9f42050f/0038b189） | ✅ 状态条+闭环条+源码级复刻；brief-* 卡语言退役 |
| 09-30 #6 | 四教学页分布条/桶组（0e861d5c） | ✅ stageband/buckets 三态色语义全站统一 |
| 10-01 | 健康中心 service 卡+事件流、登录页分栏复刻 | 进行中（本批次） |
| **10-02 A** | 令牌层归一：新建 `tokens.css`（`--wf-*` 唯一层 167 枚），`--mk-*`/`--color-*`/`--neutral-*`/`--radius-*`/`--shadow-*` 全降为别名；删 76 枚死令牌（`--lab-*`/`--fluent-*`/`--acrylic-*`/`--glass-*`）；修 `admin-surface.css` 级联缺陷（暗色曾被 `:root` 浅色字面量盖掉） | ✅ |
| **10-02 B** | 暗色调色板归一：用户侧 `--color-primary` #5a94f8→#5b8def（补上 18f09fd3 漏掉的一半）、`--neutral-*` 十一档改实测收敛坡道；`--shadow-xs` 改 `none` | ✅ |
| **10-02 C** | 圆角收口：砍 `--mk-radius-lg(10)`、`--mk-radius-xl` 12→16（全站卡片 +4px）、删 `--radius-md` 越权覆盖（12→8，用户侧与 Admin 侧控件圆角首次统一）；阴影四档→三档 | ✅ |
| **10-02 D** | 退役材质：渐变主按钮 34→0、`backdrop-filter` 15→0、hover 抬升 20→0、彩色外发光 35→0；同步退役 §7 顶栏毛玻璃 | ✅ |
| **10-02 E** | 守卫扩面 + 两条硬规则（禁渐变主按钮 / 禁 backdrop-filter）；新增 `isAdminGoverned` 收窄规则 5/6 闸门（见 §7.5.4）；修规则 7 对 `<Transition>` 钩子的 53 条误报（见 §7.5.5）；**补扫 `src/styles/*.css` 的圆角/阴影**（规则 14/15 此前从未扫过该面，见 §7.5.6）+ 新增规则 19（档位令牌取值自检）+ 渲染层双档视觉回归（见 §7.5.7） | ✅ |
| — | 清理 `design-system.css` 20 个类 + `learning-components.css` 41 个类（全部零消费），连带清零 20 枚 ZPD 令牌 | ✅ |
| — | 修规则 8 漏检的两处未定义 token（`--mk-ep-primary-bg`、`--transition-base`）：引用了不存在的令牌且无兜底，导致按钮 hover 掉色、徽章失去过渡 | ✅ |
| **10-03 #1** | 教学组四表单元格方言收敛到共享原语（26f44a33）：`.stageband/.sbl` 升全局原语、八处私有类退役、`.mk-table--click` 补键盘半边；新增方言回归门禁 `teaching-tables.dialect.test.ts` | ✅ |
| **10-03 #2** | 教学组列序统一口径（86c549a9）+ 全站行首色条撤销（47c66bc2）+ 目标对话阶段格三通道去重（7fe36f1a） | ✅ |
| **10-03 #3** | 虚拟学习者列表按方言体系重排（67931eb2：格词汇归原语、列序对齐、假行点击退役）+ KPI 带压缩（6fbc5fa5） | ✅ |
| **10-03 #4** | 平台总览密度优化（4e9d3d55）：状态条改「结论 / 明细」两层、待办长句主副行、事件流底部渐隐、KPI 注记防孤字 | ✅ |

当前全站私写 hex 存量以 `scripts/design-system-baseline.json` 为准（**218**；口径沿革 v2 收官 649 → 09-29 505 → 09-30 464 → 10-03 **218**，批次 E 扩面后用户侧纳入计数）。

## 9. 与原型的已登记偏离（复刻时不照搬的部分）

1. **微字号下限 12px**：原型 11px（图例帽/柱值/时间列）一律用 `--mk-fs-micro`（12px）——
   本仓辅助文字下限 12px，且规则 16 棘轮禁止新增 <12px。
2. **按钮字号 14px**：原型 .btn 与 .btn--sm 同为 12px（字号不承载层级，高度才是）；
   我们保留 14/12 两级，密集管理台里 12px 中文按钮标签偏小。
3. **侧栏宽度档位**：原型恒 244px；我们 244 基档 + 各断点 +36（4K zoom 补偿，沿 v2 档位体系）。
4. **总览 Row B 只有两张小卡**：原型是「图 1.6fr + 事件 1fr」下一排三小卡，其中第三张
   「学习状态分布」**不落**（后端暂无学习状态聚合口径）。曾短暂做过「模型与失败」顶替卡，
   2026-10-01 用户拍板**不做顶替卡**，Row B 固定两卡（Skill 调用量 Top 5 + 待处理事项）。
5. **登录 aside 的「当前来源 IP」**：原型硬编码假信息，禁止照搬；三条安全要点写真实机制。
6. **假动作按钮**：原型「手动生成路径」等无真实流程的按钮不上页面；每个按钮必须接真实行为。
7. **KPI 趋势 foot 已恢复（预算窗口）**：原型四卡全带 ▲▼，曾因「今日 vs 昨日全日」在
   2026-10-01 凌晨实测 ▼-97%/▼-100% 而下线。**2026-10-03 已重新上线**：改用
   **昨日同时刻同期窗口**（今日 00:00→now vs 昨日同长窗口，后端 `todayCallsBaseline` /
   `activeTodayBaseline` 字段），基线为 0 时不给百分比、foot 落「昨日同时刻无对照」。
   即本条的「等后端提供同期窗口再恢复」条件已满足。
8. **L2/L3 详情页的模板分工**（2026-10-01 勘察；2026-10-06 按代码现状校准）：
   - LearnerDetail = 标准 L2（MkDetailHero + MkStatStrip + MkSubTabs），已对齐；原独立
     UserDetail 页已并入其「账号与许可」页签（账号面 = UserAccountPane，自带「账号概览」读数条）；
   - VirtualProfile 头部**有意**只留身份信息（2026-09-27 决策「数量即 tab 角标，不单设 KPI 行》）——
     头部不放读数；hero 下、subtabs 上现有一行共享 `MkStatStrip`（grid 变体，2026-10-05 由原
     vp-metricgrid 收敛而来，见 `VirtualProfile.vue:31-37`），复刻时按此，不再另设私有统计带；
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
