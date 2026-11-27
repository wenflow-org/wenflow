# 20 问方案 × WenFlow：逐条分级结论与升级边界

> 📌 类型：设计方案（20 问的分级结论——核心 / 轻量保留 / 不做——及其理由与现行状态；现行状态以 §8 为准）｜索引见 [doc/README.md](./README.md)。

> **来源**：项目发起时列出的 12 问（机制与理解），与后来补充的 8 问（治理与商业轴），逐条对照真实项目得出。
>
> **定位（本文一切取舍的前提，来自项目 owner）**：本项目是 **教学实验 / Demo 平台，MIT 许可、非商业**。
> **会有真实用户，但不提供长期服务**——它首先是一次 **demo / showcase 体验**。因此：
> 优先级 = **实验有效性 + 教学闭环可观测**（虚拟学习者实验室、测量、教学机制）；
> **商业级轴不在范围**（或只保留已具备的零成本部分）：内容审核重层、同意/法务/未成年人、单位经济/预算、
> 真实用户实验基建、教师升级流程。已建成的**零成本护栏保留但不再加码**：输入围栏、内容降断言、
> 删除卫生、token 面板。

---

## 0. 一句话结论

**北星是"原始 12 问"**（项目发起时列出的**机制与理解**清单，见 §0.5）。后来补充的 8 问
（公平 / 安全 / 内容正确性 / 隐私 / 人的监督 / 真实实验 / 生命周期 / 成本）是**治理与商业轴**：
它们对一个"商业 AI 教育产品"成立，但本项目是**教学实验 / Demo、MIT、非商业、有真实用户但无长期服务**，
这些轴**大部分不在范围内**（仅保留其中零成本已具备的轻量护栏，**不再加码**）。

在本定位下：**原始 12 问的"机制与理解"大多已交代**（Q6/Q7 的说明见 `LEARNER_CENTER_AND_STATE_FUSION.md`）；
剩下的是**少量可选深化**（Q1 复习容量、Q10 运行时自定义），各项现状态以 §8 为准。
方法论层（双传感器、ZPD 支架、静默降级治理、OLM 自述、MRT、分层路由、成本护栏）基本正确；
**错位的是优先级，不是方向**。

> 外部报告的核心论据"检查点几乎不产生 → 成功率带永远打不开"**不成立**：
> `ready_to_close` 可出题；答案键示例、skip 路由、黑盒消费均已接通
> （VL 验证 `checkpoint:result = 9`，全部 `judgedBy:"code"`）。

---

## 0.5 覆盖小结：先对"原始 12 问"，再看补充的 8 问

### 北星：原始 12 问对账

| # | 你的原话落点 | 现状 | 剩余 |
|---|---|---|---|
| 1 | 排序模型召回知识点 | 结论不引 reranker；已量化选点质量；真瓶颈是**复习容量**（due 覆盖 6.4%/backlog 395） | 容量决策（可选） |
| 2 | 虚拟学习者**拆分** + 可视化看板 | 看板（`VirtualProfile` 记忆池 + 保留率曲线）；代码拆分（`VirtualLearners.vue` 拆 7 组件）；独立成「虚拟实验」组 | — |
| 3 | 项目里不该有的降级处理 | 虚拟 + 真实两侧静默降级改结构化打标 + DNR | — |
| 4 | 越久遗忘越高 → **抽到几率越低**（随机） | 概率化提取（**扮演可信度**）+ 确定性 PRNG；未用于排程（方向矛盾已识别） | — |
| 5 | 每个 agent 写自述/功能说明 | 自动生成自述（`prompts/AGENTS_SELF_INTRO.md`）+ 人写"缘由"手册（`AGENT_SKILL_MANUAL.md`） | — |
| 6 | **学习者中心**：通用 vs 特异 | 说明文档 `doc/LEARNER_CENTER_AND_STATE_FUSION.md` | — |
| 7 | 聚合/拆分/融合/评估"**怎么做到的**" | 说明文档同上；`truth-discovery` 多源融合**已接进概念状态裁决**（代码裁决优先） | — |
| 8 | **如何测量学习效果** | 观测层（保留率曲线）+ 选点质量 + 延迟锚题 | — |
| 9 | 编排/拓扑 = **直观看到字段命中上下游** | 「**逻辑图**（字段数据旅程）」；不建独立拓扑图 | — |
| 10 | 前端可视化建字段 → **功能自定义增强** | 字段编辑/编译/发布已做；运行时自定义（`accumulate`/L2）未做 | 视场景 |
| 11 | prompt 编程语言（**类型/字段化功能/逻辑值**） | `SKILL_PROTOCOL_V4` + `core.yaml` 即它；strict schema 已接入输出校验器，并在 `concept-load-estimator` 点亮 | — |
| 12 | 材料组织：**组装 vs 通用泛化** | 已实施（multer + material-collector/material-brief） | — |

