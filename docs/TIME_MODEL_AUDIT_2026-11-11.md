# 课程时间模型梳理（2026-11-11）

范围：**课程时间预算**（goal 说 8 小时，最后为什么只出 3.6/6.4 小时）。
不涉及模拟日/时区/墙钟；那条链路是 `simDay`、`baseDate`、`dayKeyOf`，与本问题无关。

## 0. 结论先行

1. **主要损耗不在 LLM**。4 阶段路径在 path-planning 的守恒层之前就是 `before=8h`，是确定性容量层把它夹到 `after=6.8h`；3 阶段路径 `before=5.5h`，被夹到 `3.8h`。
2. **8h 目标被三层依次吃掉**：
   - goal 把“未提及的单次时长”静默落成 **25 分钟**；
   - `[技能模块]` 标签把 8h 先压成 **6h**（3 阶段路径）；
   - 结构容量按“阶段数 × 每阶段任务上限 × 25 分钟”算，只得到 **3.75h / 6.67h**，守恒层再按容量下压。
3. **系统只会“封顶”，不会“补足”**。阶段设计只有 `stageMinutesBudget` 上限、`targetSubtasksForStage` 容量参考，没有“低于目标就加任务”的下限执行；最终写回的是任务单遍分钟和。
4. **reviewer 能看见欠交付，但只记 low**。3 阶段路径 reviewer 明确写了“4h vs objectiveScopeHours=8，仅为锚的一半”，severity=low，总分 0.85，passed=true。
5. **“小时”在系统里有四种语义**（内容总量 / 单次时长 / 结构容量 / 任务单遍时长），目前没有一层负责把它们对齐。

## 1. 四种“时间”先分开

| 名字 | 单位 | 谁产生 | 本意 | 现在被谁消费 |
|---|---|---|---|---|
| `objectiveScopeHours` | 小时 | goal-conversation | 内容客观需要多少（含练熟） | hints 的总预算锚 |
| `sessionsLengthMin` | 分钟 | goal-conversation / 用户原话 / 默认 25 | **一次坐下来能学多久** | 单任务分钟上界、结构容量 |
| `targetTotalHours` | 小时 | `derivePlanningHints` | 本轮路径总预算 | path-planning 守恒、stage 预算 |
| `targetHoursPerMilestone` | 小时 | `derivePlanningHints` | 每阶段预算锚 | stage-designer 的阶段锚 |
| `subtaskMinutesRange` | 分钟 | hints | 单个任务时长边界 | stage-designer / 裁剪 |
| `stageMinutesBudget` | 分钟 | stage-enrichment | 本阶段任务分钟**上限** | stage-designer 硬约束 |
| `subtask.estimatedMinutes` | 分钟 | stage-designer | **单次**任务时长 | 路径总学时、UI |
| `learning_paths.estimatedHours` | 小时 | stage-enrichment | 展示用总投入 | 路径列表/详情/看板 |
| `teaching_sessions.duration` | 分钟 | 课堂 | 实际学习时长 | 学习历史，不回写预算 |

关键：`objectiveScopeHours` 是“内容需要多少”，`sessionsLengthMin` 是“一次能坐多久”。前者大、后者小，正确做法是**增加坐学次数/任务数**；现在的做法是**把总学时压到后者撑得下的结构里**。

## 2. 全链路：产生 → 转换 → 应用

```
goal-conversation
  timeDimensions.objectiveScopeHours = 8
  timeDimensions.sessionsLengthMin = 25（用户未提，静默最小档）
        │
        ▼
derivePlanningHints
  targetMilestones = 4（keyStages=4） / 3（keyStages=3）
  subtaskMinutesRange[1] = 25
  structureStageCapacityHours = 每阶段任务上限 × 25 / 60
  targetHoursPerMilestone = min(容量, 总预算/阶段数)
  targetTotalHours = 8 / 6
        │
        ▼
path-planning
  模型先按 target 写 milestone.estimatedHours（before=8 / 5.5）
  enforceBudgetConservation:
    effectiveCeiling = min(1.8×target, 结构容量)
    before > ceiling → 等比压到 ceiling（after=6.8 / 3.8）
        │
        ▼
stage-enrichment
  stageMinutesBudget = max(阶段锚×60×1.25, 最少任务数×单任务下限)
  stage-designer 只被要求“不得超过”这个上限
  任务分钟真实值 × 25 分钟封顶，写回阶段/路径学时
        │
        ▼
UI
  路径列表/详情：learning_paths.estimatedHours
  任务行：subtask.estimatedMinutes
  看板：今日任务分钟 / plannedMinutes
```

