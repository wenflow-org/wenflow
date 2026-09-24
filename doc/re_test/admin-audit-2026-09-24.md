# 管理端桌面端全面巡检报告（2026-09-24）

- **检查时间**：2026-09-24
- **环境**：本地开发 `http://localhost:5173/admin`（前端 Vite :5173，后端 :3001）
- **账号**：开发默认管理员 `admin`（`ChangeMe_2026_Admin`，与 `scripts/admin-explore.mjs` 同源）
- **方式**：`scripts/admin-audit.mjs`（Playwright 无头，**只读**：仅导航 + DOM/计算样式采集，不点任何写操作）
- **覆盖**：14 个侧栏场景 × 全部 tab + 隐藏场景 `skill-workbench` + 3 个二级详情 + 登录页，共 **36 个页面/视图**；
  宽度 1440 / 3840 全量，档位子集（overview / people / sessions / skills / execution-logs / audit-logs）另跑
  1920 / 2000 / 2560，共 **85 次渲染**
- **判据**：`doc/ADMIN_VISUAL_LAYER_SPEC.md`（同视口 ≤3 个字号档、表格行高 ≥40px、卡片 padding/radius 不混档、
  页面级 scoped 只允许布局）+ 客观缺陷检测（溢出 / 裁切 / 可点尺寸 / hover-only / 键盘可达 / 跨档单调）
- **截图**：`.ui-audit/admin-audit-2026-09-24/`（39 张，已 gitignore）
- **原始数据**：`scripts/admin-audit-results/audit-2026-09-24.json`（复跑：`node scripts/admin-audit.mjs`）

> 与移动端走查同源的方法：先在真实渲染里量，再谈结论；每轮修完复跑同一脚本对比。

---

## 总览（修前 → 一轮修后 → 二轮修后）

| 指标 | 修前 | 一轮修后 | 二轮修后 |
|---|---|---|---|
| 横向溢出页 | 0 | 0 | 0 |
| 被裁切文本 | 0 | 0 | 0 |
| **档位字号非单调（越大屏字越小）** | **34 处** | **0 处** ✅ | 0 处 |
| 键盘不可达（cursor:pointer 无 role/tabindex） | 0 | 0 | 0 |
| 可点元素 <24px | 38 个页面×档位组合 | 19 个组合，剩余 136 条样本全部是 `<input type=checkbox>`（见 §1.3） | 19 个组合，剩余 **133 条样本经 `type` 字段复核全部是 checkbox**（见 §1.3） |
| **表格行高 <40px** | skills-recon 4 行（37px） | 同（见 §2.2） | **0 处** ✅（37→43px，见 §2.2） |
| 字号档 >3 的页面×档位组合 | 78 | 81（最多 16 档，见 §2.1） | 78–81（最多 16 档，见 §2.1） |
| **控制台错误 / 失败请求** | 60 / 60（全部 `/api/users/me` 401） | 60 / 60（见 §4.1） | **0 / 0** ✅（见 §4.1） |

> 「二轮修后」= 2026-09-24 按本报告 §2/§3 待挑清单执行的第二轮修复（`node scripts/admin-audit.mjs --no-shots`，
> 85 次渲染）。字号档计数随 dev 库数据浮动（78↔81，同一份代码两次复跑即可差 1），不是修复结果。

---

## 一、客观缺陷（本轮已修）

### 1.1 响应式档位字号非单调（P0，越大屏字越小）

**证据**：巡检在 6 个页面上抓到 34 处「1920 档字号 > 2000 档字号」，例如
`people-account .mk-page 1920→15px 但 2000→14.5px`、`.mk-table td 15px→13.5px`、`.mk-card__title 15px→14.5px`。

**根因**：`mk-primitives.css` 的 2000 档写于 1920 档之前，字号沿用旧的「1440→2000」节奏；
1920 档是后补的中间档（D4 补丁），同优先级后者覆盖 → 跨过 2000px 时字号反而回落。
静态核对后共 **12 个类回退 + 8 个类与 1920 档重复**。

**修法**：2000 档**不再声明字号**，只保留它的间距 / 尺寸 / 列宽 token / 覆盖层宽度职责
（1440/1920 档的先例就是「只调字号」，2000 档反过来只调间距）。
另 `Overview.vue` 3600 档有 5 处 zoom 补偿不足（见下），一并上调。

