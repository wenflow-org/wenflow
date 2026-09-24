# 开发脚本手册（DEV_SCRIPTS）

> 面向**二次开发**：本地 240+ 个脚本怎么找、怎么用、哪些别当工具用。
> 快照日期 **2026-09-24**；脚本会漂移，动手前先用 `git log -- <脚本>` 确认它还在维护。

---

## 0. 一句话导航

| 你想干的事 | 去哪 |
|---|---|
| 找**正式工具**（门禁 / 审计 / 探针 / 回填） | `backend/src/scripts/` —— 104 个，**几乎都有自述 + 用法 + 参数** |
| 跑**虚拟学习者**（造人 / 跑批 / 看结果 / 救场） | `scripts/` —— 见 §2 |
| 看到 `q-*` / `inspect-*` / `check-uicheck-*` / `*.log` | **一次性产物**，绑定具体账号/会话，别当工具用 —— 见 §4 |
| 想知道 CI 为什么红 | `npm run ci:status`（= `scripts/ci-status.mjs`） |

---

## 1. 目录与命名约定

### 1.1 目录定位

| 目录 | 数量 | 定位 | 自述质量 | 入库 |
|---|---|---|---|---|
| `backend/src/scripts/` | 104 | **正式工具**：门禁 / 只读审计 / E2E 探针 / 回填 / 评测 / 运维 | **好**（用途 + 用法 + 参数） | 104/104 ✅ |
| `scripts/`（仓库根） | 60 | **虚拟学习者 / 跑批 / 巡检 / 演示** | 中（多数一句话） | 58/60 |
| `backend/scripts/` | 73 | **历史遗留 + 一次性排查**（`q-*` / `inspect-*` / `check-uicheck-*` / 8 个 `.log`） | 差（近半无自述） | 62/73 |
| `frontend/scripts/` | 2 | 设计系统守卫 | 好 | ✅ |

### 1.2 两种调用方式

```bash
# ① backend/src/scripts/*.ts —— 从 backend/ 目录跑
cd backend && npx ts-node --transpile-only src/scripts/<名字>.ts [参数]

# ② scripts/*.mjs | *.js —— 从仓库根跑
node scripts/<名字>.mjs [参数]
```

### 1.3 命名前缀 → 用途（**最重要的一张表**）

| 前缀 | 含义 | 典型行为 |
|---|---|---|
| `check-*` / `verify-*` | 门禁 / 校验 | 多数已挂 `npm run`，进 CI 或本地门禁 |
| `audit-*` | **只读**数据审计 | 头部都声明"不写库、不迁移、不调 LLM" |
| `probe-*-e2e` | **真模型**端到端探针 | 走生产入口、真调 LLM，按审计条目命名 |
| `backfill-*` / `repair-*` / `cleanup-*` / `dedupe-*` / `consolidate-*` | 数据回填 / 修复 | **默认 dry-run**，`--apply` 才写库 |
| `eval-*` | 离线评测 | 不落库、不写 DB |
| `q-*` / `inspect-*` | **一次性查询** | ⚠️ 勿当工具（见 §4） |
| `run-vl-*` / `vl-*` / `vlab-*` | 虚拟学习者 | 见 §2 |
| `simulate-*` / `kc-multipath-*` | 跨日 / 多路径模拟 | 见 §2 |
| `migrate-*` / `vacuum-*` / `purge-*` / `prune-*` / `wake-*` | 运维 | 多为**破坏性**，先看头部纪律 |

### 1.4 通用纪律（读头部注释就能确认）

1. **默认 dry-run**：回填/清理类默认只打印计划，`--apply` 才动数据（`prune-virtual-learners.ts` 还会先自动备份主库到 `data/backups/`）。
2. **只读脚本不会写库**：`audit-*` 全部声明只读——可以放心在生产库上跑。
3. **`--strict` 才是失败退出**：门禁类默认 warn + 退出码 0，`--strict` 才退出码 1（CI 用 strict）。
4. **别名优先**：能用 `npm run xxx` 就别手敲 ts-node（见 §6）。

---

## 2. 虚拟学习者跑批（重点）

### 2.1 链路总图

