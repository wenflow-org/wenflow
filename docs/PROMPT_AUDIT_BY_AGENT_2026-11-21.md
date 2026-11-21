# WenFlow 提示词审计：按业务 Agent 分组

审计日期：2026-11-21。对象：当前工作区及本地系统库。以实际调用归属为准，而非仅按 `parentAgent`，纳入通过服务调用的辅助 Skill。以下代码问题是静态可达行为或固定输入复现，不代表线上出现频率。P1 优先修复用户状态、判分或评测证据；P2 为契约、覆盖及调用成本问题；P3 为登记和维护问题。本轮没有修改业务代码、提示词、模型上限或数据库内容，也没有运行真实模型批次或发布。

## 先分清仓库版本和实际运行版本

- 35 份 `core/*.yaml` 按现有版本号在内存中重新编译，与仓库 Markdown 全文一致；另外 1 份 `teaching-board-design` 只有 Markdown。`prompts:check:all` 退出 0，离线自测 20/20。数据源检查有 65 条警告，其中 13 个调用点锚点漂移。字段可达性检查对 Simulation 要求逐条声明，其他四阶段只核对清单基线，不证明每条边真的运行可达。
- 用只读 SQLite 检查了本地 36 个 Skill 的 `ACTIVE` 基线：32 条与文件正文及适用的 coreHash 一致，4 条正文和哈希不同，未发现这些 Skill 有活跃实验臂。四条的 `coreVersion` 数字与仓库一致，因此只看版本号发现不了差异。

| Skill | 本地 ACTIVE 版本 | 两端 coreVersion | 仓库已修规则举例 |
| --- | ---: | ---: | --- |
| `goal-conversation` | 151 | 17 | 总时长表述与澄清契约路由 |
| `path-planning` | 98 | 8 | 规划目标带、平台容差、硬时间约束三层区分 |
| `teaching-turn` | 121 | 19 | 配图优先级和无板规则等 |
| `teaching-classroom-judge` | 4 | 1 | 可定位的证据引用和证据不足处理 |

