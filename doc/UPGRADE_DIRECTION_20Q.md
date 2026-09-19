# 20 问方案 × WenFlow：教学实验/Demo 定位下的逐条核验与升级方向（2026-09-19 合并版）

> 缘起：`doc/20questions/` 下的十二问、八问调查与外部方案原文（`doc/*` 为**本机过程材料，不入库**）列举了 20 个问题与大量方案，
> 本工作把它们与真实项目业务逐条对过——哪些成立、哪些过期、哪些记错、哪些现在做。
> 方法：不采信文档结论，**逐条回代码复核**，核验结论带 `文件:行`。
> 性质：**调查 + 决策建议**（不含代码改动；例外见 §4 的即刻可修缺陷，均已落地）。
>
> **本文是合并后的单一结论文档**：原第一波并行流（Track A/B）、Q16 隐私/数据治理基线、Q18/Q19/Q20 规模化前置设计、
> 虚拟验证新发现评估等六份文档的结论已全部并入本文并随之删除。`doc/AGENT_SKILL_MANUAL.md`（开发者手册）、
> `doc/SKILL_DEVELOPMENT_GUIDE.md`、`doc/ADMIN_PAGE_TEMPLATES.md` 仍为独立文档。
>
> **定位（本文一切取舍的前提，来自项目 owner）**：本项目是 **教学实验 / Demo 平台，MIT 许可、非商业**。
> **会有真实用户，但不提供长期服务**——它首先是一次 **demo / showcase 体验**。因此：
> 优先级 = **实验有效性 + 教学闭环可观测**（虚拟学习者实验室、测量、教学机制）；
> **商业级轴不在范围**（或只保留已落地的零成本部分）：内容审核重层、同意/法务/未成年人、单位经济/预算、
> 真实用户实验基建、教师升级流程、材料库（无场景）。已建成的**零成本护栏保留但不再加码**：输入围栏、内容降断言、
> 删除卫生、token 面板。

---

## 0. 一句话结论

**北星是"原始 12 问"**（项目发起时列出的**机制与理解**清单，见 §0.5）。后来由 AI 补充的 8 问
（公平 / 安全 / 内容正确性 / 隐私 / 人的监督 / 真实实验 / 生命周期 / 成本）是**治理与商业轴**：
它们对一个"商业 AI 教育产品"成立，但本项目是**教学实验 / Demo、MIT、非商业、有真实用户但无长期服务**，
这些轴**大部分不在范围内**（仅保留其中零成本已落地的轻量护栏，**不再加码**）。

在本定位下：**原始 12 问的"机制与理解"已基本做完**（含 Q6/Q7 说明文档 `LEARNER_CENTER_AND_STATE_FUSION.md`、
Q2 虚拟学习者独立分区）；剩下的是**少量可选深化**。方法论层（双传感器、ZPD 支架、静默降级治理、
OLM 自述、MRT、分层路由、成本护栏）基本正确；**错位的是优先级，不是方向**。

> 关键反转（相对早期结论）：外部报告的核心论据"检查点几乎不产生 → 成功率带永远打不开"
> **已经过期**：最近一轮修复放开了 `ready_to_close` 出题，并补齐答案键示例、skip 路由、黑盒消费三处断点
> （VL 验证 `checkpoint:result = 9`，全部 `judgedBy:"code"`）。

---

## 0.5 覆盖小结：先对"原始 12 问"，再看 AI 补的 8 问

### 北星：原始 12 问对账

| # | 你的原话落点 | 现状 | 剩余 |
|---|---|---|---|
| 1 | 排序模型召回知识点 | 结论不引 reranker；已量化选点质量；真瓶颈是**复习容量**（due 覆盖 6.4%/backlog 395） | 容量决策（可选） |
| 2 | 虚拟学习者**拆分** + 可视化看板 | ✅ 看板/保留率曲线 `e5e9e6e5`；独立场景 `virtual-learners` + 详情 `VirtualProfile.vue` 已具备 | — |
| 3 | 项目里不该有的降级处理 | 虚拟+真实两侧静默降级改结构化打标 + DNR | ✅ |
| 4 | 越久遗忘越高 → **抽到几率越低**（随机） | 概率化提取（**扮演可信度**）+ 确定性 PRNG；未用于排程（方向矛盾已识别） | ✅ |
| 5 | 每个 agent 写自述/功能说明 | 自动生成自述 + 人写"缘由"手册 | ✅ |
| 6 | **学习者中心**：通用 vs 特异 | 仅有分散说明（`LEARNER_MODEL_ARCHITECTURE` / 理论地图） | ✅ 说明文档 `docs/LEARNER_CENTER_AND_STATE_FUSION.md` |
| 7 | 聚合/拆分/融合/评估"**怎么做到的**" | 架构说明 + 轻量真值发现 | ✅ 说明文档 `docs/LEARNER_CENTER_AND_STATE_FUSION.md` |
| 8 | **如何测量学习效果** | 观测层（保留率曲线）+ 选点质量 | 延迟锚题（可选深化） |
| 9 | 编排/拓扑 = **直观看到字段命中上下游** | 已改名「**逻辑图**（字段数据旅程）」+ 字段级运行时命中 | ✅ |
| 10 | 前端可视化建字段 → **功能自定义增强** | 字段编辑/编译/发布已做；运行时自定义（`accumulate`/L2）未做 | 视场景 |
| 11 | prompt 编程语言（**类型/字段化功能/逻辑值**） | `SKILL_PROTOCOL_V4` + `core.yaml` 即它；strict schema 编译器就绪、未接线 | 接线（可选） |
| 12 | 材料组织：**组装 vs 通用泛化** | 未做（等场景）；已定 B 路线优先 | 待场景 |

