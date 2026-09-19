# 20 问方案 × WenFlow 真实业务：逐条核验与升级方向（2026-09-18）

> 缘起：`doc/20questions/` 下的 `TWELVE_QUESTIONS_INVESTIGATION.md`（十二问）、`EIGHT_ADDITIONAL_QUESTIONS_INVESTIGATION.md`（八问）、
> `GEMINI_DEEP_RESEARCH_ANSWERS.md`（外部方案原文）、`COGNITIVE_DYNAMICS_REPORT_REVIEW.md`（第二份外部报告核对）——该目录为本机过程材料，不入库。
> 任务：这些文档列举了 20 个问题与大量方案，**要拿它们和真实项目业务对一遍**——哪些成立、哪些已过期、哪些记错、
> 哪些该现在做、哪些缺基建，最终给出下一步升级方向。
> 方法：不采信文档结论，**逐条回代码复核**（7 路并行深查 + 关键项人工复验）；核验结论一律带 `文件:行`。
> 性质：**调查 + 决策建议**，不含代码改动（例外见 §4 的四个"即刻可修缺陷"，仅列出、未改）。
> 说明：本文是入库的结论/方向文档（`doc/UPGRADE_DIRECTION_20Q.md`）；其引用的 20 问原始调查与外部方案原文
> 仍留在本机 `doc/20questions/`（`doc/*` 被 `.gitignore` 忽略，属过程材料，不进仓库）。

---

## 0. 一句话结论

20 问的**方法论层（双传感器、ZPD 支架撤除、静默降级治理、指令层级、OLM 自述优先、MRT、分层路由、成本护栏）
基本正确且值得采纳**；但它们的**优先级是按"成熟工业 ITS"排的**，与 WenFlow 的真实阶段（早期原型 + 虚拟学习者实验室 + 无向量/Redis/沙箱/本地模型的 SQLite 栈）错位。

按真实业务重排后，下一步升级方向是：

1. **先修"传感器与诚实层"**（成本最低、直接决定后面所有结论可不可信）：修好检查点/时间上下文的**半截线**、
   给真静默失败加降级标记、教学内容补"不确定降断言"。
2. **再做"虚拟学习者记忆保真 + 记忆看板"**（虚拟实验室是本项目**唯一**的验证手段，保真度就是产品力）。
3. **同步补"安全与合规最小层"**（注入围栏、防套取、内容审核单层、隐私分类/同意/自述优先）——这是**上线真实用户的前置**，
   与阶段无关。
4. **明确缓做**：独立 reranker、embedding/向量、RAG 溯源、代码沙箱、约束解码、真实用户分流/MRT、单位经济——
   全部依赖**当前不存在的基础设施**，早期做了是重复造轮子。

> 关键反转：八问 §13 与第二份报告的核心论据"检查点几乎不产生 → 成功率带油门永远打不开 → 系统稳态=最低难度档"
> **已经过期**。最近一轮修复放开了 `ready_to_close` 出题，并补上了答案键示例、skip 路由、黑盒消费三处断点
> （`doc/re_test/2026-09-18-deploy-and-verify.md` N3 已验证首条检查点落地）。公平性该做的变成了
> **D_floor（最小挑战保底）+ 支架双向退出 + 独立锚题探针**，而不是"修一个坏掉的油门"。

---

## 1. 业务事实基线（决定"哪些方案值得做"）

| 维度 | 事实 | 对方案的约束 |
|---|---|---|
| 阶段 | **早期实验性原型**（README「项目状态」自述）；Demo 站定期清库；无真实用户规模化 | 真实用户实验（Q18/MRT）、流失召回（Q19）、单位经济（Q20）**没有对象**，只能先建观测或延后 |
| 核心命题 | "学习始于对真实问题的澄清"；5 类能力（问题定义/系统思维/判断力/AI 协作/创造力） | 升级应服务"问题→路径→教学闭环"的质量，而非通用 agent 平台能力 |
| 验证手段 | **虚拟学习者实验室**（黑盒模拟 + 裁判 + 角色保真审计） | 实验室保真度 = 产品的测量仪器；记忆保真（Q4）因此是产品级，而非玩物 |
| 技术栈 | SQLite 双库；依赖仅 15 个；**无向量库 / 无图库 / 无 Redis / 无本地小模型 / 无沙箱**；模型走 OpenAI 兼容网关 | 一切"向量/沙箱/小模型/约束解码"方案=从零建基建 |
| 工程纪律 | `core.yaml` 唯一人工源 + 编译链 + 守门三查；**LLM 只出观测/建议，档位/排序/状态由代码裁决**；`SkillResult.quality` 质量标记；outbox/inbox 事件链 | 单源化、软约束、可回滚是硬约束；方案必须落进这套纪律 |
| 自动出题分工 | 时机由代码（`shouldEmitCheckpoint`）定；内容+答案键由 `teaching-turn` 定；判分由 `judgeCheckpointAnswer` 代码定 | Q13/Q14/Q15 的增量都要挂进这条链，不能另起 |
| 学习者模型自认边界 | `LEARNING_SCIENCE_AUDIT.md`：「控制回路已接线，传感器多为代理量，记忆环路刚通电，结果测量刚建最小层」 | 升级优先级应给"传感器质量"与"诚实性"，而非更多控制回路 |