运行时优先使用显式 override，其次 DB ACTIVE；部分 Skill 要求 ACTIVE，不接受文件回退。`teaching-board-design` 例外：真正发送的是启动时读入的文件正文加图型契约，而非库里的正文。不要把上述本地结果解释为线上状态。依据：[公共加载](../backend/src/composers/prompt-composer.ts#L272)／[ACTIVE 选择](../backend/src/services/agentConfig.service.ts#L263)／[画板 override](../backend/src/services/ai-teaching/teaching-board-design.service.ts#L149)／[可达性规则](../backend/src/scripts/check-routing-reachability.ts#L9)。

## Goal Agent · 2 个，另共用资料简报

| Skill | 审计结论 |
| --- | --- |
| `goal-conversation` | 保留第一站澄清、显式确认与无路径收口。**P1**：提示词要求 `not_judgeable` 不排课；有澄清契约时分流可产出 `learning_path`，执行层只在与 `physical_internalized` 同时出现时无条件阻断。固定输入已复现 `not_judgeable + cognitive_internalized + learning_path` 未被硬阻。确认前应要求修正矛盾，或针对当前验收对象收口；允许用户明确换成另一个可验目标，不要把普通外部资源不足一并拦掉。[规则](../prompts/core/goal-conversation.yaml#L111)／[分流](../backend/src/services/learning/response-triage.ts#L305)／[硬门](../backend/src/services/learning/response-triage.ts#L498) |
| `goal-confirm-adjudicator` | 单一布尔裁决职责清楚。**P2**：实际传 `proposal` 和 `lastAssistantExcerpt`，编译输入只列 `userUtterance`；`{}` 或字符串 `confirm` 可被当合法结果并静默归为未确认。显式声明有效载荷，只接受布尔，坏输出按未确认降级并留痕。用「就按这版」和「可以，但改一下周期」做对照。[提示词](../prompts/core/goal-confirm-adjudicator.yaml#L15)／[调用](../backend/src/services/learning/goal-conversation.service.ts#L779)／[校验](../backend/src/skills/goal-confirm-adjudicator/index.ts#L55) |

另外两处口径：新会话按 `clarification.blockingNeed` 路由，`support_need` 只服务旧数据，正文后段仍写它影响支持出口。建议保留一个新会话权威字段，不要简单把两者都做硬门。`out_of_scope` 提示词标 hidden、路由标 visible；现有前端测试明确不在确认卡展示，属于契约标记冲突，不是已证实的用户泄露。共用 `path-material-brief` 的首次调用有 20 秒预算，超时按标题等元信息降级；没有实测其对澄清质量的影响。[支持字段](../prompts/core/goal-conversation.yaml#L69)／[路由](../prompts/orchestration/goal.yaml#L563)／[确认卡测试](../frontend/src/views/v2/__tests__/v2goal-conversation.chat-dock.test.ts#L95)／[资料预算](../backend/src/services/learning/goal-material-summaries.service.ts#L40)。

## Path Agent · 6 个

| Skill | 审计结论 |
| --- | --- |
| `path-planning` | 规划学时三层口径在仓库版已经拆开，结构校验失败会带原因重试。优先用「短目标＋大日历窗口」与「紧截止＋必学内容」做同输入对照，不以本地旧基线代表新规则。[规则](../prompts/core/path-planning.yaml#L45)／[校验](../backend/src/skills/path-planning/index.ts#L1354) |
| `path-task-design` | **P2**：`supplementRequest` 规则称补课只用于考试缺考纲；实际普通资料型路径也会传 `reason=zero-material-ref, materialRefsRequired=true`，满员时可等量置换。显式区分「考纲漏项」和「资料零引用」，分别说明额度、引用和置换；加非备考、有附件、已满员的固定样本。[规则](../prompts/core/path-task-design.yaml#L115)／[真实输入](../backend/src/services/learning/generation/stage-material-supplement.ts#L235) |
| `path-reviewer` | 五维评分按代码统一重算；低分需返工指令。只在后台观察，虚拟显式实验才生成候选，不用其结果决定真实路径可用。后续评审验收应统计证据不足与可用低分，不合并两者。[阈值](../backend/src/skills/path-reviewer/contract.ts#L85)／[后台边界](../backend/src/services/learning/generation/path-generation.core.ts#L982) |
| `path-kc-mapping` | **P2**：要求每个任务逐字回显 `taskKey` 并绑定 KC；缺映射、粒度异常只告警，结果仍可标 `succeeded`。不必阻断路径；应给 KC 产物独立 `partial` 状态，区分未映射、占位映射和可用映射，禁止残缺产物被算作完整覆盖。[规则](../prompts/core/path-kc-mapping.yaml#L63)／[校验](../backend/src/skills/path-kc-mapping/index.ts#L184) |
| `path-material-collect` | 混合工具，只有网页抽取环节使用这个 prompt。保留外部文本只当数据、`not_found`、无引文不入包；固定用例覆盖空正文、无引文、仅给元数据，不把整个采集器标成无提示词。[提示词](../prompts/core/path-material-collect.yaml#L23)／[抽取入口](../backend/src/skills/path-material-collect/extractor.ts#L29) |
| `path-material-brief` | **P2**：声明仅 `ok/not_found`；只校验 `status` 为真值，非法枚举会归并成 `ok`，空 `brief` 会变成可缓存的空壳对象。应验证精确枚举和可用内容；`toc.title` 可对照原文时做确定性核验。测试 `status='unknown'`、`ok` 无正文、标题不在原文等。[规则](../prompts/core/path-material-brief.yaml#L23)／[归一化](../backend/src/skills/path-material-brief/index.ts#L81)／[写回](../backend/src/services/materials/path-material-brief.service.ts#L94) |

## Teaching Agent · 9 个

| Skill | 审计结论 |
| --- | --- |
| `teaching-opening` | 区分新课、复习和有历史承接。保留「无可靠历史先探测，不假称学过」；用无历史复习及续课做固定验收。[规则](../prompts/core/teaching-opening.yaml#L49)／[调用](../backend/src/services/ai-teaching/teaching-turn-preparation.ts#L216) |
| `teaching-turn` | 仓库版已有新检查点答案键校验及可视化优先级。不要把这套保护当成终检和留存探针也已覆盖。重点对照「要求先讲不考」「题目不泄题」「没画板不指板」。[规则](../prompts/core/teaching-turn.yaml#L44) |
| `teaching-peer-reinforcement` | 定位为伴学补强而非另开主线。保留独立输出验证；用学生答错、长沉默及无必要介入样本检查是否重复主讲或抢答，未实测发生率。[提示词](../prompts/core/teaching-peer-reinforcement.yaml#L39)／[校验](../backend/src/skills/teaching-peer-reinforcement/index.ts#L257) |
| `teaching-wrapup` | 保留正文总结、评价来源与课堂证据的区分；摘要可降级但不可当作新的掌握证据。用「有引导完成、缺独立证据」「模型评价不可用」验收。[规则](../prompts/core/teaching-wrapup.yaml#L38)／[降级](../backend/src/skills/teaching-wrapup/index.ts#L1019) |
| `teaching-exit-ticket` | **P1**：助教出题链只要求选择题有至少一个合法答案，未阻止 `single_choice` 有两个正确键。可进入单选 UI，评分却要求两个键都选。出题时重试或不发坏题；已有存量单独处置，不靠判分时挑第一个。[规则](../prompts/core/teaching-exit-ticket.yaml#L32)／[共享出题](../backend/src/skills/v4-aux-skills/index.ts#L375)／[判分](../backend/src/services/ai-teaching/teaching-checkpoint.ts#L461) |
| `teaching-retention-probe` | 同受单选答案数缺陷。**P2**：提示词要求换情境、不能复用课堂题面，生产调用却固定传 `recentDialogue: []`，没有历史题面；尤其不能将未核对重复性的探针直接当独立留存证据。传目标 KC 的历史题和材料标识，去重后再计量。[规则](../prompts/core/teaching-retention-probe.yaml#L31)／[调用](../backend/src/services/learner/retention-probe.service.ts#L324) |
| `teaching-classroom-judge` | **P2**：校验用 `Number(scores.overall)`，`null` 可变为 0。也可引用实际不存在的 wrapup；已有固定输入复现「无 wrapup＋null 总分 → pass/0」。要求有限数字，证据应校验实际被引用字段及有效索引，有问题先重试，仍不满足则单列 `inconclusive`，缺分不填零。该裁判不是学习结算门。[证据归一](../backend/src/skills/teaching-classroom-judge/index.ts#L110)／[前置校验](../backend/src/skills/teaching-classroom-judge/index.ts#L202) |
| `teaching-replan-attribution` | 只在允许方向中解释原因，失败保留确定性建议，适合保持旁路。验收越界建议、虚构证据 ID、已学会与旧卡点分列。[约束](../prompts/core/teaching-replan-attribution.yaml#L32)／[降级](../backend/src/services/ai-teaching/ReplanAttributionService.ts#L137) |
| `teaching-board-design` | **P2**：仅 Markdown；调用实际用文件正文＋图型 guide 的 override。发布 DB 行不能改变这条调用收到的正文。应让运行路径从生效正文拼接 guide，或明确标为文件专用并公示真正采用的内容哈希。保留退板和无板继续机制。[规则](../prompts/skill.teaching-board-design.md#L55)／[覆盖](../backend/src/services/ai-teaching/teaching-board-design.service.ts#L149) |

## Profile Agent · 7 个

| Skill | 审计结论 |
| --- | --- |
| `profile-state-review` | **P1**：非精确 `not` 的值一律归 `mastered`，例如「未掌握」或缺字段；随后成为正向 LLM 观测进入证据融合和 BKT。代码锚题优先不能覆盖所有无锚题情况。应严格枚举、验证引用，非法或无证据记录为未知，不写成正向或负向证据。[规则](../prompts/core/profile-state-review.yaml#L29)／[默认分支](../backend/src/skills/v4-aux-skills/index.ts#L510)／[融合与落账](../backend/src/services/learner/LearnerStateReviewService.ts#L187) |
| `profile-lesson-enrich` | 异步独立泳道真实落证据，不阻塞课堂。正文引用 `knowledgeState`、`wrapup` 等直接输入，声明没覆盖全；把看板台账限制与课外新卡点的去向写清楚，勿将所有新概念提升入掌握台账。[入参](../backend/src/services/learner/LessonKnowledgeEnrichmentConsumer.ts#L109)／[归一化](../backend/src/skills/profile-lesson-enrich/index.ts#L212) |
| `profile-learning-predict` | 教学上下文真实调用，不是从 Profile 步骤列表推得的死边。保留风险/档位预测和非法枚举兜底；冷启动「无历史」需要维持中性，不当真实学生掌握观测。[调用](../backend/src/services/ai-teaching/TeachingContextBuilder.ts#L532)／[输出](../backend/src/skills/profile-learning-predict/index.ts#L145) |
| `profile-adaptive-copy` | **P2**：`todayActions.to` 提示词有白名单，代码直接透传未知值。首页会回落全部路径，不是任意 URL 跳转，但原按钮文案可能与落点不符。统一动作白名单、场景适用性与默认文案。[输出](../backend/src/skills/profile-adaptive-copy/index.ts#L239)／[界面](../frontend/src/views/v2/V2Dashboard.vue#L894) |
| `profile-progress-report` | **P2**：任务完成响应前等待生成，当前仓库前端不读 `learningReport`。确认外部兼容后再退出同步链，不能仅凭本仓无消费者删除接口字段。[提示词备注](../prompts/core/profile-progress-report.yaml#L2)／[调用](../backend/src/services/learning/tasks/task-completion.service.ts#L568) |
| `profile-concept-consolidate` | 后台默认观察，实际合并走管理端；代码将 canonical/aliases 限在输入候选。保留候选白名单和观察/应用隔离。[归一化](../backend/src/skills/v4-aux-skills/index.ts#L540)／[观察入口](../backend/src/services/learner/ConceptConsolidatorService.ts#L2440) |
| `profile-concept-load` | 正常课堂只读缓存，模型在课后预热/离线使用。超时只结束本层等待，属预热成本和超时治理，不是课堂功能缺陷。[缓存/预热](../backend/src/services/memory/concept-load.service.ts#L287) |

`profile-learner-model` 是确定性聚合，不列为提示词。管理端若展示 manifest 的旧默认值，应标来源或显示实际参数，不能把元数据里的 800/1200/4000 当作本轮降低 `64000` 的依据。

## Simulation Agent · 9 个

| Skill | 审计结论 |
| --- | --- |
| `simulation-persona-designer` | 角色生产有身份锚点和采样指令。功能回归应冻结生成后的画像，不让随机换画像污染平台对照；分布是否足够拟真需独立验证。[提示词](../prompts/core/simulation-persona-designer.yaml#L33)／[校验](../backend/src/skills/simulation-persona-designer/index.ts#L163) |
| `simulation-scenario-designer` | 场景和人物阶段有静态校验；公开开场与私有「真实问题」区分是必须保留的设计。固定样本检查私有真因只按剧情逐步披露、不得直接进入平台目标稿。[规则](../prompts/core/simulation-scenario-designer.yaml#L51)／[校验](../backend/src/skills/simulation-scenario-designer/index.ts#L379) |
| `simulation-goal-dialogue` | 提示词教模拟器在拍板轮说纯确认以配合产品。功能样本可用这条轨；效果评估要另设自然混合表达样本（确认＋担心/条件），否则会高估真实确认顺畅度。这是采样偏差风险，不是已测结论。[拍板规则](../prompts/core/simulation-goal-dialogue.yaml#L61) |
| `simulation-path-evaluate` | 独立的虚拟学员反应，不是平台质量裁判，也不再卡自动推进。遗漏决策有时间/熟悉度 fallback；报告需标来源，不能把补齐结果算真人式接受率。[回退](../backend/src/skills/simulation-path-evaluate/index.ts#L174)／[自动入口](../backend/src/coordinators/simulation.path-phase.ts#L821) |
| `simulation-learn-turn` | 用可见课堂上下文及旁路认知判决塑造回答，补值有降级线索。功能轨允许继续；效果轨需核对降级、受控错误与自然首答，不能合成一个正确率。[规则](../prompts/core/simulation-learn-turn.yaml#L130)／[归一化](../backend/src/skills/simulation-learn-turn/index.ts#L417) |
| `simulation-epistemic-grounding` | 无答案键的学员侧判决有边界；只强校验 `sampledCorrectness`，缺 `masteryProb` 可默认 0.5。应显式标记补值或拒绝缺关键字段，把按设定强制的判决与学习证据拆开。[默认值](../backend/src/skills/simulation-epistemic-grounding/index.ts#L62)／[校验](../backend/src/skills/simulation-epistemic-grounding/index.ts#L171) |
| `simulation-memory-curate` | **P2**：提示词要求每项掌握配迁移证据；代码只限制显式 `kind='none'`，漏给证据仍可保留高信心。模型合法返回空数组也会被自评 fallback 补回。区分「模型结论无新增」和「调用失败」，新版缺证据进入待验证，历史兼容须单独标记；用 `[]`、漏证据、明确 `none` 和新情境证据四组用例。[规则](../prompts/core/simulation-memory-curate.yaml#L36)／[归一化](../backend/src/skills/simulation-memory-curate/index.ts#L221) |
| `simulation-referee` | **P1**：分数齐备、证据和发现数组为空时，`evidenceSufficiency` 自报高分仍可得到 `pass`，固定输入已复现。除引用闭合，还应检查必要阶段至少有一条可定位的有效证据；已有可信低分仍纳入。[完整性与结论](../backend/src/skills/simulation-referee/index.ts#L144) |
| `simulation-actor-audit` | **P1**：独立评角色的边界正确，但同样可在空证据时输出 `credible`，固定输入已复现。应检查引用命中真实输入字段、必要角色观测存在，不把旁路模型的自报充分度当门禁本身。[完整性](../backend/src/skills/simulation-actor-audit/index.ts#L120) |

**两处评估链取数问题，也不能用提示词纠正：**

1. **P1 阶段覆盖失真。** `blackbox-runner` 写入时已经首尾压缩 publicTrace，而 `buildSharedAuditTrace` 对它再压缩之前才计算阶段覆盖，仍标为 `full-trace`。长跑只出现于被裁中段的 `path` 可消失。写入时原子累计每阶段计数/首次及最后一次证据；旧数据只能用保留窗口计算并标明。黑盒适配器也把 `isCompleted` 直接映射为 `path`，而真实 Goal 会话可以 `answer_only/no_path` 且无绑定；应用 `terminalKind` 和绑定判断阶段，实际阻断不能反推案例事前预期。[写侧](../backend/src/virtual-lab/blackbox-runner.ts#L1337)／[评审取数](../backend/src/virtual-lab/blackbox-runner.ts#L2779)／[适配器](../backend/src/virtual-lab/platform-user-adapter.ts#L176)。
2. **P2 批次分组。** Campaign 报告检查的是单案例内每个 Skill 仅有一个配置，不保证一批不同案例的配置相同；分阶段样本总数没有按指纹分组。建议按阶段锁定平台模型＋提示词哈希/变体、角色配置和裁判配置，按组出分母，不能拿两组的结果算同一基线。三组固定样本：同配置跨案例、案例间换版本、案例内换版本。[资格](../backend/scripts/report-user-campaign.mjs#L398)／[汇总](../backend/scripts/report-user-campaign.mjs#L453)。

## 平台共用提示词（不归属五个业务 Agent）

`semantic-freeze-judge` 是 Prompt Lab 发布门，不是学习效果裁判；异常进人工。现有校验只要求 verdict 枚举，`{ verdict: 'equivalent' }` 可放行而无判据说明，建议作为 P2 发布可审计性补上输出契约；确定性编译与文本差异检查仍是基础。`skill-author`、`skill-compiler` 有 core/产物，但管理入口已撤，当前按预留能力记录，不纳入业务主链效果分母。[发布门](../backend/src/services/prompt-lab/semantic-freeze-judge.ts#L103)／[归属登记](../prompts/skills.yaml#L782)。

## 修复及验证顺序

1. 先修改变真实状态或判分的三处：目标不可判定、画像非法掌握观测、终检/留存坏题。用固定坏输出验证无法建错路径、写错观测或发不可答题。同步对齐合法边界：用户明确换可验目标、合法 `not` 负证据、正常单选/多选。
2. 修评估证据：完整阶段计数、终态与预期分离、裁判无证据不得下结论、配置分组。照旧保留失败、低分和缺数据样本的功能诊断，不把低分作为除名标准。
3. 在隔离环境校验四条基线与实际请求哈希，固定同一批案例和角色跑功能回归。稳定后再做同案例、同初始画像、同模型/Prompt 配置的效果对照；只输出已覆盖阶段的样本量、缺失原因和证据。路径/课堂可复用冻结考卷；目标、画像、复习各补专用固定夹具。延迟保持模拟不冒充真实学员留存。
