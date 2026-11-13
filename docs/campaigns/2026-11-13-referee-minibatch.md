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

## 十二、修复批 4（2026-11-13 当轮：出题时机编排面 + 换例重绘守门）

承接 §十一 的前两个靶子，全部代码面（不动 YAML），条数守恒不适用。

### 12.1 检查点出题时机：连续复述问门槛（代码面）

**病历单**：`ASSESSMENT_REPEAT_RECALL` 5/5 课全中（minor×9）。代表形态：教师第 6 轮直接给出
「这就是你要的那处无法指认」并收口要求压缩成追问、第 8 轮对学习者追问直接判「可以直接发」——
两轮都是对刚给出口径的复述确认，未让学习者把口径用到未被贴标签的新情形。批 3 的 rule 243
（提示词面）只收紧了「内容自检」，出题时机在编排层，需要可复算的代码门槛。

**可复算口径**（纯函数 `isCheckpointAnswerAlreadyGiven`，teaching-checkpoint.ts）：检查点的
答案键——选择题正确选项文本、简答题要点词——归一后在**教师已说过的内容**（历史回复 + 本轮回复）
里逐字出现 → 该题问的是已贴标签材料，答对只证明记住了口径、不证明会迁移。要点词/选项文本
<8 个归一字符不参与（教学必然提过的术语会把一切简答误判成复述；逐字结论才是复述确认的指纹）。
无答案键 → 判不了，返回 false 不误杀。

**编排层门槛**（teaching-turn-engine.ts，与同题复问抑制同构）：

- 「上一问已复述」（checkpointHistory 最后一行非 voided 且带 `answerAlreadyGiven:true`）
  且「本问又复述」→ 连续复述，本回合抑制出题 + 遥测（`suppress-consecutive-recall-checkpoint`）。
- **只拦连击**：单次复述仍放行（提示词 rule 243 已定迁移为默认形态，代码只断连击）。
- 放行的复述题在 pendingCheckpoint 打 `answerAlreadyGiven:true` 标记，提交/跳过后随行落
  checkpointHistory——下一题的「上一问是否复述型」由此读数（stripCheckpointAnswerKeys 只删
  答案键，布尔标记原样保留，不下发也不泄键）。
- **锚题豁免**：延迟保持率复测本就是重测已教概念，按设计是复述——锚题轮不参与判定也不打标
  （无标记的历史行天然当不了「上一问复述」）。
- **抑制自愈**：抑制只跳过落库，不写 `lastCheckpointConcept`、不进 history、不改回复——
  焦点下回合可重试换迁移新情形；模型若坚持复述，就持续不出卡（复述卡本无评估价值），课堂照常。
- **就地换题面重算**：答错补救的换题面路径按新题面/新答案键重算标记，旧标记失真即剥掉，
  保证「上一问复述」读数可复算。

**测试**：`checkpoint-recall-gate.test.ts` 12 例——纯函数 5（选项命中/干扰项不误判/要点词长短/
无键不判/迁移新情形）+ 引擎 7（连击抑制+遥测/首犯放行打标/上一复述本迁移放行/voided 不算
上一问/锚题豁免/发射→作答落 history→下一题连击三段全链真值/换题面重算剥旧标记）。
邻域回归：checkpoint 6 套件 80 例 + session-closure-gate 全绿。

### 12.2 板书指认一致性：换例重绘守门（代码面）

**病历单**：`BOARD_MISMATCH` 5/5 课（major×3）。三个 major 的共同链路：

1. **u04（财务）**：教师提到板上还没有的「60 万」→ 换数信号触发 `designBoard` 重绘 →
   右栏从 rev2「付出货款 0 元/成本是存货，非本期付现」翻成「购买商品支付现金 60 万/1 月已付货款」
   ——与教师开场口述（1 月发货、2 月底收款）自相矛盾，教师再照新板讲，整课口径翻车。
2. **u17（缓存）**：rev2 丢掉情形三行、rev3 整体换列，教师仍在引用「三种来路」矩阵结构。
3. **u07（摘要）**：教师口头强调的核心区分（相关≠因果）板上无一承载——板书设计与教学脱节
   （设计面问题，本批不强行代码化，先观察）。