---

## 2. 逐条核验（20 问 + 外部方案）

图例：核验=✅ 成立 / 🟡 部分 / ⚠️ 已过期 / ❌ 记错或不存在；贴合=与当前业务的贴合度；处置=可做 / 缓做 / 缺基建。

### A. 认知 / 学习层

#### Q4 虚拟学习者概率化记忆（文档评为"最明确、最有产品价值"）
- **核验**：🟡 主体成立，且有**比文档更好的落地条件**。
  - 记忆确实只是三桶静态标签：`learner-memory.ts:142-163`（mastered/dueReview/struggling），引用全靠 LLM 采样，无概率机制。
  - **FSRS 保留率已算、且已到模拟器**：`simulation.memory.ts:66-80` 把 dueReview 的 retention 变成 `knowledgeSnapshot.progress`；
    但 `simulation.memory.ts:52-59` 又把 `learnerMemory.dueReview` **map 成纯名字**，把数值丢了——概率提取所需的 strength 就在手边，被丢掉了。
  - **可注入随机先例只有一处**：`virtual-learner-shared/schemas.ts:243-255` `decideFrictionTrigger(budget, random=Math.random)`，
    测试注入 `()=>0.299`（`friction.test.ts:30-38`）。全仓无其它可注入 rng，**无任何 PRNG helper**。
  - **解耦的对象搞清了**：虚拟学习者与真实用户**同表**（`memory_traces` 无 `isVirtualLearner` 列，`schema.prisma:677-705`），
    靠 `userId` 隔离；虚拟会话**确实**写自己的 FSRS/痕迹（`simulation.memory.ts:33`、`ReviewCompletedConsumer`）。
    Gemini 说的"影子沙箱"在本项目 = **在调度侧按 `isVirtualLearner` 过滤**，不是建第二个库。
- **核验出的文档缺陷**：`sinceLastSessionDays` 是**死字段**（`simulated-day.service.ts:218-225` 只声明，`temporalContextFromClock` 从不赋值）；
  模拟器 payload 里 `temporalContext` 也被丢弃（见 §4）。
- **贴合**：高。**处置**：可做（低-中）。**前置**：`learnerMemory.dueReview` 先带上 retention 数值。
- **警告**：Gemini 原文的 FSRS 公式漏 `/81`（项目真值 `19/81`，`fsrs.ts:166-168`）、混淆池参数会吃掉 VAGUE/FAILED——
  文档已标注，**落地时以项目公式为准**。混淆对依赖 embedding（无）→ 用 LLM 离线判 + 留档（复用 `ConceptConsolidatorService` 范式）。

#### Q8 测量学习效果（可证伪）
- **核验**：🟡 结果测量层**存在但是孤岛**：`retention-curve.ts` 的 `buildRetentionCurve` 唯一非测试消费者是只读脚本
  `scripts/audit-retention-curve.ts:16-19`，无 route/service 引用；数据源 `learner_evidence('review:completed')` 的
  `elapsedDays/rating` 由 `ReviewCompletedConsumer.ts:111-130` 写入，**数据够算**。
- **贴合**：中（MRT 需要真实用户，当前没有）。**处置**：先激活观测层（把保持率曲线暴露到 admin）；MRT 缓。

#### Q19 生命周期（冷启动/流失/回归）
- **核验**：🟡 冷启动继承 ✅（`learning-state.service.ts:1043-1053`、`LearnerSnapshotService.ts:441-453`、`LearningMetricService.ts:180-182`）；
  churn/winback/dormant **零命中** ✅；`sinceLastSessionDays` 死字段 ✅；streak/成就 ✅ 但**无免死/修复**。
- **贴合**：中（真实用户规模化后）。**处置**：**"回归重校准"与 Q4 同源**（离开越久→记忆越不可靠→教学更保守），
  可复用 `temporalContext`，但**必须先修死字段**。低成本。

### B. 机制 / 工程层

#### Q1 排序模型 / reranker
- **核验**：✅ 无 embedding / 无 reranker / 无向量库（全仓 grep 零命中；依赖表见 `backend/package.json`）；候选集极小；
  且**已有确定性 urgency 排序 + 交错**（`review-plan.service.ts`；CHANGELOG「到期复习点自动交错排序」）。
- **贴合**：高（不引重基建，符合纪律）。**处置**：**慎做/低优先**。真缺口是"易混对"语义维度，但相似度来源（向量）不存在，
  先用 LLM 离线判定 + 台账。**建议先量化"复习选点质量"**（可复用 Q8 的观测层）再决定要不要 LLM listwise。
- **提醒**：外部方案 `scheduleReviewPack` 依赖 `semanticEmbedding`，在本项目落不了地；其 MMR 思想可无向量近似（用 LLM 判定的易混对当相似度）。