**文件**：`frontend/src/styles/mk-primitives.css`（2000 档）、`frontend/src/views/admin-redesign/Overview.vue`（3600 档）

> **zoom 折算**：≥2800 档壳层叠了全局 `zoom`（`admin-theme.css`：1.15 / 1.3），页面级 3600 档的 px 是
> **除过 zoom 的补偿值**（2800 档 17px×1.15 ≈ 3600 档 15.5px×1.3）。直接比原始 px 会误报，
> 守卫与报告都按「有效字号 = px × zoom」比较，并给 1.5% 容差。

### 1.2 仅 hover 才可见的交互（P0，键盘不可达）

| 位置 | 现象 | 修法 |
|---|---|---|
| `Overview.vue` 异常动态「排查 →」（`.feed__go`，实测 6 处常驻 `opacity:0`） | 只有鼠标悬停才出现，键盘/触屏看不到这一行可点 | 常态半透明 0.5，hover / `:focus-visible` 点亮 |
| `Overview.vue` 承载它的 `<li @click>` | 无 `role` / `tabindex`，键盘不可达 | 补 `role="button" tabindex="0"` + Enter/Space，并画 focus ring |
| `mk-primitives.css` 状态点图例 `.mk-status__dot::after`（覆盖全站 29 处状态条） | 仅 `.mk-status__dot:hover` 触发，而点本身只有 8px | 触发面扩到整条状态条，并补 `:focus-within`（Tab 进条内动作按钮时同样显示） |

> 其余 4 条被扫到的 `:hover` 规则（`.anb__close` / `.wf-notice__close` / `.tc-trend__bar` /
> `.exec-row--test` / `.mk-th__caret`）经核对基线透明度均 <1，属**强调**而非**揭示**，不是缺陷。

### 1.3 可点元素尺寸 <24px（P1，鼠标热区）

| 元素 | 修前 | 修后 | 影响面 |
|---|---|---|---|
| `.mk-th__btn`（表头排序按钮） | 39×**21** | ≥24 | 28 处（5 个页面） |
| `.exec-trace-btn`（链路入口图标） | 22×22 | 24×24 | 执行日志 5 处 |
| `.mk-status__meta-link`（状态条计数锚点） | 文字行高 ~17 | ~25（padding + 负 margin 补偿，视觉位置不变） | 4 处 |
| `.sd-settings__head`（日期模拟折叠头，`role=button`） | ~19 | ≥24 | 1 处 |
| `Login.vue` `.auth__back`（返回首页） | 66×19 | 66×27 | 登录页 |
| `input[type=checkbox]` | 13×13 | 16×16 | 表格行选择等 |

**例外登记**：复选框保留 16px —— 24px 的鼠标下限对复选框不适用（平台惯例即 13–16px，四周留白充足），
继续留在巡检清单里作为已知项，不再逐个修。**二轮复核**：巡检脚本补记 `<input>` 的 `type` 字段后重跑，
剩余样本 **133 条全部是 `type=checkbox`**（own box 16–21px；包在 `<label>` 里时按 label 热区算 19–22px，
label 文本如「记住本机登录状态 / 隐藏模拟账号 / 自动刷新 / 周一…周日」），**0 条非复选框**——
「小热区」这一类从"清单待挑"变成"仅剩登记例外"。

---

## 二、规范偏差

### 2.1 同一视口字号档 >3（SPEC §1 要求 ≤3 档）— 未修（需要单独一轮）

- 78 个「页面 × 档位」组合超过 3 档，最多 **16 档**（Overview@3840）。
- 典型：`audit-logs@1440` 出现 6 种字号 —— `12 / 12.5 / 13 / 13.5 / 14.5 / 15`。
- 根因（本轮查清）：**共享层的 1440 档自己就有 6 个字号档**（12.5 / 13 / 13.5 / 14 / 14.5 / 15
  分别给 th·cell-sub·badge·btn--sm、status meta·card meta、filter·pill·btn·num·link、menu item、
  page·td·card title、status title），页面再插半步值 → 6~7 档起步。也就是说这一条**不是页面各自
  乱写，而是 token 层的字号级差本身超过 SPEC §1 的 ≤3 档**；`--mk-fs-*` 只有 11/12/12.5/13/14/15/16/18/20，
  档位与页面在 token 之间插了半步（13.5 / 14.5 / 15.5 / 16.5 / 17），层级靠"半像素"表达而非字重/颜色。
