# 三刀改造 · 多批次真机测试报告（2026-11-11）

> 目的：验证「第一刀 prompt 9 主手术 + 6 同步补丁、第二刀 checkpoint 单焦点守门员、第三刀判官、方案二 answer_then_hook」在真实虚拟学习者链路上的效果，并用批次间对照暴露回归。
> 执行方式：`backend/src/scripts/simulate-learner-e2e.ts` 驱动（goal → path → 首日课堂），每例 1 个模拟日；判官 `backend/scripts/judge-stage-quality.ts`（异构小模型 agnes-3.0-flash + 强模型 deepseek-v4.1-flash 双判官，两份都 fail 才 fail）。
> 结论先说：**修完 6 处真机缺陷后，6/6 条被评路径通过判官（4-5 分）；盘库 v1 的线下体力任务被稳定判 fail（2 分）作为负样本；3 份黄金负样本校准 3/3 捕获。**

## 批次与结果

| 批次 | 案例 | 期望 | 实际 | 判官 |
|---|---|---|---|---|
| 1 | 合同（deadline / 法律） | 时间硬约束 + 无导论 + 逐条判读 | 2 阶段、透镜互异、deconstruct 直击合同原文；7 轮 goal 收敛 | pass 4 |
| 1 | 盘库 v1（非学术 / 实物） | 真名透镜 + 文本任务 | 阶段透镜重复；任务含「去货架点数/贴便签」 | **fail 2（正确捕获）** |
| 1 | 考研英语（exam） | exam 保底 + 选项核对 | 2 阶段、19 分钟任务、验收可判；课堂逐项核对主体/限定词/逻辑方向 | pass 5 |
| 1 | 情绪心理学 v1 | 可练的认知技能 → 组合响应 | 被 `emotional_support` 硬阻断，模型已提出可操作动作却无法排课 | 无路径（缺陷） |
| 1 | 蓝屏（oneoff） | 首轮直答 + 转化钩子，不排课 | 首轮给出抢修步骤，句尾「回『生成排障课』…」出现；未排路径 | N/A（预期不排课） |
| 2 | 盘库 v2 | 执行面铁律 + 透镜互异 | 2 阶段透镜不同；任务改为「四行仿真实盘点表/自家盘点表」文本分析 | pass 4 |
| 2 | 情绪心理学 v2 | 结构化字段 → combination → 路径 | triage=`combination`（cognitive_internalized × judgeable_output），路径为「例会被否定时不顶回去的半拍」 | pass 4 |
| 3 | 财务异常 | 非学术真名透镜 + 文本任务 | 3 阶段：净利 vs 现金 / 分项同步性 / 费用反推；30-35 分钟/任务 | pass 4 |
| 3 | Python 流水分析 | tool_operation 认知路径 | 3 阶段：退款记法 / 基线分层 / 相对偏离；脚本+透视表+文本判断 | pass 4 |
| 3 | 游泳换气 | 物理边界：拒绝排课 | `referral`，讲原理 + 明确「不排课表/线上替代不了真人」，不生成路径 | N/A（预期拒绝） |
| 4 | 合同（渐进式设计） | stage 1 设计后 stage 2 留空，完成后用 `previousStageOutcome` 设计 | 三处抢跑修复后：stage 1 有 2 任务、stage 2 0 任务且 locked；stage 1 完成后（19:01）才触发 stage 2 设计，产出「四条换过说法的条款连判 / 改成能原样发给人事的话」——是迁移与交付推进，不是 stage 1 复读 | 通过（结构复验） |

## 批次暴露并修复的 6 处真机缺陷

