# Referee Mini-Batch 病历单（2026-11-13）

> 目标：按「跑 Case → 评审挖问题 → 优化 → 换下一个 Case」的闭环，先做第 1 步——**批量跑黑盒会话、攒 referee 结构化病历单，当轮不改任何 YAML/提示词**；然后再按「≥2 次或 critical」做 Step 2 的代码工单。
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
- `--max-tasks=N` 采样收口（Step 1 是诊断，不是完成率）；
- 汇总只把「≥2 个 case 命中」或 `critical` 的 finding 列为 actionable；
- 额外从后端日志按 sessionId 统计裁判看不到的运行时事实（epistemic 降级 / LLM 失败 / Path 等待超时）；
- **code 归一化**：裁判同一现象会输出多种 code，先归一再聚类（见第五节）。

## 二、试点：u17（HTTP 缓存与并发，明确不写代码）

- Goal 4 轮收敛，路径 **3 阶段 / 12 课**，教学 12/12 课完成，会话 `completed`；
- referee：`verdict=pass_with_concerns`，overall 87；Goal 88 / Path 84 / Teaching 90 / control 87 / boundary 90 / evidence 86；
- 4 条 finding：路径生成承诺 10-60 秒实际 18 分钟（major）、`qps→path` 等内部记号泄漏（minor）、教师引用不可证的「板上/图上」（minor）、裁判输入截断 22 条（info）。

试点同时暴露两个运行时缺陷：

1. **黑盒 autopilot Path 等待上限 10 分钟 < 真实生成时长**（实测 13-20 分钟），会话永久停在 path；
2. **黑盒每个教学回合的 epistemic-grounding 都被路由冻结校验打回**：
   `API route provider changed: expected skill:virtual-learner-learn-turn-simulator, received skill:virtual-learner-epistemic-grounding`。

## 三、7 例 mini-batch 结果（并发 3，每例采样 3 课）

| case | 领域 | 终态 | verdict | overall | 主要 finding |
| --- | --- | --- | --- | --- | --- |
| u01-labor-contract | 法律 | abandoned（采样） | pass_with_concerns | 82 | 路径生成延迟、范围从五类收到三类、Meno 闸通过 |
| u04-financial-statements | 财务 | failed | fail | 80 | 教学中途被顶掉（critical）、路径生成停顿、容量提示滞后 |
| u07-paper-abstract | 学术阅读 | abandoned（采样） | pass_with_concerns | 77 | 路径延迟、第三节 20 轮不收敛、任务主题从英文摘要漂到中文期刊指南、板/图不可证 |
| u13-keynote-speech | 表达 | failed | fail | 83 | 延伸课被合成用户权限 403 顶成 BLACKBOX_STEP_FAILED（critical）、路径生成 20 分钟、Goal 代定主张 |
| u17-http-cache-concurrency | 概念 | completed | pass_with_concerns | 87 | 路径延迟、内部记号泄漏、板/图不可证、轨迹截断 |
| u19-vague-communication | 模糊目标 | abandoned（采样） | pass_with_concerns | 85 | 路径延迟、任务生成停顿、goalCompleted 提前置位、Goal 重构质量高 |
| u20-vague-econ-news | 模糊目标 | abandoned（采样） | pass_with_concerns | 84 | 路径延迟、control 阶段跳变、任务完成回执滞后、Goal 范围收窄好 |

**结论：7/7 生成路径；Goal 理解与 Teaching 本体质量普遍高（Meno 闸全过）；问题集中在「等待/状态机/收口」，不是「会不会教」。**

## 四、跨样本聚类（≥2 次或 critical）

| 聚类 | 次数 | 严重度 | 证据 |
| --- | --- | --- | --- |
| `PATH_GENERATION_LATENCY` | 7/7（8 条 finding） | major | 承诺 10-60 秒，实际 96 秒 - 20 分钟；路径 active 后阶段任务还要再等 5 分半；期间 only `abandon`，无进度/ETA |
| `CONTROL_STAGE_MISMATCH_GOAL_COMPLETED` | 2/2（u19/u20） | major | Goal 刚说「开始排」就把 `platformStage=completed`、`goalCompleted=true`，随后又回到 `generating` |
| `CONTROL_TERMINAL_FAILURE` | 2/2（u04/u13） | **critical** | u04：step 超时后同 key 重试撞上已推进的课堂 revision（「课堂已在其他页面更新」）；u13：延伸课端点未登记合成用户白名单（「合成用户不允许访问该接口」） |
| `TEACHING_BOARD_UNVERIFIABLE` | 2/2（u07/u17） | minor | 教师反复引用「板上左栏」「看图上那一格」，publicTrace 里没有任何板/图内容 |

