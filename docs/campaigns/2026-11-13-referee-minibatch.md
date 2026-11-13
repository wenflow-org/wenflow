# Referee Mini-Batch 病历单（2026-11-13）

> 目标：按「跑 Case → 评审挖问题 → 优化 → 换下一个 Case」的闭环，先做第 1 步——**批量跑黑盒会话、攒 referee 结构化病历单，当轮不改任何 YAML/提示词**；然后再按「≥2 次或 critical」做 Step 2 的代码工单。
>
> 分支：`feat/unattended-20case-sim`（不合并 develop）。

## 一、为什么不是直接复用前 20 例

Referee 在 `virtual-lab/blackbox-runner.ts` 有硬门禁：

- `experiment.mode === 'blackbox-api'`；
- 会话必须是 `completed / abandoned / failed` 终态。

前 20 例走的是 assisted 会话（harness 自己驱动 goal/advance-day），没有 `publicTrace`，裁判无法出报告。绕开这个门禁等于改产品语义，所以 mini-batch 改走平台正式的黑盒链路：

```
建虚拟学习者（手写故事）
  → POST /api/admin/virtual-learners/:id/start-blackbox-session
  → POST /api/admin/virtual-learners/sessions/:id/autopilot/start { target: final }
  → 轮询到终态
  → POST /api/admin/session-audits/sessions/:id/evaluations
       ├─ platform = referee（verdict/scores/findings/recommendations/evidence）
       └─ actor    = actor-auditor（角色保真/摩擦校准）
```

跑数器：`backend/scripts/run-referee-minibatch.mjs`

- 共享一次管理员登录，避免并发登录互踢；
- 每个 case 落 `state.json`（会话/autopilot 时间线）与 `result.json`（裁判原文）；
- autopilot 可恢复退出时自动重启续跑（最多 3 次）；超时才 stop + abandon 收口；
- `--max-tasks=N` 采样收口（Step 1 是诊断，不是完成率）；
- 汇总只把「≥2 个 case 命中」或 `critical` 的 finding 列为 actionable；
- 额外从后端日志按 sessionId 统计裁判看不到的运行时事实（epistemic 降级 / LLM 失败 / Path 等待超时）；
- **code 归一化**：裁判同一现象会输出多种 code，先归一再聚类（见第五节）。

## 二、试点：u17（HTTP 缓存与并发，明确不写代码）

- Goal 4 轮收敛，路径 **3 阶段 / 12 课**，教学 12/12 课完成，会话 `completed`；
- referee：`verdict=pass_with_concerns`，overall 87；Goal 88 / Path 84 / Teaching 90 / control 87 / boundary 90 / evidence 86；
- 4 条 finding：路径生成承诺 10-60 秒实际 18 分钟（major）、`qps→path` 等内部记号泄漏（minor）、教师引用不可证的「板上/图上」（minor）、裁判输入截断 22 条（info）。

试点同时暴露两个运行时缺陷：

1. **黑盒 autopilot Path 等待上限 10 分钟 < 真实生成时长**（实测 13-20 分钟），会话永久停在 path；
2. **黑盒每个教学回合的 epistemic-grounding 都被路由冻结校验打回**：
   `API route provider changed: expected skill:virtual-learner-learn-turn-simulator, received skill:virtual-learner-epistemic-grounding`。

## 三、7 例 mini-batch 结果（并发 3，每例采样 3 课）

| case | 领域 | 终态 | verdict | overall | 主要 finding |
| --- | --- | --- | --- | --- | --- |
| u01-labor-contract | 法律 | abandoned（采样） | pass_with_concerns | 82 | 路径生成延迟、范围从五类收到三类、Meno 闸通过 |
| u04-financial-statements | 财务 | failed | fail | 80 | 教学中途被顶掉（critical）、路径生成停顿、容量提示滞后 |
| u07-paper-abstract | 学术阅读 | abandoned（采样） | pass_with_concerns | 77 | 路径延迟、第三节 20 轮不收敛、任务主题从英文摘要漂到中文期刊指南、板/图不可证 |
| u13-keynote-speech | 表达 | failed | fail | 83 | 延伸课被合成用户权限 403 顶成 BLACKBOX_STEP_FAILED（critical）、路径生成 20 分钟、Goal 代定主张 |
| u17-http-cache-concurrency | 概念 | completed | pass_with_concerns | 87 | 路径延迟、内部记号泄漏、板/图不可证、轨迹截断 |
| u19-vague-communication | 模糊目标 | abandoned（采样） | pass_with_concerns | 85 | 路径延迟、任务生成停顿、goalCompleted 提前置位、Goal 重构质量高 |
| u20-vague-econ-news | 模糊目标 | abandoned（采样） | pass_with_concerns | 84 | 路径延迟、control 阶段跳变、任务完成回执滞后、Goal 范围收窄好 |

