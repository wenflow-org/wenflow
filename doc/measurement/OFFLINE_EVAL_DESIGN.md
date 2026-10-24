# 离线 LLM 评审设计（课堂质量 / 路径生成质量）

> 2026-10-23 落地。入口：`backend/scripts/offline-eval/run.mjs`。
> 决策模型：`deepseek-v4.1-flash`（ds4.1）。密钥只从环境变量读取。

## 一、要回答什么

平台已经跑完大量任务，但「跑完了」不等于「做得好」。本评审对**已完结的产物**做离线打分：

| 目标 | 数据源 | 回答的问题 |
|---|---|---|
| 课堂质量 | `teaching_sessions`（completed） | 这节课教得怎么样？诊断、讲解、回应、参与、准确性、收口是否达标？ |
| 路径生成质量 | `learning_paths` + `milestones` + `subtasks` | 这条路径是否贴合目标、结构完整、粒度合理、任务可验收、平台可执行？ |

评的是**产物质量**，不是学习者成绩。学习者是否真的学会，需要延迟后测/真实复习数据，属于 #96/#104 的范畴。

## 二、为什么不用「跑完就算过」或单一规则

- 规则只能查结构（课时、字段完整性），查不出「老师顺着错答讲下去」「总结把讲解记成学员产出」这类语义问题。
- 单次 LLM 判读不稳：同 prompt 重判会翻转（class-audit v2 实测 Jaccard 42.3%）。
- 模型会编造证据：判「错答放行」时经常给不出原话。

因此本评审继承 `class-audit-judge` v4 的三层加固，并扩展为连续维度：

1. **逐案例独立判 K 次**（默认 K=3；试点可用 1～2）；
2. **维度取中位数、flag 取多数**，verdict 由聚合值重算，不采信模型自报的 verdict；
3. **每个 true flag 必须附逐字引文**，引文归一化后不在案例块中 → 该 flag 降级为 false 并记入 `invalidQuotes`；
4. `judgeVersion`（口径名 + prompt 哈希 + 模型 + 温度 + K）随每条结论落档，跨版本不比较。

## 三、课堂 rubric

七个维度，0–1；权重合计 1.0：

| 维度 | 权重 | 评什么 |
|---|---:|---|
| goalAlignment 目标贴合 | 0.15 | 是否围绕本课任务/路径目标，有无跑题、提前跳课 |
| diagnosis 诊断敏感度 | 0.15 | 学员暴露错误概念时是否识别并探询，而非顺着讲或直接给答案 |
| explanation 讲解质量 | 0.15 | 准确、结构清晰、例子贴合水平，无术语堆砌/长独白 |
| responsiveness 回应性 | 0.15 | 是否直接回应用员这句话，有无答非所问、模板复读 |
| scaffolding 参与带动 | 0.15 | 是否拉进生成性参与（提问/复述/应用/反例），难度是否随表现调整 |
| accuracy 事实准确性 | 0.15 | 知识性陈述是否正确；不确定时是否诚实收窄 |
| closure 收口与总结一致 | 0.10 | 总结是否与对话事实一致；证据不足时是否宣布完成 |

五个二元问题（true = 有问题）：

- `wrongAnswerPassed` 错答被肯定/放行
- `summaryMismatch` 总结失真
- `unclosedComplete` 未答收口
- `loopStuck` 循环卡壳
- `fabricatedContent` 编造事实/内容

**硬失败**：`wrongAnswerPassed`、`fabricatedContent`、`unclosedComplete`、`summaryMismatch` 任一为 true；否则均分 < 0.70 判 fail。`loopStuck` 只影响分数与 issue。

案例块注入：本课任务（标题/说明/验收标准）、路径目标、知识点最终状态、检查点 ground truth（题面/判分来源/结果/所选/明细）、结课总结、**收口事实**（`finalizationAction` / `closureAudit.openQuestion` / 未答问题）、对话节选（首 4 + 均匀中段 + 末 10）。检查点真值优先于学员自由文本——沿用 v4.1 的判例，避免「所选与更窄检查点问题不一致」被误判为错答放行。

收口语义（2026-10-24 起）：`finalizationAction=end_only` 表示学员主动结束、没有结算任务，不得把「会话结束」当作「任务完成」宣称；若 `openQuestion=true` 且 actionPlan 含「待验证」，视为诚实收口，`unclosedComplete` 判 false。只有 `complete_task/complete_review` 或总结明确宣称达标、而末问未答时才判 true。

## 四、路径 rubric

以仓内 `path-reviewer` 的 CIDDP 五维为底，补「可行性」与结构事实：

| 维度 | 权重 | 评什么 |
|---|---:|---|
| goalAlignment 目标贴合 | 0.20 | 是否服务确认过的学习方向与首个交付物 |
| integrity 结构完整性 | 0.20 | 前置知识覆盖与顺序；KC 是否有对应任务；有无断链 |
| granularity 粒度与课时 | 0.15 | 里程碑/任务数量、单任务时长、总课时与预算 |
| specificity 任务具体性 | 0.15 | 是否有可观察产出/验收标准，是否「了解/理解 X」空泛 |
| progression 递进与复用 | 0.15 | 难度爬升、核心概念复用、无重复任务 |
| feasibility 平台可行性 | 0.15 | 是否只教对话平台能教/能判的内容；实体操作是否诚实收窄 |