**单样本 watchlist（本轮不修，避免过拟合）**：`GOAL_SCOPE_DRIFT`（u01 五类→三类）、`SESSION_NEVER_TERMINATES`（u07 收尾循环 20 轮）、`TASK_TOPIC_DRIFT`（u07 英文摘要→中文期刊指南）、`TEACHING_NOTATION_LEAK`（u17 `qps→path`）、`CONTROL_TASK_COMPLETION_LAG`（u20）、`TRACE_TRUNCATED`（u13）、`GOAL_ACCEPTS_LEARNER_DELEGATION`（u13）。

**采样伪问题（已排除，不当平台缺陷）**：`SAMPLING_ABANDONED_MID_TASK`（3 例）、`METRICS_INCOMPLETE`（3 例）——都是 `--max-tasks=3` 主动 abandon 的必然结果。

## 五、关键元发现：裁判的「稳定 code」并不稳定

同一个「路径生成慢」在 7 个 case 里输出了 8 种写法：
`PATH_GENERATION_LATENCY` / `path_generation_latency` / `path_generation_stall` /
`PATH_GENERATION_STALL_LONG` / `PATH_GENERATION_STALL` / `PATH_GENERATION_LONG_STALL` /
`path_generation_exceeds_promise` / `PATH_TASK_GENERATION_STALL`。

按原文聚类会把 7/7 的共性问题拆成 7 个单例，直接违反「≥2 次才修」的规则。跑数器已加确定性别名归一（`canonicalFindingCode`），只用于跨样本归因，不改裁判输出。下一轮应考虑：

- 给 referee 的 `code` 加枚举/字典约束，或在裁判后处理层维护 canonical map；
- 把 `info` 与 `positive` finding 从待修池剔除（否则「Meno 闸通过 ×2」会被误判成病灶）。

## 六、运行时证据（裁判看不到，但确定性存在）

| 现象 | 覆盖 | 处理 |
| --- | --- | --- |
| epistemic-grounding 每回合被路由冻结校验打回，降级为 null | 7/7，单例 19-87 次 | **已修**：只有本阶段主模拟器套冻结路由，旁路 skill 走平台正常路由（`simulator-route-policy.ts`） |
| 黑盒 autopilot Path 等待 10 分钟误杀 | u17 | **已修**：`AUTOPILOT_PATH_WAIT_LIMIT_MS` 默认 45 分钟，env 可覆盖 |
| step 超时后同 key 重试撞已推进的课堂 revision | u04 | **未修**（高风险，需对账语义改造） |
| 延伸课端点未进合成用户白名单 | u13 | **已修**：`extension-session` 登记 `teaching:write` |

## 七、Step 2 已落地的代码工单（未动 YAML）

1. **path 生成承诺与真实时延对齐**（7/7）：
   - `goal-conversation.exit.ts` / `goal-conversation-rejudge.ts`：10-60 秒 → 5-20 分钟；
   - `path-views.queries.ts`：生成中/阶段任务生成中的提示补「可以先忙别的，稍后回来」；
   - 单测 36 条通过。
2. **control 阶段归一**（2/2）：
   - `platform-user-adapter.ts`：`platformStage` 不再透传 `core.stage`/`path.status`，统一为 `goal/path/teaching/completed/error`；
   - 新增回归断言，消除 `completed → generating` 跳变。
3. **认知判决路由**（7/7 runtime）：
   - 新增 `simulator-route-policy.ts`；只有 goal-dialogue / learn-turn 主模拟器套冻结路由；
   - 新增 4 条单测。
4. **延伸课合成用户权限**（u13 critical）：
   - `synthetic-projection.middleware.ts` 登记 `POST /api/ai-teaching/tasks/:id/extension-session`；
   - 单测通过。

### 单例真机验证（u01，2 课采样）

修复后重跑 u01（新会话 `e3fb1ccf…`）：

- `认知判决失败` 日志计数：**36 → 0**；
- `platformStage` 序列：`goal → path → teaching → completed`，不再出现 `completed → generating` 跳变；
- 路径生成文案已变为「通常需要 5-20 分钟…可以先忙别的」，实际 5.5 分钟就绪；
- referee：`verdict=pass`，overall 86，controlConsistency **90**（修复前 72/87）；
- 剩余 minor：5.5 分钟等待仍无进度条、第 2 个里程碑未达、紧迫场景下拒绝代写但没给「最小可用话术」台阶。

## 八、下一轮优先级

1. **step 超时对账**（u04 critical）：超时后先 observe 对比 teaching revision，已推进则按已应用处理；未推进才换新 commandId 重试。
2. **收尾不终止**（u07 major）：教学已具备 `confirm_complete` 仍循环 20 轮，需要编排层收敛/循环打断。
3. **板/图不可证**（2/2 minor）：要么把板/图内容写入 publicTrace，要么禁止教师在不可见时引用。
4. **Goal 范围裁剪**（u01 minor）：五类风险被收成三类，需在 Goal 确认时显式说明「本次不覆盖哪几类」。
5. **任务主题漂移**（u07 minor）：生成任务与路径里程碑/原始目标做一致性校验。