### 关键公式

- 结构容量：`perStageCapHours = subtasksPerStageRange[1] × subtaskMinutesRange[1] / 60`
- 总容量：`capacitySum = perStageCapHours × targetMilestones`
- 每阶段锚：`targetHoursPerMilestone = min(structureStageCapacityHours, targetTotalHours / targetMilestones)`
- 单任务锚：`targetMinutesPerTask = min(subtaskMinutesRange[1], targetTotalHours×60/(targetMilestones×targetSubtasksPerStage))`
- 阶段预算上限：`stageMinutesBudget = max(round(stageHours×60×1.25), targetSubtasksForStage×minTaskMinutes)`
- 最终路径学时：`Σ subtask.estimatedMinutes/60`（阶段回写时还会先按阶段四舍五入）

## 3. 两条真实路径复算

### A. 4 阶段 / 6.4h（`lp_1794377200437_kfmunqv`）

| 环节 | 值 | 说明 |
|---|---|---|
| goal objective | 8h | 内容锚 |
| `sessionsLengthMin` | 25min | 用户未提，静默最小档 |
| scope 标签 | `[单点概念]` | 4 个 keyStages，代码已忽略标签（正确） |
| targetTotalHours | 8h | 未被标签压 |
| targetMilestones | 4 | keyStages=4 |
| 每阶段任务上限 | 4 | `subtasksPerStageRange[1]=4` |
| 每阶段容量 | 1.667h = 4×25/60 | |
| capacitySum | 6.667h | 4 阶段 |
| path before | 8h | 模型按目标写满 |
| path after | 6.8h | 守恒层按容量下压 |
| 实际任务 | 15 个 / 375min | 4+4+3+4 |
| 实际任务和 | 6.25h | 375/60 |
| 阶段回写和 | 6.4h | 1.7+1.7+1.3+1.7（逐阶段四舍五入） |
| 对 objective | **80%** | 6.4/8 |

损耗点：`8h → 6.667h（结构容量）→ 6.8h（取整）→ 6.4h（任务实排）`。
**模型没有少写，是容量公式只允许 4×25 分钟/阶段。**

### B. 3 阶段 / 3.6h（`lp_1794389121387_6xlr8cb`）

| 环节 | 值 | 说明 |
|---|---|---|
| goal objective | 8h | 内容锚 |
| scope 标签 | `[技能模块]` | 3 个 keyStages，标签被接受 |
| 标签硬帽 | 总 6h / 3 阶段 / 每阶段 3 任务 / 单课 35min | `TOPIC_GRANULARITY_BOUNDS.skill_module` |
| 实际单课上限 | 25min | 被 `sessionsLengthMin=25` 再夹 |
| targetTotalHours | 6h | 8h 先被标签压成 6h |
| targetMilestones | 3 | |
| 每阶段任务上限 | 3 | 标签帽 |
| 每阶段容量 | 1.25h = 3×25/60 | |
| capacitySum | 3.75h | 3 阶段 |
| path before | 5.5h | 模型接近 6h 目标 |
| path after | 3.8h | 守恒层按容量下压 |
| 实际任务 | 9 个 / 212min | 3+3+3 |
| 实际任务和 | 3.53h | 212/60 |
| 阶段回写和 | 3.6h | 1.2+1.2+1.2 |
| 对 objective | **45%** | 3.6/8 |
| 对标签目标 | 60% | 3.6/6 |
| reviewer | 0.85，passed | practicality 写明“4h vs 8h 仅一半”，severity=low |

损耗点：`8h → 6h（标签帽）→ 3.75h（结构容量）→ 3.8h（取整）→ 3.6h（任务实排）`。

## 4. 根因清单

### R1（P0）未提及的单次时长被静默落成 25 分钟，并当成硬容量

`prompts/core/goal-conversation.yaml:60,70`：无截止的自由学习，用户未提时间时“静默按单次 25 分钟一个认知闭环落档”。
这本身是单次节奏，但下游 `subtaskMinutesRange[1]=25` 直接成为**单任务硬上界**，再乘任务数变成阶段容量。
→ 8h 内容在 25min/次下需要约 19 次坐学，但结构模板只给 9-16 个任务。

