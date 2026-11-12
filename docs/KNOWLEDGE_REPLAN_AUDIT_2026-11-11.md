# 知识图谱 / AI 建议重排 / 重排效果审计（2026-11-11）

范围：`kc-mapper` → 记忆台账 → 图谱状态 → 课后建议 → 实际 replan 的整条闭环。
数据：本机 `prisma/dev.db` 当前 78 条课堂会话、41 条带建议、1 条真实 replan。

## 0. 结论

1. **`masteryScore` 25%/40% 死锁成立，而且是系统性的**：`learning` 状态固定映射 0.35，完全不看 `progress`。课堂里 `progress=85/90` 的概念，记忆台账仍是 0.35；校准后正好是 0.25/0.40。
2. **这个 Bug 同时污染了 AI 建议重排**：`LearnerKnowledgeMemoryService` 把 `status='learning' && masteryScore<0.55` 全判成 `strugglingConcepts`。于是“已经学到 90% 但状态还没写 mastered”的概念，被当成“卡点”，触发“建议调整后续路径”。
3. **AI 建议没有形成闭环**：78 节课里 41 节带建议（52.6%），但 `learnerResponse` 为 0，实际 replan 只有 1 条，且是用户 `api` 触发（“太短了，不深入”），不是 AI 建议触发。
4. **图谱 / 总表指标打架成立**：图谱读 `masteryScore`（0.35→脆弱），总表读 FSRS `retention/stability`（99%→稳固）。两套语义没有在 UI 上分开。
5. **`kc-mapper` 空壳化机制成立，但截图里的具体节点在当前库找不到**：当前 19 节点图有通用节点、没有实验真名；截图中的 `说出标志性实验的证明目标` 等 6 个名字在 `learning_paths.aiPromptTemplate` 里 0 命中，可能来自另一个 run/用户。
6. **“review-plan 跳过未初始化”不成立**：`review-plan.service.ts` 只过滤 `extractionCount===0`，没有过滤 `fsrsStability===null`；温故 0/0 需要具体 session 再查。

## 1. 关键证据

### 1.1 课堂进度 85/90，仍被写成 0.35

`teaching_sessions`（`teaching_d4644412…33cfd1d3`）的 `knowledgeState`：

```json
[
  { "name": "识别流派争夺的研究对象", "status": "learning", "progress": 90, "kcId": "kc-2a" },
  { "name": "区分构造主义与机能主义主张", "status": "learning", "progress": 85, "kcId": "kc-2b" }
]
```

同一条路径的 `memory_traces`：

```text
识别流派争夺的研究对象  masteryScore=0.35  extractionCount=9  fsrsStability=6  fsrsReps=9
区分构造主义与机能主义主张 masteryScore=0.35 extractionCount=9 fsrsStability=2 fsrsReps=9
```

`progress` 已经 85/90，`masteryScore` 还是 0.35。

### 1.2 根因代码

`src/services/memory/memory-trace.service.ts:209-242`：

```ts
switch (status) {
  case 'mastered': score = p >= 100 ? 0.9 : 0.85; break;
  case 'review':   score = 0.5; break;
  case 'learning': score = 0.35; break;
  case 'pending':  score = 0.2; break;
}
if (calibrationBias === 'overconfident') score -= 0.1;
else if (calibrationBias === 'underconfident') score += 0.05;
```

`learning` 分支没有使用 `p`。`overconfident` → 0.25，`underconfident` → 0.40，正好对应截图里的 25%/40%。

### 1.3 卡点定义被同一个 Bug 污染

`src/services/learner/LearnerKnowledgeMemoryService.ts:1152-1154`：

```ts
const strugglingConcepts = globalConceptStates
  .filter((concept) => concept.status === 'learning' && concept.masteryScore < STRUGGLING_MASTERY_THRESHOLD)
  .map((concept) => concept.label);
```

阈值 0.55。因为所有 `learning` 都是 0.35，**所有 `learning` 概念都会进 `strugglingConcepts`**，不管 progress 是 10 还是 90。

`LearnerSnapshotService` 的 mediumRisk 又要求 `strugglingCount >= 2`：一节课堂只要留下两个 `learning` 点，就会得到 `medium/reinforce` 建议。实际样本正是两个点（90/85）→ 建议 `struggling_concepts` → “可以考虑调整后续路径”。

### 1.4 建议闭环数据

