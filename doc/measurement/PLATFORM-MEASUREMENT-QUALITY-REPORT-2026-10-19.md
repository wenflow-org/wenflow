# 平台测量质量报告（首版）— 2026-10-19

**定位**：按《冻结考卷 × 双臂协议》（`doc/measurement/FROZEN-EXAM-PROTOCOL-2026-10-18.md`）登记平台**测量质量**的对照记录。首版只含**第一对已记录对照**：A 臂 = 冻结基线，B 臂 = 2026-10-18 的离线重判。前身 R4 版（2026-10-06）留在本地 `doc/local/R4-MEASUREMENT-QUALITY-2026-10-06.md`，不入库，与本报告不是同一口径。

## 一、协议摘要（判据本体）

- **冻结样本**：109 条已判 verdict，逐文件 sha256 固定在 `doc/measurement/frozen-exam-2026-10-18/manifest.json`（仓内受跟踪）；对照前先跑 `--verify`，**任何一处 sha256 不符即作废本次对照**。
- **样本量门槛**：A/B 两臂**各 ≥35** 条课堂；未达门槛只登记、不裁决。
- **主指标 F1-b**：错答放行（`wrongAnswerPassed`）在 B 臂相对 A 臂**下降 ≥10 个百分点** → 通过。
- **同源同题**：两臂必须同一批课堂；跨纪元（epoch-1 vs epoch-2）数据不得混算。

## 二、首个已记录对照对（重判 2026-10-18，登记 2026-10-19）

| 臂 | 口径 | 样本 | 错答放行 | 率 |
|---|---|---:|---:|---:|
| A（冻结基线） | 2026-10-02/04 三批判分原件，原样冻结 | 109 | 35 | 32.1% |
| B（本轮重判） | evig1 判分流水线离线重判同一 109 条 | 109 | 39 | 35.8% |

- **净变化**：+4 条 / +3.7pp（**反升**，非下降）。
- **逐条配对**（配对键 `batch::id`，同会话跨批各判一次、不按键去重）：both 22 ｜ cleared（旧放行→本轮通过）13 ｜ added（旧通过→本轮放行）17 ｜ neither 57；一致率 72.5%，Jaccard 42.3%，翻转 30/109。
- **判定：未达标（实际反升）**。样本量门槛已满足（109/臂 ≥35，属可裁决对照），F1-b 要求下降 ≥10pp，实际 +3.7pp，故不通过，且方向与要求相反。

**B 臂口径**：同一 109 样本、**不同判分流水线纪元**——离线重判，语料不动，只换判分（evig1）重跑。它检验的是「判分流水线换代在冻结集上的偏移」，**不是**改判分/教学规则的变体批次。

**局限**：

- 重判只跑 **epoch-1 归档库**（`backend/prisma/archive/dev.db-epoch1-final-20261008.db`，readOnly），未触及现库/epoch-2。
- 未引入新的教学或判分变体；「变体是否有效」本轮无法回答。
- 翻转量大（cleared 13 / added 17），按 AB-REPORT 的 McNemar 精确检验口径 p≈0.58，单轮不足以断言显著恶化；结论仅登记本对照对，不外推。

**证据目录**：

- B 臂与配对：`doc/local/runs/20261019/ab-class-audit/`（`AB-REPORT.md`、`verdicts/` 109 条、同目录 `../ab-class-audit.log`）
- A 臂原件与 manifest：`doc/measurement/frozen-exam-2026-10-18/verdicts/`（原 `doc/local/frozen-eval-2026-10-18/`，2026-10-19 移动入库，内容未改，sha256 109/109 符）

## 三、判分一致性补测（2026-10-19 · epoch-2 语料 · #84）

**动机**：§二 B 臂显示同 prompt 重判 Jaccard 仅 42.3%（30/109 翻转）——单次 LLM 判读的噪声足以吞掉 10pp 量级的对照判据；且判据缺**检查点真值**时误报高发。本节登记判分器本体加固后的现行率，作为后续 F1-b 对照的测量基线。

**判分器演进**（同模型 `deepseek-v4.1-flash`；`judgeVersion` 随每条 verdict 与 summary 落档）：