### R2（P0）`[技能模块]` 的 6h 帽与 goal 自己的 5-12h 参考锚打架

`prompts/core/goal-conversation.yaml:217`：专项技能/单模块突破 **5-12h**。
`path-planning-hints.ts:277-278`：`skill_module.totalHoursCap=6`、`subtasksPerStageCap=3`。
3 阶段路径 objective=8h、标签 `[技能模块]`，被代码先压成 6h；9 个任务的上限又只有 3/阶段，容量只剩 3.75h。
→ 同一个“技能模块”，提示词允许 5-12h，代码只允许 6h；8h 是合法输入却被静默降级。

### R3（P0）大预算扩容的判据写错：总分钟 vs 单阶段容量，且门槛 6h/阶段

`path-planning-hints.ts:1104-1106`：

```ts
const needsCapacityExpansion = anchorMin !== null && perStageHours !== null && targetMilestones !== null
  ? anchorMin > capacityMin && perStageHours > 6
  : false;
```

- `anchorMin` 是**全路径总分钟**，`capacityMin` 是**单阶段容量**，量纲不一致（少乘了阶段数）。
- 即使修掉量纲，`perStageHours > 6` 仍把普通 8h 课程挡在门外：4 阶段 2h/阶段、3 阶段 2.67h/阶段，都 <6。
- 结果：8h/3-4 阶段的路径永远不会触发扩容，容量停在 3.75/6.67h。

### R4（P1）每阶段任务数仍按“1 小时/任务”反推，而实际单课被 25 分钟封顶

`path-planning-hints.ts:1142-1145`：

```ts
const perStageFromHours = ... Math.round(estimatedHoursTotal / targetMilestones / 1.0) ...
```

4 阶段 8h → 2 个任务/阶段；3 阶段 8h → 3 个任务/阶段。
但单课上限是 25 分钟，2×25=50min、3×25=75min，和 2h/2.67h 的阶段目标差 2-3 倍。
`targetMinutesPerTask` 随后算出 60/53 分钟，再被 25 夹住——任务数与分钟数两张皮。

### R5（P1）每阶段锚先被容量夹，stage-designer 再也看不到原始目标

`path-planning-hints.ts:1171-1178`：

```ts
targetHoursPerMilestone = min(structureStageCapacityHours, targetTotalHours / targetMilestones)
```

4 阶段：`min(1.667, 2)=1.667`；3 阶段：`min(1.25, 2)=1.25`。
stage-enrichment 的 `buildStageHints` 又按这个被夹过的锚算 `targetSubtasksForStage` 和 `stageMinutesBudget`（`stage-enrichment.ts:430-459`）。
→ 下游只看到“本阶段 1.25/1.67h”，看不到“原目标 2/2.67h”，自然按小预算设计。

### R6（P0）全链路只有上限执行，没有下限补足

- `stageMinutesBudget` 是**硬上限**（`prompts/core/stage-designer.yaml:94`）。
- `targetSubtasksForStage` 是“容量上限参考”，不是必须达到的数量（`stage-designer.yaml:64`）。
- `clampStageTasksToHints` 只在超上界时裁剪（`path-planning-hints.ts:512-531`）。
- `path-budget-clamp` 只在超目标时下压（`path-budget-clamp.ts:45`）。
- `stage-budget-invariant` 明确把“阶段合计低于上游”视为诚实，不算 violation（`stage-budget-invariant.ts:98-110`）。

→ 没有任何一步会在“任务实排 < 目标”时**加任务/拆任务/增加坐学次数**。最终任务和就是交付量。

### R7（P1）reviewer 看见“只有一半”，但 severity=low，0.85 放行

3 阶段路径的 reviewer issue 原文：

> `pathPlan.estimatedHours` 合计 4 小时，而 `goalContext.timeDimensions.objectiveScopeHours=8` 为客观内容体量锚，路径仅为锚的一半。

severity=low，practicality=0.85，总分 0.85，passed=true（阈值 0.75，practicality 权重 0.2）。
→ 评审层有信号，但没有“低于内容锚 70% 必须 high/fail”的硬规则；replan 不会触发。

### R8（P2）“小时”是任务单遍和，不是总学习时长；可重复任务只算一次

