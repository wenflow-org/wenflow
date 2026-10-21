# 冻结考卷 × 双臂协议（#85）— 2026-10-18 落地版

**定位**：把一次性的 ab-class-audit 实验变成可重复流程，让「判分/教学改动到底有没有用」不再每次重新论证可比性。
2026-10-18 落协议与冻结集；2026-10-19 收口：冻结语料与本协议**入库** `doc/measurement/`，校验/判定脚本化（`backend/scripts/measurement-verify/frozen-exam-run.mjs`），并登记**首个已记录对照对**（结论见《平台测量质量报告（首版）》，未达标、实际反升）。

## 一、组件

| 组件 | 位置 | 说明 |
|---|---|---|
| 冻结评判样本集 | `doc/measurement/frozen-exam-2026-10-18/`（原 `doc/local/frozen-eval-2026-10-18/`，2026-10-19 移动入库） | 109 条已判 verdict（35 条错答放行，基线 32.1%），逐文件 sha256 见 `manifest.json`；README 写明用途与纪元 |
| 判定/聚合 runner | `backend/scripts/measurement-verify/frozen-exam-run.mjs`（npm: `measurement:frozen-exam`） | `--verify` 校验 manifest sha256+基线（不符非零退出）；`--compare` 聚合两臂按 F1-b 判定；`--selftest` 零额度自测 |
| 判据脚本 | `doc/local/runs/20261002/ab-class-audit.mjs`（本地工具，不入库） | 产出 `verdict.patterns` 五个模式：`progressInflation` / `loopStuck` / `summaryMismatch` / `wrongAnswerPassed` / `unclosedComplete`；2026-10-19 起默认冻结集指向仓内新路径（旧路径 fallback） |
| 臂定义 | 真实课堂源（VL 语料或真人会话） | A 臂 = 基线；B 臂 = 待验证改动（提示词/判分/难度控制），两臂同源同题 |
| 读数 | `verdicts/*.json` 聚合 | 主指标 `wrongAnswerPassed` 率；次指标四模式率 |

## 二、运行步骤（每次改判分或教学规则后）

1. 校验冻结集未变：`node backend/scripts/measurement-verify/frozen-exam-run.mjs --verify`（逐文件 sha256 + 基线复算；不符退出码 2）——有差异即作废本次对照。**`--compare` 已把它变成硬门禁：不带 `--verify-frozen` 直接拒跑。**
2. 用同一份判据脚本（版本号写进产物）对 A/B 两臂的**同一批课堂**各跑一遍；课堂清单与哈希一并记录。每臂再写一份**条件清单 JSON**（见下）。
3. 聚合两臂的 `wrongAnswerPassed` 与四模式率，产出对照表（含样本量）；`frozen-exam-run.mjs --compare --verify-frozen --arm-a <dir|file> --arm-b <dir|file> --arm-a-conditions a.json --arm-b-conditions b.json` 可直接出表与判定。
4. 判定：F1-b（错答放行）在 B 臂相对 A 臂**下降 ≥10 个百分点**且样本量 ≥35/臂 → 通过；未达样本量只登记不裁决。
5. 把对照表、条件清单与脚本版本写进《平台测量质量报告》：首版 `doc/measurement/PLATFORM-MEASUREMENT-QUALITY-REPORT-2026-10-19.md`（2026-10-19 产出）。

### 条件清单（2026-10-20 起必填）

每臂一份 JSON，九个字段缺一不可；`topP` / `seed` 允许显式 `null`，但键必须存在（「没写」与「写了 null」是两种事实）。

| 字段 | 约束 | 作用 |
|---|---|---|
| `modelSnapshot` | 非空字符串（如 `deepseek-v4.1-flash@2026-10-17`） | 锁定上游模型，防「同 id 静默换模型」 |
| `promptHash` | 非空字符串（`sha256:...` 或等价的稳定 id） | 锁定提示词版本 |
| `temperature` / `topP` / `maxTokens` / `seed` / `k` | 有限数；**两臂必须一致** | 防生成参数漂移；`k` 是重复次数 |
| `coverage` | 0..1；两臂均 ≥0.95 且相差 ≤0.02 | 覆盖不完整时聚合不可信 |
| `judgeVersion` | 非空字符串；**两臂必须一致** | 同一把尺子；写进产物 |

拒绝条件（退出码 1）：`JUDGE_VERSION_MISMATCH`、`PARAM_MISMATCH`、`COVERAGE_BELOW_FLOOR`、`COVERAGE_GAP`、`NO_TREATMENT`（两臂 `modelSnapshot` 与 `promptHash` 完全相同 = 没有处理变量）。`modelSnapshot`/`promptHash` 允许两臂不同——它们就是被对照的变量，产物里会写明 `differing`。

可直接复制的模板：`doc/measurement/condition-manifest.example.json`。跑对照前建议先执行
`npm --prefix backend run measurement:check`（校验所有含 `condition` 的 JSON 与冻结集 manifest 结构）。