#### Q2 虚拟学习者拆分 + 记忆看板
- **核验**：🟡 **不是"纯前端、数据已齐"**。
  - API 在：`GET /:id/memory`（`routes/admin/virtual-learners.ts:756-782`）返回 `mastered/dueReview{name,retention}/struggling/...`。
  - 前端现状：`VirtualProfile.vue:226-240` 是标签+保留率数字；`MemoryReview.vue` 是表格；**全站唯一的 ECharts 曲线是负荷曲线**
    （`LearnerDetail.vue:1176` 的 LSS/LF/LSB）——**mastery/stability/retention 没有曲线**。
  - 更全的 `getRetentionSnapshot`（含 stability/lastSeenAt）**没被该端点使用**（只被 simulated-day/batch-experiment 用）。
- **贴合**：高（实验室可解释性）。**处置**：可做（前端新画图 + 后端小改/暴露更全字段）。**前置**：统一展示口径（见下）。

#### Q5 给每个 agent 写自述
- **核验**：✅ 素材全齐：29 个 `prompts/core/*.yaml` 全含 `identity`；`agent-snapshots.md` 是**字段接口文档**（不是人话自述）；
  已有生成脚本范式 `scripts/generate-agent-snapshots.ts`（含 drift 检查）。
- **贴合**：高（降低维护/协作出错）。**处置**：可做（一天、低风险）。

#### Q7 聚合 / 拆分 / 融合 / 评估
- **核验**：✅ outbox/inbox + `learner_evidence` 只追加；`ConceptConsolidatorService` 已实现"LLM 可证伪建议 + 代码执行 + 留档 + 回滚"
  （= 外部方案的"第二阶段"）；缺第一阶段向量粗筛；delta 三态已试点（goal-conversation）；**真值发现未做**。
- **贴合**：中。**处置**：**真值发现可小做**（代码裁决 w 高、LLM 推断中、自评低——自评与真值之差=元认知校准偏置，项目已有 calibration 概念）；
  ES/CQRS 大重构缓。

#### Q9 编排拓扑命中率
- **核验**：🟡 节点级 runtime 计数**已有**（`Orchestrator.vue:253`、`live.ts` 从 `agent_call_logs` 聚合）；**边**没有任何 metric，
  也没有按 caller→callee 聚合日志的工具；12 处断链/死规则/双源已在 `LEARNING_SCIENCE_AUDIT.md:603-640` 记档。
- **贴合**：中。**处置**：可做（只读聚合 `agent_call_logs.callerAgent` → 边命中率；低风险）。

#### Q10 前端可视化创建字段 + Q11 Prompt DSL / Zod
- **核验**：🟡
  - DSL 侧 ✅：受控词表 `yaml-vocabulary.ts:17-25`（7 类型）、编译链 `core-compiler.ts`、守门三查（结构/字段冻结/含义冻结，
    `routes/prompt-lab.ts:515-554` + `semantic-freeze-judge.ts`）、后置校验器 `skill-output-validator.ts`（已接入 composer 并在失败时重试）。
  - **网关完全不支持结构化输出**：全 `backend/src/gateway/**` 无 `response_format/json_schema/json_object`（唯一命中在图片服务）；
    `executor.ts:594-604` 只透传 model/temperature/max_tokens → **第三档"约束解码"落不了地**。
  - 字段可视化：组件齐（`FieldRoutingTable/FieldAddWizard/SkillFieldRouting/SkillDesignPage`）、三级锁齐
    （`routes/admin/field-routings.ts:32-38`）；**`accumulate` 确实只产 prompt 标签不落库**（`prompt-composer/index.ts:108-118`）。
- **贴合**：中。**处置**：
  - **不追第三档约束解码**（网关 + 无本地 XGrammar/vLLM = 缺基建）。当前上限就是第二档（软约束+校验重试），
    可低风险增强：把字段表**编译成 JSON Schema** 供 `skill-output-validator` 使用 + **reasoning 字段前置**（零成本 prompt 约束，防 Tam et al. 2024）。
  - Q10 的 `accumulate` 运行时功能化属 L2 议题，缓。

#### Q18 真实用户实验基建
- **核验**：✅ 全无。只有虚拟模拟 A/B（`scripts/simulate-learner-days.ts:9-12` 的 `lp_sim_<run>_A/B`）；
  `prediction_records` 是校准台账、`review-quota` 是每日配额、`batch_experiments` 是虚拟批量；**无 feature flag、无用户哈希分流**。
- **贴合**：低（无真实用户）。**处置**：缓（Q16 合规是更前置）。**提醒**：外部报告默认的"MurmurHash 分流 + 五大实验组件"是真实用户量级才需要。

### C. 可靠 / 治理层

#### Q3 静默降级（文档评为高优先、审计价值大）
- **核验**：✅ 问题确凿、✅ 方向正确、🟡 细节有两处要修正。
  - `quality` 在（`skills/outcome.ts:55-62` 四态；`protocol.ts:87-91` 另一类型五态含 `cache`）；**`DegradationTelemetry` 全仓 0 命中**。
  - **真静默**（无日志/无标记/无事件）：`learner-memory.ts:264-268`、`simulated-day.service.ts:267-286`、
    `LearnerExitService.ts:150-152`、`ReviewCompletedConsumer.ts:149`（模块头自述"失败静默丢失，不进事件链，不可追溯"）。
  - **已被部分观测**（别误改）：`session-wrapup` 失败走 `buildFallbackSummary` + `quality='fallback'`；
    `TeachingContextBuilder.ts:658-664`、`SessionFinalizationService.ts:343-380` 有 warn。
  - **注意**：`getDueTraces`/`LearnerSnapshotService.getSnapshot` **内部不吞**，是**调用方**吞——改错地方会漏掉真实静默点。
  - DNR/结构化 degraded 字段/混沌套件**皆无**；`failurePolicy: fallback` **未彻底退役**（见 §4）。