- 修法（未做）：收敛 token 层的字号级差（1440 档 6 档 → 3 档：如 12.5 / 14 / 15），页面继承；
  这是一次**全局视觉收敛**，会改变每个管理页在 ≥1440 的字号观感，需要单独一轮 + 真机逐页复核。

### 2.2 表格行高 <40px（SPEC §3）— ✅ 已修（第二轮）

- 修前：`skills-recon`（Skill 对账表）4 行 **37px**。
- 定位：根因不是字号，而是分组行 `.sk-rec-group td` 自己覆写了 `padding: 6px 14px`——
  比表格基线 `.mk-table td` 的 9px 还紧，单行 12px 文本压到 37px（数据行有主/副两行，实测 68px）。
  报告原先推测的「`.mk-table td` 纵向内边距 9px」是错的：分组行的 padding 本来就不走基线。
- 修法：分组行不再覆写内边距，跟随 `.mk-table td` 的档位节奏（基线 9px、≥2800 档 14px）。
  实测 **37 → 43px**，且随档位增长（不写死数值）。全量巡检「表格行 <40px」归零。

### 2.3 档位蔓延（SPEC §5「视觉层改动只允许发生在 token/原语层」）— 未修（已棘轮）

- **53 个 admin 文件**自带 `min-width: 2000/2800/3600px` 档，共 **1059 条 font-size 声明**：
  SessionCockpit 140、Overview 83、LearnerDetail 63、ApiConfig 48、SkillDrawer 39…
- 已纳入守卫规则 10 的棘轮（只降不升），不再增长；收敛（改为继承共享层档位）需要逐页视觉复核，
  与 §2.1 是同一件事的两面（先把共享层档位收敛到 ≤3，页面档位才有"继承"的目标值）。

### 2.4 内容宽度无策略 — ✅ 已修（第二轮，且清单按实测修正）

**修前**：`.mk-card--narrow`（1200px 居中）全站**只用过 1 次**（`OpsCenter.vue`），
表单/设置页在 2560/3840 通栏。

**修法**：新增同值原语 `.mk-narrow`（限宽对象是 tab body 这类**容器**——一个 tab 下多张卡时，
逐卡加 `--narrow` 会各自居中、列宽还对不齐），套用在两个纯设置面：

| 页面 | 限宽前 @2560 / @3840 | 限宽后 @2560 / @3840 |
|---|---|---|
| `ApiConfig`（接入与模型） | 2280 / 3330 | **1200 / 1560** |
| `OpsCenter`（运维工具 / 数据导出） | 2280 / 3330 | **1200 / 1560** |
| `execution-logs`（表格页，对照组） | 2278 / 3328 | 2278 / 3328（不动） |

- **对 1440 零影响**：`.mk-page` 在 1440 下可用宽度 1216px，本就低于 1200 限宽（实测卡宽 1184）。
- 3840 的 1560px 是 1200 × zoom 1.3 的折算值，仍大于 1440 的 1184 → 不会出现「越大屏越窄」。
- SPEC 补 §7「内容宽度」：表格列表 / 观测台 / 编辑器工作台通栏（数据密度优先）、
  表单设置限宽 1200 居中、弹窗抽屉按档位放大（原语自带）。巡检脚本补 `narrowCols` 采集
  （宽度 + 是否居中），这条从此可被同一脚本复跑验证。

**清单修正**（原清单按文件名推，实测后有误）：报告上一版列的
`VirtualLearnerCreate / BatchCreate / Launch / PromptTest / Reclaim`、`FieldAddWizard` 都是**弹窗**
（宽度已由 `--mk-modal-w-*` 按档位管：2800→760/1000、3600→900/1160）；
`skill-design/*-tab` 是**双栏编辑器工作台**（编辑器要宽度）；`PromptEval` 主体是表格页；
`SimulatedDaySettings` 是嵌在列表卡（`mk-card--fill`）里的设置条，限宽会连表格一起限。
四类都不该限宽，故不动。


---

## 三、报告项（第二轮处置结果）