1. **引擎侧仍保留出题节奏票**（`4b62cda5`）：`teaching-turn-engine` 的 `checkpointEmissionEligible` 还在用 `checkpointRhythmMinTurns`，理解度 <0.6 时 2 条消息就加速出题，与第二刀「学生懵时给支架不弹卡」直接冲突。已删除，出题时机收敛到 `shouldEmitCheckpoint` 单一权威。
2. **检查点无概念归属 → 单焦点守门员失效**（`4b62cda5` / `425bbb87` / `2ef4b49c`）：盘库 v1 同一焦点出了 3 道唯一题。根因是 pending 的 `conceptName` 在 `output.knowledge` 为空时缺失，`checkpointHistory` 无归属，匹配不到。三层修复：发射时记 `lastCheckpointConcept`、归属兜底用 `mergedKnowledge` 最后一个点、提交时用当前看板补写 history。
3. **情绪 × 认知技能被误硬阻断**（`4b62cda5`）：心理 v1 证据原话不含「练习/方法」词，但模型已判 `skill_nature=cognitive_internalized` × `platform_judgment=judgeable_output`。`response-triage` 的 emotion 分支改为结构化字段优先 → `combination`；`physical_internalized/not_judgeable` 仍走 `referral`。
4. **阶段透镜重复**（`4b62cda5`）：盘库 v1 两个阶段 `coreConcept` 完全相同，等于同一阶段教两遍。`path-planning` 增加「透镜互异」：任意两阶段 coreConcept 不得相同/同义，重复即合并或换芯。
5. **认知课被排成线下体力任务**（`4b62cda5`）：盘库 v1 出现「去收银台贴便签」「把零食饮料区的实物真正点一遍」。`stage-designer` 增加「执行面铁律」：课堂动作必须能在文字/数字/原文里完成；线下材料只能作输入素材。判官同步增加执行面审计（`79800cf5`）。
6. **wrapup 迁移种子被开场丢弃**（`425bbb87`）：`session-wrapup` 已把「下一课开场先判这个现场…」写进 `actionPlan[0]`（`retrievalCue`），但 `teaching-opening-generator` 旧规则允许「不必每课承接」，合同案例下一课开场只做中性承接。已改为「retrievalCue 是可判定具体情境时，开场第一段必须让学习者当场判一次」，并禁止改写成定义复述。
7. **渐进式备课被三处自愈路径抢跑**（`97f52eae` / `2b6964a8` / `69bfc366`）：`PROGRESSIVE_STAGE_DESIGN=1` 下 stage 2 本应留空到 stage 1 完成，但真机连续三次复现 stage 2 被提前设计——分别是冷启动 `retryPathEnrichment` 全量枚举空阶段、自动重试 `retryOnePreparedPath` 走 replace、`queuePathEnrichmentAppend` 收了目标阶段却只传 `appendOnly`。三处统一为「渐进模式只看最早未完成阶段；当前阶段有任务即不重试；append 必须带 `restrictMilestoneIds`」。真机复验：stage 1 有 2 任务、stage 2 0 任务且 locked。
8. **判官双模型**：见下节。

## 判官校准与判官自身缺陷

- 黄金负样本 3/3 捕获：全抄原话 0 分、反向乱报 1-2 分、高负荷加难 0-1 分；真实基准 case 4 分 pass。校准门要求「3 假全部 fail 且 ≤2 分」才放行批跑。
- 批次 1 判官自身暴露 3 个数据/口径缺陷并已修（`79800cf5` 及后续）：
  1. 只按时间窗找课堂 → 把考研课堂拼进盘库路径，整份判「材料错位」；改为 `learningPathId` → 同 `userId` → 仅 `path_review.reviewedPathId` 匹配的时间窗三级绑定。
  2. 把「为练习构造的示例句/虚构题干」判成幻觉；已明确练习素材不算幻觉，只有冒充学习者真实事实才算。
  3. 把 `path-planning-fallback` 的路径评审问题当「学习者挣扎证据」做负荷审计；已明确该 provenance 下负荷审计默认通过，只有单阶段堆 ≥3 新概念或总时长 > 2× 阶段预算才判违规。
- **双判官**：agnes 对备课期材料容易误读（同一 psych2 路径 agnes fail 2、deepseek pass 4），改为两份都 fail 才 fail；校准仍要求两份都捕获（实测 3/3）。批跑中单模型误杀被消除，真实负样本（盘库 v1 线下任务）仍被两份同时判 fail。

