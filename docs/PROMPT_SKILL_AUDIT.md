# Prompt / Skill 结构审计台账

审计口径：规则重复、规则互相矛盾、把个案写进 prompt、fields 承载算法、prose 状态机、与运行时代码契约不一致。
结论分三类：**重构**（已改）、**收敛**（删除/合并了内容）、**通过**（逐条阅读后判定无需改结构，不代表已重写）。

## goal

| Skill | 结论 | 依据 |
|---|---|---|
| goal-conversation | 重构 | 进入态规则去重；控制规则由三条 prose 状态机收敛为「授权/信息不足直接推进」「话已说完就收口」两条；`understanding`/`confirmedProposal` 的 fields 从 12.5k 压到约 5.5k 字符，时间模型/阶段数/`scope_size` 口径上移为规则；消解「决定性维度采集门 vs 收敛节奏」「起步 ≤2 阶段 vs 小目标 2-5 阶段」两处冲突；意图分型由单条 2800 字符拆为 mastery / research / exam / problem-fix·troubleshooting·career / interest / multi-goal / 域适配 / 深度优先 / 范围收口 九条 |
| goal-confirm-adjudicator | 通过 | 确认/拒绝语义边界一致，未新增枚举状态机；仅保留通用语义示例 |

## path

| Skill | 结论 | 依据 |
|---|---|---|
| path-planning | 重构 | 合并重复的纯文本约束；合并 `targetMilestones` 两套数量口径并保留测试依赖的标题；其余里程碑/预算规则逐条核对无冲突 |
| path-task-design | 重构 | 合并重复的「真实场景锚 / 真实场景与判断锚」（统一为每阶段 1–2 个）；合并文本执行、单任务时长、验收判据三组重叠规则；删除「某阶段 6 节同题」等个案叙事 |
| path-kc-mapping | 重构 | 合并「可复用能力 / 不是任务步骤」两条重叠规则；KC 拆分、命名、prerequisite 知识依赖、provenance 边界一致 |
| path-material-collect | 通过 | `status` / `cite` / `sourceUrl` / `provenance` 四层约束与 fields 一致，`not_found` 口径无分叉 |
| path-material-brief | 通过 | 三个输出字段与 9 条规则一一对应，无重复或悬空引用 |
| path-reviewer | 重构 | 澄清 Pertinence 对 beginner 路径名的判定方向：使用「入门/基础」是缺陷，不是适配 |

## profile

| Skill | 结论 | 依据 |
|---|---|---|
| profile-adaptive-copy | 收敛 | 清理历史 bug 叙述与审计编号；view 分支与字段口径本身无冲突 |
| profile-state-review | 收敛 | 清理历史 bug 叙述；证据/可证伪断言/零证据分支一致 |
| profile-progress-report | 通过 | 3 条规则只约束输出边界，无重复 |
| profile-learning-predict | 通过 | 7 字段枚举与证据要求一致 |
| profile-lesson-enrich | 通过 | 6 个输出面与「不越权计算身份键/熟悉度」边界一致 |
| profile-concept-consolidate | 通过 | 「宁可漏并」与 aliasMap/canonicalWhitelist 先验的关系已写清，不构成矛盾 |
| profile-concept-load | 通过 | 粒度/难度只按名字语义判断，输入输出一一对应 |

## teaching

| Skill | 结论 | 依据 |
|---|---|---|
| teaching-turn | 收敛 | 合并「到期复习点」与「课内温故」重复规则；删除个案实证；完成判定与掌握证据的分工保持一致 |
| teaching-opening | 重构 | `question` 与 `quickReplies` 一处写互斥、一处写可共存，统一为互斥；自评场景明确要求 quickReplies 留空 |
| teaching-wrapup | 收敛 | 规则本身逐条一致；清理审计编号与 fields 中的历史注记 |
| teaching-peer-reinforcement | 收敛 | 「对齐老师节奏」两条按不同触发条件分工，保留；清掉审计编号 |
| teaching-classroom-judge | 通过 | 归因纪律、Meno 闸、脚手架、板书一致、记号泄露、收束/检查点各自独立 |
| teaching-replan-attribution | 收敛 | 清理历史 payload 叙述；归因码/建议白名单/可证伪断言边界一致 |

## simulation

| Skill | 结论 | 依据 |
|---|---|---|
| simulation-goal-dialogue | 重构 | 离场/告别 5 条规则收敛为 2 条：拍板确认、像真人一样离场；拍板轮 `shouldEnd` 口径并入拍板规则 |
| simulation-path-evaluate | 通过 | `accept/modify/reject` 只进 debug，主链只输出自然语言 reaction，与 fields 一致 |
| simulation-persona-designer | 重构 | 合并「不要默认白领」与「candidatePersonas 为空」两条身份分布规则；样本配比与学生模式规则保留 |
| simulation-scenario-designer | 重构 | 6 条来源/角色/样本分布规则合并为「来源与角色分布」「样本配比与分布」两条 |
| simulation-learn-turn | 收敛 | 清理个案实证；阶段行为、完成自评、remainingBlockers 边界一致 |
| simulation-referee | 通过 | R1 豁免、R2/R4 扣分、abandoned 不产 wrapup 的证据规则互不冲突 |
| simulation-memory-curate | 重构 | 去掉「真实 payload 中字段几乎不存在」的补丁式说明；把「嘴硬但没真会」改为「完成 ≠ 掌握」 |
| simulation-actor-audit | 通过 | 画像/故事/披露/摩擦/私有状态五类审计基准清晰，无重复 |
| simulation-epistemic-grounding | 重构 | 合并 masteryProb 0.40-0.55 的两处重复表述，阈值只在字段定义处保留；画像先验 × 教师支架双轴判决一致 |

## 元技能

| Skill | 结论 | 依据 |
|---|---|---|
| semantic-freeze-judge | 通过 | 四个语义面对账规则完整，增删/弱化判定边界清晰 |
| skill-author | 通过 | 只约束输出形态，无结构问题 |
| skill-compiler | 通过 | 生成→解析→必填字段核对三步，无重复 |

## 验证

- `npm --prefix backend run prompts:compile-all`：exit 0
- `npm --prefix backend run prompts:sync-core`：exit 0
- `npm --prefix backend run prompts:check:all`：exit 0
- `npm --prefix backend run typecheck`：exit 0
- 定向 Jest：prompt 契约 36 项、goal/path/teaching 相关 194 项，全部通过
- 5 个 goal 方向 case：x01–x04 exploratory 均 2 阶段 / ≤2h；x05 focused 控制例 2 阶段；全通过