### 附：AI 补的 8 问（治理/商业轴，**不作北星**）

| 问 | 处置 |
|---|---|
| 13 教育公平 | **核心例外**：D_floor + 公平审计 + 分层 + 锚题探针已落地（与实验有效性相关） |
| 14 安全与滥用 | 轻量保留：输入围栏 + 注入/防套取；**不加**审核层 |
| 15 内容正确性 | 轻量保留：降断言/不编造/可复核；**不加** RAG/沙箱 |
| 16 隐私/同意 | 轻量保留：删除卫生；同意/未成年人/导出/自述仲裁**不做** |
| 17 人的监督 | 不做（无真实长期学习者） |
| 18 真实用户实验基建 | 不做（无长期服务对象） |
| 19 生命周期 | 部分：真实侧长间隔信号 + 流失信号只读；winback/召回**不做** |
| 20 成本 | 轻量保留：token 面板 + 单价纯函数；单位经济/预算**不做** |

**剩余可选（按北星排序）**：① Q8 延迟锚题；② Q1 复习容量；
③ Q11b 接线；④ Q10 视场景；⑤ 契约漂移清理；⑥ Q20 补权威单价（外部输入）。

---

## 1. 业务事实基线（决定"哪些方案值得做"）

| 维度 | 事实 | 对方案的约束 |
|---|---|---|
| 定位 | **教学实验 / Demo 平台，MIT、非商业**；会有真实用户但**无长期服务**，首先是可展示的实验体验 | 商业级前置（合规、审核、单位经济、真实用户实验基建）**不做**；升级只服务"实验有效 + 教学闭环可观测" |
| 核心命题 | "学习始于对真实问题的澄清"；5 类能力（问题定义/系统思维/判断力/AI 协作/创造力） | 升级应服务"问题→路径→教学闭环"的质量，而非通用 agent 平台能力 |
| 验证手段 | **虚拟学习者实验室**（黑盒模拟 + 裁判 + 角色保真审计）——本项目**唯一**的验证手段 | 实验室保真度 = 产品的测量仪器；记忆保真（Q4）是实验有效性，而非玩物 |
| 技术栈 | SQLite 双库；依赖仅 15 个；**无向量库 / 无图库 / 无 Redis / 无本地小模型 / 无沙箱**；模型走 OpenAI 兼容网关 | 一切"向量/沙箱/小模型/约束解码"方案=从零建基建，不做 |
| 工程纪律 | `core.yaml` 唯一人工源 + 编译链 + 守门三查；**LLM 只出观测/建议，档位/排序/状态由代码裁决**；`SkillResult.quality` 质量标记；outbox/inbox 事件链 | 单源化、软约束、可回滚是硬约束；方案必须落进这套纪律 |
| 自动出题分工 | 时机由代码（`shouldEmitCheckpoint`）定；内容+答案键由 `teaching-turn` 定；判分由 `judgeCheckpointAnswer` 代码定 | Q13/Q14/Q15 的增量都要挂进这条链，不能另起 |
| 学习者模型自认边界 | `LEARNING_SCIENCE_AUDIT.md`：「控制回路已接线，传感器多为代理量，记忆环路刚通电，结果测量刚建最小层」 | 升级优先级给"传感器质量"与"诚实性"，而非更多控制回路或商业治理 |

> 已保留的零成本护栏（不加码）：输入围栏 `ai-teaching/input-fence.ts`、教学内容降断言、删除卫生（覆盖矩阵补漏）、token 面板。

---

## 2. 逐条核验（20 问 + 外部方案）

图例：核验=✅ 成立 / 🟡 部分 / ⚠️ 已过期 / ❌ 记错或不存在；
分级=**核心（该做）** / **轻量保留（零成本已落地，不再加码）** / **不做（商业级/无对象）**。

### A. 认知 / 学习层

#### Q4 虚拟学习者概率化记忆
- **分级**：**核心（该做）**。
- **核验**：🟡→✅ 记忆原为三桶静态标签（`learner-memory.ts:142-163`）；FSRS 保留率已算并到模拟器（`simulation.memory.ts:66-80`），
  但 `:52-59` 把 `dueReview` map 成纯名字丢掉数值；可注入 rng 仅一处（`virtual-learner-shared/schemas.ts:243-255` `decideFrictionTrigger`）。
  虚拟学习者与真实用户**同表按 `userId` 隔离**（`schema.prisma:677-705`）。
- **处置**：✅ 完成——纯模块（SplitMix64 + 混淆竞争）`b6d0dd9d`、集成 `db3aba11`（`memoryRecall` 进 assisted + blackbox）、
  assisted 消费待答检查点 `8fd12657`。
- **警告**：以项目 FSRS 公式为准（`fsrs.ts:166-168`，`19/81`）；混淆对依赖 embedding（无）→ 复用 LLM 离线判定 + 留档。