### 附：补充的 8 问（治理/商业轴，**不作北星**）

| 问 | 处置 |
|---|---|
| 13 教育公平 | **核心例外**：D_floor + 公平审计 + 分层 + 锚题探针已具备（与实验有效性相关） |
| 14 安全与滥用 | 轻量保留：输入围栏 + 注入/防套取；**不加**审核层 |
| 15 内容正确性 | 轻量保留：降断言/不编造/可复核；**不加** RAG/沙箱 |
| 16 隐私/同意 | 轻量保留：删除卫生；同意/未成年人/导出/自述仲裁**不做** |
| 17 人的监督 | 不做（无真实长期学习者） |
| 18 真实用户实验基建 | 不做（无长期服务对象） |
| 19 生命周期 | 部分：真实侧长间隔信号 + 流失信号只读；winback/召回**不做** |
| 20 成本 | 轻量保留：token 面板 + 单价纯函数；单位经济/预算**不做** |

**剩余可选（按北星排序）**：① Q1 复习容量（等数据）；② Q10 运行时自定义（视场景）；③ Q20 补权威单价（外部输入）。

---

## 1. 业务事实基线（决定"哪些方案值得做"）

| 维度 | 事实 | 对方案的约束 |
|---|---|---|
| 定位 | **教学实验 / Demo 平台，MIT、非商业**；会有真实用户但**无长期服务**，首先是可展示的实验体验 | 商业级前置（合规、审核、单位经济、真实用户实验基建）**不做**；升级只服务"实验有效 + 教学闭环可观测" |
| 核心命题 | "学习始于对真实问题的澄清"；5 类能力（问题定义/系统思维/判断力/AI 协作/创造力） | 升级应服务"问题→路径→教学闭环"的质量，而非通用 agent 平台能力 |
| 验证手段 | **虚拟学习者实验室**（黑盒模拟 + 裁判 + 角色保真审计）——本项目**唯一**的验证手段 | 实验室保真度 = 产品的测量仪器；记忆保真（Q4）是实验有效性，而非玩物 |
| 技术栈 | SQLite 双库；**无向量库 / 无图库 / 无 Redis / 无本地小模型 / 无沙箱**；模型走 OpenAI 兼容网关 | 一切"向量/沙箱/小模型/约束解码"方案=从零建基建，不做；**例外**：资料语义层（embedding/rerank）走既有网关 + 本地 JSON 侧车，未新建基建 |
| 工程纪律 | `core.yaml` 唯一人工源 + 编译链 + 守门三查；**LLM 只出观测/建议，档位/排序/状态由代码裁决**；`SkillResult.quality` 质量标记；outbox/inbox 事件链 | 单源化、软约束、可回滚是硬约束；方案必须落进这套纪律 |
| 自动出题分工 | 时机由代码（`shouldEmitCheckpoint`）定；内容+答案键由 `teaching-turn` 定；判分由 `judgeCheckpointAnswer` 代码定 | Q13/Q14/Q15 的增量都要挂进这条链，不能另起 |
| 学习者模型自认边界 | 自评：「控制回路已接线，传感器多为代理量，记忆环路刚通电，结果测量刚建最小层」 | 升级优先级给"传感器质量"与"诚实性"，而非更多控制回路或商业治理 |

> 已保留的零成本护栏（不加码）：输入围栏 `ai-teaching/input-fence.ts`、教学内容降断言、删除卫生（覆盖矩阵补漏）、token 面板。

---