```text
teaching_sessions: 78
带 advisory: 41（52.6%）
shouldSuggest=true: 41
learnerResponse: 0（没有 keep/later/preview/adopt）
实际 replan: 1（lp_1794377200437，triggerSource=api，reason=太短了，不深入）
AI 触发的 replan: 0
```

建议分布：

| priority/recommendation | 条数 |
|---|---|
| high / resequence | 11 |
| medium / reinforce | 12 |
| low / accelerate | 15 |
| low / keep（shouldSuggest 但仍 keep） | 3 |

这不是“AI 建议很准但用户不点”，而是**建议没有闭环，且其中一部分是 mastery Bug 制造的假卡点**。

## 2. 图谱 / 总表为什么打架

- 图谱：读 `masteryScore`，阈值 0.65；0.35 全判“脆弱”。
- 总表：读 FSRS `retention` / `stability`；刚练过、stability 2-6 天，算出来 99%-100%，标“稳固”。
- 两者都不是“错数”，但**语义不同**：`masteryScore` 是“知识内化强度”，FSRS retention 是“按当前记忆状态预测的保持率”。UI 没有区分，用户看到的就是同一批概念一边脆弱、一边稳固。

## 3. `kc-mapper` 空壳化：机制成立，引用需校正

`prompts/core/kc-mapper.yaml` 当前规则：

- `一个 KC 应当能被多个任务共用`（规则 59）；
- `KC 命名：动词 + 单一可观测对象，≤12 字`（规则 47）；
- **没有**“对象必须带本阶段学科实体/实验真名”的硬规则。

当前 19 节点图（`lp_1794403796446_8jqmv92`）确实有通用节点：

- `识别实验采用的证据类型`
- `由证据类型反推流派立场`
- `识别可证伪性的判定条件`
- `识别心智的外部可测指标`

但同一张图里也有 `区分构造主义与机能主义主张`、`对比行为主义与精神分析分歧`、`指出人本主张验证困难的根由`，所以“整张图找不到任何流派真名”是**过度表述**。准确说法是：

> 有流派名，但没有实验名；19 个节点里相当一部分仍是跨学科通用动作，无法把温故靶子定位到“安娜·O / 小艾伯特 / 斯金纳箱 / 米勒 7±2”。

截图里的 6 个具体节点名（`说出标志性实验的证明目标`、`识别流派主张的反对对象`、`指出新证据对旧前提的修正`、`提取流派的核心前提假设`、`将当代议题挂回老争论`、`复述流派递进的争论脉络`）在当前库 0 命中，不能拿它们当“当前系统这 19 个节点”的证据；可能来自另一个 run 或未落库的版本。

## 4. CoreConcept / KC 混表

`concepts` 表同一条路径同时有：

- `level='kc'` 19 条；
- `level='concept'` 5 条。

`memory_traces` 没有 `level` 字段，只按 `conceptKey` 记账。结构上确实有“concept 级节点进入 FSRS 表”的风险；当前路径 memory_traces 只有 2 条，没复现截图里的 13/11，但隔离规则应该补上：**FSRS 只收 `level='kc'`，concept 级只进图谱**。

## 5. 温故 0/0：未证实

`review-plan.service.ts:467`：

```ts
if (trace.extractionCount === 0) continue;
```

没有 `fsrsStability===null` 过滤。一个 `extractionCount>0` 但 FSRS 未初始化的 trace 仍可能进入候选。所以“未初始化被跳过导致温故 0”的归因**不成立**；0/0 更可能是 due 队列、pathId scope、当日额度、`memoryWarmup` 未注入之一。要定位需要具体 session/trace。

## 6. 真实 replan 的效果

当前只有一条实际 replan：

- `lp_1794377200437_kfmunqv`；
- `replanMode=overwrite`、`replanTriggerSource=api`、`replanReason=太短了，不深入`；
- 最终 6.4h / 4 阶段 / 15 任务，reviewer 0.84；
- 同一路径有 4 次 core 生成尝试（`path_generation_runs` 06:06、06:16、06:39、06:57），属于用户多次“太短”后重排/重试。

能确认的：

- 用户驱动的 replan 确实把路径从“太短”拉到 6.4h/4 阶段，reviewer 0.84；
- 但没有任何 AI 建议被 `adopt`，所以**无法证明“AI 建议重排”带来了正向效果**。

要做效果评估，需要至少两条同 case 路径（AI 建议采纳 vs 不采纳）或同一路径的前后快照；当前数据量不够。

## 7. 修复优先级

### P0：修 mastery 映射