#### Q8 测量学习效果（可证伪）
- **分级**：**核心（该做）**。
- **核验**：🟡 结果测量层曾为孤岛（`retention-curve.ts` 消费者仅只读脚本）；数据源 `learner_evidence('review:completed')` 数据够算
  （`ReviewCompletedConsumer.ts:111-130`）。MRT 需真实用户（无对象）。
- **处置**：✅ 最小层：保留率曲线进 admin `e5e9e6e5`。**剩余可选**：延迟锚题复用（复用 Q13 探针）。

#### Q19 生命周期（冷启动/长间隔/流失/回归）
- **分级**：**核心（该做）**（winback/streak 免死等产品功能除外）。
- **核验**：🟡 冷启动继承 ✅（`learning-state.service.ts:1043-1053` 等）；churn/winback/dormant 零命中 ✅；
  `sinceLastSessionDays` 过去只服务虚拟链路；streak 无免死/修复。
- **处置**：✅ 真实侧长间隔重校准 `b6a6afd6`（`controls.temporalGap = {daysSinceLastSession, isLongGap}`，默认 14 天）；
  休眠/流失只读审计（`learner/churn-signals.ts` + `scripts/audit-churn-signals.ts`，行为代理、非因果）。
  winback 通知 / streak 免死 = 产品功能，**不做**。

### B. 机制 / 工程层

#### Q1 排序模型 / reranker / 复习容量
- **分级**：**核心（该做）**——只做"复习容量/选点质量"，**不引向量/reranker**。
- **核验**：✅ 无 embedding/reranker/向量库；候选集极小；已有确定性 urgency 排序 + 交错（`review-plan.service.ts`）。
  外部 `scheduleReviewPack` 依赖 `semanticEmbedding`，在本项目落不了地。
- **处置**：先量化已落地（只读度量 `46853be9`）。**剩余可选**：复习容量（替代排序）——量化后决定是否需要 LLM listwise。

#### Q2 虚拟学习者拆分 + 记忆看板
- **分级**：**核心（该做）**。
- **核验**：🟡→✅ API `GET /:id/memory`（`routes/admin/virtual-learners.ts:756-782`）；此前前端无 mastery/stability/retention 曲线
  （唯一曲线是负荷曲线 `LearnerDetail.vue:1176`）。
- **处置**：✅ 完成：记忆看板 + 保留率曲线 `e5e9e6e5`。

#### Q5 给每个 agent 写自述
- **分级**：**核心（该做）**。
- **核验**：✅ 素材全齐：29 个 `prompts/core/*.yaml` 全含 `identity`；生成脚本范式已有（含 drift 检查）。
- **处置**：✅ 完成：机械自述 `prompts/AGENTS_SELF_INTRO.md`（`7cea371d`，含漂移门禁）；
  缘由手册 `doc/AGENT_SKILL_MANUAL.md`（`08dff27e`，开发者向、明确非平台功能说明）。

#### Q7 聚合 / 拆分 / 融合 / 真值发现
- **分级**：**核心（该做）**（ES/CQRS 大重构除外）。
- **核验**：✅ outbox/inbox + 只追加证据；`ConceptConsolidatorService` 已实现"LLM 建议 + 代码执行 + 留档 + 回滚"；真值发现原未做。
- **处置**：✅ 轻量真值发现 `1e1b0fba`（代码裁决 0.95 > 结构化选择 0.75 > LLM 推断 0.50 > 自评 0.20；差值=元认知校准）。
  ES/CQRS 大重构 = **不做**。

#### Q9 字段命中上下游（逻辑图）与调用用量
- **分级**：**核心（该做）**。
- **核验（已更新）**：🟢 节点级 runtime 计数已有；agent→skill 调用用量已聚合为逻辑图注解（`8b92d09b`、`79bdadf6`）；
  **字段级运行时命中**已实现并叠图：纯聚合 `field-hit-rates.ts` + 只读 CLI（`c5a91e58`），拓扑响应增 `fieldStats`、
  前端按 `produced/dead/drift` 着色、死 routing 边虚线（`612d04ac`）；结构图改称「字段数据旅程（逻辑图）」、⇄ 文案改「调用用量」
  （`52d6cfaf`），残留文案同步（`6cba6768`）。12 处断链/死规则记档于 `LEARNING_SCIENCE_AUDIT.md:603-640`。
- **处置**：✅ 完成（**不建独立拓扑图**）。**实测信号**：30 skill / **18 死字段** / **9 契约漂移** / 10 死边候选。

#### Q10 前端可视化创建字段
- **分级**：**核心（该做，工程主线）**。
- **核验**：🟡 组件齐（`FieldRoutingTable/FieldAddWizard/SkillFieldRouting/SkillDesignPage`）、三级锁齐；
  `accumulate` 只产 prompt 标签不落库（`prompt-composer/index.ts:108-118`）。
- **处置**：工程主线；`accumulate` 运行时功能化属 L2 议题，**仅场景需要时做**。

#### Q11 Prompt DSL / Zod / 约束解码
- **分级**：**核心（该做，工程主线）**。
- **核验**：🟡 DSL ✅（受控词表 `yaml-vocabulary.ts`、编译链 `core-compiler.ts`、守门三查、后置校验器 `skill-output-validator.ts`）；
  **网关完全不支持结构化输出**（`gateway/**` 无 `response_format/json_schema`）→ 第三档"约束解码"落不了地。
