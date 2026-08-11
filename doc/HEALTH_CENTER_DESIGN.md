# 健康中心（漂移/健康提醒中心）设计

> 状态：已实现（backend `GET /api/admin/health-center` + `POST /api/admin/health-center/fix`，frontend 编排结构页顶部健康区）

## 1. 定位

把分散在脚本/服务里的漂移与对账检查聚合为**统一健康区**，位于 admin 编排结构页（Orchestrator）顶部：

- 每条检查带：严重度（ok/warn/error）、一句话成因、动作（一键修复 / 查看明细 / 人工决策）
- 机械可修项支持一键修复，修复动作写入 `node_config_changes` 审计（`changeType='health-fix'`），形成「检测 → 修复 → 复检 → 审计」闭环
- 全部**复用既有纯函数/装配函数**，禁止复制逻辑；修复先备份，失败不影响原状态

## 2. 分级模型

| 严重度 | 含义 | 前端色标 | 示例 |
|---|---|---|---|
| `error` | 影响运行时正确性/产物一致性 | 红 | W4 漂移、字段路由漂移、快照漂移、parity error |
| `warn` | 存量漂移/差集，不阻断运行 | 琥珀 | fields-sync 孤儿、W1/W2/W3 差集 |
| `ok` | 检查通过 | 绿 | — |

动作矩阵：

| action | 含义 | 端点行为 | 覆盖项 |
|---|---|---|---|
| `fixable` | 机械可修 | `POST /fix` 执行（备份→修复→复检→审计） | w4-corehash / field-routing / snapshots |
| `manual` | 需人工决策 | `POST /fix` 返回 409 + 指引 | fields-sync / w1-active / w2-registration / w3-wiring / yaml-crosscheck / contract-parity |
| `none` | 仅观察（预留） | 不提供修复 | — |

## 3. 检查清单（9 项）

| id | label | 数据源（复用点） | 判定 | action |
|---|---|---|---|---|
| `w4-corehash` | 核心文件漂移（W4） | `analyzeCoreHashParity`（check-core-hash-parity.ts）；W4 薄壳 `analyzeW4`（skills-readiness.service.ts） | drifted 数 > 0 → error | fixable |
| `field-routing` | 字段路由漂移 | `detectFieldRoutingDrift`（field-routing-bootstrap.service.ts） | driftCount > 0 → error | fixable |
| `fields-sync` | Core↔编排字段同步 | `analyzeCoreFieldsSync`（check-core-fields-sync.ts） | 缺项→error；孤儿/类型不一致→warn | manual |
| `w1-active` | ACTIVE 覆盖（W1） | `analyzeW1`（skills-readiness.service.ts） | items > 0 → warn | manual |
| `w2-registration` | 注册对账（W2） | `analyzeW2` | items > 0 → warn | manual |
| `w3-wiring` | 接线对账（W3） | `analyzeW3` | items > 0 → warn | manual |
| `snapshots` | 沙盘说明书快照 | `checkAgentSnapshotsDrift`（generate-agent-snapshots.ts，渲染逻辑复用） | drifted → error | fixable |
| `yaml-crosscheck` | YAML 词表交叉校验 | `runYamlVocabularyCheck`（check-yaml-vocabulary.ts，main 逻辑提取为导出函数） | errors > 0 → error | manual |
| `contract-parity` | 契约 metadata parity | `analyzePromptRuntimeContractMetadataParity`（check-prompt-runtime-contract-metadata-parity.ts） | hasErrors → error | manual |

聚合实现 `buildHealthCenterReport`（backend/src/services/health-center.service.ts）：

- 一次 `scanPromptFiles()`、一次户口簿 `loadSkillsBookRaw()`、4 组 DB 查询（ACTIVE 行 / skill_registrations / 漂移三表 / parity 行）
- W1~W5 直接喂 `analyzeSkillReadiness`（复用纯分析层，不重复扫描）
- 快照与 yaml 检查为轻量读盘（编排文件 + core/manifest），全量在端点内可接受；60s 内存缓存兜底（`?refresh=1` 强制）

## 4. 修复动作矩阵

| id | 修复执行（复用） | 备份 | 改动 git 跟踪文件 | 审计 |
|---|---|---|---|---|
| `w4-corehash` | `compileAllCorePromptFiles()`（compile-core-files.ts）+ `ensureCoreAgentPrompts(db,'sync')`（seed-core-agent-prompts.ts） | `prompts/backups/health-fix/<ts>/` 全量 skill.*.md | 是（skill.*.md）→ 响应提示 git 提交 | ✓ |
| `field-routing` | `syncStageFieldRoutingsFromFile` 逐 stage 全量对账（field-routing-bootstrap.service.ts；route/CLI 同源） | 无（仅 DB） | 否 | ✓ |
| `snapshots` | `generateAgentSnapshotsContent()` + 写 `prompts/agent-snapshots.md` | 同上备份该文件 | 是（agent-snapshots.md）→ 提示 git 提交 | ✓ |

审计记录：`node_config_changes`，`changeType='health-fix'`，`targetTable=检查 id`，`before/after` 为严重度/状态/数量摘要 JSON，`actorId` 取自 admin 会话。

## 5. 实现落点

| 层 | 文件 |
|---|---|
| 聚合+修复服务 | `backend/src/services/health-center.service.ts`（DI 设计：`HealthCenterFixDeps` 注入编译/同步/渲染函数，测试可 mock） |
| 路由 | `backend/src/routes/admin/health-center.ts`（`GET /`、`POST /fix`；挂载 `/api/admin/health-center`） |
| 前端组件 | `frontend/src/views/admin-redesign/HealthCenter.vue`（顶部摘要条 + 可折叠清单 + 一键修复/查看跳转 + toast） |
| 前端接入 | `Orchestrator.vue` 顶部状态条新增「健康区」展开按钮（demo 模式隐藏）；`adminApi.ts` 增 `adminHealthCenterApi` + 类型 |
| 测试 | `backend/src/services/__tests__/health-center.service.test.ts`（聚合结构/缓存/fix 三分支）、`backend/src/routes/admin/__tests__/health-center.test.ts`（路由契约） |

复用重构（无逻辑复制，仅提取/收敛）：

- `check-yaml-vocabulary.ts`：main() 主体提取为导出 `runYamlVocabularyCheck()`（CLI 保持行为）
- `generate-agent-snapshots.ts`：`render()` 导出为 `generateAgentSnapshotsContent()` + `checkAgentSnapshotsDrift()`，CLI --check 复用
- `field-routing-bootstrap.service.ts`：新增 `syncStageFieldRoutingsFromFile()`（全量对账唯一实现），route `/orchestration/:stage/sync` 与 CLI 脚本改为调用它

## 6. 验收口径

- W4 当前 0 → `w4-corehash` severity=ok / status=clean / action=fixable
- fields-sync 当前孤儿 5（warn）→ severity=warn / status=orphan / action=manual
- `POST /fix` 对 manual 项 → 409 + fixHint 指引；对 fixable 项 → 备份目录生成、审计写入、复检返回

## 7. 已知边界

- 一键修复只在当前进程内生效到 DB 与磁盘产物；`skill.*.md` / `agent-snapshots.md` 为 git 跟踪文件，响应必须提示提交
- 聚合端点读盘全量执行约数百 ms（首次）；60s 缓存后常态命中
- `contract-parity` 未开放一键修复（其修复路径与 w4 的 DB 同步等价，指引用户走 w4）