## 结构断言结果（`qa-reports/` 不入库，脚本临时）

- 新路径（盘库 v2 / 心理 v2 / 财务 / Python）：无「导论/发展史/热身」阶段、无阶段透镜重复、无线下体力任务红旗。
- 盘库 v1 保留红旗作为对照：透镜重复、线下执行、同一焦点 3 道唯一题。
- 检查点：批 3 财务/Python 的首题均带概念归属，单焦点唯一题 ≤1；批 1 盘库 v1 的 3 题问题已由上述三层修复覆盖。
- 课堂质量 spot-check：合同课「先给分档规则 → 学生贴原文 → 判错后指出档位差一档 → 回到原文缺口」；考研课「学生先判 A/C → 教师只指出核对顺序 → 学生自己补 B/D」；心理课「用真实两句原话拆三帧 → 学生自己说出半拍位置」。均符合 Meno 闸与「判断由学习者做」。

## 质量门

- 后端全量 jest：**769 suites / 7130 tests 全绿**（3 suites / 9 tests skipped），`npm run typecheck` 绿。
- 定向：`response-triage` 53/53；`ai-teaching` 96 suites / 935 tests；checkpoint 33/33；learning 全量 77 suites / 802 tests 全绿。
- `prompts:compile-all` 32 skills 成功；`prompts:core:check` hasErrors=false；`prompts:sync` 后 system DB ACTIVE 版本已含全部新规则（goal-conversation v87、path-planning v74、stage-designer v72、teaching-opening-generator v33）。

## 残留问题（下一批继续）

1. **渐进式设计仍为灰度开关**：本次验证用 `PROGRESSIVE_STAGE_DESIGN=1` 启动后端；代码路径已修复并验证（stage 2 留空 → stage 1 完成后设计），但默认仍关。是否默认开启需产品拍板——开启后首课启动窗口对「未来阶段为空」的判定必须保持本次修复后的语义（只看最早未完成阶段）。
2. **单日跑不完一个阶段**：批 1-3 多为一课即到 max-days，B 块（lesson-knowledge-enricher + replan-attribution）覆盖有限；批 4 已跑完 stage 1 → stage 2 的完整衔接，但「多阶段连续收口 + replan 触发重排」还需更长批次。
3. **判官 provider 偶发失败**：双判官批跑出现一次 `Provider request retry budget exhausted`（psych2 首轮），需加单例重试/退避；当前单例重跑可恢复。
4. **路径文本对资源的指代**：考研任务写「一篇真题阅读」但未注明「平台提供」；判官会追问资源来源。可在任务 description 加一句「课堂会提供原文/题目」。
5. **物理拒绝文案的示例不贴场景**：游泳案例的拒绝文案举「风味、手感、笔锋、音色」，与游泳语境不符；属于通用文案，可改为按领域取例。
6. **oneoff 的 harness 判定**：蓝屏案例 14 步仍在 goal（用户在持续抢修），产品行为正确但 harness 记 `goal-not-converged`；需要「预期不排课」用例类型，避免把正确行为计为失败。**已修（2026-11-11 晚）**：`--expect=no-path` + learner-ended/noPath 终局，见 `docs/VIRTUAL_LEARNER_REALISM_2026-11-11.md`。
7. **多次重启造成的 harness 竞态**：盘库 v2 的 3 天续跑在后半段报 `当前课堂状态不允许此操作（teaching-step-stopped）` 并置会话 failed——发生在连续重启后，属于调试期环境竞态，非课堂逻辑回归；设计侧（路径/任务/判官）已在重启前完成验证。**另发现（2026-11-11 晚）**：`start-session` 默认拉起 autopilot，而 harness 又手动 step，同一会话被双驱动；旧批次的对话轮数/告别次数因此被放大，已改为 `autopilot:'off'` 单驱动，详见同一文档。
8. **提示词门禁已全绿**：`prompts:check:all` 退出码 0、payload-prefix 违规 0；此前 `virtual-learner-learn-turn-simulator` 的历史违规已随重编译消失，不再是残留项。

## 复现命令