`learning` 不能再固定 0.35，应按 `progress` 插值，并保证 `progress≥80` 能跨过 0.65：

```ts
case 'learning':
  score = Math.min(0.72, 0.25 + 0.55 * (p / 100));
  break;
```

- p=25 → 0.39
- p=50 → 0.53
- p=80 → 0.69
- p=90 → 0.72

同时统一 `SessionFinalizationService` 的 `mastered ? 0.85/0.9 : 0.5`，不要两条映射。

### P0：卡点判据改用“掌握度 + 进度”，不要只看 status

```ts
const struggling = concept.status === 'learning'
  && concept.masteryScore < 0.55
  && concept.progress < 70; // 或直接依赖修好后的 masteryScore
```

否则 progress 85/90 仍会被当卡点。

### P1：图谱/总表统一口径

- 要么都读 `masteryScore`；
- 要么总表把“稳固”改名为“FSRS 保持率”，并和图谱的“已掌握/脆弱”分开显示；
- 不要让同一概念在同一屏出现“0% 掌握 / 99% 稳固”两个结论。

### P1：kc-mapper 实体锚定

新增规则：

> KC 的“对象”必须是本阶段的学科机制、实验或流派名（如“识别斯金纳强化与惩罚”“指出行为主义对内部加工的盲区”）；禁止抽干成“识别实验证据类型”“识别流派反对对象”这类放进任何学科都成立的通用动作。允许同流派内复用，不允许跨流派洗掉实体名。继承“挂回/复述”禁词。

### P2：记忆表只收 KC

`memory_traces` 写入侧只接受 `level='kc'`；concept 级节点只进图谱，不进 FSRS 调度。

### P2：建议闭环

- 41 条建议 0 条处置，先补“曝光/处置”漏斗，不要继续加建议类型；
- AI 建议不得自动 replan；
- 只有 highRisk / ≥2 真卡点 / 重复困惑才发；
- 建议卡与“进入下一阶段”分开，不要每阶段收尾都问“要不要重排”。

## 8. 一句话

**“已掌握 0 / 记忆脆弱 12” 不是图谱渲染错，是 `learning → 0.35` 的确定性映射把 progress 丢了；这个 Bug 同时制造了 `strugglingConcepts` 假阳性，进而让 AI 建议重排大量出现。先修 mastery 映射，再谈图谱命名和 replan 效果；否则建议层只是在放大错误信号。**

## 9. P0 修复（2026-11-12）

已落地三处，先解决“假卡点 → 假建议”的根：

1. **D1 mastery 映射**
   - `learning` 不再固定 0.35，按 progress 插值：`min(0.85, 0.3 + 0.55×p/100)`；`review` 按 `0.35 + 0.35×p/100`。
   - `SessionFinalizationService` 与 `ReviewCompletedConsumer.mapReviewStatusToRating` 统一调用 `mapKnowledgeStatusToMastery`，消除课堂 0.35 / 复习 0.5 两套映射。
   - 浮点收尾保留 3 位小数，避免 0.5249999999999999 落库。

2. **D2 结算窗口时序**
   - `LearnerKnowledgeMemoryService.build` 新增 `currentSessionId` / `sessionEndTimeOverride`。
   - `teaching-session-lifecycle` 在生成 advisory 前把本次收束时刻作为当前会话的业务结束时间传入；本课 85/90 的看板信号不再因 `endTime=null` 丢 `seenAt`，也不会被旧 0.35 痕迹压掉。

3. **U3 建议触发与归因**
   - `ReplanAdvisoryService` 的信号分支增加 `currentMilestoneComplete || highRisk` 门槛；普通阶段中途不再按课发建议。
   - `applyAttribution` 方向与阈值不一致时保留阈值方向、不挂归因；`accelerate → keep` 不再出现“标题承诺压缩、执行等量重排”。

验证：

- `src/services/learner` + `src/services/memory` + `src/services/ai-teaching`：169 suites / 1761 tests 全绿（1 suite skipped / 3 tests skipped）。
- 新增 `sessionEndTimeOverride` 时钟测试：未写 endTime 的当前会话按 override 记业务时间，其它未结束会话仍不回退真墙钟。
- `replan-advisory-threshold` 覆盖：只有 1 个卡点不发、只有 stillLearning/movedToReview 不发、≥2 卡点或重复困惑才发、accelerate 不被误压。
- `replan-attribution` 覆盖：方向一致才挂归因；方向不一致（含 keep）保留阈值方向。
