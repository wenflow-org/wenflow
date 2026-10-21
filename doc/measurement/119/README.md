# #119 goal→path 读数复算包（2026-10-20）

本目录把 issue #119 的验收读数从「只有本机 DB + 资料库才能重算」变成**离线可复算**：
`backend/src/scripts/recompute-goal-path-readings.ts` 只读本目录，不连 DB、不走网络。

## 1. 为什么需要这个包

原读数来自 2026-10-19 的 20 goal 路径生成批（`new` 臂）。复算有两个障碍：

1. 证据只落在 gitignored 的 `doc/local/` 与 `data/`，远端 clone 拿不到；
2. **口径混用**：`zeroRefStages` 只数任务级引用，而「后半引用」「refPct」把里程碑级也算进去。
   任务级实测 233 条、里程碑级 105 条（合计 338），于是从路径对象复算 zeroRef 得 0/74，
   而 issue 里写的是 3/74。两个口径都对，混着引用才错。

## 2. 文件

| 文件 | 作用 | 引用口径 |
| --- | --- | --- |
| `run-1792388187455.json` | 生成产物索引：20 goal × `new` 臂（pathId/userId/计数/耗时） | — |
| `merged-1792388275960.json` | 与历史批合并的对照。**注意 `old` 是 10-17 的 `new` 臂改名**（`arms.old.arm = "new"`），不是真 A/B | — |
| `dual-metric-1792430145340.json` | 逐 ref 的 chunk 分位 / section 分位明细（全量 `detail`）+ totals。2026-10-20 用当前脚本对同一 run 重算 | `combined` |
| `semantic-alignment-1792388305106.json` | 逐阶段 `refPct`（引用 cos 在阶段窗口内的分位） | `combined`（字段为 2026-10-20 补标：生成时脚本只有该口径） |
| `coverage-1792388275960.json` | 20 路径逐阶段引用分布快照（任务级 / 里程碑级 / 合计），从 `aiPromptTemplate.materialRefs.byTask/byStage` 只读抽取 | 三列并列 |
| `manifest.json` | 定版信息：commit、模型、各文件 sha256、23 份夹具 sha256、期望读数、复跑命令 | — |

**不入库**：`backend/prisma/dev.db`（`.gitignore: *.db`）与 `backend/data/uploads/materials/**`
（`.gitignore: data/`，带版权的资料正文）。后者只登记 sha256，外部如需正文请向本机持有人索取并校验。

## 3. 口径定义

- **task（任务级）**：只看 `subtasks[].materialRefs`。与 `_generation.materialCoverage.refs` /
  `zeroRefStages` 同口径；零引用补课的守卫对象。
- **combined（里程碑级 + 任务级）**：再看 `milestone.materialRefs`。与「后半引用」「refPct」同口径。
- 生成侧从 2026-10-20 起在 `materialCoverage` 同时落 `milestoneRefs` / `combinedRefs` /
  `zeroCombinedRefStages`，并标 `refScope: "task"`（`backend/src/services/learning/generation/stage-enrichment.ts`）。
  本包的路径是改动前生成的，快照里的三列由抽取脚本按同一规则算出。

## 4. 期望读数（`manifest.json → expected`）

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

## 5. 复算

```bash
cd backend
npx ts-node --transpile-only src/scripts/recompute-goal-path-readings.ts --bundle=../doc/measurement/119
# 退出码 0 = 三组读数与 manifest.expected 全部一致；1 = 不一致；2 = 工件缺失
```

逐件重跑（需要 DB + 本机资料库，不走网络；`verify-goal-path-section-metric` 会读
`learning_paths.aiPromptTemplate` 与本地资料正文）：

```bash
cd backend
npx ts-node --transpile-only src/scripts/verify-goal-path-section-metric.ts \
  --run=../doc/measurement/119/run-1792388187455.json --refScope=combined
npx ts-node --transpile-only src/scripts/verify-semantic-stage-alignment.ts \
  --run=../doc/measurement/119/run-1792388187455.json --refScope=combined
```

## 6. 真 A/B 尚未跑（未完成项）

`ab-goal-path-material.ts` 已修：

- `old` 臂现在同时置 `MATERIAL_PACK_SEMANTIC_DISABLED=1`、`STAGE_MATERIAL_SEMANTIC_ORDER=0`、
  `STAGE_MATERIAL_QUOTA_RERANK=0`、`STAGE_MATERIAL_ZERO_REF_SUPPLEMENT=0`；`new` 臂回落到进程基线
  （避免 old 残留污染 new）。
- 夹具按 `--fixtureManifest` 的 sha256 选择，指纹不符直接失败；去掉 `library[i % length]` 兜底。
- 产物默认写 `doc/measurement/119/`，并生成 `run-<ts>.manifest.json`（commit / model / 夹具 sha256 / 开关）。
- `--dryRun` 只做夹具选择与指纹核对，不生成、不耗额度。

**真 A/B 复跑仍需用户/运维执行**（20 goal ×2 臂 ≈ 90 分钟模型与 embedding 额度）：

```bash
npm --prefix backend run material:ab:goal-path -- --goals=20 --arms=both \
  --fixtureManifest=../doc/measurement/119/manifest.json
```

在此之前，`merged-1792388275960.json` 里的 `old` 列**不能**当基线用。