**根因**：`decideBoardIntent` 的换例信号最弱一档——`fresh.length`（老师提到板上还没有的数字）
即判换例。但「老师讲到例子里还没上板的数」是**同例深挖**的正常形态，拿它当换题信号会让绘图员
把同一例子的板重绘成编造的变体。

**可复算门槛**（纯函数 `shouldSkipExampleRefresh`，board-intent.ts）：

- `BoardIntent` 新增 `changeSignal` 字段记录信号来源档位：`scene`（换液体/换物体）>
  `hypothetical`（反事实）> `variant-words`（明说换成/改成/拿掉）> `variant-numbers`
  （只是新数字）> `none`。前四档是显式信号，一律放行重绘——老师明说要换，重绘是他要的动作。
- 只对最弱的 `variant-numbers` 做二次确认：老师本句回复仍在引用旧板内容（maskedSpec 的
  label/sub/head/title 等内容字段文本，归一后 ≥2 字的片段，**≥2 个不同片段**逐字命中本句）
  → 老师在深挖同一例子，不是换例 → 本轮抑制重绘、保持旧板 + 遥测
  （`skip-example-refresh-stale-overlap`）。
- 双片段门槛防误伤：单一词面重叠（如顺口提到「成本是存货」）不拦；真正的换例句式通常带
  换词/场景词，走显式档位本来就不拦。

**测试**：`board-intent.test.ts` 追加 7 例——changeSignal 五档分型 2 + 守门 5（两处命中抑制/
新例子放行/单处命中放行/显式换词一律放行/空回复不判）。全部 8 个 board 套件 99 例全绿。

### 12.3 真机重评批 A（仅修复批 4a 上机）：`reeval2-2026-11-13`，5 例 × --max-tasks=2

**referee 面**：4/5 pass_with_concerns + u04 critical 1 例——`TEACHING_TERMINAL_FAILURE`，教学
第 12 轮「处理消息失败」爆死。**根因是 LLM 供应商故障，不是代码回归**：日志实锤 teaching-turn
97s 超时（stream watchdog idle 60s），同分钟窗口 stage-designer 也 RETRY_BUDGET_EXHAUSTED、
learning-predictor 超时——供应商侧全面变慢；裁判自己也判「属于平台侧失败而非学习者表现问题」。
u04 因此整案 inconclusive（24 课基数少 1 课）。`PATH_GENERATION_LATENCY` major×4 持续（§十三队列）。

**课堂层对照**（13 课，其中 4 课为 1-3 轮采样残课）：

| 聚类 | 批 3 重评（14 课） | 批 A（13 课） | 判定 |
| --- | --- | --- | --- |
| `ASSESSMENT_REPEAT_RECALL` | 5/5（minor×9） | **5/5（minor×8）** | **未收敛**，归因见下 |
| `BOARD_MISMATCH` | 5/5（major×3） | 4/5（major×3） | u01 退出聚类；major 未动（4b 未上机，批 B 验证） |
| `CLOSURE_MISSING` | 3/5（major×2） | 5/5（major×6） | 恶化——u04 爆死课无 wrapup（基础设施误伤）+ 收束内容达标线从严，批 B 复核 |
| `SCAFFOLD_LATE` | 5/5 | 5/5 | 维持 |
| `BOARD_LEGEND_UNRENDERED` | — | 2（minor×2） | **证据管线伪影**，已修（见 12.4） |

**ASSESSMENT_REPEAT_RECALL 未收敛的归因（DB 实证）**：批 A 13 课的正式检查点卡为 **0 张**
（teaching_sessions 全查：0 条 checkpointHistory、仅 1 个未答完的 pending）——单焦点守门员 +
2 课采样下，正式出题路径几乎从不触发。病历单证据 100% 挂 `content`（对话轮）：「第②③条差别
被连续复述式追问」是对话问设计形态，emitCheckpoint 编排门槛**触达不了**。4a 按指令落地且
全绿（编排面复述卡从此有可复算连击门槛），但该聚类的有效杠杆在**提示词面**：rule 243 对
对话问设计的触达需要按条数守恒再收紧一轮（编排层已无可用确定性信号——对话问没有答案键，
复述分类器算不了）。

### 12.4 证据管线修正：legend 摘要 `[object Object]` 伪影