```bash
# 校准门（3 假必须全 fail 且 ≤2 分）
STAGE_JUDGE_MODEL=agnes-3.0-flash STAGE_JUDGE_SECONDARY_MODEL=deepseek-v4.1-flash \
  npx ts-node --transpile-only backend/scripts/judge-stage-quality.ts --calibrate

# 批跑（双判官，两份都 fail 才 fail）
STAGE_JUDGE_MODEL=agnes-3.0-flash STAGE_JUDGE_SECONDARY_MODEL=deepseek-v4.1-flash \
  npx ts-node --transpile-only backend/scripts/judge-stage-quality.ts --batch --limit 20

# 单例（含下一阶段 dry-run）
npx ts-node --transpile-only backend/scripts/judge-stage-quality.ts --path <pathId> --dry-run-stage
```

## 追加：新十课批次（2026-11-11 晚）

> 目的：在 32 个 skill 字段契约审计 + 外部评审 4 条修复之后，换 10 个全新课例（不重复前四批）跑 goal → path → 首日课堂，只检查真实链路行为（收敛、排课、课堂、离场），不做判官评分。
> 运行：`backend/.tmp-batch-1111/run-new-cases.sh`（批次 1/2 各 5 例，独立 admin 并发，`autopilot:'off'` 单驱动）；路径型每例 2 个模拟日，每个模拟日 = 1 节课（2 个 round）；蓝屏 1 天、`--expect=no-path`。

### 结果

| # | 课例 | goal 收敛 | 路径 | 课堂 | 终局 |
|---|---|---|---|---|---|
| 1 | 合同条款 | 3 步 / 59s | 生成 | 2 节（283s + 233s） | max-days-reached |
| 2 | 盘库差异 | 8 步 / 189s | **未生成** | — | learner-left（行为性） |
| 3 | 报表勾稽 | 13 步 / 223s | **未生成** | — | repetition-loop（上游故障） |
| 4 | 考研长难句 | 17 步 / 519s | 生成 | 2 节（350s + 298s） | max-days-reached |
| 5 | 工单分级 | 15 步 / 263s | 生成 | 2 节（321s + 586s） | max-days-reached |
| 6 | 二次函数 | 4 步 / 144s | 生成 | 2 节（294s + 202s） | max-days-reached |
| 7 | 报告选题 | 4 步 / 106s | 生成 | 2 节（522s + 583s） | max-days-reached |
| 8 | 报销合规 | 4 步 / 62s | **未生成** | — | learner-left（行为性） |
| 9 | 家庭预算 | 3 步 / 56s | 生成 | 2 节（343s + 649s） | max-days-reached |
| 10 | 蓝屏排障 | 3 步 / 37s | 预期不排 | — | 成功，findings=0 |

10/10 走完；6/10 生成路径并各上完 2 节课（共 12 节课 / 24 个 round）；1/10 预期 no-path 判定正确（蓝屏，直答+钩子，无路径残留）；3/10 未排课，其中 2 例是行为性离场、1 例是上游故障。goal 收敛中位数 125s（路径型），最快 56s。

### 本轮修复：F22/F23「真实任务当教材」

**现象（F22）**：盘库差异与报销合规两例，导师在 goal 阶段把「取数 → 分析 → 归因 → 结论」整条可执行 SOP 一次给完；学习者拿到方案后回「行，就照你说的办，我先跑一趟 / 我这就去列」并离场，8 轮内零路径。这不是提供者故障，而是 goal 阶段把「教学载体」当成了「一次性咨询」。

**规则**（`prompts/core/goal-conversation.yaml`，编译进 `skill.goal-conversation.md`）：当 `primary_block_type=capability` 且用户手上有正在发生、有交付/截止的真实任务时：
- 每轮最多给**一个诊断动作 + 一个判断口径**，严禁整包 SOP；
- 诊断动作只用于让用户确认「你说中了我的问题」，**下一轮就产出 confirmedProposal**，第一步写成第一课任务与首个交付物（本次盘亏结论 / 这张报销单的合规缺口清单）；
- **禁止**「你先去导表/先翻单子，弄好回我」——防止 goal 阶段变成离线作业（F23）。

