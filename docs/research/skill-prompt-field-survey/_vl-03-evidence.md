# VL-03 · 虚拟学习者「扮演对话失真」历史与近期实测证据集

> 仓库快照：commit `e736f7aa`（2026-11-18/19）。调研日期：2026-11-19。
> 定位：本文是 `docs/VIRTUAL_LEARNER_REALISM_2026-11-11.md`（蓝屏 8 轮告别、77 条消息、双驱动 45/40 次、空壳人设等，已在该文档展开）**之外**的证据挖掘，覆盖 qa-reports、walkthrough、campaigns、测试用例、persona 档案与全仓关键词命中。
> 方法：全文精读 docs/UNATTENDED_20_USER_CAMPAIGN、docs/campaigns/*、qa-reports/*、backend/src 测试与源码注释、virtual-learners/presets.yaml 与 cards/；Grep `不像真人|失真|出戏|泄露|误诊|repeat|drift`。

---

## 1 证据时间线

| # | 日期 | 证据事件 | 出处 |
|---|---|---|---|
| 1 | 2026-09-11~12 | 虚拟学习者 19 个会话 **failed 9 / running 8 / completed 1**；失败主因 `auto_turn_cap_exhausted`（41 回合烧满上限仍未到终点）与 `TEACHING_SESSION_TIMEOUT`；全部为 assisted 模式，0 个 blackbox-api | qa-reports/2026-09-11-skill-runtime/report.md §3.4 |
| 2 | 2026-09-11 | referee / actor-auditor 两个「扮演审计」技能**累计 0 次调用**：声明「黑盒终态自动」，实际只有手动 API 且前置 `experiment.mode='blackbox-api'` 在 DB 中 0 命中——「角色保真审计」能力从未真正运行过 | 同上 §4-P1 |
| 3 | 2026-09-11 | persona-designer / scenario-designer 成功率仅 **56.6%**：取消 54 次 + `SCENARIO_OUTPUT_INVALID (learningStyle is invalid)` 10 次 + 重试预算耗尽（scenario 平均时延 178s、最大 667s）——人设生成链路本身就不稳 | 同上 §3.2 |
| 4 | 2026-09-11 | 客户端取消→**重试风暴**：goal-conversation 单次 167.9s 被取消后 5 秒内 5 次 35-56ms `CALLER_ABORTED` 连续失败；是 5 个技能的头号错误 | 同上 §4-P3 |
| 5 | 2026-09-12 | 复审：预算模型重构后 failed 9→3；`auto_turn_cap_exhausted` 改为可续分片边界；但 referee/actor-auditor 仍 0 调用（P1 行为版未做） | 同上 §6-§7 |
| 6 | ≤2026-09-20 | presets 语料 v1 负荷分布失衡：14 条里 7 条 `availableTime=minimal`，「实测 275 例里 **46% 被硬钳成恰好 2 段**」——人设时间字段直接压塌路径体量 | virtual-learners/presets.yaml 头部变更记录 v1 |
| 7 | 2026-09-21 | v2 均衡负荷轴（3 minimal / 8 moderate / 3 abundant）；官方注明「v1 下跑出的历史数据与 v2 不可直接比较（人设字段变了）」 | 同上 v2 |
| 8 | 2026-09-22 | v3 项目级修整：coverageAxes 时间轴自洽、去路径命名水平词、新增 fixtureMaterials 附件夹具 | 同上 v3 |
| 9 | 2026-09-27 | v4 真实情景升级：电工/健康管理师/高考/考研/中考/新 mom 等落真实考制数字；**retiree-phone-photography 退役**（照片质量平台不可观测，与学画画/剪辑同族）——第一次正式承认「不可观测域上的扮演是假扮演」 | 同上 v4 |
| 10 | 2026-10-21 | 课堂卡死探针：**当晚 8 次非收敛只剩 endReason、归因全丢**——卡死归因此前只写 taskRuntime/session log，restart-learning 整包重写 teaching 后即丢，无法回答「为什么收不了尾」 | backend/src/coordinators/__tests__/simulation.learn.steps.stuck.test.ts:88-91（注释原文） |
| 11 | 2026-11-08 | 真人课堂实录（非虚拟学习者）暴露同款**板书/口头口径漂移**：导师口头说「超过 **3 秒**阈值报错」，两轮后却指板书「右栏第 2 行写的是『超时阈值 **2 s**』」——数字对不上，学习者被迫跟着错口径走 | docs/classroom-transcripts-20261108/lesson-1-锚点场景.md（16:29 与 16:33 两轮对照） |
| 12 | 2026-11-08 | 同实录中教师反复使用「板上左栏第 3 行」「右栏第 2 行」类行位指认——即 referee-minibatch 后来定性的 `BOARD_DANGLING_TRACE`/指认精度问题在人工课上的原型 | 同上（16:26、16:27、16:29 轮） |
| 13 | 2026-11-11 | 批测 4 批暴露并修复 **6 处真机缺陷**：出题节奏票残留（理解度<0.6 时 2 条消息加速出题）、检查点无概念归属（同一焦点 3 道唯一题）、**情绪×认知技能被硬阻断**（模型已判 judgeable_output 仍走 referral）、阶段透镜重复（同一阶段教两遍）、认知课被排成「去收银台贴便签」线下体力任务、wrapup 迁移种子被开场丢弃 | docs/BATCH_TEST_2026-11-11.md「批次暴露并修复的 6 处真机缺陷」 |
| 14 | 2026-11-11 | F24 路径体量塌缩：用户确认「约 8 小时、二十来次坐学」，`scope_size=[单点概念]` 标签被代码当硬上界，8h→1.2h、4 段→2 段；且旧路径两次重排均无效（reviewer 指令被 hints 钳回 2 阶段） | 同上「F24 心理学通识路径体量塌缩」 |
| 15 | 2026-11-11 | minimal 时间塌缩：夜班护士人设 `availableTime=minimal` 把 8h/4 阶段压成 2 阶段/4 课/0.9h、reviewer 0.71——「每次坐得短」被误当「这门课只有一小时」；修复后同 goal 生成 5 阶段/6.3h | 同上「三组思考对照与 minimal 时间塌缩」 |
| 16 | 2026-11-11 | 十课批次：报表勾稽案例上游 RETRY_BUDGET_EXHAUSTED 后**学习者重复同一句被 repetition-guard 判离场**（repetition-loop）；盘库差异/报销合规两例导师把整条 SOP 一次给完，学习者回「行，就照你说的办」**8 轮内零路径离场**（F22/F23） | 同上「新十课批次」结果表与 F22/F22 规则段 |
| 17 | 2026-11-11 | 外部评审第二轮判定 4 条「扮演→对话」机制冲突**全部成立**：①epistemic-grounding 只看静态人设、吞掉教师支架效果（脚手架答对仍判挂）；②goal 模拟器「拍板带尾巴」被 confirm 裁决器误杀成改需求；③教师图/白板没进学习者 visibleContext（学员会问「图在哪」）；④recurrence 词表 `once/oneoff` 不一致、referee 不认识 R1/R2/R4 | docs/SKILL_FIELD_AUDIT_2026-11-11.md §8 |
| 18 | 2026-11-11 | 同审计遗留缺口：**D1 learn-turn 模拟器没有「离场」语义**（goal 有 shouldEnd、learn 没有——课堂里「人已经走了，老师还在讲」，只能烧满 40 回合上限）；**D2 scenario-designer 的 personaSeed 在 provisioning 链路被丢弃**（story/persona 漂移风险） | 同上 §4-D1/D2（保留观察项，未改代码） |
| 19 | 2026-11-11 | 技能字段契约审计确认 learn-turn 输出字段仅 `reply/emotion/learnerState/learnerFeedback/debug/checkpointAnswer`，确无 shouldEnd——D1 在字段面坐实 | 同上 §6 字段总表（virtual-learner-learn-turn-simulator 行） |
| 20 | 2026-11-11 | 告别死循环确定性兜底上线：`isRepetitiveLearnerReply` 单测把**跑批脚本里的 21 轮告别循环**与蓝屏 8 轮告别写成用例名；断言「换词复读」命中、「不知道。」×2 不误杀 | backend/src/coordinators/__tests__/simulation.goal.steps.test.ts:8-36 |
| 21 | 2026-11-11 | prompt-realism-guards 回归固化（27+ 断言）：离场信号只收口不下快选、真实任务禁整包 SOP、not_judgeable 禁先提案再拒单、拍板禁带尾巴、白板「不要问图在哪」等——每条断言对应一个已踩坑 | backend/src/skills/__tests__/prompt-realism-guards.test.ts 全文 |
| 22 | 2026-11-11 | VIRTUAL_LEARNER_REALISM 复验：蓝屏/游泳/合同三案例单驱动+拟真人设后分别收敛为 3/5/4 步（详见原文档，此处一行带过）；**残留 5 条**：旧批次行为结论需重跑、人设随机生成与案例语境不贴合（合同案生成「社区团购团长」、游泳案生成「高二生物课代表」）、shouldEnd 仍是模型判断、learner-ended 会话保持 running 无 paused 语义、首课启动窗口 ~10 分钟 | docs/VIRTUAL_LEARNER_REALISM_2026-11-11.md §三/§五 |
| 23 | 2026-11-13 | 20 用户战役试点：**拟真人设身份漂移 5/5 全漂**——「签劳动合同的产品经理」→「烘焙工作室主理人」、「看财报的运营」→「汽修学徒」、「产品经理学缓存」→「大理民宿店长」；提示词「保留 existingPersonaSeed 底色」规则被「避免最近职业重复」的自由采样规则压过 | docs/UNATTENDED_20_USER_CAMPAIGN_2026-11-13.md §六-2 |
| 24 | 2026-11-13 | answer_then_hook 吞打字确认（u01）：分诊为 answer_only 后确认裁决被跳过，学习者**连续说三次「开始排吧」既不算 confirmIntent 也进不了 nudges 计数**，随后直接离场、`goal-ended-without-path`——学习者服从性被闸门误读成无意图 | 同上 §六-7；backend/src/services/learning/__tests__/goal-conversation.confirm-intent.test.ts:290（用例 e） |
| 25 | 2026-11-13 | u10 真实缺陷：goal 6 个 AI 回合持续追问不产提案，**时间紧张的学习者离场**、零路径——「追问不收敛」首次在批跑中被定性为平台缺陷而非学习者行为 | docs/campaigns/2026-11-13-batch1-report.md（u10 行，goal-failed/goal-ended-without-path） |
| 26 | 2026-11-13 | 单日 `advance-day` 完成 1 课后又开新课、只落 1 条开场消息停在 active（待 7 天批次确认是否重复开场/空转）——课堂节律失真候选 | docs/UNATTENDED_20_USER_CAMPAIGN_2026-11-13.md §六-5（修复清单 #4「待确认」） |
| 27 | 2026-11-13 | 第一批 20 例大盘：完成 5 / 未跑完 14 / goal 未收敛 1；平均 2.8 阶段/10.8 课/4.4h；**无一节课风险、无标题剧透、无课堂失败、无开场假定经历**（负证清单）；u01 68 条课堂消息零法条出处（材料派生被 `needsMaterial:{}` 空对象压掉） | docs/campaigns/2026-11-13-batch1-report.md 汇总段 |
| 28 | 2026-11-13 | **路径体量跨 run 方差**：同一 u05 第一批 2 阶段/4 课/0.8h，第二批 4 阶段/15 课/7.5h；u06 3/12→4/14——goal 收敛的「范围大小」受拟真人设可用时间/表述影响，缺跨 run 稳定性护栏（定性为下一轮优先级最高的产品问题） | docs/campaigns/2026-11-13-comparison.md §三-2 |
| 29 | 2026-11-13 | 材料检索二手源：u15 把**豆瓣书评当真（status=ok）**；u03/u04 行业报告/论文被正确拒收但也没拿到法条/年报原文——采集触发≠证据质量 | 同上 §三-1 |
| 30 | 2026-11-13~14 | referee mini-batch（黑盒 7 例 + classroom-quality-judge 32 课）病历单：`TEACHING_BOARD_UNVERIFIABLE`（教师引用「板上左栏」但 publicTrace 无板书）7/7；`NOTATION_LEAK`（`qps→path` 等内部记号直落学习者对话）6/7；`ASSESSMENT_REPEAT_RECALL`（同轮已给结论的复述型检查点）7/7；`CLOSURE_MISSING` 7/7；`BOARD_MISMATCH` 6/7 | docs/campaigns/2026-11-13-referee-minibatch.md §三/§八 |
| 31 | 2026-11-13 | 裁判输入截断：**轨迹 22 条被截**，裁判看不到全量上下文（`TRACE_TRUNCATED`，info 级）——扮演质量评审自身的观测面有缺口 | 同上 §二试点 u17 findings |
| 32 | 2026-11-13 | epistemic-grounding 每回合被路由冻结校验打回、降级为 null：**7/7 case、单例 19-87 次**——认知判决在黑盒链路上系统性失明（已修 simulator-route-policy） | 同上 §六 |
| 33 | 2026-11-13 | `WRAPUP_MASTERY_OVERCLAIM`（批 C 起最大簇 major×8）：收束把「工时判断混过档」的学习者标 **mastered/100**，同一收束 learningEvaluation 自认课内被纠正——掌握度反向失真；两道既有闸（证据回链/终态措辞）都拦不住 | 同上 §13.3/§14.1 |
| 34 | 2026-11-13 | 板书**固化学员已纠错误 critical×2**（批 D）：教师明确纠正试用期上限 2 个月后，rev4 起板书一直写学员错版「上限 1 个月」到课终，错误正落在本课核心边界点；后续刷新从引语里把错版又抄回 | 同上 §14.3/§15.1（DB 实证链） |
| 35 | 2026-11-14 | `OPENING_ASSUME_EXPERIENCE` 爆量 5/5（minor×11→major×1）：开场断言「上节课已把 X 逐句标过三档」「上一课你算出 3.62 亿」但证据面无据可查——每课开场都在引用不可核验的共同记忆（多批迭代后收敛） | 同上 §16.1/§16.4 |
| 36 | 2026-11-14 | `PHANTOM_TRANSFER_MATERIAL` critical×1：教师声称「下面三句来自一篇你没读过的摘要」但从未呈现，**学员在无材料下编造答案、教师还表扬「判得准」**——对话中段材料悬空（多批仅 1 例，转观察项+tripwire） | 同上 §16.3/§17.1 |
| 37 | 2026-11-14 | `ARITHMETIC_ANSWER_MISMATCH` critical×1：学习者称「累计 −280」，教师直接认可「−280 对了」，与板上 −400 及正确算术双重矛盾——认可式错误无等式形态，自检闸结构性覆盖不到（批 I 未复现，按观察项归档） | 同上 §17.4/§18 |
| 38 | 2026-11-14 | 双子代理体验盲评（与机器判官正交）：「答案提前暴露」（板书先亮答案再让学员报净额）、「教师把自己给的答案归因为学员自查改回并写进 wrapup（归因失实）」、「重复收束三连（学员两次答应课还不散）」、「单轮多概念块、漏做后不了了之」等 8 簇 | 同上 §19.2 |
| 39 | 2026-11-15 | `GOAL_STUCK_LOOP` critical×1（u19）：学习者多次明确确认「按这个方向排路径」但平台状态机卡死不放行——学习者意图被编排层吞掉（批 17 修复后未复现） | 同上 §26.2/§27 |
| 40 | 2026-11-15 | `F_001` abandon 语义缺陷：`finalize(end_only, learner-abandoned)` 后收尾服务误报——学习者离场信号在落库面被错误归类（批 20/21 修复归位） | 同上 §30/§31 |
| 41 | 2026-11-17 | confirm 裁决真机案例 gc_1794910169154_01o30g0：stage 停在 understanding 但方案已完整、按钮 flag 推进被拦——「确认信号 vs 状态机」错位（用例 d-3 固化） | goal-conversation.confirm-intent.test.ts:271（用例名内嵌日期与 gc id） |
| 42 | 2026-11-13~17 | run-harness 注释把「教学回合模型抖动」定为**新发现问题 #3**：后端把抖动暂停写成 `failed`，harness 必须把带 retryable 标记的 failed 按「可续跑」处理，否则整日误杀 | backend/src/services/virtual-lab/run-harness.ts:43,63,194,217 |
| 43 | 日期未注（2026-11-11 前后） | 源码注释自认的扮演失真两处：①「判决概率交 LLM 自由把握 ⇒ **19 连对零失手**」的扮演失真（判决被确定性化）；②degradation-telemetry：「上下文读不到时产出**看起来自信、实际失真的结论**（虚拟链路尤其明显）」 | backend/src/coordinators/simulation.learn-phase.ts:992；backend/src/skills/degradation-telemetry.ts:5 |
| 44 | 2026-11-19（调研时点） | AB 双路径对照（thinking off/on 六跑）与 TIME_MODEL_AUDIT / KNOWLEDGE_REPLAN_AUDIT 未新增虚拟学习者失真项——2026-11-11 后无新的学习者侧独立报告；最新行为证据集中在 referee-minibatch 批 A~N（至 2026-11-14 晚网关封锁止） | docs/AB_3CASE_DUAL_PATHS_2026-11-11.md；两审计文件 grep 无「虚拟学习者」命中 |

---

## 2 失真模式目录（按模式归组，每模式 1-3 条最强证据）

### 2.1 离场失真（告别循环 / 该走不走 / 离场语义缺失）
- **最强**：跑批脚本 **21 轮告别循环** 与蓝屏 8 轮告别被写成确定性兜底用例名——连续短告别+导师短收口命中 `isRepetitiveLearnerReply`。出处：simulation.goal.steps.test.ts:8-36（2026-11-11）。
- learn-turn 模拟器**没有离场语义**：goal 有 `shouldEnd`、learn 没有，课堂里「人已经走了老师还在讲」，只能烧满 40 回合上限。出处：SKILL_FIELD_AUDIT_2026-11-11.md §4-D1 + §6 字段表（仍未修）。
- learner-abandoned 离场信号在收尾服务被错误归类（F_001）：学习者主动中止后 finalize 误报。出处：referee-minibatch §30（2026-11-15，已修）。

### 2.2 重复/复读（学习者复读 & 教师复读双向）
- 上游故障诱发学习者重复同一句 → 被 repetition-guard 判离场（报表勾稽，`repetition-loop` 终局）。出处：BATCH_TEST_2026-11-11.md 十课批次结果（2026-11-11）。
- 教师侧镜像：u07 收尾循环 20 轮不收敛（`completionDeferrals=2` 后连续 4+ 轮重发近同构收尾话术）；u01 作业指令重发循环六轮、学员只回「马上去」。出处：referee-minibatch §10.1、§22.3（2026-11-13）。
- `ASSESSMENT_REPEAT_RECALL` 7/7：检查点以复述为主（同轮已给结论，学习者只需回忆标签）；「让学生反复重说同一句结论（原话→改口→再确认）也是复述」。出处：referee-minibatch §八/§13.2（多批未清零，2026-11-14 转观察）。

### 2.3 身份漂移 / 空壳人设（persona drift）
- **最强**：拟真人设身份漂移 **5/5 全漂**（产品经理→烘焙主理人、运营→汽修学徒、学缓存→大理民宿店长）；自由采样规则压过身份种子。出处：UNATTENDED_20_USER_CAMPAIGN §六-2（2026-11-13，已修 persona-identity-anchor）。
- scenario-designer 的 `personaSeed` 在 provisioning 链路被丢弃，story/persona 漂移无守门。出处：SKILL_FIELD_AUDIT §4-D2（2026-11-11，未修）。
- 人设随机生成与案例语境不贴合（合同案生成「社区团购团长」、游泳案生成「高二生物课代表」）。出处：VIRTUAL_LEARNER_REALISM §五-2（2026-11-11，未做显式种子）。

### 2.4 泄露（内部记号 / 能力悖论 / 答案提前暴露）
- `TEACHING_NOTATION_LEAK`/`NOTATION_LEAK`：`qps→path`、「80% 那条相对线」「双线」等内部记号未解释直落学习者对话（u17 单例 → 跨样本 6/7 确认）。出处：referee-minibatch §二/§八（2026-11-13）。
- 「能力悖论泄露」误判：actor-auditor 曾把脚手架轮判 true 视为泄露——修正为「合理的支架承接不得判为能力悖论泄露」。出处：SKILL_FIELD_AUDIT §8.1-F16 配套 + prompt-realism-guards.test.ts:274-278。
- 答案提前暴露：板书轮 2 起就写「净占用现金 830」，教师四轮追问「报净额」；检查点因此降级为复述。出处：referee-minibatch §19.2-1（2026-11-14）。

### 2.5 误诊 / 误判（把学习者或场景判错）
- 情绪×认知技能被硬阻断：心理 v1 证据原话不含「练习/方法」词，模型已判 `cognitive_internalized × judgeable_output` 仍被 `emotional_support` 硬阻断、无法排课。出处：BATCH_TEST_2026-11-11.md 缺陷 3（2026-11-11，已修）。
- `scope_size=[单点概念]` 标签被当硬上界：确认 8h/二十来次坐学 → 生成 1.2h/4 课（F24）；且旧路径两次重排无效（hints 钳回）。出处：同上（2026-11-11，已修+存量需重排）。
- answer_only 闸把服从性误读成无意图：学习者连说三次「开始排吧」被判「未确认」后离场。出处：UNATTENDED §六-7（2026-11-13，已修）。
- 检索误诊：u15 把豆瓣书评当真实信源（status=ok）。出处：campaigns/2026-11-13-comparison.md §三-1（未修）。

### 2.6 节奏失真（出题/收尾/单轮多动作）
- 出题节奏票残留：`checkpointRhythmMinTurns` 在理解度<0.6 时 2 条消息加速出题，与「学生懵时给支架不弹卡」冲突。出处：BATCH_TEST 缺陷 1（2026-11-11，已修）。
- 同一焦点 3 道唯一题（检查点无概念归属，单焦点守门员失效）。出处：同上缺陷 2（2026-11-11，已修）。
- 单轮多概念块：u07 一轮三件套学员只交一件、无人追要，「漏做后不了了之还教会学员指令可以不认真」。出处：referee-minibatch §19.2-5（2026-11-14）。

### 2.7 情绪/掌握度失真（评估面反向失真）
- `WRAPUP_MASTERY_OVERCLAIM`（全战役最大簇 major×8）：混过档的学习者被标 mastered/100；「说过但被纠过错」照样过证据回链闸。出处：referee-minibatch §13.3/§14.1（2026-11-13，负证据降档闸已修+误解台账补强）。
- 「19 连对零失手」扮演失真：判决概率交 LLM 自由把握，判决被确定性化修复。出处：simulation.learn-phase.ts:992 注释。
- degradation-telemetry 自认：上下文读不到时「产出看起来自信、实际失真的结论（虚拟链路尤其明显）」。出处：backend/src/skills/degradation-telemetry.ts:5。

### 2.8 记忆/经历虚增（不可核验的共同记忆）
- **最强**：`OPENING_ASSUME_EXPERIENCE` 爆量 5/5——开场断言「上一课你已把五处逐条判完」「你已经量稳了」，本课证据面无据可查；且词面判定器是「打地鼠」（「你已经量稳了」无任何标记词），最终靠 rule 57 缺席分支收敛。出处：referee-minibatch §16（2026-11-14）。
- 反向断言子形态：「你之前没细看过这类合同」＝断言学习者没做过某事——正向判定器抓不到（批 12 已纳入）。出处：同上 §18.2/§22.1。
- 教师归因失实：把自己给的答案归因为「学员自查改回」写进 wrapup。出处：同上 §19.2-2。

### 2.9 材料悬空 / 指令要求物不存在
- `PHANTOM_TRANSFER_MATERIAL` critical×1：「下面三句来自一篇你没读过的摘要」从未呈现，学员盲答被判「方向对」再补料（评估作废变体：`盲答判对`）。出处：referee-minibatch §16.3/§20.3（2026-11-14，降级观察+tripwire）。
- 材料断裂：摘要截断后学员两轮求补全只得「我这边也没有你的原文」死胡同，末轮「第三篇贴上来」出口即散课。出处：同上 §19.2-4。
- u01 68 条课堂消息零法条出处：`needsMaterial:{}` 空对象被当成「已声明公开需求」压掉派生。出处：campaigns batch1/comparison（2026-11-13，已修）。

### 2.10 扮演-教学机制冲突（扮演信号被教学链误处理）
- epistemic-grounding 只看静态人设：脚手架答对仍判挂（无支架冷测必挂/有支架微步 0.40-0.55 两轴修复）。出处：SKILL_FIELD_AUDIT §8.1-F16（2026-11-11）。
- 拍板带尾巴被裁决器误杀：`readyToProceed=true` 附带新顾虑被判「改需求」→ 修为「纯拍板确认，严禁顺带补充背景/时间条件/顾虑/追问」。出处：同上 F17。
- 教师 figure/白板不进 visibleContext：学员会问「图在哪」→ 修为 `【课堂白板】`文本块（≤4 图/单图 ≤1200 字）注入 5 处教师消息。出处：同上 F18 + simulation.teacher-whiteboard.test.ts。
- recurrence 词表不一致 + referee 不认识 R1/R2/R4：`once|recurring` vs `oneoff|recurring`。出处：同上 F20/F21。

---

## 3 已修复 vs 仍开放

### 3.1 已修复（有修复证据：commit / 测试 / 真机复验）

| 失真项 | 修复证据 |
|---|---|
| 告别死循环（换词复读） | `isRepetitiveLearnerReply` 确定性兜底 + 4 用例（simulation.goal.steps.test.ts，2026-11-11；REALISM 文档 §四 9/9） |
| 双驱动放大对话轮数 | `autopilot:'off'` 单驱动 + autopilot 停条件（learnerEnded→stopped / noPath→completed，autopilot.service 31/31；REALISM §二-5） |
| 拟真人设身份漂移 | `services/virtual-lab/persona-identity-anchor.ts` 确定性锚定（只锚身份字段、保留行为字段）+ 4 用例；第二批起 name/occupation/background 全部锚回 case（comparison §二「5/5 漂移→全锚回」） |
| answer_then_hook 吞确认 + off-by-one | 裁决照跑、「坚持 ≥2 次」改累计确认意图；用例 e 固化（confirm-intent.test.ts:290）；第二批 u01/u02 均 4 轮确认闭环 |
| ≥5 个用户回合仍无提案（u10 零路径） | 收敛窗口软校验强制重试 + goal→path 交接改累计 understanding；第二批 u10 3 轮收敛并生成路径 |
| F22/F23 整包 SOP / 离线作业 | goal-conversation 规则「真实任务当教材，禁止整包 SOP / 不要再等用户离线做完」；盘库 v3 4 步 84s 出路径；prompt-realism-guards 4 断言（BATCH_TEST 追加节） |
| F24 单点概念钳塌缩 | `path-planning-hints` 结构自洽（key_stages 超帽→标签作废不钳）；5 单测；minimal 塌缩同修（ONE_SITTING_BOUNDS 只对 ≤2h 体量生效） |
| 外评 4 条机制冲突 | F16（支架感知两轴判决）~F21（R1/R2/R4）全部落地；6 个虚拟学习者 skill 重编译；定向 4 suites/35 tests（SKILL_FIELD_AUDIT §8.1/§9） |
| learn-turn 卡死归因丢失 | append-only `appendStuckAttributionEntry` + 四条件卡死判定（learn.steps.stuck.test.ts，2026-10-21） |
| wrapup mastery 高估 | 负证据降档 `downgradeMasteredOnNegativeEvidence` + 误解台账接线（批 E 3 次实战拦截）+ 批 10 证据强度门 D2 |
| 板书固化学员错版（critical） | 纠正语境持久化 `lastCorrectionNotes` + 清除禁令 L1 + 纠正刷新槽位 L2；批 E critical 清零 |
| 白板历史不落库（BOARD_DANGLING_TRACE 根因） | `sessionArtifacts.boardHistory`（≤40 版）+ 消息级 `boardState` 指针；新链路该簇消失（批 2 真机 A/B） |
| 收尾循环 | `closureRepeatStreak` 跨回合继承 + ≥3 轮强制放行 + 学员短确认收口（批 13 `computeLearnerShortAckStreak`，批 N 前实战命中 1 次） |
| epistemic 路由冻结 7/7 降级 | `simulator-route-policy.ts`：u01 复跑「认知判决失败 36→0」 |
| 黑盒 path 等待 10 分钟误杀 | `AUTOPILOT_PATH_WAIT_LIMIT_MS` 默认 45 分钟 |
| 检查出题节奏票/无概念归属/透镜重复/线下体力任务/情绪硬阻断/wrapup 种子丢弃 | BATCH_TEST 6 缺陷各带 commit（4b62cda5/425bbb87/2ef4b49c/79800cf5 等） |
| 管理员并发登录互踢（跑数器缺陷） | runner 共享 Cookie，20/20 建号成功 |
| GOAL_STUCK_LOOP / F_001 abandon 语义 / 延伸课 403 | 批 17/20-21/24 各带取证与真机未复现记录 |
| 供应商抖动一击毙命 | 批 5 三层（transportMaxRetries / retryable 字段 / 瞬态分类）+ 批 11（410/422 归瞬态）；批 M 窗口 20 瞬态 20 个 willRetry |

### 3.2 仍开放（截至 commit e736f7aa 无修复证据）

| # | 问题 | 出处与状态 |
|---|---|---|
| 1 | **learn-turn 无离场语义**（课堂里人走了老师还在讲） | SKILL_FIELD_AUDIT §4-D1/§6 字段表仍无 shouldEnd；§7 建议第 1 条原文保留——未见修复 commit |
| 2 | scenario-designer `personaSeed` 在 provisioning 被丢弃 | SKILL_FIELD_AUDIT §4-D2，二选一方案未拍板 |
| 3 | shouldEnd 仍是模型判断，三字组兜底抓不到「每轮换话题但都不走」；「连续 N 轮无信息增量」语义看门狗未做 | VIRTUAL_LEARNER_REALISM §五-3 |
| 4 | 人设随机生成与案例语境不贴合，harness 无显式 persona 种子 | REALISM §五-2 |
| 5 | learner-ended 会话保持 `running`，无 paused 语义（列表不显示「已离场」） | REALISM §五-4 |
| 6 | 旧批次行为结论（对话轮数/告别次数）受双驱动污染，需单驱动重跑 | REALISM §五-1 |
| 7 | **路径体量跨 run 方差**（u05 2 阶段/4 课 vs 4 阶段/15 课），缺跨 run 稳定性护栏 | campaigns comparison §三-2（定性为下一轮最高优先级） |
| 8 | 材料检索二手源（豆瓣书评 status=ok）；一手源优先/域名限定未做 | comparison §三-1 |
| 9 | 路径长度 vs 学习日预算错配（平均 10.8 课，14/20 报 max-days-reached）——产品决策未做 | comparison §三-3 |
| 10 | 单日结束留 1 条消息的 active 课堂（是否重复开场/空转）未确认 | UNATTENDED 修复清单 #4「待 7 天批次确认」 |
| 11 | `ASSESSMENT_REPEAT_RECALL` 对话问面：编排层无确定性信号（对话问无答案键），rule 243 两轮收紧未移动覆盖，裁判口径软化——转观察 | referee-minibatch §13.4/§20.3 |
| 12 | 认可式算术错误：无等式形态，自检闸结构性覆盖不到；tripwire 未触发（1 例后未复现） | referee-minibatch §17.4/§18（规格存档待触发） |
| 13 | OPENING 残余子形态：recap 在场但具体断言超纲（需 claim-vs-recap 内容比对）；批 13 队列候选 | referee-minibatch §22.2 |
| 14 | 板书指认精度（指认不存在的行/格、板面滞后于对话演进）：确定性闸误杀风险高，维持观察 | referee-minibatch §17.2/§22.3 |
| 15 | 路径生成等待体验：文案已诚实化（5-20 分钟）但无进度条/ETA | referee-minibatch §十一-5 |
| 16 | 裁判输入截断（22 条）与 referee code 不稳定（同一现象 8 种写法）——评审观测面缺口 | referee-minibatch §二/§五 |
| 17 | 时间压力下路径被压到 2 阶段是否过短——待全量批次评估 | UNATTENDED 修复清单 #5 |

---

## 4 persona 档案现状（cards / presets 字段完整度评估）

### 4.1 presets.yaml（内置预置虚拟学习者，File-as-Truth）
- **规模**：9 条 preset（student-geo-essay / nurse-career-transition / vocational-electrician-exam / primary-xsc-cram / zhongkao-streaming / gaokao-science / kaoyan-retake / backend-eng-distributed / civil-service-onsite），presetVersion 2-6；另有 `presets.yaml.backup-20261001` 备份。注意变更记录声称「原始 14 条 + 后补 4 条」，现文件实际只有 9 条（fatty-liver / mom-restart-job / fund-loss-rebalance / retiree-xiangqi-openings 等在变更记录中宣布新增的条目**不在当前文件**，属声明与实物的漂移，沿用本仓 P5 类「声明文本与实际漂移」口径）。
- **字段完整度：满配**。每条 personaSeed 约 **40 个字段全部填充**，且全部 9 条无空缺（awk 计数每个字段 ×9）：身份 4（nameHint/age/occupation/education）+ 认知 8（knownConcepts/struggleConcepts/learningStyle/metacognitiveProfile/cognitiveLoadTolerance/selfRegulationStyle/digitalLiteracy/helpSeekingPattern）+ 动机 3（motivationType/motivationOrientation/personalityDrivers）+ 情绪 3（emotionalBaseline/emotionalTriggers/resiliencePattern）+ 行为 9（communicationStyle/priorAttempts/adversarialPattern/memoryRepairPattern/behaviorBoundaries/learningPreferences/failurePatterns/behaviorHooks/behavioralProfileSummary）+ 场景 13（storyOutline/visibleOpening/triggerEvent/title/disclosurePlan/hiddenDetails/pressurePoints/problemKnowledge/misdiagnosis/goalSeed/sourceType/goalType/scope 等）+ fixtureMaterials（2 条带附件夹具）。
- **质量史即失真史**：v1 负荷失衡（46% 案例被钳成 2 段）→ v2 均衡 → v3 时间轴自洽 → v4 真实情景可网查；每版都官方声明「历史数据不可比」。`defaultBudget`（turnChunkPerLesson 60 / costCeiling 1500 / maxRetriesPerStep 8 / noProgressChunkLimit 3）把预算写进语料以保证两次运行可比。
- **评价**：档案完整度最高的一层；personaSeed 与 goal-conversation-simulator 的输入字段（learner/story/learnerMemory/personaAnchorHint/friction）对齐良好。弱点：样本仅 9、且 4 条宣布条目缺席。

### 4.2 cards/（200 张评测卡）
- **规模**：200 张（golden-100 A-E 五组含 8 张分诊负样本；frontier-100 F1-F5B 含 20 张内嵌材料卡），`{version, cards:[...]}`，validateCard 200/200 可导入 0 错误。
- **字段完整度：薄**。每张卡 persona 仅 **4 个字段**：`nameHint / background / availableTime / intentType`——与 presets 的 40 字段差一个量级；无情绪触发、失败模式、沟通风格、元认知等行为面字段。README 注明「需要更丰富的认知人设时再勾选 AI 补全人设（逐卡调用 persona-designer，较慢）」——即行为面默认靠运行时生成，**这正是身份漂移问题的入口**（2026-11-13 5/5 漂移即发生在 generate-persona 链路）。
- **story 面较实**：`visibleOpening`（Goal 开场原话）+ `followUps`（固定 3 轮应答，不足的按预算补时间追问）+ `goalSeed.budget`（horizonDays/dailyMinutes/expectedHours）+ `goalSeed.expect`（path|triage）+ 20 张 `materials[].content` 内嵌正文 + frontier 卡带 `webSource` 溯源。
- **已知告警**：47 张 golden「预算不自洽」是旧口径校验误报（expectedHours=内容体量锚 vs horizonDays×dailyMinutes=日历容量，按新时间模型本就独立）；source.kind 全部 synthetic 诚实标注。
- **评价**：卡库是「身份池不是账号」的定位下，4 字段 persona 对跑分足够，但作为「拟真扮演」语料明显偏薄——跑批行为证据（comparison §三-2 路径体量方差）已证明 availableTime 等字段会直接扰动 goal 收敛范围；行为字段缺省时全靠 `--realistic-persona` 随机生成 + 锚定兜底。

### 4.3 `--realistic-persona` 生成人设
- 走平台 `generate-persona`，输出含 emotionalTriggers / failurePatterns / availableTime / cognitiveLoadTolerance 等行为字段（REALISM §二-4）；2026-11-13 起出站经 `persona-identity-anchor` 只锚身份 4 字段、行为字段保留模型生成（persona-identity-anchor.test.ts：换身份锚回、只给名字不造职业、无 seed 原样返回）。
- 残口：种子仍由 harness 随机发起，与案例语境的贴合度无保证（仍开放 #4）；行为字段与 story 的 misdiagnosis/pressurePoints（presets 才有）无对应物。

### 4.4 结论
档案三层（presets 40 字段满配 / cards 4 字段骨架 / --realistic-persona 行为随机+身份锚定）完整度依次递减；「扮演对话失真」证据最集中发生的链路（generate-persona、goal-dialogue、learn-turn）恰好都运行在**行为字段最不完整的一侧**。若要把失真率压下来，cards 层行为字段补齐（或把 presets 式 40 字段模板作为导入卡的可选富化目标）是最直接的杠杆，其次是仍开放 #3/#4 的确定性看门狗与显式种子。

---

*本文所有引用均可在仓库当前快照（e736f7aa）中按出处复核；未展开 VIRTUAL_LEARNER_REALISM_2026-11-11.md 已有结论。*