## 2. 逐条分级（20 问 + 外部方案）

分级口径：**核心（该做）** / **轻量保留（零成本已具备，不再加码）** / **不做（商业级/无对象）**。

### A. 认知 / 学习层

#### Q4 虚拟学习者概率化记忆
- **分级**：**核心（该做）**。
- **现行**：概率化记忆（纯模块：SplitMix64 + 混淆竞争）已接入 assisted 与 blackbox（`memoryRecall`）；assisted 路径消费待答检查点。
  虚拟学习者与真实用户**同表按 `userId` 隔离**，不建第二库。
- **约束**：以项目 FSRS 公式为准（`fsrs.ts` 的 `19/81`）；混淆对不依赖 embedding（资料层的 embedding 未接线至此）——复用 LLM 离线判定并留档。

#### Q8 测量学习效果（可证伪）
- **分级**：**核心（该做）**。
- **现行**：最小层——保留率曲线进 admin；延迟锚题复用 Q13 探针，按 UTC 自然日间隔复测已完成点的保持率。
  数据源为 `learner_evidence('review:completed')`。
- **不做**：MRT 需真实用户（无对象）。

#### Q19 生命周期（冷启动/长间隔/流失/回归）
- **分级**：**核心（该做）**（winback/streak 免死等产品功能除外）。
- **现行**：冷启动继承；真实侧长间隔重校准（`controls.temporalGap = {daysSinceLastSession, isLongGap}`，默认 14 天）；
  休眠/流失只读审计（`learner/churn-signals.ts` + `scripts/audit-churn-signals.ts`，行为代理、非因果）。
- **不做**：winback 通知 / streak 免死——产品功能。

### B. 机制 / 工程层

#### Q1 排序模型 / reranker / 复习容量
- **分级**：**核心（该做）**——只做"复习容量/选点质量"，**不引向量/reranker**。
- **现行**：复习选点链路内无 embedding/reranker/向量库（资料语义层另有实现，见 Q12）；候选集极小；
  已有确定性 urgency 排序 + 交错（`review-plan.service.ts`）；选点质量已量化（只读度量）。
- **剩余可选**：复习容量（替代排序）——量化后决定是否需要 LLM listwise。

#### Q2 虚拟学习者拆分 + 记忆看板
- **分级**：**核心（该做）**。
- **现行**：看板（`VirtualProfile` 记忆池 + 保留率曲线；API `GET /:id/memory`）；`VirtualLearners.vue` 拆成 7 个子组件；
  独立成「虚拟实验」组（「批量实验」为独立页）。

#### Q5 给每个 agent 写自述
- **分级**：**核心（该做）**。
- **现行**：机械自述 `prompts/AGENTS_SELF_INTRO.md`（生成脚本 + 漂移门禁）；缘由手册 `doc/AGENT_SKILL_MANUAL.md`（开发者向，明确非平台功能说明）。

#### Q7 聚合 / 拆分 / 融合 / 真值发现
- **分级**：**核心（该做）**（ES/CQRS 大重构除外）。
- **现行**：outbox/inbox + 只追加证据；`ConceptConsolidatorService`（LLM 建议 + 代码执行 + 留档 + 回滚）；
  轻量真值发现已接入概念状态裁决——来源权重：代码裁决 0.95 > 结构化选择 0.75 > LLM 推断 0.50 > 自评 0.20，差值即元认知校准。
- **不做**：ES/CQRS 大重构。

#### Q9 字段命中上下游（逻辑图）
- **分级**：**核心（该做）**。
- **现行**：结构图即「字段数据旅程（逻辑图）」，是**纯定义视图**；**不建独立拓扑图**。调用次数统计不上图
  （`prompt_call_logs` 聚合是编排页最重的一笔，且调用量不是编排图的判读对象——用量看执行日志 / 成本分析）；
  聚合实现保留在 `services/topology/*`，供审计 CLI 使用。
- **实测信号**（`audit-field-hit-rates.ts --days=30` 的一次读数）：30 skill / **15 死字段** / **49 契约漂移** / 10 死边候选。