**验证（3 例）**：
- 盘库 v3：4 步 / 84s 生成路径；首个里程碑原文「把 23 件差异落到具体品项并算出各差多少」，与用户真实任务一致；上完 1 节课。
- 报销 v4（F23 修正后）：4 步 / 111s 生成路径；上完 1 节课。
- 报销 v3（F23 修正前）：导师让学习者「先去列单子，弄好截图发我」，学习者照做后离场——正是 F23 的实证，修正后不再复现。
- 回归：`prompt-realism-guards.test.ts` 新增 4 条断言（含「不要再等用户离线做完」「弄好回我」反例）；`prompts:check:all`、`prompts:core:check` 全绿。

### 质量门

- 后端全量 jest：**773 suites / 7159 tests 全绿**（3 suites / 9 tests skipped）。
- `prompts:compile-all` 32 skills 成功；`prompts:sync` 更新 `skill:goal-conversation` ACTIVE 版本；`prompts:check:all` 退出码 0；`prompts:core:check` hasErrors=false。
- 定向：`prompt-realism-guards.test.ts` 11/11。

### 本轮观察（下一批继续）

1. **上游空闲超时是当前最大噪声**：stage-design 与首课常因 `idle 60000ms` 重试，单节课 5-11 分钟；报表勾稽因此触发 `goal-agent RETRY_BUDGET_EXHAUSTED`，学习者重复同一句后被 repetition-guard 判离场。属于上游可用性，不是课堂逻辑。
2. **harness 的 completed 判据是「整条路径完成」**：2 天跑完 2 节课仍记 `max-days-reached`。后续按「每课验收」跑时应以 `--days=1` + path 生成作为通过判据，或把 findings 分层（路径未生成 vs 课程未走完）。
3. **goal 收敛步数仍有两极**：3-4 步与 15-17 步并存；长尾案例的上游慢请求占大头，但也值得下一批看是否还有「确认带尾巴」造成的往返。
4. **蓝屏类 oneoff 已稳定**：3 步直答 + 固定钩子 + learner-left，findings=0，无路径残留，R1 豁免口径成立。

## 追加：F24 心理学通识路径体量塌缩（2026-11-11 晚）

**现象**：用户真机确认「四家流派都过一遍、约 8 小时、二十来次坐学」后，生成的路径只有 2 个阶段 / 4 节课 / 1.1 小时；路径头部「当前阶段 4 节课 · 约 1.2 小时」与确认时承诺的 8 小时直接冲突。

**根因（数据证）**：
- goal 产出的 `confirmedProposal.scope_size` 写成 `[单点概念] ... 合计 4 家、约 8 小时、二十来次坐学`，同时 `key_stages` 有 4 段、`time_dimensions.objectiveScopeHours=8`；
- 代码把 `[单点概念]` 当硬上界：`TOPIC_GRANULARITY_BOUNDS.single_concept = { totalHoursCap: 1.2, milestoneCap: 2, subtasksPerStageCap: 2, minutesCap: 25 }`，于是 8h→1.2h、4 段→2 段、每阶段 2 课，生成 4 节 67 分钟的任务。

**修复（代码优先，提示词同步）**：
- `path-planning-hints.ts`：标签必须与结构自洽——**若 `key_stages` 数量超过该标签的 `milestoneCap`，标签作废、不钳**（单点帽 2 段、技能模块帽 3 段）。p-π 共轭（2 段 + 9.2h 背景污染）仍被单点帽收口，原修复不回退。
- `applyGranularityBoundsToHints` 增加 `structuralMilestoneCount` 入参，`stage-enrichment` 传入已落库的 milestone 数，避免旧 hints 在装配缝里再次把大路径压小。
- `goal-conversation.yaml` 的 `scope_size` 定义加入自洽规则：标 `[单点概念]` 时 `key_stages` 不得超过 2；已拆 3 段以上必须标 `[技能模块]`/`[完整学科]`；并注明代码以结构为准。

