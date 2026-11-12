# 虚拟学习者拟真审计与修复（2026-11-11）

> 触发：外评指出 07-bluescreen 在用户说「先去忙」后出现 8 轮告别；用户判断「虚拟学习者这边问题比较大，真人不可能这么做」。
> 结论：这不是一句提示词的小毛病，而是**跑数人设、模拟器协议、Goal 提示词、自动驾驶驱动**四层叠加出来的失真。四层都已修，并用单驱动真机复验。

## 一、证据：旧批次里的学习者确实不像真人

### 1. 空壳人设

旧 harness 创建的 `virtual_learner_profiles.profile` 只有四个键：

```json
{ "role": "可丢弃跑数学习者", "scenario": "端到端验证日期模拟与多日上课", "note": "...", "storyPool": [...] }
```

没有 `age/background/emotionalTriggers/failurePatterns/adversarialPattern/availableTime`。friction 预算默认 `normal`（30% 触发），但触发后没有可演的顾虑/旧账/情绪，学习者只能退化成「每轮都配合的答题机」。11 个 case 全部如此。

### 2. 模拟器没有「离场」这个动作

`virtual-learner-goal-dialogue-simulator` 的输出只有 `reply/emotion/learnerState`，没有「本轮之后真人不会再发消息」的语义。只要 Goal Agent 回一句，学习者就必须再回一句。于是：

- 蓝屏 case 的 Goal 会话累计 **77 条消息**（39 用户 / 38 导师）；
- 用户已经说「我这边先忙点别的，等能摸到电脑了再试」，之后仍连续 8 轮换词重复「好，那我先去忙 / 好，我这就去把手头的活忙完」；
- Goal Agent 每轮都以「回来告诉我停在哪一层」收尾并带问号，学习者每轮都接——双方都没有停的理由。

### 3. Goal 提示词在反向拉扯

`goal-conversation.yaml` 有一条「延期信号同权」：用户说「回头告诉你/等我查完再说」时，**禁止进入等待态**，必须补齐信息出提案。它原本是治 14 步不收敛的，但没有区分「为了出提案而暂离」和「已经拿到答案、现在要去忙」。蓝屏/游泳这类直答或拒绝场景里，这条规则把 Agent 推向继续追问。

### 4. harness 与 autopilot 双驱动

`start-session` 的产品口径是「建会话 + 立刻开 autopilot」；harness 又在外面手动 `step`。同一个会话被两个循环同时推进：

- 蓝屏复验会话的日志出现 **45 次 virtual-reply / 40 次 virtual-leave**，但只有 5 次 goal-response；
- 旧批次里 39 条用户消息、`goal-not-converged` 等 finding，有相当一部分是双驱动放大出来的，不是 Goal Agent 单轮对话的真实长度。

### 5. 不排课的终局没有被当成终局

游泳/心理 v1 的 Goal 会话已经 `stage=completed`、`learningPathId=null`（referral 硬阻断），协调器仍把会话推进到 `path`，harness 再去 `advance-day` 等路径——只能等到超时。不排课是产品合法出口，不是「路径还没好」。

## 二、修复

### 1. 模拟器：shouldEnd + 离场纪律

`prompts/core/virtual-learner-goal-dialogue-simulator.yaml` 新增：

- 输出字段 `shouldEnd` / `endReason`（leaving | satisfied | declining | no_more_questions）；
- 「像真人一样会离场」：对方只是收口/叮嘱/复述已定事项，且没有需要当场回答的新问题时，一句收尾并 `shouldEnd=true`；
- 一旦说出「我先去忙/回头再试/等我……再说」，本轮必须 `shouldEnd=true`，对方句尾再追问也不回；
- 同一段告别只说一次；默认 1-2 句口语，不写小作文；不重复对方刚说的步骤。

协调器 `executeSingleStep` 收到 `shouldEnd=true` 后不再调用 `continueConversation`，只落 `virtual-leave` 日志和 `stageResults.goal.learnerEnded`，本轮结束。另有确定性兜底 `isRepetitiveLearnerReply`：新回复与最近两条学习者发言的三字组重合都 ≥0.35（且长度 ≥12 字）时，按 `repetition-loop` 收尾。

### 2. 不排课终局

协调器在 `goalReady && !learningPathId && stage∈{completed,ready}` 时：

- 会话置 `completed`、`currentStage=goal`；
- `stageResults.goal.noPath=true`；
- 返回 `noPath` 步结果，不再触发 path 生成/等待。

开场轮就完成且无路径的 answer-only/oneoff 也走同一分支。

### 3. Goal 提示词

- 新增「离场信号 ≠ 延期信号」：已拿到直答/收口说明，或明确说「先去忙/回头再说」，且没有待确认提案时，只做 ≤2 句收口，**不提问、不复述步骤、不下发 quickReplies、不援引延期同权**；
- `not_judgeable` 一律不排路径：不得输出 `confirmedProposal`、不得进入 proposing、不得请用户点确认；讲透原理/归因后 `stage=completed`，`confirmedProposal` 为空。游泳案例的「先提案、点确认再硬拒」由此消除；
- `quickReplies` 字段说明补：离场/收口轮必须留空。

