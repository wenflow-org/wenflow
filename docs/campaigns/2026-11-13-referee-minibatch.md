# Referee Mini-Batch 病历单（2026-11-13）

> 目标：按「跑 Case → 评审挖问题 → 优化 → 换下一个 Case」的闭环，先只做第 1 步——**批量跑黑盒会话、攒 referee 结构化病历单，当轮不改任何 YAML/提示词**。
>
> 分支：`feat/unattended-20case-sim`（不合并 develop）。

## 一、为什么不是直接复用前 20 例

Referee 在 `virtual-lab/blackbox-runner.ts` 有硬门禁：

- `experiment.mode === 'blackbox-api'`；
- 会话必须是 `completed / abandoned / failed` 终态。

前 20 例走的是 assisted 会话（harness 自己驱动 goal/advance-day），没有 `publicTrace`，裁判无法出报告。绕开这个门禁等于改产品语义，所以 mini-batch 改走平台正式的黑盒链路：

```
建虚拟学习者（手写故事）
  → POST /api/admin/virtual-learners/:id/start-blackbox-session
  → POST /api/admin/virtual-learners/sessions/:id/autopilot/start { target: final }
  → 轮询到终态
  → POST /api/admin/session-audits/sessions/:id/evaluations
       ├─ platform = referee（verdict/scores/findings/recommendations/evidence）
       └─ actor    = actor-auditor（角色保真/摩擦校准）
```

跑数器：`backend/scripts/run-referee-minibatch.mjs`

- 共享一次管理员登录，避免并发登录互踢；
- 每个 case 落 `state.json`（会话/autopilot 时间线）与 `result.json`（裁判原文）；
- autopilot 可恢复退出时自动重启续跑（最多 3 次）；超时才 stop + abandon 收口；
- 汇总只把「≥2 个 case 命中」或 `critical` 的 finding 列为 actionable，单样本先当噪音；
- 额外从后端日志按 sessionId 统计裁判看不到的运行时事实（epistemic 降级 / LLM 失败 / Path 等待超时）。

## 二、试点：u17（HTTP 缓存与并发，明确不写代码）

### 链路结果

- Goal 4 轮收敛，路径 **3 阶段 / 12 课**，全程不写代码；
- 教学 12/12 课完成，会话 `completed`；
- referee：`verdict=pass_with_concerns`，overall 87；Goal 88 / Path 84 / Teaching 90 / control 87 / boundary 90 / evidence 86。

### 裁判病历单（原文要点）

| code | severity | 事实 |
| --- | --- | --- |
| `path_generation_exceeds_promise` | major | 22:19:21 告知「通常 10-60 秒内完成」，直到 22:37:15 才出现可开始任务，实际约 18 分钟；期间 `availableActions` 长期只有 `abandon` |
| `internal_notation_leaked_to_learner` | minor | 后段教学出现 `qps→path`、`limit→cap`、`write`、`cap` 等未定义记号，与「全程不碰代码」承诺冲突 |
| `teaching_references_unverifiable_board` | minor | 教师反复说「板上左栏/右栏」「看图上那一格」，publicTrace 中没有任何可视化渲染证据 |
| `trace_truncated_input_coverage` | info | originalPublicTraceCount=142、included=120，22 条轨迹未纳入裁判 |

### 试点暴露的运行时缺陷

1. **黑盒 autopilot 的 Path 等待上限 10 分钟 < 真实生成时长**：实测 4 阶段 20-25 分钟，试点 3 阶段也用了约 18 分钟。旧逻辑在 10 分钟处判「无进展」自杀，会话永久停在 path，既学不到课也出不了裁判报告。
   - 已修：`AUTOPILOT_PATH_WAIT_LIMIT_MS` 默认 45 分钟（env 可覆盖），文案按实际分钟数输出；跑数器同时保留可恢复重启。
2. **黑盒每个教学回合的 epistemic-grounding 都被路由冻结校验打回**：
   - 日志：`API route provider changed: expected skill:virtual-learner-learn-turn-simulator, received skill:virtual-learner-epistemic-grounding`
   - 结果：认知判决恒降级为 null，学习者认知信号缺失；裁判只能看到「学习者表现」而看不到根因。
   - 本轮只记录，不在 Step 1 修改（属于 Virtual Lab 运行时路由设计，不是提示词补丁）。

## 三、Mini-Batch 跑数（7 例异构）

| case | 领域 | 考察 |
| --- | --- | --- |
| u01-labor-contract | 法律 | 私有合同 + 公开法条补位、条款审查 |
| u04-financial-statements | 财务 | 真实年报、三表勾稽、数字推理 |
| u07-paper-abstract | 学术阅读 | 英文论文、证据强度 |
| u13-keynote-speech | 表达/写作 | 长文产出、纯文本边界 |
| u17-http-cache-concurrency | 概念 | 明确禁代码、术语真名 |
| u19-vague-communication | 模糊目标 | Goal 收敛、防一节课 |
| u20-vague-econ-news | 模糊目标/时事 | 范围收窄、高时效材料 |

- 并发 3，单 case 超时 180 分钟，每课回合上限 24；
- 本轮**不修改任何 YAML / 提示词 / 业务规则**；
- 产出：`backend/.runtime/referee-minibatch/2026-11-13/summary.json` + `report.md`（gitignored），本文件只归档结论。

## 四、下一轮（Step 2）

1. 读 `summary.json` 的 `actionable`：只处理出现 ≥2 次或 `critical` 的 finding；
2. 区分代码工单 vs 提示词补丁：
   - 代码：路径生成时长与承诺不一致、visual board 渲染证据、trace 截断、epistemic 路由；
   - 提示词：内部记号泄漏（如确实由教学提示词引入）；
3. YAML 只改不增：收紧/合并既有根规则，不追加新编号；
4. 双门禁 + 5 个黄金锚点回归（蓝屏直答、游泳劝退、合同 2 阶段、通识课体量、路径不剧透），任一退化先回滚再人工裁决。