#### Q10 前端可视化创建字段
- **分级**：**核心（该做，工程主线）**。
- **现行**：组件齐（`FieldRoutingTable` / `FieldAddWizard` / `SkillFieldRouting` / `SkillDesignPage`）；锁机制齐；
  `accumulate` 只产 prompt 标签不落库。
- **剩余可选**：`accumulate` 运行时功能化属 L2 议题，仅场景需要时做。

#### Q11 Prompt DSL / Zod / 约束解码
- **分级**：**核心（该做，工程主线）**。
- **现行**：DSL 成立（受控词表 `yaml-vocabulary.ts`、编译链 `core-compiler.ts`、守门三查、后置校验器 `skill-output-validator.ts`）。
  strict JSON Schema 已接入输出校验器：结构化声明 opt-in、按声明门禁，任一降级限制即回退宽容路径；
  `concept-load-estimator` 已点亮严格路径。
- **不做**：第三档"约束解码"——网关不支持 `response_format` / `json_schema`。
- **剩余可选**：reasoning 字段前置；其余 skill 按需逐个点亮严格路径。

#### Q18 真实用户实验基建
- **分级**：**不做（商业级/无对象）**。
- **现行**：无 feature flag / 用户哈希分流；只有虚拟模拟 A/B（`scripts/simulate-learner-days.ts`）。
  `prediction_records` 是校准台账、`review-quota` 是每日配额、`batch_experiments` 是虚拟批量。
- **不做理由**：无真实 cohort 对象；若商业化需从零建（见 §7）。

### C. 可靠 / 治理层

#### Q3 静默降级
- **分级**：**核心（该做）**。
- **现行**：虚拟侧降级遥测（`skills/degradation-telemetry.ts`）；真实侧真静默点结构化打标 + DNR 只读脚本；
  `failurePolicy` 收敛为 `retry | propagate`。
- **约定**：**允许降级，不允许未打标降级。**

#### Q17 人的监督与逃逸舱
- **分级**：**不做（商业级/无对象）**。
- **现行**：机制层面已有——`replanSignal` 由 `LearnerSnapshotService`（`deriveReplanSignal`）派生，
  `requireConfirmation` 在 `routes/learning.ts` 与 `path-replan.service.ts`（预览 + 确认）；
  虚拟侧有人工端点（review-path / accept-path / replan-path）。health-center 是运维层，没有学生困境升级 / 可疑输出复核队列。
- **不做理由**：教师升级工作流依赖长期服务对象；低成本的完成判定 / 检查点复核入口已由 Q3 的降级打标与 DNR 观测覆盖。

#### Q20 成本与可持续
- **分级**：**轻量保留（只做 token 面板，不再加码）**。
- **现行**：token 面板（`execution-logs` 成本分析 tab）+ 单价纯函数 `services/cost/model-cost.ts`
  （单价是占位空表，未知单价返回 `usd:null`，不冒充 0）。`costCeiling` 是**调用次数、不是钱**，且仅虚拟（`virtual-lab/session-budget.ts`）。
- **不做**：per-user 预算 / 单位经济 / 成本驱动路由（见 §7）。

### D. 伦理 / 内容层

#### Q13 教育公平与自我实现预言
- **分级**：**核心（该做）**。
- **现行**：D_floor（降档最多低于基线 1 档且绝对值 ≥3）；难度分配公平审计（只读）；
  锚题探针（目标注入 + 判定打标 + `anchor:result` 留痕，只标记不改写）；虚拟 cohort 分层审计。
  降档理由为 5 条负荷类（含 `frustration_streak`）；知识类只挡升档。
- **不做**：支架 fading——`adjusted` 每任务由基线重算，负荷理由消失即自动撤回，再加独立规则会与"知识类只挡升档"政策冲突；VAE/DRO。

#### Q14 安全与滥用防御
- **分级**：**轻量保留（零成本已具备，不再加码）**。
- **现行**：教学链路输入围栏 + 注入/防套取条款；围栏只作用于模型 payload，落库保持学生原文。
- **不做**：DeBERTa/Aho-Corasick 小模型栈、LLM 审核层。

#### Q15 内容正确性
- **分级**：**轻量保留（零成本已具备，不再加码）**。
- **现行**：教学内容"不确定降断言 / 不编造具体值 / 数学可复核"。
- **不做**：RAG 溯源 / 引用哈希 / 闭域检索 / 代码沙箱。