批 A 新聚类的 `BOARD_LEGEND_UNRENDERED ×2`（「图例渲染为 [object Object]」）经 DB 实证是
**判定脚本伪影**：真实载荷 legend 是 `{text, fill}` 对象数组（`✓ 符合`/`— 不符合`），前端渲染无恙；
judge-minibatch-classrooms.ts 的 digest 只认 `.label`，把对象 String 成 `[object Object]`，
制造了「学习者看不到图例」的假 finding。已修为 `label ?? text ?? 字符串` 三级回退，
批 B 起按修正后的证据面评审。

### 12.5 批 B（4b 上机）：`reeval3-2026-11-13`，同 5 例 × --max-tasks=2

**referee 面（历史最佳）**：u04/u07/u17/u19 **pass** + u01 pass_with_concerns，**actionable 聚类
为零**——所有 finding 均单样本噪音，连持续 5/5 的 `PATH_GENERATION_LATENCY` 本轮也未聚上
（u17 裁判调用遇瞬时 fetch failed，`--resume` 补裁 pass）。运行时证据：epistemic 降级 0/5、
Path 等待超时 0/5、LLM 执行失败仅 u01 一次（未致断课）。

**课堂层对照**（14 课，4 课为 1-3 轮采样残课 inconclusive；逐课 verdict：2 pass + 8 pass_with_concerns）：

| 聚类 | 批 3 重评 | 批 A（仅 4a） | 批 B（4a+4b） | 判定 |
| --- | --- | --- | --- | --- |
| `BOARD_MISMATCH` | 5/5（major×3） | 4/5（major×3） | **3/5（minor×5，major×1）** | **收敛**：u04 现金口径翻车消失；残余 major×1 是教师指认行位错（「右栏第 1 行」引的是左栏内容），属指认精度非板面翻车 |
| `ASSESSMENT_REPEAT_RECALL` | 5/5（minor×9） | 5/5（minor×8） | **2/5（minor×2）** | 覆盖减半，但 4a 在批 A 已上机且零触达——减半**归因不明**（样本方差或板面稳定带来的二阶效应），对话层病灶解释不变，继续观察 |
| `CLOSURE_MISSING` | 3/5（major×2） | 5/5（major×6，含 u04 爆死误伤） | 4/5（minor×5，major×1） | 水位持平略降；真实残余是「收束缺自检口径」（怎样算标对了），批 B 的 critical×1 是 `transcript_too_thin` 采样伪影（已从聚类剔除，见 12.4） |
| `BOARD_LEGEND_UNRENDERED` | — | 2（伪影） | 0 | 摘要修复生效 |
| `NOTATION_LEAK` / `SCAFFOLD_LATE` | 4/5、5/5（全 minor） | 3/5、5/5 | 4/5、4/5（全 minor） | 维持 |
| 新增 | — | `OPENING_ASSUME_EXPERIENCE` | 2（minor×2） | 开场引用上一课「共同记忆」但本课无据可查——单例级先观察 |

**4b 真机首杀（u01 竞业课，恰是批 A `board_pointer_mismatch` 病灶同款场景）**：教师逐项过
「离职后2年内/不得去同行业公司」（同例深挖），换数信号（fresh numbers）想重绘板面，
守门拦截保持旧板 + 遥测 `skip-example-refresh-stale-overlap`（hits：离职后2年内/不得去同行业公司）。

**方向性结论**：板书翻车类 major 清零（3→1，且残余是另一种形态）、裁判面 actionable 清零、
u04 中途爆死未复现（批 A 的爆死是供应商故障）。修复批 4 收口。

### 12.6 下一轮队列（按批 B 证据重排）

1. **ASSESSMENT 对话面提示词**：批 B 2/5（minor×2）——rule 243 的对话问设计触达按条数守恒
   收紧一轮；编排层无确定性信号可用（对话问无答案键），这是该聚类剩余的唯一杠杆。
2. **板书指认精度**（major×1）：教师口头指认行位/栏位与快照错位（「右栏第 1 行」实为左栏内容）
   ——figures 指认校验或板面行命名统一，待 ≥2 例再动。
3. **供应商抖动健壮性**：批 A u04 因 teaching-turn 97s 超时整案爆死——教学回合对
   provider_timeout 加有界重试/续话，把基础设施抖动从「整课终局」降级为「可恢复停顿」。
