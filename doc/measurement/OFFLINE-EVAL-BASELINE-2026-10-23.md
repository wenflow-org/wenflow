# 离线 LLM 评审 · 基线（2026-10-23）

> 工具：`backend/scripts/offline-eval/run.mjs`（设计见 `doc/measurement/OFFLINE_EVAL_DESIGN.md`）
> 决策模型：`deepseek-v4.1-flash`（ds4.1），K=3，temperature=0.2
> judgeVersion：`offline-classroom-v1:6a026d8285e6:deepseek-v4.1-flash:t0.2:k3`
> 　　　　　　 `offline-path-v1:28436e592c87:deepseek-v4.1-flash:t0.2:k3`
> 样本：近 365 天、窗口内等距抽样各 20 例；课堂 19 虚拟 / 1 真实，路径 5 虚拟 / 15 真实。

## 一、结论先行

1. **课堂的整体讲解质量不差，但收口是系统性缺陷**：均分 0.757，软通过（均分 ≥0.70）16/20 = 80%；但硬判定 pass 只有 2/20 = 10%。差距几乎全部来自 `unclosedComplete`（17/20 = 85%）与 `summaryMismatch`（10/20 = 50%），`closure` 维度均分只有 0.47。典型模式：老师抛出最后一个验证问题，学员还没答，课堂就被标为 complete；结课总结把老师的示范或讲解写成「学员已经说出/算出」。
2. **路径的结构与任务具体性尚可，前置完整性和课时口径是主要短板**：均分 0.783，pass 13/20 = 65%，软通过 18/20 = 90%。`integrity` 0.694、`granularity` 0.67 明显低于 `specificity` 0.885 与 `feasibility` 0.861。`prerequisiteGap` 6/20 = 30%，`budgetMismatch` 7/20 = 35%，`duplicateTask` 4/20 = 20%；`domainViolation` 与 `placeholderTask` 为 0。
3. **错答放行在本样本里只有 5%（1/20）**，与 #85 历史回溯分组的 A 臂 14.7% 不是同一口径/时段，不能直接比较；本样本以近期自建路径课为主，且检查点真值已注入。

## 二、课堂质量（n=20）

| 维度 | 均分 | 95% CI | 权重 |
|---|---:|---|---:|
| 目标贴合 | 0.838 | ±0.045 | 0.15 |
| 诊断敏感度 | 0.744 | ±0.062 | 0.15 |
| 讲解质量 | 0.797 | ±0.050 | 0.15 |
| 回应性 | 0.810 | ±0.061 | 0.15 |
| 参与带动 | 0.755 | ±0.063 | 0.15 |
| 事实准确性 | 0.787 | ±0.052 | 0.15 |
| **收口与总结一致** | **0.470** | ±0.099 | 0.10 |

| 二元问题 | 命中 | 比例 |
|---|---:|---:|
| 未答收口 `unclosedComplete` | 17 | 85% |
| 总结失真 `summaryMismatch` | 10 | 50% |
| 循环卡壳 `loopStuck` | 3 | 15% |
| 错答被肯定/放行 `wrongAnswerPassed` | 1 | 5% |
| 编造事实/内容 `fabricatedContent` | 0 | 0% |

- 均分 0.757（95% CI ±0.038）；硬 pass 2/20 = 10%，软 pass 16/20 = 80%。
- 按账号：虚拟 19 例 pass 10.5% / 均分 0.754；真实 1 例 pass 0 / 均分 0.800（样本太小，不作比较）。
- 高频 issue：closure 高 51 条、closure 中 30 条、diagnosis 中 30 条、scaffolding 中 20 条。

**代表案例（逐字引文已核验）**

- 「最后一步，用你自己的话说一句：一个格子的『44』和『28』分别告诉你什么，为什么排班光看 44 不够？」——学员未作答即 complete。
- 结课总结写「均由学生自己算出」，实际其中一题是老师提醒后才补算（summaryMismatch）。

## 三、路径生成质量（n=20）