## 三、当前状态（2026-10-20 更新）

- 冻结集：**已入库**（`doc/measurement/frozen-exam-2026-10-18/`，109 条、基线 32.1%，sha256 109/109 符）。
- 协议：**本文件（已入库）**。
- 双臂运行机制：**会话级臂标签已落地**（见§六）——`simulationConfig.experimentArm` 让同一后端、同一任务集上
  **交错**跑 A/B 两臂，不再依赖「换 commit / 换库」的时间序列对照。
- 双臂实跑：**首个已记录对照对**（离线重判：同一 109 样本、B 臂 = 换判分流水线重跑）→ 35/109 = 32.1% vs 39/109 = 35.8%（净增 4），判定**未达标（实际反升）**；**下一个活体对照对已定**：A 臂 = 关闭 #84 后续回合肯定语护栏，B 臂 = 现行口径（护栏开启），各 ≥35 节同源同题课堂（§六）。
- 《平台测量质量报告》：**首版已产出**（路径见§二.5），§三已登记 v2/v3/v4.1 判分器基线（26.7% / 目标 ≤16.7%）。

## 四、记录

- 2026-10-18：协议 + 冻结集（109 条，基线 35/109 = 32.1%）落地于 `doc/local/`（未入库）。
- 2026-10-18/19：离线重判对照（B 臂 = evig1 判分流水线，epoch-1 归档库只读）→ 35/109 → 39/109，both 22 / cleared 13 / added 17 / neither 57；按 F1-b 判定**未达标（实际反升）**。证据：`doc/local/runs/20261019/ab-class-audit/`。
- 2026-10-19（#85 收口）：冻结语料与协议移动入库 `doc/measurement/`；runner 入库（默认路径指新位置，旧 `doc/local` 路径保留 fallback）；《平台测量质量报告》首版产出；本协议登记上述对照对。

## 五、红线

- 冻结集只读；任何修改都必须新建 `doc/measurement/frozen-exam-<date>/` 而不是改旧目录。
- 两臂必须同源同题；跨纪元（epoch-1 vs epoch-2）数据不得混算。
- 结论只在样本量与协议都满足时给；样本不足一律标「待样本」，不凭单批拍板。

## 六、活体双臂的臂标签（2026-10-20 落地）

**目的**：让「同一后端、同一任务集、交错跑两臂」成为可执行流程，避免用「换 commit / 换库」做时间序列
对照（报告§三已明确非交错对照只登记不裁决）。

**臂标签**：会话级 `stageResults.simulationConfig.experimentArm`，取值 `'A' | 'B' | null`：

| 臂 | 标签 | 口径 |
|---|---|---|
| A | `'A'` | 关闭 #84「失败检查点概念的后续回合肯定语护栏」（`36fc5662`），复现护栏前口径 |
| B | `'B'` 或缺省 | 现行口径（护栏开启）——**正常路径零变化** |

**设置方式**（管理员会话配置接口，已支持）：

```
PUT /api/admin/virtual-learners/sessions/:sessionId/simulation-config
body: { "experimentArm": "A" }   // null 清除标签
```

标签只影响该会话的教学回合：`executeLearningStep` 读到 `'A'` 时向教学引擎显式传
`failedConceptFollowupGuard=false`（`ProcessStudentMessageOptions`，默认 true）；其余路径不读该字段。
单测：`backend/src/coordinators/__tests__/simulation.coordinator.experiment-arm.test.ts`。

**一次对照的最小流程**：

1. `npm run measurement:frozen-exam -- --verify`（在 `backend/` 下）确认冻结集未变；活体两臂不涉及冻结 verdict，
   但判分器版本必须与报告§三同口径（v4.1，`JUDGE_REV` 写进产物）。
2. 选同一任务集与同一批人设；每个任务在 A/B 各上一次课，**交错排队**（A1/B1/A2/B2…）以抵消时段效应；
   每次开课前用上面的接口写臂标签，并记录 `sessionId → arm` 清单。
3. 每臂 ≥35 节后，用同一判据脚本（v4.1）各自出 verdict 到 `verdicts/arm-a/`、`verdicts/arm-b/`；
   判据脚本按会话清单过滤，不按时间窗混算（机器时钟/模拟日均可）。
4. 聚合与判定：
   `npm run measurement:frozen-exam -- --compare --arm-a <dir> --arm-b <dir> --min-per-arm 35 --min-drop-pp 10`
   退出码 0 通过 / 3 样本不足（只登记）/ 4 未达标。
5. 把对照表、臂清单、判分器版本写进《平台测量质量报告》新增章节；样本不足时**只登记**。

**为什么 A 臂要关护栏而不是换 commit**：活体课堂依赖当前 HEAD 的完整链路（含判分真值注入、延伸课、时钟），
换 commit 会把多个变量一起换掉；臂标签只切换被检验的那一条规则，其余条件（任务集、人设、模型、判分器）保持同源。
