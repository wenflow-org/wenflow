# Admin 运营台术语治理审计（ADMIN_TERMINOLOGY_AUDIT）

> 本文是 admin 运营台术语治理的**单源依据**。`frontend/src/views/admin-redesign/terms.ts`、
> `statusText.ts` 与守卫测试 `backend/src/services/__tests__/terminology-guard.test.ts` 均以本文为准。

## §1 目标

运营人员（非研发）在改动字段、路由、配置时必须读懂界面文案。因此：

- 界面主文案一律中文；工程枚举/字段名降级为括号、`title` 或 `mono` 小字。
- 同一概念在同一页面只用一个叫法（中英不混、同义不竞争）。
- 错误/校验文案走「现象 → 影响 → 动作」三段式；错误码移入 `title` 或折叠区。
- 枚举值不得当文案直出，统一经 `statusText.ts` 本地化。

## §2 术语族（权威叫法）

| 族 | 主叫法 | 说明 |
|---|---|---|
| 漂移族 | 漂移 / 契约漂移 / W4 漂移 / 哈希漂移 / 运行时漂移 | 三义**不得合并**为同一文案 |
| 同步族 | 同步（到 DB）/ 同步完成 / 保存到编排文件 / 发布 / 对账 | 文件→DB 生效动作统一「同步」 |
| 状态族 | 缺项 / 孤儿 / 字段已同步 | 「缺声明」「未路由」「fields-synced」为禁用叫法 |
| 健康族 | 健康中心（独立页）/ 健康区（编排页内嵌）/ 今日成功率 | 原「健康分」撞词已改名 |
| 版本族 | ACTIVE = 当前生效；SUPERSEDED = 已被替代 | 版本域用 `versionStatusText()`，勿复用通用状态表 |
| 可见性 | 对外可见性（render）：可见 / 隐藏 | 原始值保留在 `title` |

## §3 禁用叫法 / 黑话

守卫禁止以下子串出现在页面源码：

```
强制同步 DB、版本不一致、fields-synced ✓、dry-run：、managedByCode=false、
deriveContract(、F3 铁律、check-core-fields-sync、base=file:、
node_config_changes / orchestration-prune、落库对账、合同维度、健康分 = 今日、P4：declared
```

## §4 治理规则（守卫）

### §4.1 文案单源
漂移/同步族关键页面必须 `import { TERMS } from './terms'`，页面文案**引用常量**，不得硬编码与常量重复的值（如把 `driftContract` 的「漂移」、`driftInSync` 的「已同步」写死）。

### §4.2 禁用叫法
扫描 `admin-redesign/` 下**全部 `.vue`**（不再硬编码文件清单），命中 §3 任一子串即失败。

### §4.3 枚举直出
模板文本不得直出英文枚举值：`degraded` / `visible` / `hidden` / `draft` / `archived` / `published` / `pending` / `offline`。
必须经 `statusText.ts`（或页面本地化函数）转换；原始值可留在 `title`。

### §4.4 表头
`<th>` 内容不得为 camelCase 字段名（顶层页面）。字段名降级到括号 / `title` / `mono`。
`skill-design/*` 工程明细 tab 视为原始契约展示，默认放行。

### §4.5 文档引用
源码中出现的 `doc/*.md` 引用必须真实存在（本文即真源）。

### §4.6 状态词单源（本次新增）
`running` 的展示词统一「**进行中**」（单源 `statusText.ts`）。页面**不得**再写私有字典 / 格式化函数把它译成「运行中」。

守卫（`terminology-guard.test.ts`）按**译名位置**断言，而不是禁「运行中」这个子串：

```
/running['"]?\s*:\s*['"]运行中/        // 私有字典 { running: '运行中' }
/'running'\)\s*return\s*['"]运行中/    // 私有格式化 if (r === 'running') return '运行中'
/运行中\s*\{\{/                        // 计数模板「运行中 {{ n }}」
/运行中\s*\$\{/                        // 模板串「… 运行中 ${n}」
```

**故意放行**的「运行中」（它们是别的语义，禁掉会逼出错误文案）：

| 位置 | 语义 | 例 |
|---|---|---|
| 自由文本 | 运行时 / 线上 | 「源文件与**运行中**的 Prompt 不一致」（`SkillDesignPage`）、「是否已在系统**运行中**注册」（`SkillReconciliation`） |
| 动词进行态 | 「运行」这个动作正在发生 | 「**运行中**…」（`skill-design/trial-tab.vue` 试跑按钮） |
| 内部注释 | 非 UI 文案 | `live.ts` / `vlab.ts` 注释里的「运行中会话」 |

## §5 已知的历史疏漏（已修）

- 会话状态 `running` **一处「进行中」（`statusText` 徽章）、一处「运行中」（页内私有字典 / 计数说明）** —— 同义不同词（`ADMIN_PAGE_TEMPLATES` 附清单第 409 行也记过「顶栏 `进行中` 与右栏 `运行状态 运行中`」）→ **统一「进行中」**，并把 `BatchExperiments` 私有 `statusText`、`GoalConversations` 私有 `statusLabel`、`VirtualProfile.formatRunResult` 的 running 分支改为引用共享单源（48 处文案）。

- `degraded` 在会话座舱一处翻译、一处直出 → 统一「降级」。
- 版本表 `{{ v.status }}` 直出 `ACTIVE` → `versionStatusText()`。
- 字段路由图例 `visible` / `hidden` 直出 → 「可见 / 隐藏」+ 括号保留 `render`。
- `HealthCenter` / `FieldAddWizard` 硬编码 `TERMS` 值 → 改引用常量。
- `FieldRoutingTable` 引用不存在的 `doc/FIELD_ROUTING_UX_REDESIGN.md` → 删除。