**结论：7/7 生成路径；Goal 理解与 Teaching 本体质量普遍高（Meno 闸全过）；问题集中在「等待/状态机/收口」，不是「会不会教」。**

## 四、跨样本聚类（≥2 次或 critical）

| 聚类 | 次数 | 严重度 | 证据 |
| --- | --- | --- | --- |
| `PATH_GENERATION_LATENCY` | 7/7（8 条 finding） | major | 承诺 10-60 秒，实际 96 秒 - 20 分钟；路径 active 后阶段任务还要再等 5 分半；期间 only `abandon`，无进度/ETA |
| `CONTROL_STAGE_MISMATCH_GOAL_COMPLETED` | 2/2（u19/u20） | major | Goal 刚说「开始排」就把 `platformStage=completed`、`goalCompleted=true`，随后又回到 `generating` |
| `CONTROL_TERMINAL_FAILURE` | 2/2（u04/u13） | **critical** | u04：step 超时后同 key 重试撞上已推进的课堂 revision（「课堂已在其他页面更新」）；u13：延伸课端点未登记合成用户白名单（「合成用户不允许访问该接口」） |
| `TEACHING_BOARD_UNVERIFIABLE` | 2/2（u07/u17） | minor | 教师反复引用「板上左栏」「看图上那一格」，publicTrace 里没有任何板/图内容 |

**单样本 watchlist（本轮不修，避免过拟合）**：`GOAL_SCOPE_DRIFT`（u01 五类→三类）、`SESSION_NEVER_TERMINATES`（u07 收尾循环 20 轮）、`TASK_TOPIC_DRIFT`（u07 英文摘要→中文期刊指南）、`TEACHING_NOTATION_LEAK`（u17 `qps→path`）、`CONTROL_TASK_COMPLETION_LAG`（u20）、`TRACE_TRUNCATED`（u13）、`GOAL_ACCEPTS_LEARNER_DELEGATION`（u13）。

**采样伪问题（已排除，不当平台缺陷）**：`SAMPLING_ABANDONED_MID_TASK`（3 例）、`METRICS_INCOMPLETE`（3 例）——都是 `--max-tasks=3` 主动 abandon 的必然结果。

## 五、关键元发现：裁判的「稳定 code」并不稳定

同一个「路径生成慢」在 7 个 case 里输出了 8 种写法：
`PATH_GENERATION_LATENCY` / `path_generation_latency` / `path_generation_stall` /
`PATH_GENERATION_STALL_LONG` / `PATH_GENERATION_STALL` / `PATH_GENERATION_LONG_STALL` /
`path_generation_exceeds_promise` / `PATH_TASK_GENERATION_STALL`。

按原文聚类会把 7/7 的共性问题拆成 7 个单例，直接违反「≥2 次才修」的规则。跑数器已加确定性别名归一（`canonicalFindingCode`），只用于跨样本归因，不改裁判输出。下一轮应考虑：

- 给 referee 的 `code` 加枚举/字典约束，或在裁判后处理层维护 canonical map；
- 把 `info` 与 `positive` finding 从待修池剔除（否则「Meno 闸通过 ×2」会被误判成病灶）。

## 六、运行时证据（裁判看不到，但确定性存在）

| 现象 | 覆盖 | 处理 |
| --- | --- | --- |
| epistemic-grounding 每回合被路由冻结校验打回，降级为 null | 7/7，单例 19-87 次 | **已修**：只有本阶段主模拟器套冻结路由，旁路 skill 走平台正常路由（`simulator-route-policy.ts`） |
| 黑盒 autopilot Path 等待 10 分钟误杀 | u17 | **已修**：`AUTOPILOT_PATH_WAIT_LIMIT_MS` 默认 45 分钟，env 可覆盖 |
| step 超时后同 key 重试撞已推进的课堂 revision | u04 | **未修**（高风险，需对账语义改造） |
| 延伸课端点未进合成用户白名单 | u13 | **已修**：`extension-session` 登记 `teaching:write` |

## 七、Step 2 已落地的代码工单（未动 YAML）

1. **path 生成承诺与真实时延对齐**（7/7）：
   - `goal-conversation.exit.ts` / `goal-conversation-rejudge.ts`：10-60 秒 → 5-20 分钟；
   - `path-views.queries.ts`：生成中/阶段任务生成中的提示补「可以先忙别的，稍后回来」；
   - 单测 36 条通过。