#### Q16 隐私、同意与伦理边界
- **分级**：**轻量保留（仅删除卫生；零成本已具备，不再加码）**。
- **现行**：删除能力覆盖虚拟级联 + 真实 purge 的派生数据（含 `prediction_records` / `misconception_ledger`）。
  密集心理特征只存在于**虚拟 persona**（合成人设）；真实用户只存认知画像 + 情绪画像 + 叙事。
- **不做**：同意 / 未成年人 / 自述优先仲裁 / 导出 / 保留 TTL——商业级（理由与商业化代价见 §7）。

#### Q6 学习者模型维度
- **分级**：**不做（商业级/无对象）**。
- **现行**：认知 / 元认知 / 情感 / 行为四维已实现；SDT 归属感、成长型思维缺；无 OLM 自述仲裁（无"自述覆盖推断"）。
- **不做理由**：现有维度够实验用；OLM"自述优先"属用户权利/治理（Q16），量表/贝叶斯融合不做。

#### Q12 材料 / 资料组织
- **分级**：**已实施**。
- **现行**：multipart 上传（`materials.routes.ts` multer）+ `material-collector` / `material-brief` 两个 skill。
  `web-search` / `web-fetch` 不直接进教学链路。资料语义层（embedding / rerank）仅用于资料检索，
  见 `DEV_SCRIPTS.md` §3.8.1。

---

## 3. 事实更正（对外部报告）

| 外部说法 | 实际 |
|---|---|
| "检查点几乎不产生 → 油门打不开" | `AITeachingCoordinator` 已放行 `ready_to_close` 出题 |
| "排期/展示不同源" | `preserveDueAt` 已在（`memory-trace.service.ts`） |
| `replanSignal` / `requireConfirmation` 在 `simulation.coordinator.ts` | 在 `LearnerSnapshotService`（`deriveReplanSignal`）/ `routes/learning.ts` |
| 降档理由是 4 条负荷类 | **5 条**（含 `frustration_streak`） |
| 学习者模型有密集心理特征 | 真实用户只存认知 + 情绪 + 叙事；密集特征在虚拟 persona |
| "删除能力只覆盖部分记录" | 虚拟级联 + 真实 purge 已覆盖派生数据；缺自动 TTL / 自助导出（不做） |
| —（未记） | 网关不支持 `response_format` / `json_schema`，第三档约束解码落不了地 |
| —（未记） | `failurePolicy` 只允许 `retry` / `propagate` |
| —（未记） | `actr.ts` 的 `calculateRetention` / `isReviewDue` 仅测试引用，不在生产路径 |
| —（未记） | `costCeiling` 是调用次数不是钱；无单价表 |
| —（未记） | 管理端有 mastery / stability / retention 曲线（不只是负荷曲线） |

---

## 4. 模拟器与契约的关键约定

| 约定 | 内容 |
|---|---|
| 模拟器 payload 完整 | `buildUserPayload` 携带 `pendingCheckpoint` / `temporalContext`（白名单投影，不含答案键） |
| 定义同步 | 模拟器 `definition.ts` 与运行时 `SkillDefinition` 保持一致 |
| 失败策略词表 | `failurePolicy` 只允许 `retry` / `propagate`（scaffold 默认 `retry`） |
| 时间维度打通 | `sinceLastSessionDays` 由真实时间戳赋值（`previousCourseDayGap`，课表口径）；ACT-R 死代码不在生产路径 |

---

## 5. 可行性分级（方案 → 本定位）

### ① 现在就能做（北星内、无商业依赖）
- **Q8 测量深化**：延迟锚题复用（按 UTC 自然日间隔复测已完成点保持率）。
- **Q11b strict JSON Schema**：已接入输出校验器，并在 `concept-load-estimator` 点亮。
- **Q7 真值发现接线**：已接入 `LearnerStateReviewService`（见 §8）。
- **契约漂移清理**：已 triage + 修复（Q9，见 §8）。
- **Q1 复习容量（替代排序）**：在已量化的选点质量上决定是否需要 LLM listwise。
- **Q10 `accumulate`**：视场景。
- **Q20 token 面板**：面板已在；补权威单价即可出金额（外部输入）。