```
[准备]  prune-virtual-learners.ts        清理堆出来的临时 VL（默认 dry-run + 自动备份）
        vl-preset-stories.mjs            给基准 preset 追加故事（只驱动接口，不写库）
   ↓
[造数据/生成路径]
        vl-batch-path.mjs --tag=vl50     批量造 N 个互不相同的 VL → 推进到 path 生成完成（不进学习）
        vl-preset-run.mjs                用内置 14 个 preset 跑 Goal→Path（并发 1 + 指数退避，对网关友好）
        simulate-learner-e2e.ts          ★ 可丢弃学习者 + 等就绪 + 断点续跑 + 自动清理（推荐）
   ↓
[推进学习]（已有 sessionId）
        run-vl-learn.mjs <sessionId>     path → learn → 完成
        run-vl-full.mjs  <sessionId>     当前阶段 → 全路径完成
        run-vl-one.js    <key>           单轮（默认 key=shop-owner-inventory）
        kc-multipath-run.ts              同一学习者 N 条路径 × 跨日（看概念图被消费 / 动态调整轨迹）
        kc-resume-case.ts --session=<id> 失败后续跑（保留 goal 与路径，只补课）
   ↓
[观察]
        vl-path-report.mjs --tag=vl50    人设 + 故事池 + 路径 全景 HTML（输出 backend/vlab-runs/*.html）
        vl-dataset-report.mjs --tag=vl50 数据集汇总（规模分布 / scope_size / targetMilestones 落点）
        vl-blocktype-report.mjs          源头问题类型标注覆盖率与分布（L1 提示词改动的主指标）
        vl-ai-audit.mjs                  AI 独立盲评（两段式；分诊判定不给模型看系统产出的路径，防辩护）
        vlab-sessions-list.mjs           列出该用户全部教学会话
        vlab-lesson-{locate,result,review}.mjs   单节课定位 / 结果汇总 / 完整复盘
        vlab-cohort.mjs [--resume]       三人队列实验（幂等断点续跑；报告 doc/COHORT_EXPERIMENT_REPORT.md）
        cohort-{status,progress,teaching-check}.mjs   队列状态 / setup 进度 / 教学消息增长
   ↓
[救场]
        wake-hanging-sessions.ts         收束悬挂会话（走应用自己的收束路径，不直接改库）
        who-running.mjs / terminate-stuck.mjs   谁在跑 / 终止卡住的
```

### 2.2 关键前置条件与坑

| 项 | 说明 |
|---|---|
| **管理员凭据** | 跑批脚本从 `backend/.env` 的 `INIT_ADMIN_NAME` / `INIT_ADMIN_PASSWORD` 读；也可用 `E2E_ADMIN_NAME` / `E2E_ADMIN_PASSWORD` 覆盖 |
| **基准 preset 在哪** | `virtual-learners/presets.yaml`（14 个手写 preset；`builtin_*@preset.local`，`prune` 会**保留**它们） |
| **网关限流** | `vl-preset-run.mjs` 默认并发 1 + 学习者之间留间隔 + 失败指数退避——实测网关会返 429，别硬加并发 |
| **"未就绪"不是失败** | 路径生成窗口内 `advance-day runTasks` 会拒跑（不烧模拟日）——`simulate-learner-e2e.ts` 会等就绪，手工跑容易误判 |
| **后端重启会掐断在途请求** | `ts-node-dev --respawn` 下长链路会被并行编辑打断 → 用带 `--state=` 的脚本断点续跑 |
| **别用真实学习者跑数** | 手工跑会污染画像/统计；`simulate-learner-e2e.ts` 用可丢弃学习者并自动清理 |
| **直查库的口径** | `vl-*.mjs` 多用 `node:sqlite` **只读**直查（schema 常变，Prisma 客户端会漂移），跑批动作走 admin API |

---

## 3. 可复用工具索引（`backend/src/scripts/` 为主）

### 3.1 门禁 / 校验（多已挂 `npm run`，进 CI）