- **处置**：**不追第三档**；第二档增强已做编译器 `0d4aa01b` + core loader 承载 `enumValues`/嵌套 `properties` `126e05c7`。
  **剩余可选**：把 `compileStrictJsonSchema` 接入 `skill-output-validator`（用 `collectSchemaLimitations` 做门禁），reasoning 字段前置。

#### Q18 真实用户实验基建
- **分级**：**不做（商业级/无对象）**。
- **核验**：✅ 全无 feature flag / 用户哈希分流；只有虚拟模拟 A/B（`scripts/simulate-learner-days.ts:9-12`）；
  `prediction_records` 是校准台账、`review-quota` 是每日配额、`batch_experiments` 是虚拟批量。
- **处置**：**不做**——无真实 cohort 对象；若商业化需从零建（见 §7）。

### C. 可靠 / 治理层

#### Q3 静默降级
- **分级**：**核心（该做）**。
- **核验**：✅ 问题确凿。真静默原 4 处：`learner-memory.ts:264-268`、`simulated-day.service.ts:267-286`、
  `LearnerExitService.ts:150-152`、`ReviewCompletedConsumer.ts:149`（模块头自述"失败静默丢失"）；`DegradationTelemetry` 原 0 命中；
  `failurePolicy: fallback` 原未彻底退役。
- **处置**：✅ 最小层——虚拟侧降级遥测（新增 `skills/degradation-telemetry.ts`）`c1f83891`；
  真实侧两处真静默打标 + DNR 只读脚本 `21738b8d`；`failurePolicy` 收敛为 `retry|propagate` `955dbcdc`。
  约定：**允许降级，不允许未打标降级**。

#### Q17 人的监督与逃逸舱
- **分级**：**不做（商业级/无对象）**。
- **核验**：🟡 机制在（`replanSignal/requireConfirmation` 在 `services/learning/learning.service.ts:3947-3988`，真实学习者侧预览+确认；
  虚拟侧是人工端点 `routes/admin/virtual-learners.ts:2690/2708`）；health-center 是运维层，无学生困境升级/可疑输出复核队列。
- **处置**：**不做**——教师升级工作流依赖长期服务对象；低成本完成判定/检查点复核入口已由 Q3 的降级打标与 DNR 观测覆盖。

#### Q20 成本与可持续
- **分级**：**轻量保留（只做 token 面板，不再加码）**。
- **核验**：🟡 `costCeiling` 是**调用次数、不是钱**，且仅虚拟（`virtual-lab/session-budget.ts:10-24`）；
  `agent_call_logs.sessionId` 真列 + token 列 ✅，但缺按模型单价表；无 per-user 预算、无单位经济；路由是静态 tier。
- **处置**：✅ token 面板 + 单价纯函数 `services/cost/model-cost.ts`（单价仍是占位空表，未知单价返回 `usd:null` 不冒充 0）。
  per-user 预算 / 单位经济 / 成本驱动路由 = **不做**（见 §7）。

### D. 伦理 / 内容层

#### Q13 教育公平与自我实现预言
- **分级**：**核心（该做）**。
- **核验**：🟡 问题真、核心论据已过期、细节需更正：降档理由现为 5 条负荷类（含 `frustration_streak`）；知识类只挡升档但 band `upgrade` 可绕过；
  原**无 D_floor**（只有 clamp 到 1）、无公平审计。分层对象可先用虚拟学习者（有 persona 标签），绕开真实用户无属性问题。
- **处置**：✅ 最小层：D_floor `a97fcc24`、难度分配公平审计（只读）`e643d494`、锚题探针纯决策 `dfe30482`、接线 `152713f2`
  （目标注入 + 判定打标 + `anchor:result` 留痕，只标记不改写）、虚拟 cohort 分层审计 `c13dee5b`。
  **支架 fading 复核后不做**：`adjusted` 每任务由基线重算，负荷理由消失即自动撤回，再加独立规则会与"知识类只挡升档"政策冲突。
  不做 VAE/DRO。

#### Q14 安全与滥用防御
- **分级**：**轻量保留（零成本已落地，不再加码）**。
- **核验**：✅ 完全确凿：`teaching-turn.yaml` 原无注入防御/指令层级/输入围栏（学习者消息原样进 `messages`）、零内容审核、零防套取；
  虚拟侧既有 prompt 条款 + 代码级 `sanitizeVisibleContent` 可镜像。
- **处置**：✅ 最小层：教学链路输入围栏 + 注入/防套取条款 `5f59c904`；修正为围栏只作用于模型 payload、落库保持学生原文 `6285168d`。
  **不加** DeBERTa/Aho-Corasick 小模型栈、**不加** LLM 审核层。

#### Q15 内容正确性
- **分级**：**轻量保留（零成本已落地，不再加码）**。
- **核验**：✅ 讲解/例子/总结全 LLM 实时生成、无 RAG/无引用/无事实校验；检查点判**学生**不判**老师**；
  "不确定降断言"原仅存在于 meta 技能，教学内容本身没有。