### ② 轻量保留（已做，不再加码）
- **Q14 输入围栏 + 注入/防套取条款**——**不加**审核重层。
- **Q15 教学内容降断言/不编造/可复核**——**不加** RAG/沙箱。
- **Q16 删除卫生/数据覆盖补漏**——同意/未成年人/导出等重层不做。
- **Q20 token 面板 / 单价纯函数**——预算与单位经济不做。
- **Q3 降级打标 + DNR**——维持最小层，不扩成故障注入套件。

### ③ 不做（商业级，若将来商业化需从零建）
- 内容审核重层（小模型栈 / 多级审核）。
- 同意、法务、未成年人、自述优先仲裁、数据主体导出、保留 TTL。
- 单位经济、per-user 预算、成本驱动路由。
- 真实用户实验基建（feature flag / 哈希分流 / MRT）。
- 教师升级流程 / 可疑输出复核队列。
- RAG 溯源 / 向量库 / 代码沙箱 / 约束解码 / 本地小模型。（**embedding / reranker 例外**：资料语义层仅用于资料检索，非复习选点，见 Q1/Q12）

---

## 6. 路线取舍

> 排序原则：**先让"测量与诚实"可信 → 再让"实验室保真"更强**；依赖新基建或商业对象的全部不做。

- **已具备的方向**
  - 传感器与诚实层：检查点端到端、死字段/死代码清理、策略收敛、静默降级（虚拟 + 真实）+ DNR、输入围栏、内容降断言、D_floor + 公平审计 + 锚题探针、删除覆盖补漏。
  - 实验室保真与可解释：概率化记忆、记忆看板 + 保留率曲线、自述/手册、选点质量、轻量真值发现、JSON Schema 编译器、真实侧长间隔信号。
  - 验证中发现并修掉的缺口：路径生成失败自愈、教学回合失败可续跑暂停。
- **剩余可选（北星内，非阻塞）**
  1. Q1 复习容量（替代排序）。
  2. Q10 `accumulate` 运行时（视场景）。
  3. Q20 补权威单价（外部输入）。
  4. 锚题 `checkpoint:result` 是否从成功率带样本中排除（待产品定夺）。
- **明确不做**：规模化前置（Q18 分流 / Q19 winback / Q20 单位经济）——无对象、无长期服务（见 §7）。

---

## 7. 与既有治理计划的边界（不做 + 理由 + 若商业化的代价）

| 层 | 已被谁覆盖 | 本定位处置 |
|---|---|---|
| 基础设施安全 | `SECURITY.md` | 维持；不涉及 |
| 教育科学性 | `EDUCATIONAL_THEORY_MAP.md` | Q13/Q8 与其衔接（已自认阻尼陷阱/观察非因果） |
| Prompt 工程 | `SKILL_PROTOCOL_V4.md` / `AGENT_IO_DESIGN_V3.md` | 轻量保留（Q11 第二档、Q14 防套取） |
| 数据治理 | 未立项 | **不做**（见下） |
| 教育/内容/伦理 | — | Q14/Q15 轻量保留；Q13 核心最小层 |

**PRIVACY（Q16）——不做，理由与商业化代价**
- 不做的部分：数据分类矩阵、同意台账 `consent_records`、未成年人年龄门/家长同意、"自述优先"OLM 仲裁、导出=删除同一覆盖矩阵、学习数据保留 TTL。
- **为什么不做**：无长期服务、真实用户不是被服务的长期数据主体；合规文档需法域/法务拍板，与 Demo 定位不匹配。
- **若商业化需从零建**：`consent_records{userId,purposeCode,version,grantedAt,revokedAt,source}`、年龄区间采集与监护人同意、
  未成年人关闭心理推断/实验、`selfReported*` 平行值 + `provenance` 仲裁、`LEARNER_DATA_COVERAGE` 单源矩阵 + 主体导出端点、按类保留 TTL。
- **已保留的零成本部分**：删除覆盖补漏（`prediction_records`/`misconception_ledger`）——删除卫生属于"诚实"而非合规重层。