- **贴合**：高（防"自信的错"，与"LLM 观测 + 代码裁决"纪律一致）。**处置**：**可做（低-中）**。最小版：给 4 处真静默加结构化降级标记
  + 一个 DNR 统计脚本 + 顺手收敛 fallback 残留。

#### Q17 人的监督与逃逸舱
- **核验**：🟡 机制在，但**文档文件归属写错**：`replanSignal/requireConfirmation` 在 `services/learning/learning.service.ts:3947-3988`
  （真实学习者侧，preview+确认），**不在** `simulation.coordinator.ts`；虚拟侧是人工端点（`virtual-learners.ts:2690/2708`）。
  health-center 是**运维层**（`health-center.ts:96-101` 只处理基线漂移），无学生困境升级/可疑输出复核队列。
- **贴合**：中（真实用户规模化后）。**处置**：缓；低成本项（给完成判定/检查点留人工复核入口）可并入 Q3。

#### Q20 成本与可持续
- **核验**：🟡 细节要纠正：
  - `costCeiling` 是**调用次数上限、不是钱**，且仅虚拟（`virtual-lab/session-budget.ts:10-24`）。
  - `agent_call_logs.sessionId` 真列 + token 列 ✅，`scripts/audit-session-cost.ts` 只给 token/调用数，
    **明说缺"按模型单价"权威表、不换算金额**。
  - **无 per-user 预算、无单位经济**；模型路由是**静态 tier**（`models.config.ts` / `router.ts:136-158`），
    **无成本/复杂度驱动路由**。
- **贴合**：中（规模化前必答）。**处置**：缓。低成本项：补一张模型单价表 → 现有 token 日志即可出金额。

### D. 伦理 / 内容层

#### Q13 教育公平与自我实现预言（八问评 P1；第二份报告评 P0）
- **核验**：🟡 **问题真、但核心论据已过期，且细节需更正**。
  - 降档理由现在是 **5 条负荷类**（新增 `frustration_streak`，`TaskDifficultyAdjustmentService.ts:138-144`），非文档说的 4 条；
    知识类 3 条**只挡升档**（`:221-225`）；**但 band `upgrade` 会绕过知识阻挡直接 +1**（`:244-247`）；
    且 `challengeLevelCap==='high'` ⇔ `paceMode==='push'`（`LearnerSnapshotService.ts:114`），"去掉 paceMode 重复证据"并未完全成立。
  - **油门前提已过期**：`shouldEmitCheckpoint` 已放行 `ready_to_close`（`AITeachingCoordinator.ts:242-254`），
    协调器护栏 `!completionReady` 只在"本轮已可收尾"时挡（`:2761-2769`，而 `ready_to_close` 可来自 PF 逃生梯，不必然 completionReady）；
    答案键示例、skip 路由、黑盒消费三处已修；报告 N3 已验证首条检查点落地。**残余门是统计性的**（`SUCCESS_BAND_MIN_SAMPLE=6`/用户），非结构性。
  - **`D_floor` 不存在**：只有 clamp 到 1（`:26,253-257`；测试 `task-difficulty-adjustment.test.ts:241-249` 断言"落回 1"）；无横向重路由。
  - **无公平审计**：无分层；真实用户**无任何 cohort/保护属性**（`schema.prisma:810-856`）；难度台账只在 `reasons.length>0` 写
    （`AITeachingCoordinator.ts:1861`），且每 task 覆盖、无 `keep` 记录、无对照臂（`hasRandomizedControl:false`）。
- **贴合**：高（"学习者中心"理念的自洽性）。**处置**：**可做（低成本、高价值）**：
  **D_floor + 支架双向退出（fading）+ 独立锚题探针**；审计先做"行为代理变量分层统计"简版，**不要** VAE/DRO。
  分层对象可先用**虚拟学习者**（有 persona/分层标签），绕开真实用户无属性的问题。

#### Q14 安全与滥用防御（八问评 P0）
- **核验**：✅ **完全确凿**：`teaching-turn.yaml` 无任何注入防御/指令层级、无输入围栏（学习者消息原样进 `messages`，
  `AITeachingCoordinator.ts:2323-2336`，`teaching-turn/index.ts:770-825` 无 sanitize）；**零内容审核**；**零系统提示防套取**；
  答案农场仅软规则（`teaching-turn.yaml:107`）。**对照**：虚拟侧既有 prompt 条款（`virtual-learner-learn-turn-simulator.yaml:66`、
  `virtual-learner-actor-auditor.yaml:41`、`skill.virtual-learner-referee.md:61`）**又有代码级 `sanitizeVisibleContent`**
  （`skills/virtual-learner-learn-turn-simulator/index.ts:164-171`）——**现成范式，直接镜像到真实教学侧**。