2. **control 阶段归一**（2/2）：
   - `platform-user-adapter.ts`：`platformStage` 不再透传 `core.stage`/`path.status`，统一为 `goal/path/teaching/completed/error`；
   - 新增回归断言，消除 `completed → generating` 跳变。
3. **认知判决路由**（7/7 runtime）：
   - 新增 `simulator-route-policy.ts`；只有 goal-dialogue / learn-turn 主模拟器套冻结路由；
   - 新增 4 条单测。
4. **延伸课合成用户权限**（u13 critical）：
   - `synthetic-projection.middleware.ts` 登记 `POST /api/ai-teaching/tasks/:id/extension-session`；
   - 单测通过。

### 单例真机验证（u01，2 课采样）

修复后重跑 u01（新会话 `e3fb1ccf…`）：

- `认知判决失败` 日志计数：**36 → 0**；
- `platformStage` 序列：`goal → path → teaching → completed`，不再出现 `completed → generating` 跳变；
- 路径生成文案已变为「通常需要 5-20 分钟…可以先忙别的」，实际 5.5 分钟就绪；
- referee：`verdict=pass`，overall 86，controlConsistency **90**（修复前 72/87）；
- 剩余 minor：5.5 分钟等待仍无进度条、第 2 个里程碑未达、紧迫场景下拒绝代写但没给「最小可用话术」台阶。

## 八、课堂级独立评审（classroom-quality-judge）

### 为什么 referee 不够

Referee 只看 publicTrace：板书/图文载荷、逐轮脚手架、收束产出这些**课堂内部证据**它拿不到，
「教师引用板上左栏」因此只能报成不可证的 minor。课堂需要自己的独立 LLM 评审面。

### 基建（已落地，门禁全绿）

- 技能：`skill:classroom-quality-judge`（handler-only，照 goal-confirm-adjudicator 成例）
  - `prompts/core/classroom-quality-judge.yaml` + manifest + skills.yaml + AGENT_MANIFEST；
  - handler `backend/src/skills/classroom-quality-judge/index.ts`（callPrompt + 输出归一：证据 index 越界剔除、finding 必须挂有效 evidence、无板书面时 boardConsistency 强制 null）；
  - `prompts:compile-all` / `prompts:sync` 落 DB；`prompts:skills:check`、`prompts:yaml:check`、`prompts:lint`、`prompts:core:check`、`prompts:fields-sync:check` 全绿；handler 单测 4 条。
- 跑数器：`backend/src/scripts/judge-minibatch-classrooms.ts`
  - 逐课抽 `teaching_session_messages`（含学习者真实可见的 figures 附件）+ `teachingState.sessionArtifacts.board` 白板快照 + `teaching_sessions.wrapup`；
  - 断点续跑、`--force` 重评；code 归一聚类与 referee 同规则（≥2 例或 critical 才进修复，info 不进池）。

### 证据源教训（自我纠错记录）

首评把消息 `payload.analysis.board` 当板书源——它恒为 null，于是 32 课全部误报 BOARD_DANGLING_TRACE。
真实落库位置：任务级白板在 `teachingState.sessionArtifacts.board`（BoardState，**只存最终 revision**），
逐轮 figures 附件只在白板重渲染的轮次出现。喂真实快照后 `--force` 重评 32 课，结论才站得住：
**白板 revision 历史不随消息落库，教师「板上左栏第 N 行」类指认在证据面不可回放**——
这是 referee「板/图不可证」的真实根因，从 minor 升级为轨迹面产品缺陷。

### 32 课结果（约 3.5 分钟评完，单课 ~15s）

7 例黑盒批次共 32 节课，`verdict`：pass_with_concerns 29 / inconclusive 3（采样中断的 1-3 轮课）/ fail 0（单课层面无一 fail）。

| 课堂聚类 | 覆盖 | 严重度 | 事实 |
| --- | --- | --- | --- |
| `BOARD_DANGLING_TRACE` | 7/7 | major×18 | 白板历史版本不落库；教师逐轮指认「左栏第 N 行」在证据面不可回放 |
| `ASSESSMENT_REPEAT_RECALL` | 7/7 | minor×24 | 检查点以复述为主（同轮已给结论，学习者只需回忆标签），迁移型不足 |
| `CLOSURE_MISSING` | 7/7 | major×4 | 收束缺「带走的判断/下一步动作」；部分为采样 abandon 伪问题（已标注） |
| `BOARD_MISMATCH` | 6/7 | major×10 | figure 标题在轮次间漂移；「左右栏」结构与载荷对不上 |
| `NOTATION_LEAK` | 6/7 | minor×17 | 「80% 那条相对线」「双线」等记号未当场用场景语言解释（referee 单例 → 跨样本确认） |
| `SCAFFOLD_LATE` | 4/7 | minor×8 | 学习者连续念错时平台重复「再核一眼」而不先给可定位的对照物 |
| `OPENING_PRIOR_ASSUMPTION` | 2/7 | minor×4 | 开场假定上节已练顺，先复述上节结论而非锚定本课材料 |