**验证**：新增 5 条单测——4 家/8h/单点标签 → `targetTotalHours=8`、`targetMilestones=4`、`milestoneRange=[2,5]`（约 4 阶段 × 5 课 × 25 分钟）；3 段预览不再被钳到 2；4 个已落库里程碑 + 单点标签不再二次钳；2 段 p-π 仍钳到 1.2h。定向 30/30，typecheck 与 `prompts:check:all` 全绿。全量 jest 772/773 suites 通过；唯一失败 `goal-conversation.regenerate-path` 是满载下的偶发超时，单跑与串行复跑均 2/2 通过（与本次改动无调用关系）。

**存量路径**：该用户的旧路径是按错误标签生成的，代码修复不会自动改旧数据；需重启后端后在路径页点「调整路径」重新生成（会按 4 个 key_stages 重算为 4 阶段 / 约 8 小时）。

### 调整路径三入口同步重写（2026-11-11 晚）

原三入口按「学习者学得怎样」命名（学得不好重来 / 学了一些调剩余 / AI 看学习情况），既把路径规划错误说成学习者失败，也漏掉了「一开始就没排对」这一最常见场景；副标题「已学完的内容会保留并衔接」对整条重排并不成立。改为按**改哪里**命名：

| 入口 | 新标题 | 新说明 | 后端动作 |
|---|---|---|---|
| rebuild | 整条路径重新规划 | 范围、节奏或顺序没排对，按新说明重排整条；已完成记录保留，新路径不沿用旧任务 | `regeneratePath(mode: rebuild-all)` |
| reshape | 只调整还没学的部分 | 已完成的阶段和任务原样保留，只重排当前阶段或从某个未学阶段起到末尾 | `regeneratePath(fromStageNumber)` |
| auto | 先让 AI 看看怎么调 | 结合完成情况、掌握度和卡点先给建议，看过再决定，不直接改路径 | `requestPathReplan(previewOnly)` |

同时修正：
- 弹窗副标题改为「选择你想改的范围。已完成的课堂记录都会保留在学习历史里。」；
- 「整条重建/从头开始/调整剩余部分」等工程词与责备语全部替换；确认按钮、占位示例、进度警告同步改写；
- reshape 的三个范围改为「只改当前阶段 / 从当前阶段改到末尾 / 从指定阶段改到末尾」，不再暴露「未学阶段、阶段/任务」等内部名词；
- **零进度禁用 AI 诊断**并说明「还没有学习记录，AI 诊断暂时没有依据」——此前零进度点 auto 只会在预览里收到 keep，是死路；此时策略若推荐 replan，改为推荐「整条重新规划」。
- 回归：`v2learning-path-detail.policy.test.ts` 9/9、路径详情六套件 41/41、`vue-tsc` 通过。

### 存量路径「重排没效果」的实证（2026-11-11 晚）

用户在旧路径上连续触发两次重排，结果仍是 2 阶段（第二次甚至从 4 节压到 3 节）。日志证据：

- 第一次（14:09）：`[path-reviewer] 路径未通过评估，触发一次自动重规划`，指令是「总 estimatedHours 由 2 提到约 8h」；重排后仍是 `milestoneCount: 2`，reviewer 因 `replanDepth 已达上限` 接受当前结果。
- 第二次（16:31）：reviewer 指令升级为「将 milestone 从 2 个拆为 4 个，分别对应 confirmedProposal.keyStages 的四家流派」；stage 设计阶段仍出现 `[stage-hints-clamp] stage2 4 → 2`、`[stage-budget-clamp] 50 → 23 分钟`，最终 `milestoneCount: 2 / taskCount: 3 / estimatedHours: 1.2`。
- 两次都命中 `[stage-enrichment] 颗粒度硬上界再钳生效`（`scopeSizeRaw` 为 `[单点概念]`，`targetHours 1.2`）——说明生效的是 `[单点概念]` 硬帽，reviewer 的 4 阶段/8 小时指令被 hints 覆盖。