**SCALE（Q18/Q19/Q20）——不做，理由与商业化代价**
- **Q18 真实用户实验基建**：无真实 cohort 对象。若商业化：复用 `SplitMix64PRNG`（sha256 种子）做稳定分桶 + 仓库内配置注册表
  （不落库、kill-switch）+ `learner_evidence` 记曝光/结果 + 合规门 + SRM 只读审计，再谈 MRT。
- **Q19 生命周期产品功能**：冷启动继承与长间隔重校准已做；churn/winback/dormant 分布可用只读脚本从既有时间戳推导。
  若商业化再加：winback 通知（需独立同意依据）、streak 免死/补签（复用 `learner_projections`，避免加列）。
- **Q20 单位经济**：无收入对象。若商业化：`models.config.ts` 单价表 → 只读金额报表 → per-user/session 归因 → 软告警 → 硬上限；
  注意 `agent_call_logs.promptTokens` 粗算会**高估**缓存部分，精确口径须用 `llm_execution_attempts` 的 `promptCacheHit/MissTokens`。
- **Q17 教师升级流程**：依赖长期服务对象，不做。
- **Demo 就绪功能**：**不做**——"Demo"是项目**定位**（对外展示的实验体验），不是待建功能；"不空屏/不卡/不报错"已由静默降级（Q3）、路径失败自愈、教学回合可续跑覆盖，**不另建走查/冒烟机制**。

---

## 8. 现行状态一览

| 项 | 现行状态 / 机制 |
|---|---|
| 模拟器 payload 与定义同步 | 见 §4 |
| 降级遥测 + 真静默打标 | 虚拟侧 `skills/degradation-telemetry.ts`；真实侧 `LearnerExitService` / `ReviewCompletedConsumer` 结构化打标；只读 DNR 脚本（近似，非真 SLO） |
| 输入围栏 | `input-fence.ts`（datamark）；只作用 payload，落库保原文 |
| 教学内容诚实 | `teaching-turn` / `session-wrapup` 的降断言规则 |
| 公平最小层 | D_floor：降档最多低于基线 1 档且绝对值 ≥3，输出/evidence 增 `floor`/`floorApplied`；纯函数公平审计 + 只读脚本（默认排除虚拟学习者） |
| 概率化记忆 | SplitMix64 + 混淆竞争；`memoryRecall` 接入 assisted + blackbox |
| 记忆看板 | `VirtualProfile` 记忆池 + 保留率曲线 |
| 自述与手册 | `prompts/AGENTS_SELF_INTRO.md`、`doc/AGENT_SKILL_MANUAL.md` |
| 复习选点质量 | 只读度量 |
| 真值发现 | 接入 `LearnerStateReviewService`：LLM `conceptAssessments` 与代码裁决锚题（`judgedBy='code'`）经 `concept-truth-fusion.ts` 加权融合，代码裁决优先；**单源时融合值 = 原二值**；来源拆解写入评审载荷 `truthDiscovery`（可审计）；锚题证据读取失败记 `DB_READ_FAILED` 降级遥测，不静默当成「无证据」 |
| 延迟锚题复测 | `anchor-probe` 增 `utcNaturalDayDiff` + `selectDelayedAnchorCandidates`（UTC 自然日间隔门、`lastProbeAt` 冷却、最久未接触优先）；`anchor-probe-emit` 增延迟候选与 `TEACHING_DELAYED_ANCHOR_DAYS`（默认 7）；`anchor:result` 带 `anchorKind`/`intervalDays`；**只观测不改写** |
| 延迟锚题的时钟域约定 | 账本 `seenAt` 只用业务写入的 `completedAt` / `endTime` / `lastSeenAt`，缺则**不记**，**绝不回退 `updatedAt`**（真墙钟）；`completedAt > now` 的跨域/未来时间戳跳过并打 `future-timestamp` 标签（`partitionDelayedAnchorCandidates`）；延迟候选从**全量** `conceptStates`/`conceptLedger` 派生，不依赖切片 |
| 严格 JSON Schema | 见 Q11 |
| 契约漂移 | 审计统计的是归一化前的原始解析，历史计数不随运行时容错变化；teaching-turn 平铺的 `currentPoint/points/confirmCheck` 在运行时收敛回 `knowledge`；generic-chat 的漂移字段随 skill 退役不动作；aux / 手动旁路 skill 的死字段与死边不动作 |
| 路径失败自愈 | `path-status` 增 `pathGeneration{...}`；失败**即时判终局**（不再空等）+ **有界自愈重试**（core / stageDesign，≤2 次） |
| 教学回合失败 | 步骤级有界重试（≤2，仅命中已知校验码）；耗尽则**可续跑暂停**（保持 `running` + `lastError` + `teaching-step-paused`），**禁止伪造教师回复** |
| 真实侧时间信号 | 见 Q19；`teaching-turn` 有"长间隔先回捞"规则 |
| 管理端导航 | 低频页折入 tab 宿主，旧 URL 重定向；虚拟学习者独立成「虚拟实验」组 |
| 虚拟学习者前端 | `VirtualLearners.vue` 拆成 7 个子组件 |

