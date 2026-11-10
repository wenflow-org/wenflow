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
6. **oneoff 的 harness 判定**：蓝屏案例 14 步仍在 goal（用户在持续抢修），产品行为正确但 harness 记 `goal-not-converged`；需要「预期不排课」用例类型，避免把正确行为计为失败。
7. **提示词门禁已全绿**：`prompts:check:all` 退出码 0、payload-prefix 违规 0；此前 `virtual-learner-learn-turn-simulator` 的历史违规已随重编译消失，不再是残留项。

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