- **处置**：✅ 最小层：教学内容"不确定降断言/不编造具体值/数学可复核" `760ff281`。
  RAG 溯源/引用哈希/闭域检索/代码沙箱 = **不做**。

#### Q16 隐私、同意与伦理边界
- **分级**：**轻量保留（仅删除卫生；零成本已落地，不再加码）**。
- **核验**：🟡 问题真但文档对"敏感字段"有夸大：密集心理特征只在**虚拟 persona**（合成人设，非真实用户）；
  真实用户只存认知画像 + 情绪画像 + 叙事，且 `frustrationTolerance`/`BehavioralBaseline` 是死默认。
  删除能力比文档说的强（虚拟级联 + 真实 purge 覆盖派生数据），缺自动 TTL / 自助导出；原漏 `prediction_records`/`misconception_ledger`。
- **处置**：✅ 删除覆盖补漏 `2d205f9b`（回归修复 `345e4550`）。
  同意/未成年人/自述优先仲裁/导出=删除同矩阵/保留 TTL = **商业级，不做**（理由与商业化代价见 §7）。

#### Q6 学习者模型维度
- **分级**：**不做（商业级/无对象）**。
- **核验**：🟡 认知/元认知/情感/行为已实现；SDT 归属感/成长型思维缺；无 OLM 自述仲裁（无"自述覆盖推断"）。
- **处置**：**不做**——现有维度够实验用；OLM"自述优先"属用户权利/治理（Q16 商业级），量表/贝叶斯融合不做。

#### Q12 材料 / 资料组织
- **分级**：**不做（商业级/无对象）**。
- **核验**：✅ 无 materials 实体、无 multipart 上传；`web-search/web-fetch` 有但不接教学；`course-design` 已退役。
- **处置**：**不做/待场景**（若将来要，B 路线：上传→解析→注入 evidence，复用现有外挂能力）。

---

## 3. 核验发现：文档"未记 / 记错 / 已过期"清单

| # | 类型 | 内容 | 证据 | 现状 |
|---|---|---|---|---|
| 1 | ⚠️ 已过期 | "检查点几乎不产生 → 油门打不开" | `AITeachingCoordinator.ts:242-254` 已放行 `ready_to_close`；VL 验证 `checkpoint:result=9` | ✅ 已修 |
| 2 | ⚠️ 已过期 | "排期/展示不同源" | `preserveDueAt` 已在（`memory-trace.service.ts:229-233,264-267`） | 残留 legacy 首次创建 / `lastSeenAt` 刷新 |
| 3 | ❌ 记错（文件归属） | `replanSignal/requireConfirmation` 记在 `simulation.coordinator.ts` | 实际在 `learning.service.ts:3947-3988` | 保留 |
| 4 | ❌ 记错（数据） | 降档理由是 4 条负荷类 | 现为 **5 条**（含 `frustration_streak`） | 保留 |
| 5 | ❌ 夸大 | 学习者模型密集心理特征 | 真实用户只存认知+情绪+叙事；密集特征在虚拟 persona；两个死字段 | 保留 |
| 6 | ❌ 夸大 | "删除能力只覆盖部分记录" | 虚拟级联 + 真实 purge 已覆盖派生数据；缺自动 TTL/自助导出 | ✅ 覆盖补漏 `2d205f9b` |
| 7 | ❌ 未记 | 网关不支持 `response_format/json_schema` | `gateway/**` 无命中 → 第三档约束解码落不了地 | 保留（不做第三档） |
| 8 | ❌ 未记 | `failurePolicy: fallback` 未彻底退役 | 词表 + 2 manifest + scaffold 默认 | ✅ 收敛 `955dbcdc` |
| 9 | ❌ 未记 | `actr.ts` 的 `calculateRetention/isReviewDue` 已 test-only | 生产 import 只剩 3 项；`memory-trace.service.ts:333` 注释过期 | ✅ 清理 `338c7717` |
| 10 | ❌ 未记 | `sinceLastSessionDays` 死字段 | 只声明、无赋值 | ✅ 打通 `338c7717`；真实侧另补 `b6a6afd6` |
| 11 | ❌ 未记 | `costCeiling` 是调用次数不是钱；无单价表 | `virtual-lab/session-budget.ts:10-24` | 保留（轻量，token 面板已做） |
| 12 | ❌ 未记 | 前端无 mastery/stability/retention 曲线 | `LearnerDetail.vue:1176` 只有负荷曲线 | ✅ 修复 `e5e9e6e5` |

---

## 4. 即刻可修缺陷（已全部落地）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| **D1** | 模拟器 `buildUserPayload` 丢弃 `pendingCheckpoint`/`temporalContext` | 检查点黑盒消费是半截线 | `59483516`（两分支白名单投影，无答案键） |
| **D2** | 模拟器 `definition.ts` 与运行时 `SkillDefinition` 漂移 | snapshots/守门口径不一致 | `83c26460` |
| **D3** | `failurePolicy: fallback` 残留（含 scaffold 默认） | 新 skill 继续生成退役策略值 | `955dbcdc` |
| **D4** | `sinceLastSessionDays` 死字段 + `actr.ts` 死代码/过期注释 | Q19/Q4 时间维度落空 | `338c7717` |

---

## 5. 可行性分级（方案 → 本定位）