4. **收束自检口径**（4/5 minor~major）：收束两件套（判断口径+下一步）已有，补第三件
   「怎样算做对了」的自检口径——rule 234 同条内收紧。
5. **路径等待交互**（referee 单例化但仍是每个 case 的等待体验）：进度反馈/ETA。

## 十三、修复批 5（2026-11-13 当轮：供应商超时健壮性 + rule 243 对话问触达）

承接 §12.6 队列第 1、3 项。5a 代码面（三层），5b 提示词面（条数守恒）。

### 13.1 供应商超时健壮性（5a，批 A u04 critical 的直接根因）

**三层叠加的死亡链**（日志逐层取证）：

1. **网关层**：`willRetry = retryable && attempt < maxAttempts && !streamStarted` —— 流式请求
   一旦流开始，传输层不再重试；watchdog 中途掐断（u04：teaching-turn 97s，idle 60s）= 一击毙命。
2. **callPrompt 层**：gateway 抛错时 catch 直接 `throw`——传输失败不在 prompt 层重试
   （只有校验失败走 `continue`）。
3. **路由掩码**：`resolveTeachingError` 对 status>=500 把 message 换成泛化兜底「处理消息失败」
   ——瞬态信号（timed out）丢失，**只有 error.code（ATTEMPT_TIMEOUT）幸存**；适配器抛出的
   PlatformAdapterError 既无 retryable 字段、message 也无瞬态词 → `isRecoverableExecutionFailure`
   误判不可恢复 → `persistUnexpectedFailure` → 整场实验 terminalReason=failed。

**三层修复**：

| 层 | 改动 | 语义 |
| --- | --- | --- |
| prompt-composer | `retryStrategy.transportMaxRetries`（缺省 0 = 行为不变；上限 2） | 对网关标记 retryable 且非 caller_abort 的传输错误，在逻辑预算（maxAttempts）之外整请求重试 N 次（退避 1.5s×次数）；同时给两处校验 `continue` 加 `attempt < maxAttempts` 闸——校验重试不越逻辑预算（否则会漏进传输轮次） |
| platform-user-adapter | `PlatformAdapterError.retryable` | 按 `payload.error.code ∈ TRANSIENT_TRANSPORT_CODES` 或 status>=500 判定——message 被掩码后 code 是唯一幸存信号 |
| autopilot.service | blackboxAdvance 瞬态判定补 `asErrorLike(error).retryable === true` | 适配器错误带标志后，step 级重试 + 控制面对账（批 3 机制）接管，实验保持 running |

**开启范围**：teaching-turn 与 virtual-learner-learn-turn-simulator 各 `transportMaxRetries: 1`
（1 次重试 + 退避最坏再加 ~100s，仍在教学回合 300s 墙钟预算内）。其余 skill 缺省 0，行为不变。

**测试**：prompt-composer 5 例（重试后成功/缺省不重试/caller_abort 不重试/预算到顶终局/
校验重试不越逻辑预算）+ PlatformAdapterError 4 例（ATTEMPT_TIMEOUT/404/缺 code 的 5xx/
RETRY_BUDGET_EXHAUSTED）。

### 13.2 rule 243 对话问设计触达（5b，ASSESSMENT_REPEAT_RECALL 剩余唯一杠杆）

**病历单**：批 B `ASSESSMENT_REPEAT_RECALL` 2/5（minor×2）——「从 index 23 到 26，教师让学习者
反复重说『这段跟我的实际情况对不上』这句措辞，一轮改口、一轮确认、一轮再确认」。编排层已无
确定性信号可用（对话问没有答案键，复述分类器算不了——§12.3 归因），提示词面是剩余杠杆。

**条数守恒改动**（rule 243 单条原位收紧，规则条数 126=126）：

- 适用面从「检查点」扩到「**检查点与 check 轮对话提问**」——正文里的口语问句同样受迁移
  默认形态约束（批 B 病灶全是对话问，不认自己是检查点）；
- 点名反模式：**「让学生反复重说同一句结论（原话→改口→再确认）也是复述，不是迁移**——
  同一句判断口径确认过一次就不要再让学生换措辞重说第二遍」；下一问要么给未贴标签新情形
  （另一条款/另一段/另一组数据）让学生自己动手用口径判，要么推进到下一步。

