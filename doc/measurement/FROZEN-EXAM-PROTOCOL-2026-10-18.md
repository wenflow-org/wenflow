# 冻结考卷 × 双臂协议（#85）— 2026-10-18 落地版

**定位**：把一次性的 ab-class-audit 实验变成可重复流程，让「判分/教学改动到底有没有用」不再每次重新论证可比性。
2026-10-18 落协议与冻结集；2026-10-19 收口：冻结语料与本协议**入库** `doc/measurement/`，校验/判定脚本化（`backend/scripts/measurement-verify/frozen-exam-run.mjs`），并登记**首个已记录对照对**（结论见《平台测量质量报告（首版）》，未达标、实际反升）。

## 一、组件

| 组件 | 位置 | 说明 |
|---|---|---|
| 冻结评判样本集 | `doc/measurement/frozen-exam-2026-10-18/`（原 `doc/local/frozen-eval-2026-10-18/`，2026-10-19 移动入库） | 109 条已判 verdict（35 条错答放行，基线 32.1%），逐文件 sha256 见 `manifest.json`；README 写明用途与纪元 |
| 校验/判定 runner | `backend/scripts/measurement-verify/frozen-exam-run.mjs`（仓内；纯函数在 `frozen-exam-core.mjs`） | `--verify` 校验 manifest sha256+基线（不符非零退出）；`--compare` 聚合两臂按 F1-b 判定；`--selftest` 零额度自测 |
| 判据脚本 | `doc/local/runs/20261002/ab-class-audit.mjs`（本地工具，不入库） | 产出 `verdict.patterns` 五个模式：`progressInflation` / `loopStuck` / `summaryMismatch` / `wrongAnswerPassed` / `unclosedComplete`；2026-10-19 起默认冻结集指向仓内新路径（旧路径 fallback） |
| 臂定义 | 真实课堂源（VL 语料或真人会话） | A 臂 = 基线；B 臂 = 待验证改动（提示词/判分/难度控制），两臂同源同题 |
| 读数 | `verdicts/*.json` 聚合 | 主指标 `wrongAnswerPassed` 率；次指标四模式率 |

## 二、运行步骤（每次改判分或教学规则后）

1. 校验冻结集未变：`node backend/scripts/measurement-verify/frozen-exam-run.mjs --verify`（逐文件 sha256 + 基线复算；不符退出码 2）——有差异即作废本次对照。
2. 用同一份判据脚本（版本号写进产物）对 A/B 两臂的**同一批课堂**各跑一遍；课堂清单与哈希一并记录。
3. 聚合两臂的 `wrongAnswerPassed` 与四模式率，产出对照表（含样本量）；`frozen-exam-run.mjs --compare --arm-a <dir|file> --arm-b <dir|file>` 可直接出表与判定。
4. 判定：F1-b（错答放行）在 B 臂相对 A 臂**下降 ≥10 个百分点**且样本量 ≥35/臂 → 通过；未达样本量只登记不裁决。
5. 把对照表与脚本版本写进《平台测量质量报告》：首版 `doc/measurement/PLATFORM-MEASUREMENT-QUALITY-REPORT-2026-10-19.md`（2026-10-19 产出）。

## 三、当前状态（2026-10-19 更新）

- 冻结集：**已入库**（`doc/measurement/frozen-exam-2026-10-18/`，109 条、基线 32.1%，sha256 109/109 符）。
- 协议：**本文件（已入库）**。
- 双臂实跑：**首个已记录对照对**（离线重判：同一 109 样本、B 臂 = 换判分流水线重跑）→ 35/109 = 32.1% vs 39/109 = 35.8%（净增 4），判定**未达标（实际反升）**；**真正的变体批次仍待定**（需改判分/教学规则的实际变体与两臂各 ≥35 条同源同题课堂）。
- 《平台测量质量报告》：**首版已产出**（路径见§二.5）。

## 四、记录

- 2026-10-18：协议 + 冻结集（109 条，基线 35/109 = 32.1%）落地于 `doc/local/`（未入库）。
- 2026-10-18/19：离线重判对照（B 臂 = evig1 判分流水线，epoch-1 归档库只读）→ 35/109 → 39/109，both 22 / cleared 13 / added 17 / neither 57；按 F1-b 判定**未达标（实际反升）**。证据：`doc/local/runs/20261019/ab-class-audit/`。
- 2026-10-19（#85 收口）：冻结语料与协议移动入库 `doc/measurement/`；runner 入库（默认路径指新位置，旧 `doc/local` 路径保留 fallback）；《平台测量质量报告》首版产出；本协议登记上述对照对。

## 五、红线

- 冻结集只读；任何修改都必须新建 `doc/measurement/frozen-exam-<date>/` 而不是改旧目录。
- 两臂必须同源同题；跨纪元（epoch-1 vs epoch-2）数据不得混算。
- 结论只在样本量与协议都满足时给；样本不足一律标「待样本」，不凭单批拍板。