### ① 现在就能做（北星内、无商业依赖）
- **Q8 测量深化**：延迟锚题复用（复用 Q13 探针，当前只覆盖"已掌握/挣扎"两信念）。
- **Q1 复习容量（替代排序）**：在已量化的选点质量上决定是否需要 LLM listwise。
- **Q11b strict JSON Schema 接线** `skill-output-validator`；**Q10 `accumulate`** 视场景。
- **契约漂移清理**：Q9 实测 9 漂移 / 18 死字段 / 10 死边候选。
- **Q20 token 面板**：面板已在（`execution-logs` 成本分析 tab）；补权威单价即可出金额（外部输入）。

### ② 轻量保留（已做，不再加码）
- **Q14 输入围栏 + 注入/防套取条款**（`5f59c904` + `6285168d`）——**不加**审核重层。
- **Q15 教学内容降断言/不编造/可复核**（`760ff281`）——**不加** RAG/沙箱。
- **Q16 删除卫生/数据覆盖补漏**（`2d205f9b`）——同意/未成年人/导出等重层不做。
- **Q20 token 面板 / 单价纯函数**（`services/cost/model-cost.ts`）——预算与单位经济不做。
- **Q3 降级打标 + DNR**（`c1f83891` / `21738b8d`）——维持最小层，不扩成故障注入套件。

### ③ 不做（商业级，若将来商业化需从零建）
- 内容审核重层（小模型栈 / 多级审核）。
- 同意、法务、未成年人、自述优先仲裁、数据主体导出、保留 TTL。
- 单位经济、per-user 预算、成本驱动路由。
- 真实用户实验基建（feature flag / 哈希分流 / MRT）。
- 教师升级流程 / 可疑输出复核队列。
- 材料库 / 上传解析。
- RAG 溯源 / 向量库 / embedding / reranker / 代码沙箱 / 约束解码 / 本地小模型。

---

## 6. 升级路线建议（按新定位重新基线）

> 排序原则：**先让"测量与诚实"可信 → 再让"实验室保真"更强**；依赖新基建或商业对象的全部不做。

**已基本完成**：
- **Wave 1（传感器与诚实层）**：检查点端到端 D1/D2、死字段/死代码 D4、策略收敛 D3、静默降级（虚拟+真实）+ DNR、
  Q14 输入围栏、Q15 内容降断言、Q13 D_floor + 公平审计 + 锚题探针、Q16 删除覆盖补漏。
- **Wave 2（实验室保真 + 可解释）**：Q4 概率化记忆、Q2/Q8 记忆看板 + 保留率曲线、Q5 自述/手册、Q9 字段命中 + 调用用量、
  Q1 选点质量、Q7 轻量真值发现、Q11b JSON Schema 编译器、Q19 真实侧长间隔信号。
- **Wave 2.5（验证中新发现）**：路径生成失败自愈、教学回合抖动可续跑暂停、真实侧长间隔信号（详见 §8）。

**剩余可选（北星内，非阻塞）**：
1. **Q8 测量深化**：延迟锚题复用。
2. **Q1 复习容量（替代排序）**。
3. **Q11b 接线**；**Q10 `accumulate`** 视场景。
4. **契约漂移清理**。
5. **Q20 token 面板**：补权威单价即可出金额（外部输入）。

**明确不做**：第三波"规模化前置"（Q18 分流 / Q19 winback / Q20 单位经济）——无对象、无长期服务（见 §7）。

---

## 7. 与既有治理计划的边界（不做 + 理由 + 若商业化的代价）

| 层 | 已被谁覆盖 | 本定位处置 |
|---|---|---|
| 基础设施安全 | `NON_FUNCTIONAL_GOVERNANCE_PLAN.md`（41 条 NF）+ `SECURITY.md` | 维持；不涉及 |
| 教育科学性 | `LEARNING_SCIENCE_AUDIT.md` / `EDUCATIONAL_THEORY_MAP.md` | Q13/Q8 与其衔接（已自认阻尼陷阱/观察非因果） |
| Prompt 工程 | `SKILL_PROTOCOL_V4.md` / `AGENT_IO_DESIGN_V3.md` | 轻量保留（Q11 第二档、Q14 防套取） |
| 数据治理 | NF-P2-1（需决策，未做） | **不做**（见下） |
| 教育/内容/伦理 | 原几乎空白 | Q14/Q15 轻量保留；Q13 核心最小层 |

**PRIVACY（Q16）结论并入——不做，理由与商业化代价**
- 原基线覆盖：数据分类矩阵、同意台账 `consent_records`、未成年人年龄门/家长同意、"自述优先"OLM 仲裁、
  导出=删除同一覆盖矩阵、学习数据保留 TTL。
- **为什么不做**：无长期服务、真实用户不是被服务的长期数据主体；合规文档需法域/法务拍板，与 Demo 定位不匹配。
- **若商业化需从零建**：`consent_records{userId,purposeCode,version,grantedAt,revokedAt,source}`、年龄区间采集与监护人同意、
  未成年人关闭心理推断/实验、`selfReported*` 平行值 + `provenance` 仲裁、`LEARNER_DATA_COVERAGE` 单源矩阵 + 主体导出端点、按类保留 TTL。