| 脚本 | 用途 | 入口 |
|---|---|---|
| `check-core-hash-parity.ts` | core ↔ 编译产物 ↔ DB 的 hash 对账 | `npm run prompts:core:check` |
| `check-input-handoffs.ts` | inputs 声明 ↔ 字段路由 handoff 双向对账 | `prompts:check-handoff` / `:strict` |
| `check-core-fields-sync.ts` | 产出字段 ↔ core fields 一致性 | `prompts:fields-sync:check` |
| `check-payload-prefix-stability.ts` | 稳定键前置护栏（KV 前缀缓存） | `prompts:payload-prefix:check[:strict]` |
| `check-skills-file.ts` | 技能户口簿 `prompts/skills.yaml` 全量门禁（F1~F12） | `prompts:skills:check` |
| `check-yaml-vocabulary.ts` | YAML 词表一致性 | `prompts:yaml:check` |
| `check-data-source.ts` | `dataSource` 声明校验 | `prompts:data-source:check` |
| `check-retired-skill-lists.ts` | 退役名单不变量（防双名单漂移） | `retired:check` |
| `lint-prompts.ts` | 提示词 lint | `prompts:lint` |
| `field-routing-drift-probe.ts --check` | 字段路由漂移探测 | `prompts:drift-check` |
| `check-llm-call-boundary.ts` | LLM 调用边界 | `llm:calls:check` |
| `check-constants-provenance.ts` | 常量出处 | `constants:check` |
| `check-prompt-runtime-contract-metadata-parity.ts` | 运行时契约元数据 parity | `prompts:runtime-contract:check` |
| `check-route-db-boundary.mjs`（在 `backend/scripts/`） | 路由层不得直连 DB | `boundaries:check`（`--update` **只允许收缩**） |

> ⚠️ `check-constants-provenance` / `check-core-fields-sync` / `check-core-hash-parity` / `check-yaml-vocabulary` / `check-prompt-runtime-contract-metadata-parity` / `generate-agent-snapshots` / `compile-core-files` 的**实现已迁到 `services/prompt-manifest/`**，脚本只是运维 CLI 入口（审计 #8）。

### 3.2 只读审计（`audit-*`，安全，可对生产库跑）

`audit-churn-signals`（休眠/流失分档）· `audit-degradation-rate`（降级率 DNR）· `audit-difficulty-{cohorts,fairness,ledger}`（难度公平/台账）· `audit-field-hit-rates`（字段运行时命中率 / 死字段）· `audit-handoff-edges`（编排交接边用量）· `audit-judge-agreement`（代码裁决 vs 模型判分一致性）· `audit-learning-metrics-scale`（指标量纲）· `audit-retention-curve`（保持率×间隔）· `audit-review-{loop,quality}`（复习闭环参数 / 选点质量）· `audit-session-cost`（按会话 token 成本）· `audit-skill-latency`（skill 延迟分位）· `audit-success-band`（成功率带）· `audit-warmup-loop`（课内温故闭环）· `audit-sensitive-storage`（敏感存储权限，`--apply` 才改）

### 3.3 端到端探针（`probe-*-e2e`，**真模型**）

| 脚本 | 验什么 |
|---|---|
| `probe-prerequisite-e2e` | 前置探测结果 goal→path 接线 |
| `probe-motivation-fields-e2e` | 动机字段 `motivation_signal` / `mi_frames` 落库 |
| `probe-replan-payload-e2e` | 重规划载荷含评审反馈 + 旧路径 |
| `probe-stage-e2e` | stage 节点（materials / loadTarget / 无资料不核对） |
| `probe-adjustments-e2e` | 用户「补充说明重新生成」链路 |
| `probe-peer-contract-e2e` / `probe-opening-e2e` / `probe-guidance-e2e` / `probe-consolidator-e2e` | 课堂各 skill |
| `probe-probe-scoring-e2e` / `probe-triage-advisory-e2e` | 探测题确定性判分 / 分诊只落库 |
| `probe-material-{upload,path-e2e,teaching-turn,learn-wiring}` | 附件 → 路径 → 任务 → 课堂 全链 |
| `probe-teaching-visual-{courses,model}` | 教学配图时机 / 模型能否输出 `visual` |
| `probe-session-eval-shadow` | 会话评估影子（真实数据，不调 LLM） |

> 探针的共同设计：**走生产入口**（不另写组装路径）+ **只读或可清理**（`--keep` 决定是否留数据）。

### 3.4 数据回填 / 修复（默认 dry-run）