- **贴合**：**最高**（真实学生与 AI 对话；涉青少年则是合规硬约束）。**处置**：**可做（低成本、立刻）**：
  镜像注入条款 + 代码级 sanitize/datamarking + 防套取 + 单层 LLM 审核（**不需要** DeBERTa/Aho-Corasick 小模型栈）。

#### Q15 内容正确性（八问评 P0）
- **核验**：✅ **完全确凿**：讲解/例子/总结全部 LLM 实时生成，无 RAG/无引用/无事实校验；`web-search/web-fetch` 存在但
  **不在教学链路**（只注册进 Capability Runtime）；检查点判**学生**不判**老师**（`AITeachingCoordinator.ts:1457-1491`，代码自述"弱独立"）。
  🟡 **一处修正**："不确定降断言"文化**存在但只在 meta 技能**（learning-predictor/lesson-knowledge-enricher/replan-attribution/
  concept-consolidator/learner-state-review/session-wrapup），**教学内容本身没有**。
- **贴合**：高（"AI 老师能不能信"是产品根本）。**处置**：**可做（低成本）**：教学内容补"不确定降断言强度" + 算数/代码类轻校验；
  RAG 溯源/沙箱 = 缺基建，缓（呼应 Q12）。

#### Q16 隐私、同意与伦理边界（八问评 P1）
- **核验**：🟡 问题真，但**文档对"敏感字段"有夸大**：
  - **真实用户**画像（`agents/learner-model-agent/types.ts`）推断的是认知画像（`metacognitionLevel/thinkingStyle/selfAssessmentAccuracy`）
    + 情绪画像（`motivationTrigger/confidenceLevel/frustrationTolerance`）+ 自由文本叙事；其中 **`frustrationTolerance` 是死默认**
    （aggregator 只填 3 个字段）、`BehavioralBaseline` 已死（`fetchBaselineData` 返回 null）。
  - **`helpSeekingPattern/adversarialPattern/emotionalTriggers/failurePatterns/...` 这些密集心理特征在虚拟 persona**
    （`virtual-learner-shared/schemas.ts:30-69`，LLM 生成的合成人设，可含 `age`），**不是真实用户**。
  - 合规材料：**无同意/未成年人/COPPA/FERPA**；但 `NON_FUNCTIONAL_GOVERNANCE_PLAN.md:735` NF-P2-1 已把它列为"**需决策**"（非空白，但未做）。
  - 删除能力**比文档说的强**：虚拟级联删（`virtual-cleanup.service.ts`，硬拒真实用户 409）**覆盖派生数据**
    （`learner_evidence/learner_projections/memory_traces` 等）；真实用户有软删（`routes/users.ts:222-274`）+ 手动 purge 脚本
    （`purge-soft-deleted-users.ts`，覆盖派生数据，含 `--dry-run`）。缺的是**自动保留/TTL、用户自助数据导出**。
- **贴合**：高（合规=上线前提；"自述 vs 推断"与 OLM 一致）。**处置**：**可做（产品/数据设计，低基建）**：
  数据分类矩阵 + 同意/未成年人策略 + "自述覆盖推断"仲裁 + 用户数据导出；虚拟 cleanup 已是现成范式。

#### Q6 学习者模型维度
- **核验**：🟡 认知/元认知/情感/行为已实现；SDT 归属感/成长型思维缺；**无 OLM 自述仲裁**（无"自述覆盖推断"逻辑）。
- **贴合**：中。**处置**：把 **OLM"自述优先"并入 Q16**；量表/贝叶斯融合暂缓。

#### Q12 材料/资料组织
- **核验**：✅ 无 materials 实体、无 multipart 上传；`web-search/web-fetch` 有但不接教学；`course-design` 已退役。
- **贴合**：中（等场景）。**处置**：缓（B 路线：上传→解析→注入 evidence，复用现有外挂能力）。

---

## 3. 核验发现：文档"未记 / 记错 / 已过期"清单