- **已保留的零成本部分**：删除覆盖补漏（`prediction_records`/`misconception_ledger`，`2d205f9b`）——删除卫生属于"诚实"而非合规重层。

**SCALE（Q18/Q19/Q20）结论并入——不做，理由与商业化代价**
- **Q18 真实用户实验基建**：无真实 cohort 对象。若商业化：复用 `SplitMix64PRNG`（sha256 种子）做稳定分桶 + 仓库内配置注册表
  （不落库、kill-switch）+ `learner_evidence` 记曝光/结果 + 合规门 + SRM 只读审计，再谈 MRT。
- **Q19 生命周期产品功能**：冷启动继承与长间隔重校准已做；churn/winback/dormant 分布可用只读脚本从既有时间戳推导。
  若商业化再加：winback 通知（需独立同意依据）、streak 免死/补签（复用 `learner_projections`，避免加列）。
- **Q20 单位经济**：无收入对象。若商业化：`models.config.ts` 单价表 → 只读金额报表 → per-user/session 归因 → 软告警 → 硬上限；
  注意 `agent_call_logs.promptTokens` 粗算会**高估**缓存部分，精确口径须用 `llm_execution_attempts` 的 `promptCacheHit/MissTokens`。
- **Q17 教师升级流程**：依赖长期服务对象，不做。

---

## 8. 执行进展（2026-09-18 → 09-19）

> 本文件原有结论与优先级不改；这里是"按路线做了什么"的台账（每条含提交）。原 Track A/B 与 Wave-2 记录已合并至此。

### Wave 1 · Track A（虚拟学习者链路）
| 项 | 提交 | 结果 |
|---|---|---|
| A1 检查点/时间上下文补进模拟器 payload | `59483516` | 两分支白名单投影（无答案键）；测试 4 例 |
| A2 运行时定义与 `SkillDefinition` 补齐 | `83c26460` | definition + 运行时同步；snapshots/runtime-contract 过 |
| A3 `sinceLastSessionDays` 打通 + ACT-R 死代码清理 | `338c7717` | `previousCourseDayGap`（课表口径，首日省略键）；删 4 死函数 |
| A5 降级遥测 + 虚拟侧两处真静默 | `c1f83891` | 新增 `skills/degradation-telemetry.ts`；learner-memory / simulated-day 打标 |
| A4 `failurePolicy` 收敛 | `955dbcdc` | 可写词表收敛为 `retry|propagate`；scaffold 默认 retry |

### Wave 1 · Track B（真实教学侧治理）
| 项 | 提交 | 结果 |
|---|---|---|
| B1 真实侧静默降级 + DNR | `21738b8d` | LearnerExitService / ReviewCompletedConsumer 结构化打标；只读 DNR 脚本（近似，非真 SLO） |
| B2 输入围栏 + 注入条款 | `5f59c904` + `6285168d` | `input-fence.ts`（datamark）；修正为只作用 payload、落库保原文 |
| B3 教学内容诚实 | `760ff281` | teaching-turn / session-wrapup 各加 3 条规则；门禁 29-0 |
| B4 公平最小层（一）`D_floor` | `a97fcc24` | 降档最多低于基线 1 档且绝对值≥3；输出/evidence 增 `floor`/`floorApplied` |
| B4 公平最小层（二）审计 | `e643d494` | 纯函数公平审计 + 只读脚本（默认排除虚拟学习者） |

### Wave 2（实验室保真 + 可解释）
| 项 | 提交 |
|---|---|
| Q4 概率化记忆：纯模块（SplitMix64 + 混淆竞争） | `b6d0dd9d` |
| Q4 集成：`memoryRecall` 接入 assisted + blackbox | `db3aba11` |
| assisted 路径消费待答检查点（E2E 真缺口） | `8fd12657` |
| Q2/Q8 记忆看板 + 保留率曲线 | `e5e9e6e5` |
| Q5 机械自述 + 缘由手册 `doc/AGENT_SKILL_MANUAL.md` | `7cea371d`、`08dff27e` |
| Q9 调用用量聚合（逻辑图注解） | `8b92d09b`、`79bdadf6` |
| Q9 结构图改称「字段数据旅程（逻辑图）」+ 文案 | `52d6cfaf`、`6cba6768` |
| Q9 字段级运行时命中：聚合 CLI + 叠图着色/死边虚线 | `c5a91e58`、`612d04ac` |
| Q1 复习选点质量只读度量 | `46853be9` |
| Q7 轻量真值发现（多源加权 + 元认知校准） | `1e1b0fba` |
| Q13 难度分层审计（虚拟 cohort） | `c13dee5b` |
| Q13 锚题探针纯决策层 / 接线（目标注入 + 判定打标 + `anchor:result`） | `dfe30482`、`152713f2` |
| Q16 删除覆盖补漏 `prediction_records`/`misconception_ledger`（+路由测试回归） | `2d205f9b`、`345e4550` |
| Q11b strict JSON Schema 编译器 / core loader 承载 `enumValues` | `0d4aa01b`、`126e05c7` |