`backfill-concept-{graph,registry}`（概念图边 / 概念身份）· `backfill-{metric-path-identity,path-subject}` · `consolidate-misconceptions`（误解台账归并）· `dedupe-memory-traces` · `repair-learning-metric-scale` · `cleanup-{field-routings,orphan-field-routings,retired-field-data,test-paths}` · `kc-annotation-refresh`（用**当前已发布**契约重跑既有路径；默认**拒绝**重跑有痕迹的路径）

### 3.5 离线评测（`eval-*`，不落库）

`eval-path-review`（真实路径跑 path-reviewer，`--replan` 可 dry 跑重规划）· `eval-concept-load`（LLM 档位 vs 旧正则）· `eval-triage-judge`（60 例分流判据准确率）· `eval-systemone-{cognition,triage}`（外部模型离线对照）

### 3.6 运维 / 数据库

| 脚本 | 说明 |
|---|---|
| `prune-virtual-learners.ts` | 清理临时 VL；`--apply` 前**自动备份**；保留 `builtin_*@preset.local` |
| `wake-hanging-sessions.ts` | 收束悬挂会话（走 `SessionFinalizationService`，不直接改库）；`--dry` 只报告 |
| `purge-soft-deleted-users.ts` | 物理删除已软删用户（合规/存储） |
| `vacuum-database.ts` | SQLite 空间回收（`log-retention` 只删行不缩文件） |
| `clear-deprecated-prompt-model.ts` | 清理 `agent_prompts.model` 上的模型绑定副本 |
| `migrate-database-secrets.ts` / `migrate-mcp-secrets.ts` | 密钥迁移 |
| `adopt-prisma-baseline.ts` / `verify-prisma-clean-replay.ts` | Prisma baseline 采纳 / 干净重放 |
| `audit-sensitive-storage.ts --apply` | 权限审计 / 修复 |

### 3.7 提示词工程

| 脚本 | 说明 |
|---|---|
| `compile-core-file.ts` | **单点编译**（并行开发必用）：默认 dry-run，`--write` 才落盘；避免 `compile-all` 盖掉别人 WIP |
| `compile-core-files.ts` | 全量编译（= `prompts:compile-all`）⚠️ **并行开发期间慎用** |
| `ensure-core-agent-prompts.ts` | `--sync` / `--bootstrap` / `--backfill`（= `prompts:sync` 等） |
| `seed-field-routings.ts` | 字段路由三表 seed（CI / 手动） |
| `field-routing-orchestration-sync.ts` | 编排文件 → 三表全量对账 upsert |
| `generate-agent-snapshots.ts --check` / `generate-agents-self-intro.ts` | 生成 `prompts/agent-snapshots.md` / `AGENTS_SELF_INTRO.md` |
| `check-material-collector.ts` | material-collector **真跑**冒烟（真 search / fetch / LLM） |
| `export-material-demo.ts` | 附件→路径→任务→课堂 导成自包含 HTML |
| `verify-kv-prefix-cache.ts` | 连调 goal 3 次看 TTFT / 缓存命中 |

### 3.8 外挂能力冒烟

`check-web-search`（`search:check`）· `check-web-fetch`（`fetch:check`）· `check-text-to-image`（`image:check`）· `check-mcp-client`（`mcp:check`）

### 3.9 全链验证 / 重放

| 脚本 | 说明 |
|---|---|
| `verify-from-zero.ts` | **从零**验证：新建 VL → 生成路径 → 上课 → 跨天 → 再上课 |
| `simulate-learner-days.ts` | 日期模拟（把路径隔离/总负担/信号区分固化成可回归断言） |
| `simulate-learner-e2e.ts` | 端到端跑数 harness（见 §2） |
| `replay-path-planning.ts` | **只重放 path 一步**（复用历史 Goal 产出，跳过 Goal 对话）；只读、不落库 |
| `trigger-path-generation.ts` | 触发一次完整路径生成（生产同款函数） |
| `verify-warmup-loop.ts` / `verify-concept-dualwrite.ts` / `verify-kc-identity.ts` | 温故闭环 / 概念双写 / KC 身份度量 |
| `verify-orchestration-{edit-side,http}.ts` / `verify-scaffold-e2e.ts` | 编排编辑侧 / scaffold 一条龙 |

### 3.10 前端 / 设计系统

`frontend/scripts/check-design-system.mjs`（八条规则守卫；`design:check`；`--update` 更新基线）· `frontend/scripts/design-system-baseline.json`