| # | 类型 | 内容 | 证据 |
|---|---|---|---|
| 1 | ⚠️ **已过期** | "检查点几乎不产生 → 油门打不开" | `AITeachingCoordinator.ts:242-254` 已放行 `ready_to_close`；N3 已验证；残门是 `SUCCESS_BAND_MIN_SAMPLE=6` |
| 2 | ⚠️ **已过期** | "排期/展示不同源"（§2.1 排期侧） | `preserveDueAt` 已在（`memory-trace.service.ts:229-233,264-267`）；残留：首次创建走 legacy、`lastSeenAt` 仍被刷新 |
| 3 | ❌ **记错（文件归属）** | `replanSignal/requireConfirmation` 在 `simulation.coordinator.ts:1933/1976` | 实际在 `learning.service.ts:3947-3988`；`simulation.coordinator.ts` 那两行是函数收尾括号 |
| 4 | ❌ **记错（数据）** | 降档理由是 4 条负荷类 | 现为 **5 条**（新增 `frustration_streak`，2026-09-18） |
| 5 | ❌ **夸大** | 学习者模型密集心理特征 | 真实用户只存认知+情绪+叙事；密集心理特征在虚拟 persona；`frustrationTolerance`/`BehavioralBaseline` 是死字段 |
| 6 | ❌ **夸大** | "删除能力只覆盖部分记录" | 虚拟级联 + 真实 purge **已覆盖派生数据**；缺的是自动 TTL 与自助导出 |
| 7 | ❌ **未记** | 网关不支持 `response_format/json_schema` | `gateway/**` 无命中 → 第三档约束解码落不了地 |
| 8 | ❌ **未记** | `failurePolicy: fallback` 未彻底退役 | `yaml-vocabulary.ts:48` 仍列；2 个 manifest 用 `deterministic-fallback`；**scaffold 默认仍写 fallback**（`skill-scaffold.service.ts:149`） |
| 9 | ❌ **未记** | `actr.ts` 的 `calculateRetention/isReviewDue` 已 test-only | 生产 import 只剩 `reviewIntervalDays/clamp01/DEFAULT_RETENTION_THRESHOLD`；`memory-trace.service.ts:333` 注释过期 |
| 10 | ❌ **未记** | `sinceLastSessionDays` 死字段 | 只声明、无赋值（`simulated-day.service.ts:218-237`） |
| 11 | ❌ **未记** | `costCeiling` 是调用次数不是钱；无单价表 | `virtual-lab/session-budget.ts:10-24`；`audit-session-cost.ts:11,142` |
| 12 | ❌ **未记** | 前端无 mastery/stability/retention 曲线（只有负荷曲线） | `LearnerDetail.vue:1176`；`MemoryReview.vue`/`VirtualProfile.vue` 是表格/标签 |

---

## 4. 核验中发现的四个"即刻可修"缺陷（未改，建议进第一波）

| # | 缺陷 | 影响 | 证据 |
|---|---|---|---|
| **D1** | 模拟器 `buildUserPayload` **丢弃 `pendingCheckpoint` 与 `temporalContext`**（两个分支都丢） | 最近落地的 P1-3"黑盒消费检查点"是**半截线**：LLM 看不到结构化题目/选项与时间上下文；`normalizeCheckpointAnswer` 只能靠历史文本猜 | `virtual-learner-learn-turn-simulator/index.ts:318-386`（body 与 stable-prefix 分支均无这两个字段） |
| **D2** | 模拟器 `definition.ts` 与运行时 `SkillDefinition` / 契约漂移 | 缺 `learnerMemory`/`epistemicGrounding`/`pendingCheckpoint`/`checkpointAnswer`；snapshots/守门口径与实际不一致 | `definition.ts:8-33` vs `index.ts:394-417` |
| **D3** | `failurePolicy: fallback` 残留（尤其 **scaffold 默认**） | 新 skill 会继续生成本应退役的策略值，纪律滑坡 | `yaml-vocabulary.ts:48`、`prompts/manifests/concept-priority.yaml:17`、`path-adjustment-generator.yaml:17`、`skill-scaffold.service.ts:149` |
| **D4** | `sinceLastSessionDays` 死字段 + `actr.ts` 死代码/过期注释 | Q19"回归重校准"与 Q4 时间维度都指着它，却是空的 | `simulated-day.service.ts:218-237`；`memory-trace.service.ts:333` |

> D1/D2 直接决定"检查点出题"这条刚修好的链是否**真的端到端可用**——建议在任何"记忆保真/看板/公平"之前先修。

---

## 5. 可行性分级（方案 → 真实业务）

### 现在就能做（低基建、低风险、高杠杆）
- **修 D1/D2/D4**（检查点 payload 与定义漂移、死字段）——见 §4。
- **Q3 静默降级最小层**：4 处真静默加结构化 `degraded` 标记 + DNR 脚本；收敛 `failurePolicy` 残留（D3）。
- **Q14 安全最小层**：镜像虚拟侧注入条款 + 代码级 sanitize/datamarking + 防系统提示套取。
- **Q15 内容诚实最小层**：教学内容"不确定降断言强度"（复用 meta 技能已有的 hedging 文化）。
- **Q13 公平最小层**：`D_floor`（不可永远贴地板）+ 支架双向退出 + 独立锚题探针。
- **Q16 合规基线**：数据分类矩阵 + 同意/未成年人策略 + "自述覆盖推断" + 用户数据导出（虚拟 cleanup 已是范式）。
- **Q5 agent 自述生成器**（一天）。
- **Q9 拓扑边命中率**（只读聚合 `agent_call_logs`）。

### 可做但需小设计（低-中基建）
- **Q4 虚拟学习者概率记忆**：概率提取 + 复用 friction 注入 rng 范式 + 混淆对先走 LLM 离线判；**前置：D1/D4 + `dueReview` 带 retention**。
- **Q2 记忆看板**：前端新画曲线 + 后端暴露 `getRetentionSnapshot` 字段；**前置：统一展示口径（`lastSeenAt` 语义）**。
- **Q7 真值发现（轻量）**：代码裁决 > 结构化选择 > LLM 推断 > 自评，派生元认知校准偏置。
- **Q11 增强（第二档）**：字段表 → JSON Schema 供后置校验；reasoning 字段前置。
- **Q8 观测激活**：把 `retention-curve` 孤岛接进 admin。