`stage-designer` 明确允许“同一任务在不同天重复执行，`estimatedMinutes` 是单次时长”（`stage-designer.yaml:68`）。
但 `learning_paths.estimatedHours` 是 `Σ estimatedMinutes/60`，**每个任务只算一遍**。
4 阶段路径目标“二十来次坐学”，实际只有 15 个任务；3 阶段 9 个任务。若任务要重复练，真实投入高于 3.6/6.4h，但展示值不会体现。
→ 需要明确：`estimatedHours` 到底是“任务清单单遍时长”还是“达到目标的总学习时长”。两者不能混用。

### R9（P2）路径总学时按阶段四舍五入后相加，和任务分钟和对不上

`stage-enrichment.ts:1333-1351`：阶段小时先 `round(...,1)`，再累加。
4 阶段：1.7+1.7+1.3+1.7=**6.4h**，任务分钟和是 375min=**6.25h**。
3 阶段：1.2+1.2+1.2=**3.6h**，任务分钟和是 212min=**3.53h**。
`learning.helpers.ts:33-70` 在读侧用任务分钟和归一，但 DB 写回仍是阶段四舍五入和；两处口径不完全一致。

### R10（P2）goal 的 scopeAnchor 自身也会算错坐学数

3 阶段路径 `scopeSizeRaw` 写“约 6-8 次坐学”，但 objective=8h、单次 25min；6-8 次只有 2.5-3.3h，和 8h 对不上。
4 阶段写“二十来次坐学”，20×25min≈8.3h，是自洽的。
→ goal 层“坐学次数 × 单次分钟 = 总小时”的算术没有被自检；不同 case 会给出互相矛盾的锚。

## 5. 最小修复顺序（建议，不在本次改动）

1. **先定权威口径**：`objectiveScopeHours` 是本轮内容契约；`targetTotalHours` 不得在无“显式缩范围”的情况下低于它。若标签帽/容量帽低于 objective×0.8，必须记录并让 reviewer 阻断，而不是静默降级。
2. **修 R3 扩容判据**：改为“每阶段锚分钟 > 单阶段容量”，去掉 `perStageHours > 6`；按 `ceil(perStageMinutes / 单课上限)` 抬任务数。8h/25min 应得到约 19 个任务位，而不是 9-16 个。
3. **修 R2 标签帽**：`skill_module` 的总时帽与 goal 的 5-12h 对齐（或按 objective 动态放宽）；`subtasksPerStageCap=3` 不能同时承担“模块颗粒度”和“任务密度”两个职责。
4. **加下限补足**：stage-enrichment 在任务实排 < 阶段锚×0.8 时，按新方向补任务/拆任务，而不是只写【课时说明】；补的任务仍受单课上限约束。
5. **reviewer 硬门**：`estimatedHours < objectiveScopeHours×0.7` → practicality high + passed=false；最终交付入库后再对 objective 复算一次。
6. **统一小时语义**：若任务可重复，增加 `repeatCount`/`totalMinutes`，路径总学时按总学习时长算；否则明确 `estimatedHours` 只是“任务单遍和”，并在 UI 上改文案。
7. **收尾取整**：路径总学时直接由总分钟/60 得出，不要 Σ 阶段四舍五入值。

## 6. 产品口径（2026-11-11 用户确认）

**时间窗口是约束，不是配额；计划按内容设计，执行交给人。**

- 3 个月 / 每周 6 小时只回答两件事：内容装不装得下、最晚什么时候该学完；**不生成周计划，不按周均分，不为了填满窗口加课**。
- 路径按内容依赖与认知顺序设计；学时是内容估算，不是“总窗口 ÷ 阶段数”的算术结果。
- 阶段之间不追求均分；学时差异必须来自内容权重/依赖关系，而不是为了“看起来不均分”刻意制造差异。
- 执行计划的是人：系统给任务顺序、单次时长、完成标准；不替学习者排每天/每周的执行表。
- 因此，“3 个月只出了 15.7h”本身不是缺陷；真正的缺陷只有两个：内容契约是否被覆盖（18h 目标只排了 15.7h），以及提案里的坐学数是否算错（8-10 次 vs 18 次）。这两个是内容完整性问题，不是排期问题。

## 7. 这次不碰的部分

