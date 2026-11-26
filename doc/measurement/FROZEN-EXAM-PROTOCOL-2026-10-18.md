# 冻结考卷 × 双臂协议

> 📌 类型：活规范（判分/教学改动是否有效的对照协议）｜索引见 [doc/README.md](../README.md)。

**定位**：把一次性的课堂审计实验变成可重复流程，「判分/教学改动到底有没有用」不再每次重新论证可比性。冻结语料与本协议入库 `doc/measurement/`，校验与判定由 `backend/scripts/measurement-verify/frozen-exam-run.mjs` 执行；每一对对照的结果登记在[《平台测量质量报告》](./PLATFORM-MEASUREMENT-QUALITY-REPORT-2026-10-19.md)。

## 一、组件

| 组件 | 位置 | 说明 |
|---|---|---|
| 冻结评判样本集 | `doc/measurement/frozen-exam-2026-10-18/` | 109 条已判 verdict（35 条错答放行，基线 32.1%），逐文件 sha256 见 `manifest.json`；README 写明用途与纪元 |
| 判定/聚合 runner | `backend/scripts/measurement-verify/frozen-exam-run.mjs`（npm: `measurement:frozen-exam`） | `--verify` 校验 manifest sha256 + 基线（不符非零退出）；`--compare` 聚合两臂并按 F1-b 判定；`--selftest` 零额度自测 |
| 判分器 | `backend/scripts/measurement-verify/class-audit-judge.mjs`（口径见 §五） | 产出 `verdict.patterns` 五个模式：`progressInflation` / `loopStuck` / `summaryMismatch` / `wrongAnswerPassed` / `unclosedComplete`；跑批产物留在本机 `doc/local/runs/`，不入库 |
| 臂定义 | 真实课堂源（虚拟学习者语料或真人会话） | A 臂 = 基线；B 臂 = 待验证改动（提示词/判分/难度控制），两臂同源同题 |
| 读数 | `verdicts/*.json` 聚合 | 主指标 `wrongAnswerPassed` 率；次指标四模式率 |

## 二、运行步骤（每次改判分或教学规则后）

1. 校验冻结集未变：`node backend/scripts/measurement-verify/frozen-exam-run.mjs --verify`（逐文件 sha256 + 基线复算；不符退出码 2）——有差异即作废本次对照。`--compare` 已把它变成硬门禁：不带 `--verify-frozen` 直接拒跑。
2. 用同一份判分器（版本号写进产物）对 A/B 两臂的**同一批课堂**各跑一遍；课堂清单与哈希一并记录。每臂再写一份**条件清单 JSON**（见下）。
3. 聚合两臂的 `wrongAnswerPassed` 与四模式率，产出对照表（含样本量）；`frozen-exam-run.mjs --compare --verify-frozen --arm-a <dir|file> --arm-b <dir|file> --arm-a-conditions a.json --arm-b-conditions b.json` 可直接出表与判定。
4. 判定：F1-b（错答放行）在 B 臂相对 A 臂**下降 ≥10 个百分点**且样本量 ≥35/臂 → 通过；未达样本量只登记不裁决。
5. 把对照表、条件清单与判分器版本登记进《平台测量质量报告》。

### 条件清单（必填）

每臂一份 JSON，九个字段缺一不可；`topP` / `seed` 允许显式 `null`，但键必须存在（「没写」与「写了 null」是两种事实）。

| 字段 | 约束 | 作用 |
|---|---|---|
| `modelSnapshot` | 非空字符串（如 `deepseek-v4.1-flash@2026-10-17`） | 锁定上游模型，防「同 id 静默换模型」 |
| `promptHash` | 非空字符串（`sha256:...` 或等价的稳定 id） | 锁定提示词版本 |
| `temperature` / `topP` / `maxTokens` / `seed` / `k` | 有限数；**两臂必须一致** | 防生成参数漂移；`k` 是重复次数 |
| `coverage` | 0..1；两臂均 ≥0.95 且相差 ≤0.02 | 覆盖不完整时聚合不可信 |
| `judgeVersion` | 非空字符串；**两臂必须一致** | 同一把尺子；写进产物 |

拒绝条件（退出码 1）：`JUDGE_VERSION_MISMATCH`、`PARAM_MISMATCH`、`COVERAGE_BELOW_FLOOR`、`COVERAGE_GAP`、`NO_TREATMENT`（两臂 `modelSnapshot` 与 `promptHash` 完全相同 = 没有处理变量）。`modelSnapshot` / `promptHash` 允许两臂不同——它们就是被对照的变量，产物里会写明 `differing`。