### 4. harness 单驱动 + 预期不排课

- `start-session` 显式传 `autopilot: 'off'`，harness 自己逐步驱动；
- 新增 `--expect=path|no-path`：no-path 时 `learner-ended` / `noPath` 按成功终局，不再记 `goal-not-converged`；
- goal 阶段检测 `stageResults.goal.learnerEnded` / `noPath` / `session.status=completed && currentStage=goal`，命中即停；
- 新增 `--realistic-persona`：调用平台既有 `generate-persona`，把完整人设（emotionalTriggers/failurePatterns/availableTime 等）合并回 profile，再开会话。

### 5. autopilot 停条件

`advanceGoalRoundByRound` 收到 `learnerEnded` 时停止自动驾驶并写 `stopped`；收到 `noPath` 时写 `completed`。避免后台循环在 learner 离场后继续重跑告别回合。

### 6. 阶段交付物不越界

- `path-planning` 新增「交付物归属唯一」：后段核心交付是「改成可发送措辞/写成成稿」时，前段只能判断、指缺口、列清单，不得提前产出成品；
- `stage-designer` 新增「阶段交付物不越界」：同一成品不能被两个阶段同时认领。

## 三、单驱动真机复验

| 案例 | 修复前 | 修复后（单驱动 + 拟真人设） |
|---|---|---|
| 蓝屏（oneoff，`--expect=no-path`） | 77 条消息、8 轮告别、session abandoned | **3 步**：直答 → 学习者追问 + 真实顾虑（「拆不了/没 U 盘/下午三点就要交」）→ 一句「我先按你说的步骤试，先去弄」`shouldEnd=leaving`；无路径、findings=0 |
| 游泳（referral，`--expect=no-path`） | 5 轮后给两阶段提案，用户确认 → 平台硬拒 | **5 步**：全程只讲原理/归因/边界，`confirmedProposal=null`，从不进 proposing；学习者说「我试一下」后离场；无路径、findings=0 |
| 合同（path，`--expect=path`） | 4 轮 goal、路径 2 阶段 | **4 轮 goal 收敛**、路径 2 阶段/0.9h；阶段 1 只判「合法/存疑 + 指哪句要改」，阶段 2 才产出「能直接发人事的话」；首日 1 课，harness 因 `--days=1` 报 `max-days-reached`（预期） |

蓝屏复验的会话日志：`virtual-reply ×3 + goal-response ×3 + virtual-leave ×1`，不再有后台重复 step。

## 四、测试

- `virtual-learner-goal-dialogue-simulator`：9/9（shouldEnd 透传/缺省不误收尾）
- `simulation.goal.steps`：新增 5/5（告别复读兜底、noPath/learnerEnded 透传）
- `run-harness`：新增 `--expect` / `--realistic-persona` 解析
- `autopilot.service`：31/31（新增 learnerEnded→stopped、noPath→completed）
- `prompt-realism-guards` + `virtual-learner-prompt-sources`：12/12
- 全量 jest：**771 suites / 7145 tests 全绿**（3 suites / 9 tests skipped，0 failed）
- `prompts:check:all` 退出 0；`prompts:fields-sync:check` 孤儿 0；`prompts:core:check` hasErrors=false；32 skills 重编译并同步（goal-conversation v88、path-planning v75、stage-designer v73、goal simulator v31）
- `npm run typecheck` 绿

## 五、残留

1. **旧批次的行为结论需要重跑**：11 个 case 的路径/任务/判官结论仍然有效（判官看的是落库产物），但对话轮数、goal 收敛、告别次数受双驱动污染；行为学结论请用单驱动 + `--realistic-persona` 重跑。
2. **人设是随机生成的**：`--realistic-persona` 生成的人设可能与案例语境不完全贴合（合同案生成「社区团购团长」、游泳案生成「高二生物课代表」）。需要严格控人设时，应在 harness 增加显式 persona 种子，而不是每次随机。
3. **shouldEnd 仍是模型判断**：三字组兜底只能抓「换词复读」，抓不到「每轮换一个话题但都不走」；后续可加「连续 N 轮无信息增量」的语义看门狗。
4. **不排课的会话状态**：learner-ended 后会话保持 `running`（视为暂停，用户可回来），autopilot 为 `stopped`；若产品希望列表里显示「已离场」，需要新增 paused 语义，而不是复用 running。
5. **首课启动窗口**：合同单驱动复验从 path 生成到首课可上约 10 分钟（阶段任务生成），与学习者无关，但会拉长跑批时间。

## 六、复验命令

```bash
# 不排课案例（蓝屏/游泳）
npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
  --name="[verify] 蓝屏" --goal="..." --story-opening="..." \
  --days=1 --base-days-ago=1 --keep --expect=no-path --realistic-persona \
  --state=.../blue-state.json

# 排课案例（合同）
npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
  --name="[verify] 合同" --goal="..." --story-opening="..." \
  --days=1 --base-days-ago=1 --keep --expect=path --realistic-persona \
  --state=.../contract-state.json
```