| 版本 | 加固 | wrongAnswerPassed 读数（epoch-2，150 节） | 三样本一致率 |
|---|---|---|---|
| v1（冻结档案口径） | 单次判读，无引文/真值锚定 | 32–36%（epoch-1 109 条，跨纪元仅供参照；重判 Jaccard 42.3%） | — |
| v2 | 多数表决 K=3 + 逐字引文锚定（引文找不到即降级为 false） | 21.3%（32/150） | 83.3% |
| v3（定版，已入库） | + 检查点真值（题干 / learner_evidence 明细「正确 X，作答 Y」/ 答案键原文）+ 判定纪律：passed 且明细一致 → 不得凭自由文本判放行；**failed 后仍被肯定或总结称掌握 → 是放行** | **26.7%（40/150）** | 81.3% |

**读数解读**：

- v2 的 32 个 flag 里约 25 个为「缺检查点真值」的上下文缺失型误报（例：C药 vs B药 的检查点选 C 本就正确，被判分器按任务级口径「最急=多巴胺」误判为放行）；引文锚定 + 真值注入后消除。
- **机械核验（不调模型）**：150 节里 code 判分 `passed=true` 但所选≠答案键的检查点为 **0**——「判分器把错答判对」这一机制不存在。残余 40 例的机制是 **failed 检查点随后仍被老师肯定 / 结课总结仍称掌握 / 知识点仍标 mastered**（抽验 8 例全部为实，含「cp3/cp4 正确 A 学员选 B 判 failed，老师随后仍称『选B很稳』」）。
- 活体护栏口径与此对齐：`36fc5662`（失败概念后续回合肯定语剥离 + 「走通了」类进展断言纳入剥离）针对的正是该残余类；下一对对照可验增量。
- **F1-b 适用性**：现行率 26.7%，距 10pp 下降判据尚有可裁决余量（目标 ≤16.7%）；臂间对照仍需同批课堂，本节仅为测量基线，不作裁决。

**判分口径修正（v4.1，2026-10-19 晚）**：v3/v4 的案例块把「最近一次发出的检查点」的答案键以游离字段呈现，判分器会把它错配给历史检查点（post-guard 批 2/2 flag 均为该误报：明细明写「与答案键一致（C）」却被判成「键 A 作答 C」）。修正=**删除游离键**，键一律以 learner_evidence 明细「选项一致（X）/不一致（正确 X，作答 Y）」为准；同时补 `--since/--before` 时间窗与 `JUDGE_REV` 口径修订号。

**护栏前/后同源对照（v4.1 同判据；非交错，登记不裁决）**：

| 臂 | 样本 | wrongAnswerPassed | 三样本一致率 |
|---|---|---|---|
| 护栏前（preset 池，10-08~10-18 课堂） | 55 | **36.4%（20/55）** | 87.3% |
| 护栏后（同日新批，同 5 个人设） | 24 | **4.2%（1/24）** | 95.8% |

- 机制侧核验：新批 24 节里 9 节有 failed 检查点；护栏遥测 2 次触发且均实际剥离（样本：「对，∠CAD=60° 完全正确！」）；9 节中残留疑似肯定句仅 1 句。
- 归因纪律：批间还差着任务内容、时点与其它已落地修复，护栏本身只证明「触发并生效 2 次」——32pp 差值不作单一归因；F1-b 意义上是强方向性证据。
- 处置：`#84` 按「问题解决即可关」关闭（测量口径已定版入库、机制已护栏且验证、遗留 wrapup 层 over-claim 与概念名漂移已在结单评论登记）。

**证据**：`doc/local/runs/20261019/judge4-out/`（v3/v4：36.4% 前为 25.5%，差异即上述错配）、`judge-v41-preset-pool/`、`judge-v41-post-guard/`（均含 verdicts + summary.json）；判分器入库 `backend/scripts/measurement-verify/class-audit-judge.mjs`（`--selftest` 装配 150 节、不调模型）。

## 四、剩余项