### 与 referee 病历单的互证

- referee 的 `TEACHING_BOARD_UNVERIFIABLE`（u07/u17 minor）→ 课堂评审定位根因为白板历史不落库，且覆盖升到 7/7；
- referee 的 `internal_notation_leaked_to_learner`（u17 单例）→ 课堂层确认 6/7，升入修复池；
- referee 看不到的「同构复述检查点」「脚手架降阶慢」「收束缺下一步」都是课堂层新发现。

## 九、修复批 2（2026-11-13 当轮闭环：发现 → 修复 → 真机验证）

### 9.1 step 超时对账（u04 critical，代码面）

`autopilot.service.ts` 的 `blackboxAdvance`：超时类失败不再直接同 key 重打——先
`refreshBlackboxObservation` 对账，控制面指纹（teachingRevision/taskId/completedTasks）有变化
即「副作用已生效」，按已应用收口；无变化才同 key 重试。单测 +1（对账生效不重打、无进展同 key 续跑两条路径都覆盖）。

### 9.2 白板 revision 历史落库（课堂层 7/7 根因，代码面）

- `teaching-turn-engine.ts`：`sessionArtifacts.boardHistory` 按 revision 变更追加快照
  （学习者可见面 maskedSpec，上限 40 版）；assistant 消息新增 `boardState` 指针
  （revision/kind/focusId/conceal），放全部板面变更之后写入。
- `TeachingSessionRepository`：`TeachingSessionMessage.boardState` 字段（只增证据，不改前端行为）。
- 课堂评审跑数器消费：教师轮定位顺序 = 本轮 figures 附件 → boardState 指针 → boardHistory 回放；
  另加图型无关的 spec 文本抽取（split-compare/concept-map 的条目不在行列标签里）。

### 9.3 真机 A/B 验证（u01 黑盒样本三轮）

| 样本 | 证据面 | 正课板书 findings |
| --- | --- | --- |
| validation2（boardHistory+快照，无逐轮指针） | 非重渲染轮不可回放 | 1 课仍有 `board_dangling_trace` + `board_state_inconsistent` |
| validation3（+boardState 指针，rev1 split-compare conceal=takeaway） | 指针+历史全通 | 摘要器只有标题时仍 1 major 悬空 |
| validation3 重评（+图型无关 spec 文本抽取） | 板面内容完整可定位 | 板书 findings 降为 1 条 `board_minor_gap`（minor） |

**`BOARD_DANGLING_TRACE` 在新链路上消失**；referee「板/图不可证」的根因已修。

### 9.4 修复批 2 后的课堂跨样本聚类（32 课重评）

| 聚类 | 修复批 1 时 | 修复批 2 后 | 解读 |
| --- | --- | --- | --- |
| `BOARD_DANGLING_TRACE` | 7/7（major×18） | 5/7（major×1，minor×11） | 旧课无 boardHistory 的证据缺口如实保留；新链路已解决 |
| `BOARD_MISMATCH` | 7/7（major×4+minor×22） | 7/7（major×13+minor×18） | 板书设计/指认问题真实存在，不因证据修复而消失——下一步真靶子 |
| `NOTATION_LEAK` | 6/7 | **7/7**（minor×18） | 覆盖升满 |
| `ASSESSMENT_REPEAT_RECALL` | 7/7 | 7/7（minor×26） | 复述型检查点，提示词面待修 |
| `CLOSURE_MISSING` | 7/7 | 7/7（major×6+minor×8） | 剔除采样伪问题后仍普遍 |
| `SCAFFOLD_LATE` | 6/7 | 3/7 | 部分为证据面误报，随重评收敛 |
| `OPENING_PRIOR_ASSUMPTION` | 2/7 | 2/7 | 维持 |

## 十、修复批 3（2026-11-13 当轮：收尾不终止 + 提示词三件 + 收敛重评）

### 10.1 收尾循环打断（u07 major，代码面）