**门禁**：compile-all（33 文件）→ prompts:sync（skill:teaching-turn synced-from-code）→
`prompts:check:all` 13 项子门禁全绿 → core:check hash 对齐 → lint 33/33。

### 13.3 批 C 双评重评（5a+5b 上机）：`reeval4-2026-11-13`

**语料结构变化（先读这个）**：u04 本轮 autopilot 跑得更远，单例贡献 7 课（全批 19 课 vs 批 B 14 课）
——跨批对照时，u04 的课程级特点会放大成跨样本聚类，量级对比要打折。

**referee 面**：actionable **0 类**（连续第二批）；u19 pass、u07/u17 pass_with_concerns。
4b 换例守门批内再中 2 次（两批累计 4 次）；5a 传输重试 0 命中（本轮供应商健康，安全网待命）。

**课堂层对照**（19 课，4 残课 inconclusive；逐课 verdict：3 pass + 12 pass_with_concerns）：

| 聚类 | 批 B | 批 C | 判定 |
| --- | --- | --- | --- |
| `ASSESSMENT_REPEAT_RECALL` | 2/5（minor×2） | 2/5（minor×1，**major×1**） | **未收敛**——rule 243 对话面收紧没有移动覆盖；且裁判口径出现软化（代表 detail 自己承认「作为降低记忆负荷的脚手架有效」），属边界性教学姿态而非明确缺陷。音量已低（19 课 2 处），继续动提示词收益递减，转观察 |
| `CLOSURE_MISSING` | 4/5（minor×5，major×1） | 5/5（minor×4，**major×8**） | **新形态主导**：`WRAPUP_MASTERY_OVERCLAIM`（收束把「工时判断混过档」的学习者标成 mastered/100）——收束产出高估掌握，与新三件套无关，是 wrapup 侧新靶子 |
| `OPENING_ASSUME_EXPERIENCE` | 2（minor×2） | **5/5（minor×11，major×1）** | **爆量**：开场断言「上节课已把 X 逐句标过三档」但本课无据可查——每课开场都在引用不可核验的共同记忆。修复批 4 队列里是单例，现在正式成簇 |
| `BOARD_MISMATCH` | 3/5（minor×5，major×1） | 3/5（minor×2，**major×6**） | major 上升，代表形态是**板面设计完整性**（rev3 只摊两笔业务教师却说四笔）——不是换例翻车（4b 管住的），是板面行数没跟上教学内容，与批 4 u07 型同源 |
| `BOARD_DANGLING_TRACE` | 2（minor×2） | 2（**major×3**） | 指认不存在的边/格（载荷存在、指认错位）——指认精度类，维持 ≥2 待修 |
| `NOTATION_LEAK` | 4/5 | 2（minor×3） | 维持低位 |

### 13.4 修复批 5 结论与下一轮队列（§14）

**5a 判定**：健壮性安全网就位（三层信号链打通 + 有界重试），本轮供应商健康未触发——无反证，
保留。**5b 判定**：rule 243 收紧后该聚类未移动（2/5→2/5），且裁判自己开始把部分复述确认
认定为有效脚手架——音量低 + 口径软化，提示词继续加压收益递减；转观察，不再迭代该条。

**新靶子（按批 C 证据排优先级）**：

1. **收束 mastery 高估**（major×8，最大簇）：wrapup 把有混档证据的学习者标 mastered/100
   ——wrapup 产出与 learningEvaluation 自评不同源，需要一致性约束（代码可复算：收束标
   mastered 的点在课内是否有 check 失败/纠错记录）。
2. **开场假定上节课经历**（5/5，minor×11）：开场引用「上节课我们…」但本课证据面无法核验
   ——开场生成侧要求条件式表述（「如果上周试过…」）或锚定本课材料。
3. **板面行数没跟上教学**（major×6）：教师在口头展开 N 项，板面 rev 只呈现 M<N 项——
   板书设计完整性（designBoard 的行覆盖 vs 教师展开度），编排层可复算（spec 行数 vs reply 枚举数）。
4. 指认精度（不存在的边/格，major×3）：与 3 同属板书链，一并观察。
5. ASSESSMENT_REPEAT_RECALL：转观察（低音量 + 裁判口径软化）。