1. **真正的 B 臂变体批次仍待定**：协议要求两臂各 ≥35 条同源同题课堂（改判分/教学规则的实际变体）；本轮无待验变体，待提供后方可启动。
2. 判分一致性：翻转 30/109，需逐条审计 added/cleared、双人盲标 + 仲裁（清单见 `AB-REPORT.md`「还需要补什么」）。
3. 本对记录此后不得改写；下一对对照出现时在本文件追加条目并注明日期与判据版本。

## 五、证据命令清单（可复算）

```bash
# 0) 冻结集完整性（sha256 109/109 符 + 基线 35/109；不符非零退出）
node backend/scripts/measurement-verify/frozen-exam-run.mjs --verify

# 1) 干跑自检（零模型额度）：sha256 + 109 条覆盖 + 逐条装配
node doc/local/runs/20261019/ab-class-audit-winpath.mjs --selftest

# 2) B 臂离线重判（会调用模型；跑批阶段执行，产物即证据目录）
node doc/local/runs/20261019/ab-class-audit-winpath.mjs \
  --db backend/prisma/archive/dev.db-epoch1-final-20261008.db \
  --frozen doc/measurement/frozen-exam-2026-10-18 \
  --out doc/local/runs/20261019/ab-class-audit

# 3) 完结课堂审计判分（§三，定版；--selftest 不调模型）
node backend/scripts/measurement-verify/class-audit-judge.mjs --selftest
WENFLOW_AUDIT_KEY=… node backend/scripts/measurement-verify/class-audit-judge.mjs \
  --out=doc/local/runs/class-audit/2026-10-19 --conc=4
```

> 注：B 臂重判当日冻结集仍在 `doc/local/frozen-eval-2026-10-18/`（sha256 同源），2026-10-19 移动入库到现路径；重跑时给新路径即可复现同一集合。

## 六、活体双臂对照：#84 肯定语护栏（2026-10-23 判分）

协议§六的活体对照对：**A 臂 = 关闭 #84「失败检查点概念的后续回合肯定语护栏」**（`experimentArm='A'`），
**B 臂 = 现行口径（护栏开启）**。臂标签落库在 `virtual_sessions.stageResults.simulationConfig.experimentArm`，
只影响该会话的教学回合（`executeLearningStep` 显式传 `failedConceptFollowupGuard=false`），其余链路不变。

- 样本来自 2026-10-08 ~ 10-14 的预设学习者会话（同源同题，两臂交错分布在同期）；
  按 `teachingSessionHistory` 还原 sessionId → arm，筛 completed 且消息数 ≥8：
  **A 109 节 / B 51 节**（均 ≥35）。
- 判分器：`judge-v4.1:e67ceef3aace:deepseek-v4.1-flash:t0.2:k3`（两臂同一把尺子；
  证据引文无效降级 26 处，无有效样本 0 条）。
- 不复用 §三 的冻结 109 基线：纪元/判分版本不同，按协议不得混算。

| pattern | A（n=109） | B（n=51） |
|---|---|---|
| progressInflation | 61（56.0%） | 23（45.1%） |
| loopStuck | 18（16.5%） | 9（17.6%） |
| summaryMismatch | 73（67.0%） | 32（62.7%） |
| **wrongAnswerPassed** | **16（14.7%）** | **5（9.8%）** |
| unclosedComplete | 70（64.2%） | 33（64.7%） |

**F1-b 判定：fail**。错答放行下降 4.9pp（14.7% → 9.8%），未达 ≥10pp 的协议阈值；样本量已达标，
因此这是**已裁决的未通过**，不是「样本不足只登记」。

边界：臂标签由既有会话的 `stageResults` 还原，未独立复核当时是否严格 A1/B1 交错；两臂均用 v4.1 判分、
同一模型与温度，结论只在两臂之间成立，不与冻结基线横比。

复算命令（manifest 可由 `virtual_sessions` 的臂标签 + `teachingSessionHistory` 重建）：

```bash
node backend/scripts/measurement-verify/class-audit-judge.mjs --selftest --ids=<manifest.json>
WENFLOW_AUDIT_KEY=… node backend/scripts/measurement-verify/class-audit-judge.mjs \
  --ids=<manifest.json> --k=3 --conc=8 --out=outputs/ab-judge-v41-full
```