1. **`/api/users/me` 401 × 60** — ✅ 已修。根因是路由守卫 ISSUE-12 的会话自举
   `restoreFromCookie()` 对**每次导航**都执行，而管理端登录态判据是 `hasAdminSession()`，
   于是每个管理页导航都发一条注定 401 的探针请求。改为 `/admin*` 跳过自举。
   实测：登录 + 连续 5 个管理页导航，`/api/users/me` 请求 **0 次**；全量巡检
   「控制台错误 0 条 / 失败请求 0 条」。
2. **i18n 从未接入** — 未动（产品决策：无 `vue-i18n` / 无 `$t(`，文案全部硬编码中文；
   是否引入是产品范围，不是缺陷）。
3. **`skill-workbench` 无侧栏入口** — 未动（产品决策：它是「新建 Skill」骨架生成的唯一入口，
   测试里显式标注为隐藏场景，是否上侧栏属导航 IA 决策）。
4. **404 无管理端出口 / `/admin/<未知>` 静默回总览** — ✅ 已修。非法 page 回退总览前先
   `toast.warning`「未知管理页「xxx」，已回到总览」（URL 仍归一化，深链可分享）；
   `NotFound.vue` 在管理端会话存在时补第三个动作「前往管理控制台」。
5. **PromptEval 悬空 personaId** — ✅ 部分已修（列表可见化）。后端 `GET /eval-cases` 批量核验
   引用（新增 `filterExistingProfileIds`，一次 `in` 查询）并在载荷加 `personaMissing`；
   前端「状态」列加「人设失效」徽章 + 说明 tooltip。**DB 自动清理仍未做**（需要删除策略：
   是清引用、停用用例还是留档，属数据治理决策）。实测 dev 库已标出 1 条悬空引用。
6. **`MkChart` 主题不响应** — ✅ 已修。`theme` 只在 `init` 读取且无调用方传值 → 改为
   显式 prop 优先、未传时跟随 `useIsDark()`（`<html data-theme>`），主题变化时 dispose + 重建
   （ECharts 无运行时换主题 API）。实测暗色切换后 canvas 节点被替换、背景像素从透明变
   ECharts dark 底色 (4,8,16,255)，切回可逆。**系列色仍硬编码**（ECharts 不解析 CSS 变量），未动。
7. **`Messages.vue` 孤儿页** — ✅ 已删。`/admin/messages` 已重定向到 `ops-hub?tab=announce`，
   组件无生产 import（不在 AdminConsole 场景表、不在 manifest），只有冒烟测试挂载它。
   该用例改写为**打在生产宿主 OpsHub 上**的等价深链用例（`?tab=announce` → 切「站内通知」→ `?tab=inapp`）。
8. **8 处 Element Plus 死规则** — ✅ 已清（CapabilityShell ×3、LearningEvaluationPage ×4、
   QuickLearnPanel ×1；`v2.css` 的 `:not(.el-button)` 是功能性子句，保留），
   并新增**守卫规则 12**（硬失败）禁止 `.el-*` 选择器回潮。


---

## 四、已裁定豁免（不重报）

来自 `doc/ADMIN_VISUAL_LAYER_SPEC.md` §6 与本次核对：

- **Overview 手作体系**（`brief-card` / `feed` / `trend` / `wq` 等自造类，仅 2 个 `mk-*` 类）：明确「保留作为质感标尺」。
- **MkKpi 与 MkStatStrip 双形态**：两种布局用途，不做机械合并。
- **Login 独立视觉页**：已核实用 37 处 `--mk-*`，作为独立视觉页保留。
- **复选框 16px**：见 §1.3 例外登记。

---

## 五、方法沉淀（下轮复跑）

```bash
node scripts/admin-audit.mjs                      # 全量（约 8 分钟，84 次渲染）
node scripts/admin-audit.mjs --only overview,audit-logs --no-shots   # 单页快速验证
```

三个必须记住的点：

1. **等页面真的渲染出来再量**：管理端首屏模块多（冷启动 4–5s），只等固定毫秒会量到骨架屏——
   第一版脚本就踩了这个坑（量到的 `.mk-page` 不存在、字号只有 2 种）。现在等
   「页面容器出现 + `.mk-skeleton` 消失」，超时记 `stuckSkeleton` 而不是失败。