- 模拟日/时区：`simDay`、`baseDate`、`dayKeyOf`、`endOfDay`，与本问题无关。
- 课堂实际时长：`teaching_sessions.duration` 是真实学习记录，不回写预算；它是后续校准 `estimatedMinutes` 的数据源，不是本次收缩的原因。
- `maxWeeks`：无 deadline 时 52 周只是结构硬顶，不是要求排满，也不是这次少排的直接原因。

## 附：LLM 单独计算实测（2026-11-11，3 个月年报案例）

不经过任何代码夹取，直接看模型自己的原始输出：

- goal：`objectiveScopeHours=18`、`sessionsLengthMin=60`、4 个 key stages；但 `scope_size` 写“约 8-10 次坐学”，按 60min 应为 18 次。
- path-planning 原始输出：`estimatedHours=18`、4 个 milestone（5/4.5/4.5/4），summary 自己写“每周 6 小时约三周”。
- stage-designer 原始输出：5/5/5/4 个任务，255/225/255/200 分钟，合计 **15.58h**，不是 18h。

结论：

- 模型**能**做局部估算（18h、4 阶段、约三周、每任务 40-60min 都算对了）。
- 模型**不能**保证跨层算术一致（goal 的 8-10 次 vs 18 次；stage 的 15.58h vs 18h）。
- 因此代码的角色应是**验算/约束/缺口披露**，不是替模型做内容估算，也不是按错误上限硬砍。

对照：心理学 4 阶段原始 path 是 8h，代码按 25min × 4 任务 × 4 阶段夹到 6.7h；3 阶段原始 path 是 5.5h，代码按 25min × 3 任务 × 3 阶段夹到 3.8h。8h→3.6h 主要是**代码上限错**，不是模型没算。

## 实施结果（2026-11-11）

已按“只修机械天花板，不加下限强制补课”落地：

- `path-planning-hints.ts`：
  - 新增 `sessionsLengthSource`（explicit/estimated/default/unknown）；默认 25 分钟不再当硬上界，单课区间放宽到 15-35；显式 20 分钟仍严格封顶。
  - `skill_module` 总时帽 6→12h，每阶段课数 3→5；单阶段普通路径最多 5 课，超大预算（>6h/阶段）保留 30 课例外。
  - 扩容判据改为“每阶段锚分钟 > 单阶段容量”，去掉 `perStageHours > 6` 和“总分钟 vs 单阶段容量”的量纲错位。
  - 任务数反推改用每任务分钟锚（显式/默认/结构化单次时长），不再写死 1h/任务。
  - 新增 `rawTargetHoursPerMilestone`，只用于审计/覆盖判断，不强制补课。
- `stage-enrichment.ts`：路径总学时改为 `round(Σ task minutes/60, 1)`，不再累加逐阶段四舍五入值；结构容量缺口 ≥10% 时给用户【课时容量提示】（若已有 core 的“容量说明”则不重复）。
- `goal-conversation.yaml`：proposing 的 reply 与 `scope_size` 不再口头承诺总小时/总坐学数；新增 `sessionsLengthSource` 字段；总学时交给路径卡片。
- `path-planning` 容量说明文案从“提高单次学习时长”改为“增加坐学次数或阶段数”，不违背用户“每次只能 20 分钟”的硬约束。

真机验证：

| case | 单次时长来源 | 目标 | 结构容量 | 最终 | 结果 |
|---|---|---|---|---|---|
| 心理学（默认 25） | default | 10h | 14.6h | **10.0h / 5 阶段 / 24 任务** | 完整交付，无夹取 |
| 心理学（显式 20） | explicit | 10h | 6.7h | **6.1h / 4 阶段 / 20 任务** | 不再 3.6h；缺口如实披露，不补课 |
| 心理学（显式 20，重跑） | explicit | 12h | 7h | 骨架 7h，阶段生成重试 | 路径描述已带“容量说明：12h 预算 / 7h 结构” |

门禁：

- `src/services/learning` 107 suites / 1030 tests 全绿；
- `src/services/learning/generation` 21 suites / 177 tests 全绿；
- `src/skills/path-planning` 6 suites / 55 tests 全绿；
- `src/skills/goal-conversation` 10 suites / 71 tests 全绿；
- `src/services/learning/__tests__/goal-conversation` 14 suites / 97 tests 全绿；
- `prompt-realism-guards` 13 tests 全绿；
- `prompts:check:all`、`prompts:core:check` 全绿。