### Wave 2.5（VL 验证中的三项新发现与修复）
| 项 | 提交 | 结果 |
|---|---|---|
| #2 路径失败无自愈 | `eb2f3bc9` | `path-status` 增 `pathGeneration{...}`；失败**即时判终局**（不再空等 30 分钟）+ **有界自愈重试**（core/stageDesign，≤2 次） |
| #3 教学回合失败终局化 | `f2548c7d` | 步骤级有界重试（≤2，仅命中已知校验码）；耗尽 → **可续跑暂停**（保持 `running` + `lastError` + `teaching-step-paused`），**禁止伪造教师回复** |
| #1 真实侧时间信号 | `b6a6afd6` | `controls.temporalGap = {daysSinceLastSession, isLongGap}`（同路径上一场 `endTime`，默认阈值 14 天，env 可覆盖）+ teaching-turn"长间隔先回捞"规则 |

### VL 验证结果（真实跑数）
- assisted E2E（`advance-day runTasks`）8 天 × 2 节：链路健康；`temporalContext.sinceLastSessionDays` 计算正确（跨周末 3 / 工作日 1）；
  `memoryRecall` 真进 payload。
- 修复后复跑：**`checkpoint:result = 9`（全部 `judgedBy:"code"`）**，`pendingCheckpoint` 清空 → 成功率带传感器在该路径打通。
- **环境争用说明**：收尾 E2E 受另一进程并发改动影响，未能稳定跑到终态；单测/门禁与上述结果以无争用批次为准。
- 三项 Wave 2.5 修复**未**在真实模型长跑中复测（仅单测 + 门禁）；`f2548c7d` 的 `isTeachingTurnHiccupError` 为保守白名单，
  新校验码回落旧终局行为（有意，避免把真实契约错误当无限暂停）。

**回归**：全仓 **327/327 套件、2808 例通过**；`tsc` / `eslint` / prompts 门禁全过。

### 仍未做（明确延后 / 不做）
- **Q11b 接线**：编译器已就绪（`0d4aa01b`/`126e05c7`），还需在 core yaml 声明 `enumValues`/嵌套 `properties`，并把
  `compileStrictJsonSchema` 接入 `skill-output-validator`（用 `collectSchemaLimitations` 门禁，避免误拒）。
- **锚题探针调优**：接线已完成；锚题 `checkpoint:result` 是否应从成功率带样本排除，待产品定夺。
- **Q8 延迟锚题复用 / Q1 复习容量**：见 §6 剩余可选。
- **商业级轴**：Q16 合规重层 / Q17 教师升级 / Q18 实验基建 / Q20 单位经济 = 不做（§7）。
- `login_attempts` 是否纳入删除覆盖（按用户名/IP 而非 userId），待场景。

---

## 9. 附：关键证据索引

- 记忆/排期：`backend/src/services/memory/{fsrs,actr,memory-trace.service,retention-curve,review-plan.service,review-quota.service,probabilistic-recall}.ts`
- 虚拟记忆：`backend/src/virtual-lab/learner-memory.ts`、`backend/src/coordinators/simulation.memory.ts`、`backend/src/skills/virtual-learner-shared/schemas.ts`
- 模拟器：`backend/src/skills/virtual-learner-learn-turn-simulator/{index.ts,definition.ts}`、`prompts/core/virtual-learner-learn-turn-simulator.yaml`
- 难度/公平：`backend/src/services/learner/{TaskDifficultyAdjustmentService,independent-success-band.service,IndependentAnchorProbeService,LearnerSnapshotService}.ts`、`backend/src/services/ai-teaching/AITeachingCoordinator.ts`
- 降级/质量：`backend/src/skills/{outcome.ts,degradation-telemetry.ts}`、`backend/src/scripts/audit-degradation-rate.ts`、`backend/src/services/yaml-vocabulary.ts`
- 安全/内容：`backend/src/services/ai-teaching/input-fence.ts`、`prompts/core/{teaching-turn,session-wrapup}.yaml`
- 隐私/删除：`backend/src/agents/learner-model-agent/types.ts`、`backend/src/services/virtual-lab/virtual-cleanup.service.ts`、`backend/src/routes/users.ts`、`backend/src/scripts/purge-soft-deleted-users.ts`、`doc/NON_FUNCTIONAL_GOVERNANCE_PLAN.md:735`
- 生命周期/成本：`backend/src/services/learner/{churn-signals,truth-discovery}.ts`、`backend/src/scripts/audit-churn-signals.ts`、`backend/src/services/cost/model-cost.ts`、`backend/src/config/models.config.ts`
- 人在环：`backend/src/services/learning/learning.service.ts:3947-3988`、`backend/src/routes/admin/virtual-learners.ts:2690/2708`
- DSL：`backend/src/services/yaml-vocabulary.ts`、`backend/src/services/prompt-lab/{core-compiler,core-file-loader}.ts`、`backend/src/services/skill-output-validator.ts`、`backend/src/gateway/api-gateway/{executor,router}.ts`
- 字段命中/逻辑图：`backend/src/services/admin/field-hit-rates.ts`、`frontend/src/views/admin-redesign/{Orchestrator,DataFlowGraph}.vue`、`frontend/src/views/admin-redesign/live.ts`
- 前端：`frontend/src/views/admin-redesign/{VirtualProfile,LearnerDetail,MemoryReview,FieldAddWizard,SkillFieldRouting}.vue`
- 结果测量：`backend/src/services/memory/retention-curve.ts`、`backend/src/scripts/audit-retention-curve.ts`