**验证结论**：assisted E2E（`advance-day runTasks`）8 天 × 2 节链路健康；`checkpoint:result = 9`（全部 `judgedBy:"code"`），成功率带传感器在该路径打通。路径自愈与教学回合可续跑暂停未在真实模型长跑中复测（仅单测 + 门禁）；`isTeachingTurnHiccupError` 是保守白名单，新校验码回落旧行为（有意，避免把真实契约错误当无限暂停）。

---

## 9. 附：代码索引

- 记忆/排期：`backend/src/services/memory/{fsrs,actr,memory-trace.service,retention-curve,review-plan.service,review-quota.service,probabilistic-recall}.ts`
- 虚拟记忆：`backend/src/virtual-lab/learner-memory.ts`、`backend/src/coordinators/simulation.memory.ts`、`backend/src/skills/virtual-learner-shared/schemas.ts`
- 模拟器：`backend/src/skills/virtual-learner-learn-turn-simulator/{index.ts,definition.ts}`、`prompts/core/virtual-learner-learn-turn-simulator.yaml`
- 难度/公平：`backend/src/services/learner/{TaskDifficultyAdjustmentService,independent-success-band.service,anchor-probe,LearnerSnapshotService}.ts`、`backend/src/services/ai-teaching/AITeachingCoordinator.ts`
- 降级/质量：`backend/src/skills/{outcome.ts,degradation-telemetry.ts}`、`backend/src/scripts/audit-degradation-rate.ts`、`backend/src/services/yaml-vocabulary.ts`
- 安全/内容：`backend/src/services/ai-teaching/input-fence.ts`、`prompts/core/{teaching-turn,session-wrapup}.yaml`
- 隐私/删除：`backend/src/agents/learner-model-agent/types.ts`、`backend/src/services/virtual-lab/virtual-cleanup.service.ts`、`backend/src/routes/users.ts`、`backend/src/scripts/purge-soft-deleted-users.ts`
- 生命周期/成本：`backend/src/services/learner/{churn-signals,truth-discovery,concept-truth-fusion}.ts`、`backend/src/scripts/audit-churn-signals.ts`、`backend/src/services/cost/model-cost.ts`、`backend/src/config/models.config.ts`
- 人在环：`backend/src/services/learner/LearnerSnapshotService.ts`（`deriveReplanSignal`）、`backend/src/services/learning/replan/path-replan.service.ts`、`backend/src/routes/admin/virtual-learners.assisted-path.ts`
- DSL：`backend/src/services/yaml-vocabulary.ts`、`backend/src/services/prompt-lab/{core-compiler,core-file-loader}.ts`、`backend/src/services/skill-output-validator.ts`、`backend/src/gateway/api-gateway/{executor,router}.ts`
- 字段命中/逻辑图：`backend/src/services/topology/field-hit-rates.ts`、`frontend/src/views/admin-redesign/{Orchestrator,DataFlowGraph}.vue`、`frontend/src/views/admin-redesign/live.ts`
- 前端：`frontend/src/views/admin-redesign/{VirtualProfile,LearnerDetail,MemoryReview,FieldAddWizard,SkillFieldRouting}.vue`
- 结果测量：`backend/src/services/memory/retention-curve.ts`、`backend/src/scripts/audit-retention-curve.ts`
