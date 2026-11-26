# goal→path 资料引用读数复算包

> 📌 类型：参考资料（20 例 goal→path 资料引用读数、口径与复算命令）｜索引见 [doc/README.md](../../README.md)。

本目录是 goal→path 资料引用读数的**离线复算包**：`backend/src/scripts/recompute-goal-path-readings.ts` 只读本目录，不连 DB、不走网络。

## 1. 文件

| 文件 | 作用 | 引用口径 |
| --- | --- | --- |
| `run-1792388187455.json` | 生成产物索引：20 goal × `new` 臂（pathId/userId/计数/耗时） | — |
| `merged-1792388275960.json` | 与历史批合并的对照。**`old` 列是早期的 `new` 臂改名**（`arms.old.arm = "new"`），不是真 A/B，**不能当基线用** | — |
| `dual-metric-1792430145340.json` | 逐 ref 的 chunk 分位 / section 分位明细（全量 `detail`）+ totals | `combined` |
| `semantic-alignment-1792388305106.json` | 逐阶段 `refPct`（引用 cos 在阶段窗口内的分位） | `combined` |
| `coverage-1792388275960.json` | 20 路径逐阶段引用分布快照（任务级 / 里程碑级 / 合计），从 `aiPromptTemplate.materialRefs.byTask/byStage` 只读抽取 | 三列并列 |
| `manifest.json` | 定版信息：commit、模型、各文件 sha256、23 份夹具 sha256、期望读数、复跑命令 | — |

**不入库**：`backend/prisma/dev.db`（`.gitignore: *.db`）与 `backend/data/uploads/materials/**`（带版权的资料正文）。后者只登记 sha256，外部如需正文请向本机持有人索取并校验。

## 2. 口径定义

- **task（任务级）**：只看 `subtasks[].materialRefs`。与 `_generation.materialCoverage.refs` / `zeroRefStages` 同口径；零引用补课的守卫对象。
- **combined（里程碑级 + 任务级）**：再看 `milestone.materialRefs`。与「后半引用」「refPct」同口径。

两个口径都对，混着引用才错：同一批路径，任务级 zeroRef 是 3/74，里程碑级 + 任务级是 0/74。引用读数必须连同口径一起报。

生成侧在 `materialCoverage` 同时落 `milestoneRefs` / `combinedRefs` / `zeroCombinedRefStages`，并标 `refScope: "task"`（`backend/src/services/learning/generation/stage-enrichment.ts`）。本包的路径生成于该改动之前，快照里的三列由抽取脚本按同一规则算出。

## 3. 期望读数（`manifest.json → expected`）

| 读数 | 值 |
| --- | --- |
| 阶段数 | 74 |
| zeroRef（task） | **3/74**：`cpa-accounting:s4`、`high-school-history:s4`、`diabetes-guide:s2` |
| zeroRef（combined） | **0/74** |
| 引用总数（combined） | 338（task 233 + milestone 105） |
| chunk 后半 | 97/338 = 28.7% |
| section 后半 | 117/338 = 34.6% |
| 仅 section 命中 | 37 |
| refPct 均值 | 0.7331（74 阶段） |

## 4. 复算

```bash
cd backend
npx ts-node --transpile-only src/scripts/recompute-goal-path-readings.ts --bundle=../doc/measurement/119
# 退出码 0 = 三组读数与 manifest.expected 全部一致；1 = 不一致；2 = 工件缺失
```

逐件重跑（需要 DB + 本机资料库，不走网络）：

```bash
cd backend
npx ts-node --transpile-only src/scripts/verify-goal-path-section-metric.ts \
  --run=../doc/measurement/119/run-1792388187455.json --refScope=combined
npx ts-node --transpile-only src/scripts/verify-semantic-stage-alignment.ts \
  --run=../doc/measurement/119/run-1792388187455.json --refScope=combined
```

## 5. 真 A/B

`ab-goal-path-material.ts` 以 `--fixtureManifest` 的 sha256 选择夹具，指纹不符直接失败；产物默认写 `doc/measurement/119/`，并生成 `run-<ts>.manifest.json`（commit / model / 夹具 sha256 / 开关）。`--dryRun` 只做夹具选择与指纹核对，不生成、不耗额度。

```bash
npm --prefix backend run material:ab:goal-path -- --goals=20 --arms=both \
  --fixtureManifest=../doc/measurement/119/manifest.json
```