- 根因取证：u07 循环课 teachingState——`completionDeferrals=2`（同题延迟到顶）、阶段已 `ready_to_close`，
  但老师连续 4+ 轮重发近同构收尾话术，完成信号不再落地；既有「低增量重复护栏」只 warn 不打断。
- 修复：`closureRepeatStreak` 跨回合继承（teachingState 持久化）；循环信号 = 老师连续
  「显式收尾话术 / 模型自报完成候选 / **与上一轮低增量重复**」且学员无新问题；
  连续 ≥3 轮且知识面已冻结、无 pending 检查点 → 绕过软条件强制放行完成信号，
  并落 `closureLoopBreakReleased`——收束入口（evaluateSessionClosable）同源认账，
  避免「引擎放完成、confirm 409」僵局（#164 两门禁同源纪律）。
- 锚点样本回归发现复述循环未必带「到这儿收」类收尾词 → 循环信号并入
  `assessAdjacentRepetition` 低增量判据（b22060fb）。单测 39/39 绿。

### 10.2 提示词三件（只改不增，497b5c37，门禁全绿）

| 改动 | 落点（既有规则内收紧） |
| --- | --- |
| 检查点迁移默认 | rule 243「依口径≠考原话」段：迁移是检查点默认形态；已文本作答/板上已给结论的材料同样算已贴标签 |
| 记号即陌生词 | rule 98「真名锚定」反向：引入符号/缩写/工程记号必须当场用场景语言解释，否则 Meno 闸按积木未给 |
| 收束两件套 | rule 234「主动提议收尾」：收口必须「一句带得走的判断口径 + 一个具体下一步」，禁止客套/复述充数 |

`prompts:compile-all` / `prompts:sync` 落 DB；lint（33/33）、core:check、fields-sync、skills:check（F1~F12）全绿。

### 10.3 收敛重评（5 例 × 2 课 = 14 节，全部修复生效后首轮回归）

referee 面：**5/5 pass_with_concerns、零 critical**；u04 中途爆死消失（CTRL_ABANDON_CLEAN）；
u07 式 `session_never_terminates` 消失；跑数器 abandon 409→同 key 重试→200 自愈按预期工作。

课堂层对照（基线 = 修复批 2 后 32 课重评）：

| 聚类 | 基线（32 课） | 重评（14 课） | 判定 |
| --- | --- | --- | --- |
| `BOARD_DANGLING_TRACE` | 5/7（major×1） | 2/5（minor×4） | 证据缺口已收敛；残余为「该课确实无板书附件」的如实 minor |
| `BOARD_MISMATCH` | 7/7（major×13） | 5/5（major×3，minor×7） | severity 大幅下降但覆盖仍在——**下一个真靶子** |
| `NOTATION_LEAK` | 7/7 | 4/5（minor×5） | 覆盖下降，全 minor |
| `CLOSURE_MISSING` | 7/7（major×6） | 3/5（major×2） | 下降 |
| `ASSESSMENT_REPEAT_RECALL` | 7/7 | 5/5（minor×9，+no_transfer×2） | 全 minor 但覆盖未降——出题时机 emitCheckpoint 在编排层，M1 只收紧了内容自检，需要编排面配合 |
| `SCAFFOLD_LATE` | 3/7 | 5/5（minor×8） | 维持（评审粒度更细后显性化） |
| 新增单例 | — | `board_stale_after_rev4`、`board_pointer_mismatch`、`closure_repeat_verbatim` | 白板历史/指针新证据面暴露的新形态，单例先观察 |

**结论：方向性收敛成立**——critical 清零、major 从 13 降到 3、悬空消除、收尾循环与中途爆死消失；
`ASSESSMENT_REPEAT_RECALL` 与 `BOARD_MISMATCH` 是下一轮的两个真靶子（编排面出题时机 / 板书指认校验）。

## 十一、下一轮优先级

1. **检查点出题时机编排面**（课堂层 5/5 minor）：`emitCheckpoint` 由编排层按可复算条件决定——把「上一问是复述」纳入出题门槛（代码面）。
2. **板书指认一致性**（课堂层 5/5，major×3）：figures/白板快照与教师口头指认的栏位结构对不上——板书设计/指认校验。
3. **Goal 范围裁剪**（u01 minor）：五类风险被收成三类，需在 Goal 确认时显式说明「本次不覆盖哪几类」。
4. **任务主题漂移**（u07 minor）：生成任务与路径里程碑/原始目标做一致性校验。
5. **路径生成等待体验**（referee 面 5/5 major 持续）：进度反馈与 ETA（文案已诚实化，交互面仍无进度条）。