### 缺基建 / 当前无对象（缓做，别现在动）
- 独立 reranker / embedding / 向量库（Q1、Q7 粗筛、Q4 混淆对在线部分）。
- RAG 溯源 / 引用哈希 / 闭域检索（Q12、Q15 长期）。
- 代码沙箱 / WASM SymPy / Firecracker（Q15 工具校验）。
- 约束解码 / XGrammar / 本地小模型栈（Q11 第三档）。
- 真实用户分流 / feature flag / MRT（Q18、Q8 因果）。
- 单位经济 / per-user 成本预算 / 成本驱动路由（Q20）。
- 小模型多级内容审核（Q14 的 DeBERTa/Aho-Corasick 层）——先用单层 LLM。
- 流失预测 / winback / streak 免死（Q19 产品功能）。

---

## 6. 升级路线建议（三波）

> 排序原则：**先让"测量与诚实"可信 → 再让"实验室保真"更强 → 最后才上依赖新基建的研究型/规模化能力**。

### 第一波：传感器与诚实层（低成本，解锁后续所有判断）
1. 修 D1/D2（检查点端到端）与 D4（死字段/死代码）；顺带收敛 D3。
2. Q3 静默降级最小层 + DNR；把"允许降级、不允许未打标降级"写成显式约定。
3. Q14 注入围栏 + 防套取；Q15 教学内容降断言。
4. Q13 D_floor + 支架 fading + 独立锚题探针。
5. Q16 合规基线（同意/未成年人/自述优先/导出）。
- **验收**：学情快照失败会带 `degraded` 且教学链路显式提示"数据不全"；检查点题目真正进 payload 并能被黑盒作答；
  被降档组有最小挑战保底与探针复测；能导出单个学习者的全量数据。

### 第二波：实验室保真 + 可解释（中低成本）
6. Q4 概率化记忆（强度确定 + 提取概率 + 混淆对离线表 + 确定性 PRNG；虚拟调度与真实按 `isVirtualLearner` 隔离）。
7. Q2 记忆看板（先统一展示口径，再画曲线）+ Q8 保持率曲线进 admin。
8. Q5 agent 自述生成器 + Q9 拓扑边命中率。
9. Q7 轻量真值发现（自评↔真值差 = 元认知校准）。
- **验收**：虚拟学习者"越久越含糊/易记错"可复现（同种子回放一致）；看板与排期同源；拓扑能看出死边。

### 第三波：规模化前置（等真实用户或明确需求）
10. Q11 第二档增强（JSON Schema 校验；reasoning 前置）；Q20 单价表 + per-user 监控。
11. Q18 分流基建（用户哈希 + feature flag）→ 再谈 MRT；Q19 回归重校准 + 流失信号。
12. 按需再评估：RAG/沙箱/约束解码/reranker（届时问"是否真有场景"）。
- **验收**：能在一个真实 cohort 上做无偏对比；成本可按用户归因。

---

## 7. 与既有治理计划的边界（避免重复建设）

| 层 | 已被谁覆盖 | 本文新增落点 |
|---|---|---|
| 基础设施安全 | `NON_FUNCTIONAL_GOVERNANCE_PLAN.md`（41 条 NF）+ `SECURITY.md` | Q14 的 **LLM 语义安全**不在此层 |
| 教育科学性 | `LEARNING_SCIENCE_AUDIT.md` / `EDUCATIONAL_THEORY_MAP.md` | Q13/Q8 与它衔接（审计已自认阻尼陷阱/观察非因果） |
| Prompt 工程 | `SKILL_PROTOCOL_V4.md` / `AGENT_IO_DESIGN_V3.md` | Q11 增强（第二档）；Q14 防套取与其相关 |
| 数据治理 | NF-P2-1（需决策，未做） | Q16 的**伦理/同意**与它角度不同（工程删除矩阵 vs 伦理） |
| 教育/内容/伦理 | **几乎空白** | Q13/Q14/Q15/Q16 全在此层 |

---

## 8. 执行进展（2026-09-18 → 09-19）

> 本文件原有结论与优先级不改；这里是"按三波路线做了什么"的台账（每条含提交）。

### 第一波：传感器与诚实层（全部完成）
| 项 | 提交 |
|---|---|
| A1 检查点/时间上下文补进模拟器 payload（修 P1-3 半截线） | `59483516` |
| A2 运行时定义与 SkillDefinition 补齐 | `83c26460` |
| A3 `sinceLastSessionDays` 打通 + 删 ACT-R 死代码 | `338c7717` |
| A4 `failurePolicy` 收敛为 retry\|propagate | `955dbcdc` |
| A5 降级遥测共享接口 + 虚拟侧两处真静默 | `c1f83891` |
| B1 真实侧静默降级打标 + DNR 脚本 | `21738b8d` |
| B2 输入围栏 + 注入条款（+只作用 payload 的修正） | `5f59c904`、`6285168d` |
| B3 教学内容诚实（降断言/不编造/可复核） | `760ff281` |
| B4 D_floor 最小挑战保底 | `a97fcc24` |
| B4 难度分配公平审计（只读） | `e643d494` |