2. **扫 `:hover` 规则要先判 `selectorText` 再递归**：Chrome 的 `CSSStyleRule` 也有 `cssRules`
   （空数组是 truthy），先看 `cssRules` 会把所有普通规则跳过——第一版就是这么漏掉全部 hover 规则的。
3. **跨档比字号要按 zoom 折算**：≥2800 档的页面级 px 是除过 `zoom` 的补偿值（见 §1.1）。

**只读纪律**：巡检只做导航与 DOM/样式采集；二级详情靠点表格行 / 只读图标按钮（详情 / 控制台）
/ `role=button` 单元格进入（纯导航），行文本含「重算/重建/删除/导出」等变更语义时跳过不点。

---

## 六、本轮未覆盖（诚实边界）

- **二级详情探到 3/4**：`detail-user`（用户详情）、`detail-learner`（学习者画像）、`detail-virtual`（虚拟学习者画像）
  已采集；**会话座舱未采到**（入口是表格行的「控制台」图标按钮，脚本已补该回退路径但该行未落到 `?view=` 深链）。
- **Skill 设计页未采到**：`/admin/skills/:agentId+` 的入口不是 `<a href>`（列表用 @click 跳转），
  脚本拿不到 agentId → 该页本轮未量。
- **数据态只覆盖"当前 dev 库"这一种**：空态 / 错误态 / 长文本极端态没有逐一构造，
  「被裁切文本」为 0 只能说明现有数据下没有被裁。
- **6 个「页面×档位」组合在 12s 内没清空骨架屏**（skills-run@1440、execution-logs@3840、execution-cost@1440、
  audit-logs@1440、ops-center-tools@3840、ops-hub-announce@1440）——首次访问要编译模块，属 dev server 现象；
  生产构建下的首屏耗时需另测（脚本把这 6 条记成 `stuckSkeleton` 而不是失败）。
- **暗色模式未做专项巡检**：仅人工截图核对，没有纳入脚本的自动判定。
- **交互流程未走查**：本次是"逐页静态巡检"，不点写操作、不跑业务流程
  （对照 `doc/ADMIN_UI_WALKTHROUGH.md` 的点击走查；两者互补）。
- **桌面端以外的宽度不做**：按用户明确要求，管理端不做移动端适配，故未测 <1440 的窄屏。

---

## 七、第二轮修复清单（2026-09-24 续，按本报告 §2/§3 执行）

| 提交 | 内容 | 对应条目 |
|---|---|---|
| `94aaa9a8` | 表格分组行高 37→43px；`.mk-narrow` 原语 + ApiConfig/OpsCenter 收敛；SPEC §7 | §2.2 / §2.4 |
| `ec779d05` | 管理端导航跳过学习者会话自举（401 噪声 60→0） | §3.1 |
| `a8387362` | 未知管理页 toast + 404 管理端出口 | §3.4 |
| `15afa171` | MkChart 跟随 `<html data-theme>`，暗色重建实例 | §3.6 |
| `a7f8bebb` | 清 8 处 EP 死规则 + 删孤儿页 Messages + 守卫规则 12 | §3.7 / §3.8 |
| `9a729ebd` | 评估用例列表标记「人设失效」（后端批量核验 + 前端徽章 + 2 条回归测试） | §3.5 |

**仍未做**（见 §2.1 / §2.3 / §3.2 / §3.3 / §3.5 后半）：共享层字号级差收敛（≤3 档）、
档位蔓延收敛、i18n、skill-workbench 侧栏入口、PromptEval 悬空引用的 DB 清理策略。
前两项是同一件事（先收共享层，页面档位才有继承目标），需要单独一轮 + 真机逐页复核。

**顺带核实的两个"疑似"项（结论：不是问题）**：

- `admin-surface.css` 曾被记为"空转"：实际**不是**。它已收敛为 `:root` 兼容映射
  （`--bg-*` / `--text-*` / `--border-*` / `--radius-md` 等），被用户侧文件消费
  （`NotFound.vue`、`LearningEvaluationPage.vue`、`CompletionCard.vue`、`SessionFeedbackPanel.vue`、
  `learning-components.css`、`design-system.css` 等 7 个文件）——删掉会让用户侧掉样式。
- `Overview` 的手作体系与 `Login` 独立视觉页：仍按 SPEC §6 豁免，不动。