可直接复制的模板：`doc/measurement/condition-manifest.example.json`。跑对照前先执行 `npm --prefix backend run measurement:check`（校验所有含 `condition` 的 JSON 与冻结集 manifest 结构）。

## 三、基线与已裁决对照

详细数字、配对明细与局限见《平台测量质量报告》，这里只列结论：

| 对照 | 样本 | 结果 | 判定 |
|---|---|---|---|
| 冻结集基线（epoch-1 语料） | 109 条 | 错答放行 35 条（32.1%） | 基线 |
| 判分流水线换代在冻结集上的偏移（离线重判） | 109 / 109 | 32.1% → 35.8% | 未达标（实际反升） |
| 判分一致性基线（epoch-2 语料，现行判分口径） | 150 节 | 26.7%（40/150） | 距 10pp 下降判据的目标 ≤16.7% |
| 活体双臂：失败检查点肯定语护栏（§六） | A 109 / B 51 | 14.7% → 9.8%（−4.9pp） | fail（已裁决的未通过） |

## 四、红线

- 冻结集只读；任何修改都必须新建 `doc/measurement/frozen-exam-<date>/` 而不是改旧目录。
- 两臂必须同源同题；跨纪元（epoch-1 vs epoch-2）数据不得混算。
- 结论只在样本量与协议都满足时给；样本不足一律标「待样本」，不凭单批拍板。

## 五、判分口径

单次 LLM 判读不稳（同 prompt 重判 Jaccard 仅 42.3%），且缺检查点真值时误报高发，所以判分器 `class-audit-judge.mjs` 采用三层加固：

1. 每条课堂独立判 K 次，逐 pattern 取多数（≥2）；
2. 每个判 true 的 pattern 必须附**逐字引文**，引文在文本中找不到即降级为 false；
3. 案例块注入**检查点真值**（题干、判分来源、结果、所选，以及代码判分的「正确 X，作答 Y」明细），并明确两条判定纪律：`passed` 且明细一致 → 不得凭自由文本判放行；`failed` 后仍被肯定或总结称掌握 → 是放行。

答案键只以代码判分明细为准，不以游离字段呈现——游离键会被错配给历史检查点，造成「明细写明一致却判放行」的误报。

`judgeVersion`（prompt 哈希 + 模型/温度/K）随每条 verdict 与 summary 落档；跨版本不比较。

## 六、活体双臂的臂标签

**目的**：让「同一后端、同一任务集、交错跑两臂」成为可执行流程。活体课堂依赖当前 HEAD 的完整链路，换 commit 会把多个变量一起换掉；臂标签只切换被检验的那一条规则。

**臂标签**：会话级 `stageResults.simulationConfig.experimentArm`，取值 `'A' | 'B' | null`。

| 臂 | 标签 | 口径 |
|---|---|---|
| A | `'A'` | 关闭「失败检查点概念的后续回合肯定语护栏」，复现护栏前口径 |
| B | `'B'` 或缺省 | 现行口径（护栏开启）；正常路径零变化 |

**设置方式**（管理员会话配置接口）：

```
PUT /api/admin/virtual-learners/sessions/:sessionId/simulation-config
body: { "experimentArm": "A" }   // null 清除标签
```

标签只影响该会话的教学回合：`executeLearningStep` 读到 `'A'` 时向教学引擎显式传 `failedConceptFollowupGuard=false`（`ProcessStudentMessageOptions`，默认 true）；其余路径不读该字段。单测：`backend/src/coordinators/__tests__/simulation.coordinator.experiment-arm.test.ts`。

**一次对照的最小流程**：

1. `npm run measurement:frozen-exam -- --verify`（在 `backend/` 下）确认冻结集未变；活体两臂不涉及冻结 verdict，但判分器版本必须与报告登记的基线同口径（`JUDGE_REV` 写进产物）。
2. 选同一任务集与同一批人设；每个任务在 A/B 各上一次课，**交错排队**（A1/B1/A2/B2…）以抵消时段效应；每次开课前用上面的接口写臂标签，并记录 `sessionId → arm` 清单。
3. 每臂 ≥35 节后，用同一判分器各自出 verdict 到 `verdicts/arm-a/`、`verdicts/arm-b/`；判分器按会话清单过滤，不按时间窗混算（机器时钟/模拟日均可）。
4. 聚合与判定：`npm run measurement:frozen-exam -- --compare --arm-a <dir> --arm-b <dir> --min-per-arm 35 --min-drop-pp 10`；退出码 0 通过 / 3 样本不足（只登记）/ 4 未达标。
5. 把对照表、臂清单、判分器版本登记进《平台测量质量报告》；样本不足时**只登记**。