### 第二波：实验室保真 + 可解释（主体完成）
| 项 | 提交 |
|---|---|
| Q4 概率化记忆：纯模块（SplitMix64 + 混淆竞争） | `b6d0dd9d` |
| Q4 集成：`memoryRecall` 接入 assisted + blackbox 两路 | `db3aba11` |
| **assisted 路径消费待答检查点**（E2E 发现的真缺口） | `8fd12657` |
| Q2/Q8 记忆看板 + 保留率曲线 | `e5e9e6e5` |
| Q5 Agent 自述生成器 | `7cea371d` |
| Q9 交接边用量聚合 + 拓扑图接线 | `8b92d09b`、`79bdadf6` |
| Q1 复习选点质量只读度量 | `46853be9` |
| Q7 轻量真值发现（多源加权 + 元认知校准） | `1e1b0fba` |
| Q13 难度分层审计（虚拟 cohort） | `c13dee5b` |
| 锚题探针**纯决策层** | `dfe30482` |
| **锚题探针接线**（教学链：目标注入 + 判定打标 + `anchor:result` 留痕，只标记不改写） | `152713f2` |
| 数据治理基线（Q16） | `1d3b55ef` |
| 删除覆盖补漏（`prediction_records`/`misconception_ledger`） | `2d205f9b`（含路由测试回归修复 `345e4550`） |
| Q11b strict JSON Schema 纯编译器 | `0d4aa01b` |
| Q11b 接线前置：core loader 结构化承载 `enumValues`/嵌套 `properties` | `126e05c7` |

### VL 验证（真实跑数）
- assisted E2E（`advance-day runTasks`）8 天 × 2 节：链路健康；`temporalContext.sinceLastSessionDays` 计算正确（跨周末 3／工作日 1）；`memoryRecall` 真进 payload。
- 修复后复跑：`checkpoint:result = 9`（全部 `judgedBy:"code"`）、`pendingCheckpoint` 清空 → **成功率带传感器在该路径通了**。
- 附带观察：一次 `TEACHING_TURN_REPLY_MISSING` 导致 session-failed（普通教学回合模型未产出 reply），建议后续加"缺 reply 重试/降级"护栏。

### 仍未做（明确延后）
- **Q11b 接线后续**：前置已就绪（`126e05c7`），但还需 ① 在 core yaml 声明 `enumValues` / 嵌套 `properties`，② 把 `compileStrictJsonSchema` 接入 `skill-output-validator`（用 `collectSchemaLimitations` 做门禁，避免误拒）。
- **锚题探针调优**：接线已完成（`152713f2`），但当前锚题只在"已掌握/挣扎"两种信念上选靶；锚题 `checkpoint:result` 是否应从成功率带样本中排除，需产品定夺。
- **Q18 真实用户实验基建 / Q19 生命周期 / Q20 单位经济**：按本文件"缺基建/无对象"结论继续延后。
- `login_attempts` 是否纳入删除覆盖（它按用户名/IP 而非 userId，需另行判断）。

---

## 9. 附：关键证据索引

- 记忆/排期：`backend/src/services/memory/{fsrs,actr,memory-trace.service,retention-curve,review-plan.service,review-quota.service}.ts`
- 虚拟记忆：`backend/src/virtual-lab/learner-memory.ts`、`backend/src/coordinators/simulation.memory.ts`、`backend/src/skills/virtual-learner-shared/schemas.ts`
- 模拟器：`backend/src/skills/virtual-learner-learn-turn-simulator/{index.ts,definition.ts}`、`prompts/core/virtual-learner-learn-turn-simulator.yaml`
- 难度/公平：`backend/src/services/learner/{TaskDifficultyAdjustmentService,independent-success-band.service,LearnerSnapshotService}.ts`、`backend/src/services/ai-teaching/AITeachingCoordinator.ts`
- 降级/质量：`backend/src/skills/outcome.ts`、`backend/src/services/telemetry-writer.service.ts`、`backend/src/services/{log-retention.service,yaml-vocabulary.ts}`
- 安全/内容：`prompts/core/{teaching-turn,session-wrapup,stage-designer}.yaml`、`backend/src/skills/{web-search,web-fetch}/index.ts`
- 隐私：`backend/src/agents/learner-model-agent/types.ts`、`backend/src/services/virtual-lab/virtual-cleanup.service.ts`、`backend/src/routes/users.ts`、`backend/src/scripts/purge-soft-deleted-users.ts`、`doc/NON_FUNCTIONAL_GOVERNANCE_PLAN.md:735`
- 人在环：`backend/src/services/learning/learning.service.ts:3947-3988`、`backend/src/routes/admin/virtual-learners.ts:2690/2708`
- DSL：`backend/src/services/yaml-vocabulary.ts`、`backend/src/services/prompt-lab/{core-compiler,core-file-loader}.ts`、`backend/src/services/skill-output-validator.ts`、`backend/src/gateway/api-gateway/{executor,router}.ts`
- 前端：`frontend/src/views/admin-redesign/{VirtualProfile,LearnerDetail,MemoryReview,Orchestrator,DataFlowGraph,FieldAddWizard,SkillFieldRouting}.vue`、`frontend/src/views/admin-redesign/live.ts`、`dataFlow.ts`
- 结果测量/成本：`backend/src/services/memory/retention-curve.ts`、`backend/src/scripts/{audit-retention-curve,audit-session-cost}.ts`
