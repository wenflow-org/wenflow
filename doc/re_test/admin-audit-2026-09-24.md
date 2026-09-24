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

## 总览（修前 → 修后）

| 指标 | 修前 | 修后 |
|---|---|---|
| 横向溢出页 | 0 | 0 |
| 被裁切文本 | 0 | 0 |
| **档位字号非单调（越大屏字越小）** | **34 处** | **0 处** ✅ |
| 键盘不可达（cursor:pointer 无 role/tabindex） | 0 | 0 |
| 可点元素 <24px | 38 个页面×档位组合 | 19 个组合，**剩余 136 条样本全部是 `<input type=checkbox>`**（见 §1.3） |
| 表格行高 <40px | skills-recon 4 行（37px） | 同（未修，见 §2.2） |
| 字号档 >3 的页面×档位组合 | 78 | 81（最多 16 档，见 §2.1） |
| 控制台错误 / 失败请求 | 60 / 60（全部 `/api/users/me` 401） | 60 / 60（同，见 §4.1） |

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
继续留在巡检清单里作为已知项，不再逐个修。

---

## 二、规范偏差（未修，待挑）

### 2.1 同一视口字号档 >3（SPEC §1 要求 ≤3 档）

- 81 个「页面 × 档位」组合超过 3 档，最多 **16 档**（Overview@3840）。
- 典型：`audit-logs@1440` 出现 6 种字号 —— `12 / 12.5 / 13 / 13.5 / 14.5 / 15`。
- 性质：`--mk-fs-*` token 只有 11/12/12.5/13/14/15/16/18/20，档位与页面在 token 之间插了**半步值**
  （13.5 / 14.5 / 15.5 / 16.5 / 17 …），层级靠"半像素"表达而非字重/颜色。
- 修法（未做）：先在 token 层补齐/收敛档位，再让页面继承；属于一次全局收敛，需要单独一轮 + 视觉复核。

### 2.2 表格行高 <40px（SPEC §3）

- `skills-recon`（Skill 对账表）4 行 **37px**：单元格是 12.5px 单行文本，`.mk-table td` 纵向内边距 9px。
- 两个修法，需拍板：① 该表字号提到 14px；② `.mk-table td` 纵向内边距 9→11px（**影响全站表格**，约 +4px 行高）。
- 只影响单行小字号单元格——有主/副两行的表格实测 ≥44px。

### 2.3 档位蔓延（SPEC §5「视觉层改动只允许发生在 token/原语层」）

- **53 个 admin 文件**自带 `min-width: 2000/2800/3600px` 档，共 **1059 条 font-size 声明**：
  SessionCockpit 140、Overview 83、LearnerDetail 63、ApiConfig 48、SkillDrawer 39…
- 已纳入守卫规则 10 的棘轮（只降不升），不再增长；收敛（改为继承共享层档位）需要逐页视觉复核。

### 2.4 内容宽度无策略

- `.mk-card--narrow`（`max-width:1200px; margin-inline:auto`）全站**只用过 1 次**（`OpsCenter.vue:27`）。
- 表单/设置型页面在 2560/3840 下通栏：`ApiConfig`、`SimulatedDaySettings`、`VirtualLearnerCreate` /
  `BatchCreate` / `Launch` / `PromptTest` / `Reclaim`、`FieldAddWizard`、`skill-design/*-tab`。
- 表格页通栏是对的（数据密度优先），这一条只针对表单/设置页。

---

## 三、报告项（需产品决策，本轮未动）

1. **`/api/users/me` 401 × 60**：管理端每个页面都会请求学习者侧接口并拿到 401（控制台噪声，实测
   60 次失败请求全部是它）。管理端不该调用学习者接口，或应静默跳过。
2. **i18n 从未接入**：无 `vue-i18n` / 无 `$t(`，文案全部硬编码中文。
3. **`skill-workbench` 无侧栏入口**：新建 Skill 的唯一入口只能靠深链 `/admin/skill-workbench`（测试里显式标注为隐藏场景）。
4. **404 无管理端出口**：`NotFound.vue` 只有「返回首页 / 前往学习台」；且 `/admin/<未知page>` 被
   `/admin/:page` 吞掉后**静默 replace 到总览**，打错的深链既无 404 也无提示。
5. **PromptEval 悬空 personaId**：批量评估已改为「跳过并提示」（`backend/src/routes/admin/prompt-ops.ts`），
   但用例列表不标记「引用失效」，DB 里的悬空引用也不会自动清理。
6. **`MkChart` 主题不响应**：`theme` 只在 `echarts.init` 时读取（`MkChart.vue:32,41`），暗色下图表容器主题不切换；
   Overview 的轴/分割线已联动，系列色仍硬编码。
7. **`Messages.vue` 孤儿页**：无生产 import，仅 `__tests__/merged-tabs.smoke.test.ts` 引用。
8. **8 处 Element Plus 死规则**：EP 已彻底移除，残留选择器不会命中任何元素；管理端仅 1 处
   （`QuickLearnPanel.vue:884`），其余 7 处在用户侧。

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