---

## 4. 一次性脚本存档（**别当工具用**）

### 4.1 `backend/scripts/` 的一次性族

| 族 | 例子 | 为什么别用 |
|---|---|---|
| `q-*` | `q-kc-shape` / `q-graph-summary` / `q-miscon-*` / `q-trace-join` | 绑定**某个具体路径/学习者名**（默认值写死在源码里），是当时排查的探针 |
| `inspect-*` | `inspect-stage-payload` / `inspect-uicheck-*` | 打印某一次载荷/某账号的数据 |
| `check-uicheck-*` / `where-uicheck-*` | `check-uicheck-lesson` / `where-uicheck-adjustments` | 绑定 uicheck 测试账号 |
| `.log` | `vlearner-goal-e2e*.log`（8 个） | 跑批日志残留，**不是脚本** |
| 其它 | `tmp-turn-split.py` | 临时片段 |

> 这些多数**未入库**或入库但无自述——建议按 §5 归档。

### 4.2 未入库（CI 看不到，换机器就丢）

- `scripts/`：`admin-audit-results/`（JSON 产物）、`material-strategy-probe.py`
- `backend/scripts/`：`q-consolidator-abort.ts`、`tmp-turn-split.py`、8 个 `vlearner-goal-e2e*.log`

### 4.3 已有归档先例

`scripts/archive/`（`failure-*.mjs` 12 个、`run-vl-retry*.mjs` 3 个、`vlab-test-result*.mjs`、`qoder-search2.mjs`，含 `README.md`）——**归档已经有约定，照它做**。

---

## 5. 二次开发约定（新增脚本往哪放）

1. **正式工具 → `backend/src/scripts/`**（TS + `npx ts-node --transpile-only`）。
2. **跑批/演示 → `scripts/`**（`.mjs`，从仓库根 `node` 跑）。
3. **头部必须写清四件事**：用途 / 用法（含示例）/ 参数 / 纪律（是否只读、是否 dry-run 默认）。
4. **破坏性操作**：默认 dry-run，`--apply` 才写；必要时先自动备份（照 `prune-virtual-learners.ts`）。
5. **绑具体数据的排查脚本**：跑完就挪进 `scripts/archive/`（或直接删），别留在主目录。
6. **常用链路**考虑挂 `npm run` 别名（根 `package.json`），让新人不翻目录就能用。
7. **别入库**：日志、产物、含真实教学会话的数据（`data/`、`text/` 见 `.gitignore` 与 `SECURITY.md`）。

---

## 6. 附：已有 npm 入口速查

| 命令 | 作用 |
|---|---|
| `npm run dev` | 跨平台开发入口（`scripts/dev-entry.mjs`） |
| `npm run ci:status [-- --branch=develop --runs=5 --logs]` | CI 状态回看 |
| `npm run security:scan:current` / `:history` | 密钥扫描 |
| `npm run check:quality` / `check:test` / `check:build` / `check` | 与 CI 三个 job 一一对应 |
| `npm run prompts:check` | = `prompts:check:all`（11 道提示词门禁串） |
| `npm run prompts:core:check` / `prompts:runtime-contract:check` | core hash / 运行时契约 |
| `npm run prompts:sync` / `prompts:bootstrap` / `prompts:backfill-core` | 提示词入库 |
| `npm run prompts:compile-all` | ⚠️ 全量编译（并行开发期间会盖别人 WIP） |
| `npm run prompts:snapshots` / `prompts:self-intro` | 重生成快照 / 自述手册 |
| `npm run boundaries:check` | 路由层 DB 边界 |
| `npm run design:check` | 前端设计系统守卫 |
| `npm run verify:kv-prefix-cache` | KV 前缀缓存验证 |
| `npm run search:check` / `fetch:check` / `image:check` / `mcp:check` | 外挂能力冒烟 |

---

## 附：本文档的取材方式

脚本清单由只读脚本生成（三个目录全量 + 头部注释 + 用法行），再人工核对关键链路（虚拟学习者 / 门禁 / 探针）。
未展开的目录：`scripts/deep-run/`、`scripts/agent-audit/`、`scripts/admin-audit-results/`（产物）、`backend/scripts` 中未列出的 `check-*`/`inspect-*` 变体。