结论：**前端弹窗改动已生效，但后端进程仍是 10:54 裸启的旧代码**（ts-node 直启入口文件、无 watch、未走 restart.mjs 的类型快检），`path-planning-hints.ts` 的结构自洽修复未加载，所以重排必然回到 2 阶段/1.2h。重启后端后再触发一次「整条路径重新规划」，才会按 4 个 key_stages 重算为 4 阶段/约 8 小时。

### Toast 圆角外直角（2026-11-11 用户走查）

**现象**：右上角 toast 卡片是圆角，但外侧还有一条直角边。

**根因**：`.toast-host` 上的 `overflow: hidden` + `max-height` 把子卡的 `--mk-shadow-pop`（0 16px 40px）沿宿主矩形边界裁断——被裁的是阴影，不是卡片本身，所以圆角外出现一条方形阴影边。路径页实测：改成 `overflow: visible` 后同一张卡的阴影立即恢复为圆形扩散。

**修复**：删除 `.toast-host` 的 `overflow: hidden` 与 `max-height`（同时最多 3 张卡，高度远低于视口，不需要滚动裁切）；新增回归断言，禁止宿主再裁切子卡阴影。`toasthost.position.test.ts` 6/6、`vue-tsc` 通过。

### 思考模式审计与开启（2026-11-11）

**审计结果**：`skill_model_configs` 共 32 行，**0 条 enabled**——20 条显式 `thinkingMode=disabled`，6 条 `default`、6 条 `NULL` 全部继承平台默认 `disabled`。也就是说此前所有关键 skill 都没开思考。

**能力边界**：
- `deepseek-v4.1-flash`：`supportsThinking=true`，挡位 `low/high/max`，`reasoningReserveTokens=8192`（开启时 `max_tokens = 输出预算 + 8192`）。
- `agnes-3.0-flash`：`supportsThinking=false`，虚拟学习者 7 个 skill 全部跑在它上面，**开不了**。
- `semantic-freeze-judge`：router 硬编码强制 `disabled`（审查链不能被推理拖慢），配置也改不动。

**已开启（用户选「规划链 4 个」）**：

| skill | 模型 | thinking | effort |
|---|---|---|---|
| goal-conversation | deepseek-v4.1-flash | enabled | high |
| path-planning | deepseek-v4.1-flash | enabled | high |
| path-reviewer | deepseek-v4.1-flash | enabled | high |
| stage-designer | deepseek-v4.1-flash | enabled | high |

生效验证（`router.resolve` + `buildThinkingPolicy`）：四个 skill 均返回 `{"thinking":{"type":"enabled"},"reasoningEffort":"high"}`，64000 输出预算时 `max_tokens=72192`。改动走 `skillModelConfigService.upsert`，已失效网关缓存，**无需重启**。`reasoningReserveTokens=8192` 只是输出余量（`max_tokens = 输出 + 8192`），不是思考上限；真正控制思考深度的是 `reasoning_effort`。曾短暂试过 `max`，按用户要求回到 `high`。

**未开启及原因**：`teaching-turn`（每轮都调，思考会拉长课堂响应）；`adaptive-guidance-copy`/`peer-reinforcement`/`kc-mapper`/`material-*`（短输出或结构化抽取）；虚拟学习者 7 个（模型不支持）；`semantic-freeze-judge`（代码强制关闭）。

**真机验证（high 档，开启后跑一例心理学通识；max 档尚未跑批）**：
- 调用日志出现 `reasoning_tokens`：goal-conversation 单轮 3223、stage-designer 单阶段 8807/11557——确认真实走了思考，不是配置空转。
- 延迟代价：goal 单轮 39s/72s/24s（此前约 7-15s）；stage-designer 单阶段 83s/104s（此前约 18s）；3 阶段设计约 8.5 分钟才就绪。teaching-turn 仍关闭，课堂回合不受影响。
- 该例路径为 3 阶段 / 3.6h（goal 估 8h，但标成 `[技能模块]`，帽 6h；stage-designer 又只交付 3.6h）。这不是「单点概念压成 2 阶段/1.2h」那个 bug 的复现，说明结构帽已放开；但 8h 目标的**交付不足**仍需另查 stage-designer 的预算分配。