五个二元问题：`domainViolation`（越界承诺）、`prerequisiteGap`（前置缺失/顺序错误）、`budgetMismatch`（课时与预算明显不符）、`placeholderTask`（占位/空泛任务）、`duplicateTask`（任务重复）。`domainViolation` / `prerequisiteGap` 为硬失败，其余进入均分与 issue。

案例块额外注入**代码统计的结构事实**（任务数、总分钟、预算比、验收标准覆盖、KC 覆盖、重复标题），要求模型以事实为准，不许自行重算。课时比的分母优先用 `budgetConservation.after`（守恒后计划）；`target` 是守恒前容量，用它做分母会把已声明的缩水误判成缺陷。

## 五、采样与运行

```bash
# 自检（不调模型、不写盘）
node backend/scripts/offline-eval/run.mjs --selftest

# 抽样预览（不调模型）
node backend/scripts/offline-eval/run.mjs --target=all --limit=10 --days=30 --dry-run

# 小批试跑
node backend/scripts/offline-eval/run.mjs --target=classroom --limit=20 --days=30 --k=3
node backend/scripts/offline-eval/run.mjs --target=path --limit=20 --days=30 --k=3

# 两者一起
node backend/scripts/offline-eval/run.mjs --target=all --limit=20 --days=30 --k=3
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--target` | `all` | `classroom` / `path` / `all` |
| `--limit` | 20 | 每个目标的样本上限（窗口内按时间等距抽样，避免只评最近一批） |
| `--days` | 30 | 只取最近 N 天创建的数据 |
| `--k` | 3 | 每案例独立判读次数 |
| `--conc` | 4 | 并发案例数（每案例内部 K 次并发） |
| `--scope` | all | `virtual` / `real` / `all` |
| `--email-like` | — | 只取匹配邮箱的账号（如 `builtin_%`） |
| `--ids` | — | 指定 ID 清单文件（每行一个） |
| `--min-msgs` / `--min-tasks` | 6 / 3 | 课堂/路径的最小声量门槛 |
| `--model` | ds4.1 | 决策模型（换模型会改变 judgeVersion） |
| `--dry-run` | — | 只抽样打印，不调用模型 |

环境变量（`.env` 在 gitignore 内；`.env.example` 只有占位符）：

```
OFFLINE_EVAL_API_URL=https://newapi.wenflow.org/v1/chat/completions
OFFLINE_EVAL_API_KEY=sk-your-api-key
OFFLINE_EVAL_MODEL=deepseek-v4.1-flash
```

## 六、输出

默认写入 `doc/local/runs/offline-eval/<timestamp>/`（gitignored）：

- `classroom-verdicts.jsonl` / `path-verdicts.jsonl`：每条含 K 次原始判读、聚合结果、结构指标；
- `classroom-summary.json` / `path-summary.json`：均分与 CI、pass 率与 Wilson CI、flag 率、按虚拟/真实分组、分数带、高频 issue、低分案例；
- `report-classroom.md` / `report-path.md`：可直接贴进周报/issue 的 Markdown。

## 七、成本与边界

- 成本 ≈ 案例数 × K 次调用。课堂案例块约 8–15k 字符；20 例 × K=3 约 60 次调用，单轮在十分钟量级（并发 4）。
- 评审是 LLM 判断，不是人工真值；**只应在同一 judgeVersion 内横向比较**。
- 样本以虚拟学习者为主时，结论只代表「模拟行为质量」，不能直接外推真实学习者；报告必须带虚拟/真实分栏。
- 路径评审不替代生成时的 `path-reviewer`（那是运行时闸门）；离线评审用于发现系统性缺陷与版本回归。
- 课堂评审不替代冻结考卷（#85）。冻结考卷测的是「护栏对错答的抑制效应」，本评审测的是「这节课整体教得怎么样」。

## 八、与既有评测的关系

| 工具 | 用途 | 关系 |
|---|---|---|
| `class-audit-judge.mjs` | 课堂五类问题（二元 flag，v4.1） | 本评审的课堂 flag 沿用其判例，但增加七维连续分 |
| `path-reviewer`（运行时） | 生成时五维评分，<0.75 触发重规划 | 本评审复用其维度语义，但离线、只读、不触发重规划 |
| `frozen-exam`（#85） | 冻结题面 × 双臂 F1-b | 实验协议，回答「干预是否有效」 |
| 本工具 | 已跑完任务的离线质量画像 | 回答「现在整体质量如何、退化了没有」 |

## 九、后续扩展（未做）

- 按 skill / promptVersion / model 分层出分（需要把 `prompt_call_logs` 的版本号 join 进案例块）。
- 与 `#96` 的延迟后测、`#104` 的 FSRS 校准共用同一份报告骨架。
- 人工抽核：对 `invalidQuotes` 和低分案例做人工复核，形成 judge 校准集。
