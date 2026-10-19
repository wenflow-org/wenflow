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

**证据**：`doc/local/runs/20261019/judge4-out/2026-10-19/`（verdicts 150 + summary.json，judgeVersion `judge2:e67ceef3aace:deepseek-v4.1-flash:t0.2:k3`）；判分器入库 `backend/scripts/measurement-verify/class-audit-judge.mjs`（`--selftest` 装配 150 节、不调模型）；对照产物 v2：`doc/local/runs/20261019/judge2-out/`、v3 早期口径 4.7%：`judge3-out/`（该口径因「passed 后不凭自由文本判定」漏掉残余类，定版采用规则③口径）。

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