### 三组思考对照与 minimal 时间塌缩（2026-11-11 晚）

同一心理学目标/故事，开思考（high）跑 3 组；基线是用户当前未开思考的 4 阶段路径：

| 组 | 人设 availableTime | goal 估时 | key_stages | 路径阶段 | 任务 | 学时 | reviewer | 通过 |
|---|---|---|---|---|---|---|---|---|
| 基线（思考关） | 未给 minimal 信号 | 8h | 4 | 4 | 15 | 6.4h | 0.84 | 是 |
| #1（思考开） | **minimal** | 8h | 4 | **2** | 4 | **0.9h** | **0.71** | **否**（practicality 0.45） |
| #2（思考开） | moderate | 18h | 4 | 4 | 12 | 4.8h | 0.80 | 是 |
| #3（思考开） | abundant | 10h | 3 | 3 | 9 | 3.6h | 0.80 | 是 |

结论：
- **思考没有稳定提升路径质量**：reviewer 0.80-0.84 与基线 0.84 基本同一档；真正决定结构的是 goal 的 scope/key_stages 与 hints。
- **#1 的塌缩不是思考导致**：`availableTime=minimal` 触发 `ONE_SITTING_BOUNDS`，把 8h/4 阶段的提案压成 2 阶段/4 课/0.9h。旧逻辑把「每次坐得短」误当成「这门课只有一小时」。
- 修复：`derivePlanningHints` 只在**客观体量 ≤2h** 时才收成一节课；8h/4 阶段这类大体量 + minimal 时间，只把单课压到 ≤25 分钟，阶段/任务/总学时仍按内容走（时间少应拉长周期，不是砍内容）。
- 修复后真机验证：同一 goal + `availableTime=minimal` 的夜班护士人设，生成 **5 个阶段 / 约 6.3h**（不再是 2 阶段/0.9h），核心生成 5.5 分钟。
- 仍未解决：goal 估时在人设间漂移（8/18/10h）、stage-designer 交付普遍低于目标（18h→4.8h、10h→3.6h），reviewer 仍放行；这是下一轮的预算交付问题。

### 3 个不同 case 的关/开对照（用户指定）

同一 case 同一故事，分别在 `thinking=disabled` 与 `enabled/high` 下各跑一次；均使用修复后的 `minimal` 结构逻辑。

| case | 思考 | goal 估时 / key_stages | 路径阶段 | 任务 | 学时 | reviewer |
|---|---|---|---|---|---|---|
| 合同条款 | 关 | 5h / 4 | 3 | 7 | 2.9h | 0.86 |
| 合同条款 | 开 | 3h / 3 | 3 | 7 | 2.8h | 0.85 |
| 报表勾稽 | 关 | 3h / 2 | 2 | 4 | 1.0h | 0.82 |
| 报表勾稽 | 开 | 4h / 2 | 2 | 4 | 0.8h | 0.83 |
| 考研长难句 | 关 | 8h / 3 | 3 | 8 | 3.3h | 0.79 |
| 考研长难句 | 开 | 8h / 3 | 3 | 9 | **4.9h** | **0.83** |

结论：
- **思考不是普遍增益**。合同、报表两例的结构、任务数、reviewer 分数基本不变（±0.01），报表甚至从 1.0h 降到 0.8h；思考主要改变的是 goal 的估时（合同 5h→3h），不是路径质量。
- **学术/拆解类有可见收益**：考研长难句在相同 8h / 3 阶段目标下，开思考后交付从 3.3h/8 任务升到 4.9h/9 任务，reviewer 0.79→0.83；这是三例中唯一同目标、同结构的对照。
- 思考的真实代价仍是延迟：goal 单轮 97-104s（关思考 5-61s），stage-designer 单阶段 2-3 倍耗时。
- 结论：思考值得开在**低频、拆解/规划型**链路上；对操作型目标，瓶颈在 goal 的 scope 与 stage-designer 的预算分配，不在推理深度。