| 维度 | 均分 | 95% CI | 权重 |
|---|---:|---|---:|
| 目标贴合 | 0.841 | ±0.032 | 0.20 |
| **结构完整性** | **0.694** | ±0.057 | 0.20 |
| **粒度与课时** | **0.670** | ±0.070 | 0.15 |
| 任务具体性 | 0.885 | ±0.031 | 0.15 |
| 递进与复用 | 0.756 | ±0.039 | 0.15 |
| 平台可行性 | 0.861 | ±0.036 | 0.15 |

| 二元问题 | 命中 | 比例 |
|---|---:|---:|
| 课时与预算明显不符 `budgetMismatch` | 7 | 35% |
| 前置缺失/顺序错误 `prerequisiteGap` | 6 | 30% |
| 任务重复 `duplicateTask` | 4 | 20% |
| 越界承诺 `domainViolation` | 0 | 0% |
| 占位/空泛任务 `placeholderTask` | 0 | 0% |

- 均分 0.783（95% CI ±0.023）；硬 pass 13/20 = 65%，软 pass 18/20 = 90%。
- 按账号：虚拟 5 例 pass 40% / 均分 0.787；真实 15 例 pass 73.3% / 均分 0.782。

**代表案例**

- 阶段 2 只标注了两科大纲，阶段 3 却按「四科权重」分学时 → prerequisiteGap（经济/管理之外两科从未引入）。
- 学习者可用时间 1 小时、路径总预计 90 分钟、估算又写 3 小时 → budgetMismatch 与口径不一致同时出现。
- 两个阶段各有一个「把拆分结果与忙闲记录对照」的任务，实质重复 → duplicateTask。

## 四、口径与边界

- **这是 LLM 判断，不是人工真值**；只应在同一 judgeVersion 内横向比较，跨版本（换模型/改 prompt/K）不比较。
- 每个 true flag 都经过逐字引文核验；引文不在案例块中的 flag 已降级为 false（本次未出现因引文缺失而降级的 flag）。
- 课堂样本 19/20 是虚拟学习者：结论只代表「模拟课堂行为质量」，不能直接外推真实学习者。路径样本真实账号占 15/20，代表性更好。
- 硬 pass 规则对 `unclosedComplete`/`summaryMismatch` 一票否决，因此 pass 率低不等于整体质量差；报告同时给出软 pass 率。
- 本基线**不能**替代 #85 的冻结考卷双臂协议：后者测「护栏是否降低错答放行」，本工具测「已跑完任务的整体质量画像」。
- 数据源为 `backend/prisma/dev.db` 只读；本次运行未写任何业务表。

## 五、下一步建议

1. **收口缺陷（优先级最高）**：在结课链路里加「最后一个待答问题未闭合 → 不允许 complete」的硬闸门（或自动生成一个待验证项）；同时让 wrapup 生成只引用学员实际产出。课堂上 85% 的未答收口说明这不是个别案例。
2. **路径前置完整性**：生成期或 `path-reviewer` 增加「后继任务依赖的产出是否在前置阶段出现」的机械校验（利用 `kcAnnotation.conceptKcs` / `taskKcLinks` 与任务标题匹配），比 LLM 事后发现更便宜。
3. **课时口径统一**：同一路径的 `estimatedHours`、`budgetConservation.target`、学习者可用时间三者需要在生成时对齐；当前 35% 的 budgetMismatch 多半是口径不一致而非真实超载。
4. 扩样本后按 `promptVersion` / 模型分层，观察哪一代生成器在 integrity/granularity 上退化。

## 六、复现

```bash
# 自检
node backend/scripts/offline-eval/run.mjs --selftest

# 本次基线（20+20，K=3，窗口内等距抽样）
node backend/scripts/offline-eval/run.mjs --target=all --limit=20 --days=365 --k=3 --conc=6
```

产物（本地、gitignored）：`doc/local/runs/offline-eval/baseline-20261023/`
（`*-verdicts.jsonl`、`*-summary.json`、`report-*.md`）。
