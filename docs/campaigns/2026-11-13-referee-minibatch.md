# Referee Mini-Batch 病历单（2026-11-13）

> 目标：按「跑 Case → 评审挖问题 → 优化 → 换下一个 Case」的闭环，先做第 1 步——**批量跑黑盒会话、攒 referee 结构化病历单，当轮不改任何 YAML/提示词**；然后再按「≥2 次或 critical」做 Step 2 的代码工单。
>
> 分支：`feat/unattended-20case-sim`（不合并 develop）。
>
> **常设约束（用户裁决，2026-11-15，优先级最高）**：授课+评审链路的 `deepseek-v4.1-flash` 是**教学基准模型**——即使 ds 出现严重故障/完全不可用，**也不得切换到其他模型**；基准变了会严重影响教学质量与全部水位对照。正确处置=如实报告故障、等待恢复（fail-closed，不降级、不替换、不临时顶替）。学员扮演族 7 skill（agnes-3.0-flash）不在本约束内；flip-model-config.cjs 的任何 flip/rollback 操作严禁把授课+评审 skill 移出 ds。「模型权衡三选一」就此永久关闭。
>
> **⚠️ 修订记录（2026-11-16 试验 → 2026-11-17 终止）**：用户曾指令「教学模型换成 gpt-6-luna 看看」——授课链路 19 skill 切 luna（评审锚 ds 不变），reeval35 判定质量 PASS（judge 0 critical/三族持平/内容真值族未复现），代价=延迟 3 倍；步进预算调宽 300s→600s 后 reeval36 达 **5/5 零失败**。**2026-11-17 用户指令「先切回 ds，暂时不跑了」——已回滚（19 行 luna→deepseek-v4.1-flash），配置恢复 11-15 拆分形态（ds×20/agnes×7/null×5），后端已重启；原 11-15 常设约束恢复全效。** 回滚方式：定向 UPDATE / 备份 `model-config-backup-2026-11-16T14-04-53.json`。

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

## 十四、修复批 6（2026-11-13 当轮：收束 mastery 与课内负证据一致性）

承接 §13.4 第 1 项：WRAPUP_MASTERY_OVERCLAIM（major×8，全战役最大簇）。

### 14.1 病历单与既有闸的缺口

代表形态：收束把「核对基本条款一致性」标 **mastered/100**，同一收束的 learningEvaluation 却
承认学习者工时判断一度混档、要教师纠正。wrapup 链已有两道防高估闸，但都拦不住它：

1. **证据回链闸**（#52 ④）：只验 evidence 能否回链到学员原话——「说过但被纠过错」照样过闸；
2. **终态措辞闸**（#52 ③）：只看点自身 evidence/reason 里的相悖措辞——矛盾在点外
   （learningEvaluation 文、课内客观记录）时不可见。

### 14.2 可复算负证据降档（代码面）

**纯函数** `downgradeMasteredOnNegativeEvidence`（session-wrapup skill，与 ④ 同纪律）：

- 概念归一匹配 checkpointHistory（conceptName/conceptKey）——存在未通过/跳过行（voided 不算）
  **且其后没有更晚的 passed=true 行** → 反面成立；先失败后通过 = 掌握成立不降；通过后又答错 = 反面成立；
- misconception 概念名单命中 → 反面成立；
- 概念无任何匹配行 → 判不了，不动（证据不足不惩罚学生）；
- 降档形态与 ④ 一致：mastered → learning、progress 封顶 79，打 `negativeEvidenceDowngraded` 标记。

**接线**（teaching-session-lifecycle，wrapupResult/artifact 解析后、持久化前）：对 result.summary
与 artifact.summary 同步应用；artifact.progress 桶同步搬移（被降档点移出 newlyMastered/
unchangedMastered → stillLearning）；打遥测 `downgrade-mastered-on-negative-evidence`。

**测试**：negative-evidence.test.ts 6 例（未通过无后继通过降档 / 先败后过不降 / 败在过后降 /
voided 不算+无行不判 / 误解名单命中 / learning 不参与+无历史原样）。wrapup 全套件 46 例绿。

### 14.3 批 D 双评重评：`reeval5-2026-11-13`（15 课）

**referee 面**：actionable 1 类——`PATH_GENERATION_LATENCY` ×4 **全 minor**（历史首次降出 major 档）。

**课堂层对照**：

| 聚类 | 批 C | 批 D | 判定 |
| --- | --- | --- | --- |
| `WRAPUP_MASTERY_OVERCLAIM` | 5/5（major×8） | **0（簇消失）** | 收束把 mastery 高估的形态本轮未出现。**归因保留**：降档闸 0 命中（15 课 checkpointHistory 仍为 0——正式检查点在本语料不触发），簇消失无法归因于本修复，方差可能性大；误解台账接线在批 D **之后**才补上，活验证顺延到下一轮 |
| `OPENING_ASSUME_EXPERIENCE` | 5/5（minor×11） | 5/5（minor×6，major×2） | 维持（未修，纯观测符合预期） |
| `BOARD_MISMATCH` | 3/5（major×6） | 4/5（**critical×2**，major×2） | **新 critical 形态**：板书把学习者已纠错的答案固化回最终板面（教师 index 4 明确纠正试用期上限为 2 个月，rev4 自 index 10 起一直写学习者 index 3 的错版「上限 1 个月」到课终）——板书 rev 采纳/滞留学员未纠正错误，与换例误触发（4b 已管）不同源 |
| `ASSESSMENT_REPEAT_RECALL` | 2/5（minor+major） | 2/5（minor×2） | 维持低位；代表形态转为「对同一**指令**的复述确认」而非知识复述 |
| `CLOSURE_MISSING` | 5/5（major×8） | 5/5（major×5） | 主力是残课 wrapup 缺失（采样属性）；`closure_overclaim`（收束标 complete 但目标产出从未被正确完成）为单例待观察 |

**14.3a 降档闸 0 命中的归因与本批补强**：批 D 15 课 **0 课有 checkpointHistory**（再次实证正式
检查点在本语料不完成闭环），而病历单的反面证据在**对话纠错**里——已补接误解台账：
lifecycle 收束时查 `misconception_ledger`（`lastSessionId` 锚定本课、`status != 'addressed'`），
conceptKey 与收束点名归一匹配（真实台账多为可读中文名，cpt_hash 形态匹配不到属 fail-soft）。
批 D 会话实测有活例（「提炼业务价值结论」suspected/confirmed），下一轮验证闸的实战命中。

**新 critical 靶子（§14 队列首项）**：板书固化学员已纠错误——教师口头纠正后板面 rev 不刷新，
学员错版一直挂到课终且正落在本课核心边界点上。确定性杠杆难（纠正语义在对话里），
候选方向：designBoard 刷新指令带「不得保留学员已被纠正的错误表述」+ 纠正轮次的刷新触发信号。

## 十五、修复批 7（2026-11-13 当轮：板书固化学员已纠错误 critical×2）

承接 §14 队列首项。

### 15.1 病历单与取证

**病历单**（批 D u01 badf3f77 课，critical）：教师 index 4 明确纠正试用期档位（一年整 →
「一年以上不满三年」档、上限 2 个月），rev4 自 index 10 起一直写学员 index 3 的错版
「上限一个月，正好到顶」到课终——错误正落在本课核心边界点上。

**DB 实证链**（teaching_session_messages 逐轮）：

1. **纠正轮带可复算信号**：turn 4 的 `analysis.misconceptions` 明确记录
   `{"conceptKey":"核对试用期限档位","hypothesis":"学生误以为一年整的合同落在『三个月以上不满一年』
   这一档，试用期上限按一个月算"}`——确定性触发源存在；
2. **纠正轮未刷新**：rev 停在 2（常规意图 exampleChange='none' 不触发刷新）；
3. **后续刷新盲重建**：designBoard 不收当前板面（只有 kindHint），rev3/rev4 从 studentSays/
   回复引语里把学员错版又抄回板上——刷新指令从未被告知「有错要清」。

### 15.2 确定性双杠杆（代码面）

| 杠杆 | 实现 | 语义 |
| --- | --- | --- |
| 纠正语境持久化 | `teachingState.lastCorrectionNotes`（board-intent 新纯函数 mergeCorrectionNotes：cap 5、按假设去重、带 turn 定位） | 误解假设跨轮可用——纠正当轮与后续任何刷新轮都能带着它 |
| 清除禁令（L1） | `buildCorrectionDirective`（含假设原文：设计器据此知道**哪句话**不得再现）追加到**所有**刷新指令 | 换例刷新轮与纠正刷新轮都不得保留学员错版 |
| 纠正刷新槽位（L2） | 误解轮且常规意图未刷新 → `else if` 确定性触发 designBoard 强制重绘（BoardOp 新 reason `'correction'`）+ 遥测日志 | 纠正当轮板面立即跟上口径（badf3f77 的 turn 4 在此机制下会刷新）；4b 换例守门不适用——纠正不是换数，信号更强 |

### 15.3 批 E 双评重评：`reeval6-2026-11-13`（15 课）

**两道闸门首次实战命中（本批最重要结果）**：

1. **L2 纠正刷新槽位 ×2**（u07 课）：误解轮强制重绘按预期开火，`notes` 带出纠正假设
   （识别追问中的提问焦点/分配追问时注意力）；
2. **误解台账降档闸 ×3**（修复批 6 补强的首次活验证）：三节不同课的 wrapup mastered 声明
   被课内误解记录驳回降档（区分三张表回答的问题/识别单方调薪授权/改写细节为答法）——
   「说过但被纠过错」不再一路绿灯。

**课堂层对照**：

| 聚类 | 批 D | 批 E | 判定 |
| --- | --- | --- | --- |
| `BOARD_MISMATCH` | 4/5（**critical×2**，major×2） | 3/5（major×2，**critical 0**） | **板书固化学员错版 critical 清零**（批 D 病历单形态未再现）；残余 major 为同课前后 rev 对「理由范围」表述漂移（指认精度类，维持观察） |
| `WRAPUP_MASTERY_OVERCLAIM` | 0 | 0（且降档闸 3 次实战拦截） | 连续两批未现——批 6 的负证据降档从「方差」转为「闸已实战拦截」的正向证据 |
| `CLOSURE_MISSING` | 5/5（major×5） | 5/5（major×6） | 主力仍是残课 wrapup 缺失（采样属性）；closure_repetition/loop 为真残余 |
| `OPENING_ASSUME_EXPERIENCE` | 5/5（minor×6） | 4/5（minor×4，major×2） | 维持（未修，纯观测符合预期）——下一轮队列候选 |
| `ASSESSMENT_REPEAT_RECALL` | 2/5（minor×2） | 2/5（**major×2**） | 维持低位但批内唯一一例升 major（师生交替复述同一结论的回声环）；观察 |
| `MENO_GATE_VIOLATION`（新） | — | 2（major×3） | 开场自认薄弱后未给低门槛入口——单例级先观察 |
| `BOARD_DANGLING_TRACE` | 2（major×3） | 2（major×2） | 无板课程口头指认「下面四句」——指认纪律，维持观察 |

**referee 面**：actionable 0 类（连续第三批）。u19 裁判调用被上游内容安全 422 拒
（评估管线脆弱性，非课堂缺陷；其课堂课仍被判定）。

**修复批 7 结论**：板书固化 critical 清零 + 两闸门实战命中，负证据一致性链
（误解报告 → 台账 → 收束降档 / 板书纠正刷新）全链贯通。

## 十六、修复批 8（2026-11-14 当轮：开场「上一课经历」接地守卫）

承接 §15.3 队列：OPENING_ASSUME_EXPERIENCE（4/5，minor×4 major×2，最大未修簇）。

### 16.1 病历单与取证

**病历单形态**：开场断言上一课经历——「上一课你把竞业限制和违约金那五处逐条判完了」
「上一阶段那三把尺子已经走稳了」「上一课在万向钱潮上算出…3.62 亿」「你说过要的是……」——
本课证据面无法核验这些先修经历。

**取证**：recap 链（teaching-context-recap）已有可验证信号——`lastLessonRecap` 只在真实
完成课（status='completed' + wrapup 非空）存在时由 recap 链装配；mini-batch 的前课多为
abandoned（不满足）→ 开场生成时该输入缺席。断言正是在这个「无据可查」状态下产生的
（taskOrder=2 让模型推断存在前任务并把叙述成已完成）。

### 16.2 确定性接地守卫（代码面）

- **判定器** `hasUnverifiablePriorClaim`（纯函数，message+question 双扫描）：
  `/(上一[节节课次阶段]|上次[的课学习]?|你说过|你之前[提讲]过)/`；
- **接线**（generateOpening）：`!context.lastLessonRecap && 判定命中` → 携带接地约束
  （「本课没有任何可核验的上一课记录。不得断言…；如需衔接改用条件式表述（如果你之前
  接触过…），或直接锚定本课材料开场」）**重生成一次**——重生成结果始终采用（带指令的
  即便仍违例也优于原版），打遥测 `regenerate-opening-prior-claim-grounded`；
- **fail-open**：重生成失败保留原开场，绝不阻塞开课。recap 存在（真有上一课）时守卫
  完全不参与——引用真实 recap 内容合法。

**测试**：opening-prior-claim-grounding.test.ts 4 例（病历单形态全命中/条件式不误伤/
锚定本课不误伤/message+question 双扫描）。

### 16.3 批 F 双评重评：`reeval7-2026-11-14`（10 课判定，u04 路径生成瞬态失败未开课）

**接地守卫实战命中 ×1**（`regenerate-opening-prior-claim-grounded`）——但簇未收敛：

| 聚类 | 批 E | 批 F | 判定 |
| --- | --- | --- | --- |
| `OPENING_ASSUME_EXPERIENCE` | 4/5（minor×4，major×2） | **4/5（minor×4，major×2）** | **未收敛**，归因有二：①判定器标记太窄（代表形态「期限那句的起算点和两年上限**你已经量稳了**」不带任何 prior 标记词；「上一环节」也不在标记集）——词面标记是打地鼠；②提示词 rule 57 是**条件式**条款——只管「输入提供 lastLessonRecap 时」，缺席分支完全静默，模型在无据可查时自由断言 |
| `CLOSURE_MISSING` | 5/5（major×6） | 4/5（major×5） | 残课属性维持 |
| 新 critical | — | `PHANTOM_TRANSFER_MATERIAL` ×1（u07） | 教师声称「下面三句来自一篇你没读过的摘要」但从未呈现，学员在无材料下编造答案、教师还表扬「判得准」——**对话中段材料悬空**（开场有材料护栏，课中无） |

**第二刀（同批内迭代，双杠杆）**：

1. **提示词 rule 57 原位收紧**（条数守恒 36=36，13 项门禁全绿）：补上**缺席分支**——输入未提供
   lastLessonRecap 时同样不得断言上一课/上次/上一环节/上一阶段的经历成果或掌握状态（点名
   「你已经量稳了」型），衔接用条件式或锚定本课材料；
2. **判定器补「上一环节」**标记。

u04 fail（路径生成瞬态状态翻转）为平台侧：管线日志全部成功（planning→reviewer→stage-designer×2），
状态机在后续环节翻转——归入路径健壮性队列既有项，与批 8 无关（开课从未开始）。

### 16.4 批 G 双评重评：`reeval8-2026-11-14`（15 课）——**收敛**

| 聚类 | 批 F | 批 G | 判定 |
| --- | --- | --- | --- |
| `OPENING_ASSUME_EXPERIENCE` | 4/5（minor×4，major×2） | **×1 单例（major×1，不进 actionable）** | **收敛**——4/5 聚类解体。双杠杆分工生效：批 G 重生成 0 次 = rule 57 缺席分支让**首次生成就合规**（提示词前置纪律），代码判定器退居保险丝。剩余散形单例（OPENING_PRIOR_REFERENCE minor / OPENING_UNVERIFIED_PRIOR major / MATERIAL_NOT_ANCHORED major 各 1）存档观察 |
| `PHANTOM_TRANSFER_MATERIAL` | critical×1 | **0（未复现）** | 单次形态，方差保留观察 |
| `CLOSURE_MISSING` | 4/5（major×5） | 4/4（critical×1→实为 1 轮残课伪影，major×3） | critical 是 1 轮残课的结构性必然——判据改为**按 turnCount<3 整课剔除**（比枚举伪影 code 更根本）；真残余 wrapup_truncated/stale_evaluation 维持 |
| `BOARD_MISMATCH` | — | ×1（major×1） | 维持低位 |
| `BOARD_DANGLING_TRACE` | 2（major×2） | 2（major×1，minor×1） | 维持观察 |

**修复批 8 结论**：开场假定性簇 4/5 → 收敛（连续三轮在册的最后一支大簇解体）。两轮迭代的
教训归档：词面判定器是打地鼠（「你已经量稳了」无任何标记词），提示词缺席分支才是正路；
代码判定器退居保险丝。全战役 8 批闭环完成，referee/课堂双面无 critical 真缺陷。

## 十七、修复批 9（2026-11-14 当轮：观察项决策归档 + 残课伪影剔除验证）

### 17.1 对话中段材料悬空（PHANTOM_TRANSFER_MATERIAL critical×1）：正式降级为观察项

**取证与决策依据**（四条，归档备查）：

1. **频次**：全部六批 ~90+ 课中仅 1 例（批 F u07）；批 G 15 课零复现。
2. **无结构化材料源**：开场护栏（ensureOpeningMaterialGrounding）成立的前提是材料本体在
   taskDescription 里有编号行可提取补挂；课中被承诺的材料（「下面三句来自一篇你没读过的摘要」）
   没有任何结构化源可对——确定性闸只能做标记词正则，而「跨轮兑现承诺」是合法教学形态，
   误杀风险高（同例：教师说「下面我们看三步」下一轮逐步给，是正常节奏）。
3. **提示词纪律已在**：teaching-turn rule 49 明文「资料里没有的内容不要编造（不确定就说
   不确定）」——违规属模型行为漂移，不是规则缺口。
4. **下游已被批 6 机制兜住**：该形态的最大危害（无据作答被表扬 → mastery 虚高）在收束侧
   被负证据降档闸核对（误解/失败记录命中即降档）——编造问答不再能兑现任意 mastery 标记。

**触发器（tripwire）**：未来任一批次该形态 ≥2 例复现 → 重新升级，用开场护栏的 cue/line
正则做**同轮承诺-兑现核对**（reply 含「下面/以下 N 句」时 reply 必须实际含 ≥N 条编号/引号
材料行，缺则按 D10 先例剥离该承诺句）。

### 17.2 closure 真残余与指认精度：按水位决策

- `closure_repetition/loop`、`wrapup_truncated/stale_evaluation`：全 minor 量级、跨批稳定
  低水位 → **维持观察**（wrapup 侧已有两道降档闸兜 mastery 面；文案重复属打磨级）。
- 指认精度（BOARD_DANGLING/缺边缺格，major×1-2 跨批稳定低水位）：词面指认与板面实体的
  对齐是 NLP 判定，确定性闸误杀风险同 17.1 第 2 条 → **维持观察**（4b/7 的纠正刷新与
  盲重建禁令已把「错版固化」这一最重形态清零，残余是轻度指认漂移）。

### 17.3 批 H 双评验证：`reeval9-2026-11-14`（15 课）

**验证点结果**：①closure critical 残课伪影 ✅ 被 turnCount<3 剔除，不再进聚类（批 G 的
伪影 critical 未再现）；②OPENING_ASSUME / PHANTOM / MASTERY_OVERCLAIM ✅ 全部维持收敛
（各自 0-1 例散形，无成簇）；③❌ **一个新 critical 出现**——见 17.4。

其余水位：referee 面 actionable 1 类（PATH_GENERATION_LATENCY ×4 major×1 minor×3，队列
既有项）；CLOSURE_MISSING 4/5（wrapup 缺失为主，残课剔除后真残余 wrapup_truncated/
stale_evaluation 维持 minor）；BOARD_DANGLING ×2 维持观察。

### 17.4 新 critical：认可式算术错误（ARITHMETIC_ANSWER_MISMATCH ×1，u04 fail）

**病历单**：本课算例 500+200−900−300+100 = −400，板书 rev1 正确给出 −400；第 9 轮学习者称
「应付加回 100 后累计是 −280」，第 10 轮教师直接认可「−280 对了」——口头结论与板上 −400
及正确算术双重矛盾，学习者被锚定在错误答案上。

**取证**：课中算式自检闸**已存在**（内容正确性第一刀：`findArithmeticMismatches` 逐轮复算
回复 → 修复重调一次）。漏网原因：**认可式错误无算式形态**——「应付加回 100 后累计是 −280」
没有 `a+b−c=d` 结构可复算，错在与板书已算出的 −400 的**交叉引用**上（检查器是单文本的，
板书数字在另一载荷里）。

**下一轮队列首项（候选杠杆，按优先级）**：

1. **认可-数字与板面交叉核对**：回复含认可语（「对了/正确/没错」）+ 新数字，而该数字不在
   当前板面/本链已算出的数字集合中且与板数同链（同为「累计」语境）→ 判定认可矛盾。
   确定性风险：教师合法引入新中间数会被误杀——需要限定「累计/合计」等链尾语境词。
2. **板链数字权威复用**：把板书已算出的链尾数字（如 −400）作为该链的权威值缓存，后续认可
   语 + 冲突数字即触发修正重调（复用第一刀的 repairInstruction 机制，KV 缓存便宜）。
3. tripwire：频次观察（本轮 1 例）；若连续两批复现则第 2 项升级为强制实现。

## 十八、批 I tripwire 观测（2026-11-14 当轮：认可式算术错误复现判定 → 未复现归档）

### 18.1 判定：未复现 → 按观察项归档（杠杆不实现，tripwire 保留）

**双评面证据**（`reeval10-2026-11-14`，5 例 × --max-tasks=2）：referee 面 0 条算术 code
（actionable 仅 PATH_GENERATION_LATENCY ×3）；classroom 面 15 课生成、9 课进聚类，5 类
actionable 聚类中无一算术（`grep -ci "ARITHMETIC\|arithmetic" classroom-report.md` = 0）。

**归档决策依据（三条）**：

1. **频次水位未达触发线**：批 H（reeval9）1 例 → 批 I（reeval10）双评面 0 例。「连续两批
   复现」的 tripwire 判据未满足；单批 1 例更符合模型数值口误的方差分布，而非系统性缺陷。
2. **检出形态局限如实入档**：课中自检闸 `findArithmeticMismatches` 只抓等式形态；认可式
   （无等式、背书语 + 与板链冲突的数字）需跨载荷交叉引用板书数字，现有守卫结构性覆盖不到
   ——这正是保留 tripwire 而非关闭观测的理由。
3. **无复现证据不预建确定性守卫**：§17.4 杠杆（板链数字权威缓存 + 认可-数字交叉核对，复用
   repairInstruction、链尾语境词门控）的误杀风险（教师合法引入新中间数）在单例水位下大于
   收益。规格已存档于 §17.4，后续任意一批 ARITHMETIC code 再现即升级为强制实现。

### 18.2 批 I 双评水位

- referee 面：PATH_GENERATION_LATENCY ×3（{"minor":1,"major":2}，队列既有项，u01/u07
  路径段 abandoned + u04 两残段与此同源）；其余全为单例 minor。
- classroom 面 actionable 5 类：
  - **CRITERIA_FALSE_GENERALIZATION ×1（critical×1，新簇）**——见 18.3 队列首项。
  - **CLOSURE_MISSING ×2**（{"minor":2,"critical":1,"major":1}；u04
    closure_premature_completion——收束宣布「净额那行也并好了，你扫一眼就知道」但同一
    wrapup 自述「还需要你自己独立走一遍」，完成信号与证据不一致；u07
    closure_scope_incomplete / closure_status_complete_mismatch）。
  - **OPENING_ASSUME_EXPERIENCE ×2**（{"minor":3}）——批 8 修复后水位 4/5（major 为主）
    → 2 课全 minor，收敛趋势确认但未清零；剩余形态是**反向断言**子形态
    （「你之前没细看过这类合同」＝断言学习者没做过某事、「下周一又要签」＝假定日程），
    现有判定器 `hasUnverifiablePriorClaim` 只抓正向断言（你说过/上一课你X了）。
  - ASSESSMENT_REPEAT_RECALL ×2（{"major":1,"minor":1}）——观察项水位持平，维持既有决策。
  - BOARD_MISMATCH ×2（{"minor":1,"major":1}）——已收敛簇残余（major 13→3→1→1 批际水位），
    批 I u04 新形态为「部分方向边缺失被说成四支都标出」，与 §12.2 changeSignal 同域，维持观察。

### 18.3 下一轮队列（按批 I 证据）

1. **CRITERIA_FALSE_GENERALIZATION ×1（critical，u04 fail）**：收束口径「没进新钱的增减，
   一律是占住」与同课第 4 轮示范（应付账款增加＝「钱还没付出去，所以放出 330」）直接矛盾
   ——「一律」型全称概括踩掉课中已示范的反例，学习者套用会得到相反方向。critical 即修纪律
   → 队列首项。取证方向：收束/总结生成器为何能输出与课中示范冲突的全称规则（与批 6 负证据
   降档同域但不同形态：这次是教师口径自相矛盾，非 mastery 高估）；候选杠杆沿第一刀
   repairInstruction 机制加「收束规则 vs 课中反例」一致性维度。
2. CLOSURE_MISSING critical×1（u04 完成信号 vs wrapup 自述不一致）——与第 1 项同课，
   下轮一并取证处理。
3. OPENING_ASSUME 反向断言子形态——tripwire：下批复现成簇则把反向形态（「你之前没X过」）
   纳入 `hasUnverifiablePriorClaim` 判定器（条数守恒改 rule 57）。
4. PATH_GENERATION_LATENCY（referee 面，major×2）——队列既有项，批 I 水位未降
   （abandoned×2 + 残段×2 与之同源），维持排队。
5. 认可式算术 tripwire——继续观测（本节归档），ARITHMETIC code 任一批再现即按 §17.4 规格实现。

## 十九、双子代理交流体验评审（2026-11-14 当轮：教育视角 + 学员体验视角，批 I 9 课）

### 19.1 方法：与机器判官正交的第三方评审

用户纠偏：九轮闭环全在工程正确性面，「顺不顺、好不好用、聊得深不深」这些用户感知最明显的
环节没有被评审过。本轮把批 I 9 课逐轮导出（`export-classroom-md.ts` →
`review-md/*.md`，证据与 judge 同源：teaching_session_messages + 板书 revision 回放 +
wrapup），派**两个独立子代理**盲评（不看机器判官结论，只读对话原文，轮次引用取证）：
①教育视角（提问链/支架节奏/复述 vs 迁移/反馈质量/口径一致性/认知负荷）；
②学员体验视角（下一步清晰度/门槛/噎住点/节奏密度/语气人味/进展感/收束体验）。

### 19.2 双视角共识簇（合并排序 = 修复批 10 队列）

两代理独立评审后在以下模式上**互证**（机器判官未聚类或未覆盖的以 ✚ 标注）：

1. **答案提前暴露（先亮答案再检查）**——✚（机器判官只抓了板书指认不一致，未抓「题走过场」）
   u04 板书轮 2 起就写「净占用现金 830」而教师四轮追问「报净额」（学员体感：答案贴在那儿，
   你让我报什么）；差额方向全被板书预标，「逐项判断」练习量只剩求和一步；u01 轮 4 先说破
   「落在第一档」再提问；u07-d5eff63b 轮 2 替学生定案最难的背景/缺口两句；u17-53af203f
   轮 14 同错误复发处直接给答案。四处检查点因此降级为复述，学习证据链断裂。
   **改法**：出题铁律——凡要求学员「报/判/选」的，答案不得在其视野内（布题轮板书摘除
   答案列/遮蔽）；提问前不出现结论。检测面与批 4 `answerAlreadyGiven` 同域但方向相反
   （那个防重复出题，这个防出题时答案在场）。
2. **掌握标签证据通胀**——✚（批 6 只做了负证据降档，缺正证据不足门）u01 期限/补偿两格
   教师讲授+学员复述过关即判 mastered(88/85)；u04 净额学员从未报出却进 newlyMastered；
   u17-53af203f 轮 16 教师把**自己给的答案**归因为「学员自查改回」并写进 wrapup
   （归因失实=诚实性缺陷）；u17-cbbe10d6 单例首答即 90 分。
   **改法**：wrapup 掌握判定加证据门——mastered 只认学员独立产出（与概念匹配的非复述
   产出）；复述/跟随/教师代做/单例首答一律「待验证」cap。反馈归因：不得把教师产出
   记到学员名下。
3. **收束口径漂移/矛盾 + 重复收束**——u04 轮 18「一律占住」踩轮 4 反例（=机器判官
   critical，双代理同抓）；u07-d5eff63b 收束把语义判据压成关键词清单（与姊妹课专门
   警示的陷阱背向）；重复收束：u01 轮 16/18/20 三连（学员两次「收到/行」仍复读）、
   u07-d5eff63b 两遍、u17-cbbe10d6 两遍、u19 双布置（学员体感：我都答应了课怎么还不散）。
   **改法**：①收束口径发出前对课中已判实例做一致性回归校验（critical 杠杆）；
   ②收束只留一轮（口径一句+下一步一句），学员确认即止；wrapup 已产出后抑制继续
   收束口径输出；③收束不得以新作业指令收尾而不等回应。
4. **材料断裂/悬空指令**——✚u07-fefe1552 摘要截断，学员两轮求补全只得「我这边也没有
   你的原文」困死胡同，末轮「第三篇贴上来」出口即散课（欠两篇无人认领）；u17-53af203f
   轮 10「下面选一个」无选项；u17「默判」产不出可发送内容。**改法**：凡要求「贴/选/报」
   的指令，所引材料必须完整在手——不可得就当场换材料或换任务，不说「我也没有」；
   开放选择必须真给选项。与批 G PHANTOM（引用不存在材料）同域但新形态（材料不完整/
   指令要求物不存在）。
5. **单轮多概念块**（教育×4 课 + 体验「只接住一件剩下的无声蒸发」互证）——u07-fefe1552
   轮 4 三件套学员只交一件且无人追要；u04 轮 14 三个返工+一个总任务学员只修一件又卡住；
   u19-1b87f350 轮 6 两种铺垫+检验法+应用题同轮。漏做后不了了之还教会学员「指令可以
   不认真」。**改法**：一轮只一个动作；引入新概念就不同轮要产出（rule 243 同域，
   条数守恒收紧）。
6. **错误复发时干预降级**——✚u17 b/d 串行轮 5→轮 13 复发，处理从「诊断+令其重判」退到
   「给答案+表扬」；u04 存货差额轮 5 对→轮 13 错只令重算未探因。**改法**：同一概念/
   错形复发应升级干预（批 7 misconception ledger 加复发升级分支：第二次命中 → 探错因/
   让学员自己产出判别，禁止直接给答案）。
7. **代号当对话语言**——✚u01「duty 格/pay 格」要求学员先翻译再思考；u17 a/b/c/d 字母
   配对直接诱发轮 6、轮 14 两次「串行」——卡点全在簿记不在学科。**改法**：对话一律说
   中文名，代号只留板书当索引（提示词规则）。
8. **纠错先扣帽子后收回**——✚u19-1b87f350 轮 8「你把两件事混了」随后给的骨架与学员
   回答同义；u04 轮 8「验证你是不是顺着我说」预设学员糊弄。**改法**：纠错先点对再指偏，
   验证直接给新题不口头交代动机（提示词规则）。

### 19.3 正例锚点（规则写作时引用）

- u07-d5eff63b（体验最顺）：每轮一个焦点问题、夸奖夸到具体的词、学员提「组会前要交」
  当场给速判版——人味与节奏的正面样本。
- u19-567c4159（教育质量最高）：学员的顽固信念不被教师说服，而被自己生成的证据推翻
  （让学员替听众说「然后呢？」）——误解处理的模板形态。
- u01 轮 10 / u17 轮 6 的纠错（先诊断错因→令重走→带回原题补齐）——反馈闭环正面样本。

### 19.4 队列重排（取代 §18.3 顺序）

修复批 10 = **交流体验专项**（用户 2026-11-14 指定优先级）：
①答案提前暴露（含布题轮板书答案遮蔽，检测面可复算）→ ②掌握标签证据门 + 归因诚实
→ ③收束一致性校验 + 单轮收束（吞并 §18.3 第 1、2 项 critical）→ ④材料断裂/悬空指令
自检 → ⑤单轮单动作（rule 243 条数守恒）→ ⑥错误复发升级 → ⑦⑧代号语言/纠错帽子
（提示词规则，随任一批顺带）。§18.3 第 3-5 项（opening 反向 tripwire、PATH_LATENCY、
算术 tripwire）维持不变。

## 二十、修复批 10 + 批 J 验证（2026-11-14 当轮：交流体验专项四杠杆 → 跨批次渐进出队）

### 20.1 修复内容（提交 55f4ffed，全量 jest 7321 通过、prompts 三门禁全绿）

- **D1 答案提前暴露**：布题轮板面/配图文本（`collectTurnBoardFaceText`）并入复述问扫描源，
  答案同屏的检查点自动进批 4 复述链（标记+连击抑制）；板面源单独命中打遥测
  `flag-answer-on-board-face`。不做板面重绘（误伤合法中间数风险 > 单例收益）。
- **D2 掌握证据强度门**：`capMasteredOnInsufficientEvidence` 三闸（全复述行→learning/79；
  零行零证据→learning/79；单例通过→progress 封顶 89），lifecycle 接线+桶同步+遥测。
- **D4 复发升级**：`mergeCorrectionNotes` 同错形命中 hits+1；`buildCorrectionDirective`
  在 hits≥2 时追加「不得直接给答案，先问思路让学员自己产出判别」。
- **提示词 5 处条数守恒原位收紧**：rule 243（答案键不得上板面/配图）、rule 97（出题材料
  完整性并入 Meno 闸）、rule 236（一轮只向学生要一个动作）、rule 234（收束口径同课只说
  一遍 + 全称表述过课内反例）、rule 98（板书代号/字母编号不是对话语言）+ session-wrapup
  （复述跟随不算独立应用 + 归因诚实「教师给的不得记成学员自查」）。

### 20.2 批 J（reeval11）双评 + 双子代理复评：§19 八簇趋势判定

机器面：actionable 5 类 → **2 类**；classroom 12 课、6 pass / 4 inconclusive / 0 fail。
referee 唯一簇 PATH_GENERATION_LATENCY ×3（**升 critical×1**——u04 整例路径生成失败未进课，
批 I 已残段×2、批 J 全挂，连续两批缺课）。

| §19 簇 | 批 J 判定 | 证据 |
|---|---|---|
| ⑤单轮多件事 | **基本收敛** | 两代理均未见「无声蒸发」；轻残留集中在纠错轮密度 |
| ⑧纠错扣帽子 | **已消失** | 全批先接住再拧，零帽子 |
| ⑥复发干预降级 | **已消失**（D4 方向生效或样本方差，无法区分） | 本批无错误复发场景 |
| ⑦代号语言 | **大幅改善** | 裸代号 0；指代普遍带内容原文，残留方位词低害 |
| ③收束漂移/重复收束 | **部分收敛**：critical 双双消失（criteria_false_generalization 0、CLOSURE critical 0）；重复收束降级为轻（4/7 课确认后仍多一拍，但比批 I 短、尾拍带新信息；新变体 ack 后加码） | rule 234 方向生效 |
| ①答案提前暴露 | **部分收敛**：重症（挂板四轮追问报净额）消失；**新变体**「纠错轮内嵌答案集→学生复述→表扬归因」（b515f1a8 轮 16-18，高）+ 温和挂板 2 处 | D1 只覆盖 checkpoint 答案键，正文内嵌不在扫描面 |
| ②掌握标签通胀 | **未收敛（杠杆 0 拦截）** | 见 20.3 |
| ④材料断裂/悬空 | **未收敛（头号残留）**：3/7 课出题不带料；「甩回学员」消失（认错+当场补料）；**升级变体**「盲答判对」（b211a517 轮 8-10：无选项出题→学员盲答→先判「方向对」再补料，评估作废） | rule 97 单轮提示词不够 |

正面新证据：焦虑→话术转化（两批间最明显的体验升级）、修复质量（认错利落当场补）、
「这轮只做一步」节奏（b211a517/d387c47c）。

### 20.3 D2 活性核查（诚实归因）

批 6 负证据闸 ×4 活性命中、④证据回链闸 ×2 命中；**D2 新闸（recall/singlePass/lessonEvidence
三标记）0 命中**。子代理指认的三处通胀（2618c559 双 mastered 95/90、e6511488 零独立证据 90、
u01 教师口径记成学员自查）全部落在闸的匹配盲区：checkpointHistory 行概念名与 knowledgeItems
名称精确归一匹配不上（→ Gate B 退化为「evidence <6 字」门槛，而通胀点的 evidence 都是
长句）；且「学员复述教师口径」在 ④ 回链闸里算「学员说过」（6 字窗口过松）。

### 20.4 修复批 11 队列（按批 J 证据）

1. **PATH_GENERATION critical（u04 连续两批缺课）**——critical 即修升首项：路径生成失败
   根因取证（1 分 52 秒 generating→failed），与批 5 transport 重试的缺口面（非瞬态失败）。
2. **出题附料确定性检测（④ 头号残留 + 盲答判对变体）**：reply 正文含「下面哪个/以下/选一个」
   型选择题形态而本轮无 control.checkpoint options、也无随文材料 → 拦截或强制补料；
   悬空被发现后不得先采认学员答案（先补料再重问）。
3. **④回链闸复述降权（D2 迭代）**：学员回合与紧邻教师上文高重叠（复用批 4 复述判定）时，
   该 6 字回链窗口不计独立产出证据——直接打「教师口径记成学员自查」形态。
4. **纠错轮内嵌答案集（① 新变体）**：rule 245/纠错域提示词收紧——纠错轮只给反例或让学员
   重指落点，不得把候选答案集写进解释后再提问。
5. **板面状态管理（BOARD_MISMATCH major×5 回弹 + 板书滞后新形态）**：「右栏第三格」指认
   落空（指认行已被后续 rev 覆盖）与 d387c47c 板面冻结中间稿——归入批 4 指认一致性家族，
   取证指认轮的 rev 匹配。
6. PATH_LATENCY 等既有观察项维持。

## 二十一、修复批 11 + 批 K/L 双验证（2026-11-14 当轮：PATH_GENERATION critical 双层根因修复 → 收敛）

### 21.1 修复内容（三笔提交）

- **3fd5f251 四杠杆主体**：①PATH_GEN critical——取证 u04 批 J：网关回 **410 "openai_error"**
  （上游渠道池抖动，同分钟同 skill 其他调用全成功），被「4xx=永久」旧分类挡在重试外→后台
  任务无二次机会→终态 failed 整课缺失。三层修复：executor 双路 410 归瞬态 + path 后台任务
  瞬态兜底延迟重试（4s）+ adapter 码表加 UPSTREAM_410。②裸选择题附料检测
  （`findUnfurnishedChoiceQuestion`：询问形态+无 checkpoint options+无内联选项 → 判裸选，
  repairInstruction 重调一次）。③回链闸教师口径降权（evidence 归一 ≥12 字整句逐字命中教师
  语料 → teacherSuppliedEvidence 降档）。④rule 245 原位收紧（纠错解释不得预写候选答案集）。
- **a7028c8c 422 追加**：批 K 新根因——u07 整例 PATH_GENERATION_FAILED 源于 **422 内容安全
  筛查抖动**（良性学习目标间歇性误筛，同分钟多 skill 同中、同内容重试即过）。executor 双路
  「422+content safety screening」归瞬态 + path 兜底正则扩展。
- **d60584a7 附料词表缺口**：批 K u01 MISSING_OPTIONS 实证「下列哪一种」漏拦——词表扩
  （下列/种）+ 病历单回归用例（注：晚于批 L 起跑，词表验证归批 M）。

### 21.2 双验证结果

**批 K（reeval12）**：u04（批 J critical 宿主）critical→**pass_with_concerns 且进课 26 步**
（路径阶段 38 分钟延迟=重试链在工作，不再终态卡死）；u07 整例失败暴露 422 第二根因（→当轮
补修）。机器双评面 actionable：批 I 5 类 → 批 J 2 类 → **批 K 0 类（首次全清）**。

**批 L（reeval13）**：**critical 家族清零**——PATH_GENERATION_LATENCY ×3 **全 minor**（纯
延迟 7-8 分钟，无终态失败）；五例全数进课（u07 批 K 缺课 → 批 L pass 正常出课）。422 修复
实战证据链：18:01:47 teaching-turn 吃 422 筛查，日志 `retryable:true, willRetry:true,
backoffMs:294`（分类翻转）→ 同 trace 重试 `execution succeeded`（19.5s）——端到端恢复。

**liveness**：①422 composer 重试实战命中 ✓；410 兜底批 K 生效（u04 进课）✓；路径后台兜底
批 L 未触发（前两层已够）。②③④批 K/L 无命中场景（方差，机制上线待观察）。

### 21.3 批 L 机器面水位与批 12 队列

referee 面：PATH_GENERATION_LATENCY ×3（minor×3，纯延迟）；classroom 面 15 课
（9 pass_with_concerns / 1 fail=3 轮残课 / 5 inconclusive）：
1. **OPENING_ASSUME_EXPERIENCE ×5 成簇（minor×7）**——§18.3-3 反向断言 tripwire 正式触发：
   批 12 首项=把反向形态（「你之前没细看过」「上次你差半步」）纳入 `hasUnverifiablePriorClaim`
   判定器 + rule 57 原位收紧（条数守恒）。
2. BOARD_MISMATCH ×4（major×3，板面与已发送文本不一致/标题错位）——§20.4-5 板面状态管理
   维持队列。
3. CLOSURE_MISSING ×3（major×5，repetitive_closure_loop 六轮重复核对指令）——重复收束家族
   major 形态回升，与 2 同批取证。
4. NOTATION_LEAK ×2（minor）——代号家族轻残，维持观察。
5. PATH_LATENCY minor×3——队列既有项降级为纯延迟观察（间隔等待提示优化可作低优选项）。

## 二十二、修复批 12 + 批 M 验证（2026-11-14 当轮：开场反向断言 tripwire 响应 + 板面/收束取证）

### 22.1 修复内容（提交 311d9994）

- **判定器扩展**：`hasUnverifiablePriorClaim` 纳入**反向断言**形态——无条件负向经历断言
  （「你之前没细看过」「从没接触过」「不太见过」）；**逐句条件式豁免**（「如果你之前没
  接触过…」等批 8 钉住的合法衔接形态不误伤：命中句含如果/假如/要是/是否等标记即放行）。
- **rule 57 条数守恒收紧**（teaching-opening-generator.yaml 缺席分支原位）：反向假定条款
  并入 + 批 L 5/5 实证引用；`OPENING_PRIOR_CLAIM_CONSTRAINT` 重生成指令同步。
- 6/6 定向测试（病历单反向形态 + 条件豁免 + 原 4 用例回归）、prompts 三门禁+锚点全绿。

### 22.2 批 M（reeval14）验证

- **OPENING_ASSUME ×5（minor×7）→ ×3（minor×3）**：tripwire 响应生效、水位降档；残余子
  形态为 **recap 在场但具体断言超纲**（「上节那套三条线」「你说希望…」指向 recap 之外的
  经历）——该形态需 claim-vs-recap 内容比对，判定器当前只在 recap 缺席时拦截，列批 13
  候选（先取证 recap 结构，避免误伤 recap 真实内容的合法承接）。
- **BOARD_MISMATCH ×4（major×3）→ ×2（major×1）**：「右栏第二行摆着两个比对对象」指认
  落空形态再现 → 可复算杠杆候选确认为批 13 首项：reply 中引号板面引用片段（≥4 字）必须
  在当轮 board digest 中命中，否则 repairInstruction 重调（同附料机制）。
- **CLOSURE 重复收束**：repetitive_closure_loop 未进批 M 聚类（方差）；取证结论维持 §22.3。
- **liveness**：批 M 窗口 20 个瞬态错误 **20 个全部 willRetry:true**（批 11 瞬态分类修复
  翻转率 100%，零漏网）；referee 面 PATH_LATENCY ×2 全 minor（约 4 分 50 秒）。
- 全批 0 critical、0 fail 课（9 pass_with_concerns / 1 pass / 5 inconclusive）。

### 22.3 批 12 取证归档：板面状态管理 + 重复收束（杠杆设计留批 13）

**BOARD_MISMATCH 三形态**（批 L 病历单定性）：
1. 指认落空（教师指认的连线/节点/行在当轮可见 rev 不存在）——批 13 首项可复算杠杆见 22.2；
2. 板面滞后于对话演进（学习者已改写句子/切换场景，板面保留旧版行——u01「已发送核实话」、
   u17 库存场景错标活动价）——确定性检测难（语义比对），候选：学习者提交修改性产出后的
   下一轮刷新指令追加「板面引用最新版」语境（提示词侧）；
3. 标题/节点措辞与口头不一致——低优观察。

**重复收束真根因**（repetitive_closure_loop）：不是收尾话术循环（closureRepeatStreak 只认
收尾话术/完成候选/低增量），而是**作业指令重发循环**——任务宣布结束后教师反复重发「去练/
贴原句」，学员只回「马上去」（u01 六轮、u04 十轮）。现有强制收口需 `targetsFrozenBefore`
，多任务会话的后续任务不满足→循环持续。批 13 杠杆候选：**学员连续 ≥2 轮纯短确认（≤6 字
非问句）且教师 reply 与上轮低增量 → 本身即为收口条件**（不依赖 targetsFrozen），或至少
streak≥2 时注入「学员已确认，停止重发指令，一句收干」刷新指令。

### 22.4 批 13 队列

1. 指认-板面交叉核对（可复算，22.2/22.3 形态 1）；
2. 学员短确认收口（22.3 杠杆候选，repetitive_closure_loop）；
3. OPENING 残余子形态取证（recap 在场但断言超纲——先读 recap 装配结构再定检测面）；
4. 板面滞后形态 2（提示词侧，随任一批顺带）。

## 二十三、修复批 13 + 批 N 验证（2026-11-14 当轮：指认-板面交叉核对 + 学员短确认收口；⚠️ 批 N 后段遭遇上游网关客户端封锁）

### 23.1 修复内容（提交 ba2574e7，定向 48/48 + 全量 7342 零失败）

- **①指认-板面交叉核对**（BOARD_MISMATCH 指认落空形态，§22.3 定性的可复算杠杆）：
  `findUnmatchedBoardReferences`——reply 中带板面指认语境的引号片段（指认词在前：看板上「X」/
  右栏「X」；指认词在后：标着「X」的那条线）归一 ≥4 字必须命中当轮持久板面；引对话豁免
  （引用此前教师说过的话不判）。命中 → repairInstruction 重调（指认改为板面真实元素或删去
  指认）→ 复检仍缺 flagged-only 放行。与算式/附料两刀同机制，三刀并列。
- **②学员短确认收口**（repetitive_closure_loop）：`computeLearnerShortAckStreak`（最近连续
  学员回合全是 ≤6 字非问句短确认的计数）+ 强制收口新分支（短确认 ×2 + closureRepeatStreak≥2
  + 教师低增量 → 收口，**不依赖 targetsFrozen**；教师推进新内容时 lowIncrement=false 不触发）。
  遥测新增 loopBreakKind 区分 short-ack-instruction-loop / frozen-targets。

### 23.2 批 N（reeval15）验证：referee 面首次全清 + ① 杠杆实战命中 + ⚠️ 上游封锁

- **referee 面 actionable 0 类**——战役首次（此前每批至少 1 类，PATH_LATENCY 本批未成簇）。
- **① 杠杆实战命中**：20:21:28 抓到指认落空「业务相同的行业、单位」→ 触发修复重调 → 复检
  仍缺 → flagged-only 放行（检测/修复/降级三级按设计工作）。
- ② 本批无短确认循环场景（方差，机制待后续批次观察）。
- **⚠️ 外部事件（非代码层）**：20:41 起 newapi 网关（newapi.wenflow.org）按客户端类型封锁
  本平台全部 LLM 流量——返回 200 但内容为「本站仅限主流 Coding 客户端/CLI 使用…当前客户端
  不支持」（prompt_tokens:0/completion_tokens:1），20:42 后零成功调用、86 次拒绝。下游症状：
  u19 goal 首轮 STRUCTURED_OUTPUT_INVALID（封锁消息连续 3 次过不了 schema 校验）整例缺课、
  502 invalid JSON、classroom judge 4 调用全灭。**批 N 双评=部分完成**：referee 完整（0
  actionable），classroom 面被外部封锁阻塞（judge 断点续跑就绪，封锁解除后直接重跑
  judge-minibatch-classrooms.ts --run-dir=.runtime/referee-minibatch/reeval15 即可补全）。
- **处置建议（用户侧）**：网关封锁按客户端类型 UA/调用方特征拦截，代码层无法绕过也不应
  绕过——需要更换供应商端点/升级网关套餐/客户端白名单登记。这是全平台级风险（教师、评审、
  总结全链共用该网关），非战役局部问题。

### 23.4 批 14 队列

1. **（外部，最高优先）网关封锁解除/端点更换**——解除后补全批 N classroom 评审；
2. STRUCTURED_OUTPUT_INVALID 观察项：封锁期间 1 例（同根因）；若封锁解除后独立复现，
   取证连续 3 次校验失败的原始输出形态；
3. ② 短确认收口继续观察（loopBreakKind=short-ack-instruction-loop 首次命中待记录）；
4. §22.4 遗留：指认-板面已落地（本节），OPENING recap 超纲子形态、板面滞后提示词顺带维持。

### 23.5 补录：网关封锁解除（渠道切换）+ 批 N 课堂面补全（2026-11-14 晚）

**解锁路径（用户侧选项②的落地，全程可回滚）**：
1. 诊断确认封锁为**渠道级策略**：key/分组正常（deepseek-v3.2 返回标准路由错误），该中转仅有的
   两个 chat 渠道（deepseek-v4.1-flash 及 -1017 变体）均改为 Coding 客户端专用罐头拦截；
2. 排查发现同 key 下 **agnes-3.0-flash 渠道未受门禁**（平台 learner 侧技能一直在生产使用）；
3. 金丝雀流程：先备份 32 行 skill_model_configs + platform_api_configs
   （`.runtime/model-config-backup-2026-11-14T12-56-14.json`，回滚用 flip-model-config.cjs
   rollback）→ 翻 platform defaultModel 三字段 → judge 单技能金丝雀（端到端出真实 verdict，
   结构化输出正常）→ 翻全部 20 个钉死 deepseek 的主链技能行（thinkingMode→disabled，
   agnes 为非推理 flash）+ .env 三字段同步 → 重启；
4. 现状：全平台运行于 **agnes-3.0-flash**。deepseek 渠道恢复后可整表回滚。

**批 N 课堂面补全**（judge 断点续跑，4 课：1 fail / 2 pass / 1 pass_with_concerns）：
- 聚类 CLOSURE_MISSING ×2（critical×1）——**诚实归因：封锁打断的残课形态**（15 轮课截断在
  迁移性问题上、wrapup 不存在 = 会话被 20:41 封锁打断的产物），不计教学质量水位；
- 批 N 双评至此完整：referee 0 actionable + 课堂面已补。

**模型切换的批际可比性注记**：批 14（reeval16）起运行于 agnes-3.0-flash，与批 I–N
（deepseek-v4.1-flash）的水位对比存在**模型混杂变量**——批 14 定位为**新模型基线重建批**，
其水位作新基线，不与 deepseek 时代直接比降幅。

## 二十四、批 14：agnes 新模型基线（2026-11-14 当轮：基线重建 + meta-only 重试杠杆 + 质量权衡警示）

### 24.1 基线读数（reeval16，12 课判定：4 pass / 5 pass_with_concerns / 2 fail / 1 inconclusive）

- referee 面 actionable 1 类：**PATH_GENERATION_LATENCY ×1 critical（u17）**——根因
  `PATH_PLANNING_META_ONLY_PATH`：agnes 对排障策略类目标的概念措辞滑向元认知词表
  （「策略/清单」），触发 2026-10-20 的质量守卫。**输出方差非确定性失败** → 已纳入路径兜底
  重试族（PATH_GENERATION_TRANSIENT_ERROR 扩展 + 单测钉住），重试一次换措辞即可恢复，
  下批观察首次实战。
- classroom 面 actionable 2 类：
  - **CLOSURE_MISSING ×4（critical×1）**——critical 代表形态是 **wrapup 归因偏差**
    （改进建议指控学习者「需确认唯一性约束边界」，但 index5 显示学习者已准确推断、index6
    教师已肯定——总结指控了不存在的问题）。这是 agnes 的收束质量回退信号。
  - BOARD_DANGLING_TRACE ×1（critical×1）——u01 课 board 快照缺失而教师话语隐含指代
    可视化材料（证据链断裂形态，板面状态管理家族新子形态）。
- liveness：批 14 窗口两杠杆无触发场景（方差）；STRUCTURED_OUTPUT_INVALID 0 例（封锁解除
  后未独立复现，观察项关闭）。

### 24.2 ⚠️ 模型质量权衡（需用户决策）

agnes-3.0-flash 基线 vs deepseek-v4.1-flash 时代末期（批 M referee 1 类 minor / 批 N 0 类）：
**收束归因准确性、板面证据链质量出现回退**（两个新 critical 形态都是 agnes 输出质量面），
但平台全链可用。权衡选项：
- 恢复 deepseek 渠道（向中转方申请/换套餐，回滚命令已备：
  `node .runtime/flip-model-config.cjs rollback` + .env 还原）；
- 维持 agnes 并按批 15 队列对收束归因/板面证据链做适配治理；
- 混合：关键链（teaching-turn/wrapup）等 deepseek 恢复，轻链维持 agnes。

### 24.3 批 15 队列

1. wrapup 归因偏差（agnes 形态）取证：收束生成在 agnes 上的改进建议与课内证据回链核对
   （现有 ④ 回链闸只链学员原话，不校验「指控的问题是否真实存在」——候选杠杆：改进建议
   须引用一条学员真实失误轮次，否则降格为中性建议）；
2. BOARD_DANGLING_TRACE（板面证据链断裂）归入板面状态管理家族；
3. meta-only 重试首次实战记录；短确认收口继续观察。

## 二十五、修复批 15 + 批 O 验证（2026-11-14 当轮：wrapup 归因偏差剥离 + 无板面指认检测）

### 25.1 修复内容（提交 8b63b269，定向 47/47、门禁+锚点全绿、全量 jest 争用假阳性复跑全绿）

- **①wrapup 无据问题指控剥离**：`stripUnfoundedProblemAdvice`——零负证据课（无未过/跳过
  检查点行、无误解命中）的改进建议/行动计划里带问题指控措辞的条目 → 剥离（批 14 critical
  「指控了不存在的问题」形态）；有负证据的课不判（保守漏判可接受，误删真实批评不可接受）；
  actionPlan 保底留 1 条（间隔迁移契约）。生命周期接线 + strip-unfounded-problem-advice 遥测。
- **②无板面板面指认检测**：`referencesBoardWithoutBoardAvailable`——本课无板面而 reply 用
  「看板上/那份图/右栏」指认（批 14 BOARD_DANGLING critical 形态）→ 修复重调（删指认、口头
  描述承接），否定句豁免。与批 13「指认落空」互补：板面证据链两个断裂面（元素不存在/
  板面本身不存在）均已封住。
- **③wrapup 归因规则条数守恒扩展**：改进建议同理——必须对应课内真实失误，零失误课写中性下一步。

### 25.2 批 O（reeval17）验证：referee 0 actionable + 剥离杠杆实战命中 ×4

- **referee 面 actionable 0 类**（agnes 时代第二次，批 13/15 均达成）。
- **① 杠杆实战命中 ×4**：strip-unfounded-problem-advice 在批 O 窗口拦截 4 条无据问题指控
  （22:0x，全部在批 15 重启后）——证实 agnes 确实在批量制造假问题指控，剥离闸在实战兜底。
- ②无板面指认 / ③meta-only 重试 / ④短确认收口：本批无触发场景（u17 路径本批正常 = meta-only
  未再现）。
- classroom 面（15 课，4 pass_with_concerns / 5 pass / 2 fail / 3 inconclusive）：
  **CLOSURE_MISSING ×4（critical×3）** + **SCAFFOLD_LATE ×3（major×2，同构指令重复）**
  ——agnes 时代收束质量与支架质量回退在批 14→15 **持续存在**（非单批方差）。

### 25.3 模型权衡决策窗口收窄（待用户三选一）

批 14/15 两个 agnes 基线批一致显示：收束质量（critical×1→×3）与支架质量（0→major×2）回退
是**系统性**的，非方差。剥离/检测类杠杆在兜住诚实性与证据链，但收束与支架的「教得好不好」
层面代码兜不住。三个选项的代价已具体化（§24.2），建议尽快定夺：
- 恢复 deepseek（回滚命令就绪，水位大概率回落至批 M/N 水位）；
- 维持 agnes + 批 16 起对收束/支架做提示词治理（模型能力差距部分可缓解，部分不可）；
- 混合分档（关键链等 deepseek、轻链 agnes——需要中转方先恢复任一 deepseek 渠道）。

### 25.4 批 16 队列

1. 收束质量治理（agnes 主线）：wrapup 生成前的收束完备性自检（带走的口径+下一步必填，
   否则补全后再产出——确定性闸候选）；
2. 支架同构重复（SCAFFOLD_LATE agnes 形态）：与短确认收口联动，教师连续低增量时注入
   「降门槛脚手架或收口」二选一指令；
3. meta-only/短确认/无板面指认 首战记录（持续 liveness 观察）；
4. 若用户选择恢复 deepseek：整表回滚 + 批 16 作为恢复后基线批（队列 1/2 降为观察项）。

## 二十六、修复批 16 + 批 P 验证（2026-11-14 当轮：判官漂移标注器 + 两个新平台状态机 critical）

### 26.1 首项取证反转 + 测量卫生杠杆（提交至 judge-minibatch-classrooms.ts）

- **原杠杆不实现（取证反转）**：agnes 两批 17 份 wrapup 产物 keyTakeaways/actionPlan **零空壳**
  ——「wrapup 生成前必填校验」无的放矢（phantom 批 G 同款决策纪律，依据入档）。
- **真发现：判官仪器漂移**——agnes 时代教师与判官**两端同时换模型**，批 14/15 的课堂 critical
  读数两端混杂，水位对比有效性受损。
- **落地：判官漂移标注器**——judge 脚本记录 wrapup 口径计数（keyTakeaways/actionPlan 条数
  入 record），closure 族缺口聚类时三态注记并渲染：①产物不存在=残课/截断形态；②在案但
  口径 0=空壳实锤；③在案口径非空=课内收束缺失或判官口径漂移（需人工复核）。旧记录聚类前
  从 DB 回填。
- **首战双验证**：批 O 重聚类——4 条 closure 缺口 **3 条为残课/截断伪影**、1 条 wrapup 在案
  （「收束崩坏 critical×3」大幅修正）；批 P 新记录原生计数——3 条缺口自动分化为 2 课内
  收束缺失/漂移 + 2 残课。

### 26.2 批 P（reeval18）双评：两个新平台状态机 critical

- **EXTENSION_STATE_CONFLICT ×1 critical（u17）**：任务 2 中途表达延伸意愿 → extensionPhase
  pending → 抛「该任务还没有完成过课堂」（与任务 1 completed 矛盾）——延伸流程状态冲突，
  实验失败终态。
- **GOAL_STUCK_LOOP ×1 critical（u19）**：学习者多次明确确认「按这个方向排路径」，平台
  10 分钟循环输出「等你回来点确认按钮」不触发路径生成——Goal 确认状态机缺陷；伴
  **PLATFORM_RATE_LIMIT_FAIL**（agnes 渠道在并发 2 下出现限流新症状）。
- classroom 面（11 课，1 fail / 3 pass / 5 pass_with_concerns / 2 inconclusive）：
  CLOSURE_MISSING ×3（critical×1，标注器三态分化见上）+ NOTATION_LEAK ×2 minor。
- liveness：无据指控剥离累计 3+ 次；无板面指认/短确认/meta-only 本批无场景（方差）。

### 26.3 批 17 队列

1. **GOAL_STUCK_LOOP 取证**（critical）：确认→排路径状态机为何不识别确认意图（与在途的
   「确认动作减重」goal-confirm-adjudicator 方案的相关性一并评估）；
2. **EXTENSION_STATE_CONFLICT 取证**（critical）：延伸流程与完成态判定的冲突窗口；
3. **PLATFORM_RATE_LIMIT_FAIL 观察**：agnes 渠道限流阈值/频次（并发 2 即触发需关注）；
4. liveness 四项持续；meta-only 重试/短确认收口首战记录仍空缺（方差）。

### 26.4 模型权衡（仍待用户三选一，决策矩阵更新）

判官漂移发现后：agnes 时代的「质量崩坏」读数部分是仪器效应（closure 族大半为伪影+漂移），
部分是真实的（wrapup 归因偏差被剥离闸 ×4+ 实证）。恢复 deepseek 不仅能回升教学质量，
**还能恢复判官仪器的有效性**（双端回 deepseek 才能重建与批 I–N 可比的水位基线）——这为
「恢复 deepseek」选项增加了测量学权重。回滚命令就绪。

## 二十七、修复批 17 + 批 Q 验证（2026-11-14 当轮：GOAL_STUCK 死锁破解 + EXTENSION 跨任务回退 → 双 critical 未复现）

### 27.1 取证结论与修复（提交 9a2eb51f）

- **GOAL_STUCK_LOOP（u19 批 P critical）——双向死锁机理**：①硬字段守卫压回
  （`time_budget` 缺失 → proposing 打回 understanding）；②stage=understanding →
  `proposalConfirmable=false` → **确认裁决器永不触发**（循环窗口零调用）；③学员打字确认
  变普通回合 → 模型重发方案 → 再压回。与在途 goal-confirm-adjudicator 方案的关联：裁决器
  本体与 fail-open 均正常，缺陷在其 stage 门槛条件被压回绕开。
  **修复两杠杆**：压回时注入缺失字段**确定性收集提问**（`buildMissingFieldQuestion`，
  time_budget→「每周练几天、每天多久？」，顶掉模型下一问，逼对话走向补字段）；裁决门槛
  **跨轮放行**（collected.confirmedProposal 在案即裁决，用户 agency 先例同向）。
- **EXTENSION_STATE_CONFLICT（u17 批 P critical）——跨任务路由缺口**：学员说「顺便看看
  最近那个活动页的案例」（指 task 1，其会话记录**确实 completed**），延伸请求却带当前活动
  任务（task 2）的 taskId → 按当前任务计数=0 → 拒绝，报错与事实矛盾。
  **修复**：`countCompletedLessonSessionsOnPath` 回退——当前任务无完成课但同路径已有完成课
  即放行。

### 27.2 批 Q（reeval19）验证

- **referee 面 actionable 0 类**——两个 critical 均**未复现**；u19 从 fail 翻回
  pass_with_concerns（goal 流正常推进、采样 2/4 课）；延伸拒绝批 Q 窗口 **0 次**。
- 压回守卫本批 7 次——守卫照常工作，死锁破解提问把压回转向收集路径（无卡死）。
- classroom 面（15 课，2 fail / 7 pass_with_concerns / 4 pass / 2 inconclusive）：
  CLOSURE_MISSING ×3（critical×2）+ OPENING_ASSUMPTION ×2（major×1）——agnes 判官时代
  课堂 critical 持续，标注器三态分化在案，**模型权衡决策仍是主变量**（见 §26.4）。

### 27.3 批 18 队列

1. 模型权衡决策落地（回滚或维持），批 18 以恢复后基线/治理批定位；
2. classroom fail 课取证（agnes 判官 critical×2 结合标注器读数人工复核）；
3. 四项 liveness + 延伸回退/死锁破解 首战记录持续。

## 二十八、批 18（决策无关项）：reeval19 fail 课标注器复核 + 批 R liveness 积累

### 28.1 reeval19 四节 fail 课逐课复核（判官漂移 vs agnes 真实质量面）

| 课 | 形态 | 分类 |
|---|---|---|
| u01 T1 残课（1 轮，无 wrapup/板面） | turn_incomplete + board/closure 记缺 | **残课伪影（仪器面）**——判官对残课的规则性记缺，采样截断产物，与批 N/O 同款 |
| u04 T11（11 轮，wrapup 在案 key3/plan2） | major opening_vague_ref + minor notation_leak，无 critical | **判官 score 阈值 + 轻微真实面**——真实问题仅开场模糊引用级；fail 判定由 agnes 判官分数阈值驱动 |
| u07 T41（41 轮长课，wrapup 在案） | major scaffolding_repetition（学员 7 次表达焦虑教师复读同一话术）+ major board_dangling（任务要求填模板但全课无板面载荷）+ minor closure_gap/criteria_drift | **agnes 真实质量面**——支架复读与板面缺失为批 14/15 已确认回退家族的真实回归（长课放大） |
| u07 T17（17 轮，wrapup 在案） | major opening_anchor_violation（「上节课你已经把数据点和结论连上线」recap 超纲正向断言）+ major repetitive_instruction_loop（「弄完挑一篇发我看看」×3 无提交） | **agnes 真实质量面**——开场 recap 超纲子形态（§22.2 已知）+ 指令循环家族（短确认收口的目标形态变体：提交循环） |

**复核结论**：4 fail = 1 残课伪影 + 1 判官阈值效应 + **2 节 agnes 真实质量面**。真实面集中于
支架复读/板面缺失/开场超纲/指令循环四家族——与 §25.3 系统性回退判断一致，且给出批 18+
杠杆的精确靶点：①板面缺失新子形态（引用任务材料原文而非板面词表，批 15 检测器词表未覆盖
「填模板」类任务材料未渲染）；②提交循环（「挑一篇发我看看」×3）与短确认收口同域可合并治理。

### 28.2 批 R（reeval20）

（跑批中，完成后补：referee/classroom 水位 + 四项 liveness 首战记录——延伸回退、死锁破解
提问、meta-only 重试、短确认收口。）

### 28.2 批 R（reeval20）读数与 liveness 首战记录

- referee 面 actionable 1 类：**F_LOOP ×1 critical（u17，新形态）**——「教学循环重复提问」：
  学员已答对「失效策略是主因」后，平台对同一追问（「最先该动的是哪个机制？」）原样重复，
  学员开始自我怀疑。与短确认收口同域但不同子形态（**已答不推进** vs 确认不推进）→ 批 19
  队列：已答推进检测（学员回合与教师紧邻上问的答案匹配后，同一问句禁止原样重复——可复算
  面：reply 含与上轮相同问句且学员上轮非短确认）。
- 四项 liveness：
  - **死锁破解提问：首次实战 exercised**（压回 ×1，收集提问注入路径已走通）；
  - **无据指控剥离：再命中 ×1**（累计 5+）；
  - meta-only：修复后连续两批零复现（观察趋稳）；
  - 短确认收口/无板面指认：本批无场景（方差，继续观察）；延伸回退本批无延伸场景。
- classroom 判定与 fail 课复核沿用 §28.1 方法（标注器三态 + 逐课人工分类）。

### 28.3 批 19 队列

1. F_LOOP 已答不推进（新 critical，可复算检测候选）；
2. 「填模板」类任务材料未渲染 + 提交循环（§28.1 精确靶点，与 1 同域治理）；
3. 模型权衡三选一落地（回滚就绪）；
4. liveness 持续（延伸回退/短确认/无板面指认 首战仍空缺）。

## 二十九、修复批 19 + 批 S 验证（2026-11-15 当轮：已答不推进守卫首战命中）

### 29.1 修复内容（提交含 F_LOOP 守卫 + 延伸回退 fail-closed）

- **①F_LOOP 已答不推进守卫**（批 R critical 可复算杠杆）：`findRepeatedQuestionAfterAnswer`
  （question-loop-guard.ts）——上一教师轮含问句 + 学员实质性作答（归一 ≥6 字非反问，短确认/
  反问豁免）+ 本轮原样包含同一问句 → 判「已答不推进」。repairInstruction 重调（第一句反馈
  作答→推进下一步，禁重复上轮问句），复检仍犯 flagged-only。第六刀（算式/附料/指认落空/
  无板面指认/已答不推进 + 路径兜底重试）。
- **②延伸回退 fail-closed**：批 17 的同路径回退在仓储计数异常时会 500——加 try/catch，
  计数失败按严格规则拒绝（既有用例「无完结课堂→400」语义保持，mock 同步）。该回归由
  全量 jest 抓住（批 17 落地时未跑全量 routes 的流程教训已吸收）。

### 29.2 批 S（reeval21）验证

- **① 首战实战命中**：00:57:23 拦截「学员已作答而教师原样重复同一问句」→ 触发修复重调。
- 无据指控剥离再命中 ×2（累计 7+）；meta-only 延续零复现；短确认/无板面本批无场景。
- referee 面 actionable 1 类：**F_001 ×1 critical（u07，新家族）**——状态脱同步：教学会话
  终态 completed 而实验回执 abandoned（黑盒 runner abandon 标记与会话状态机不同步；与
  EXTENSION 冲突同根族：黑盒 abandon 语义与产品完成态语义的错位）→ 批 20 队列。
- classroom 面（15 课，3 fail / 6 pass / 3 pass_with_concerns / 2 inconclusive）：
  **CLOSURE_MISSING ×4（critical×5，severity 数字超簇计数=agnes 判官严重度膨胀又一例）**
  ——收束家族在 agnes 判官下持续高发，标注器三态注记在案；模型权衡决策仍是主变量。

### 29.3 批 20 队列

1. F_001 状态脱同步取证（critical）：黑盒 abandon 标记 vs teaching_sessions.status 的
   语义错位面（与 EXTENSION 同根：abandon 语义族治理）；
2. agnes 收束家族：批 16/19 数据已足够支撑模型决策，决策后定位（恢复 deepseek→水位回落
   验证批；维持 agnes→收束完备性提示词治理）；
3. liveness 持续（已答不推进/剥离 已有实战；延伸回退/短确认/meta-only 待场景）。

## 三十、修复批 20（2026-11-15 当轮：F_001 状态脱同步——abandon 语义族落库归位）

### 30.1 取证（真语义缺陷确认，非误读）

链路还原：黑盒 runner abandon → `platform-user-adapter.endTeaching('abandoned')` →
`POST /finalize (end_only, learner-abandoned)` → **SessionFinalizationService.finalize 对
end_only 无条件走 complete_task 结算链**（endReason 只进 completeTask 的 reason 参数，
不改变落库 status）→ `completeTask + status='completed'`。

铁证（批 S u07 session3, te73ljj）：16:58:19 开始 → 16:58:58 abandon 200 返回（**39 秒
中止课**）→ teaching_sessions.status=**completed** + 任务完成指标 true，与实验回执
abandoned 脱同步。污染面：①完成课计数族（`countCompletedLessonSessions`/
`countCompletedLessonSessionsOnPath` 把中止课算进「已完成的课堂」——批 17 EXTENSION
冲突的计数膨胀同源）；②startSession 同任务重学计数（completed ∈ 重学判定集合）。
产物化取证：runner 日志 abandon 时间戳 vs DB 行 endTime/status 同秒对齐，脱同步确定性成立。

### 30.2 修复（两刀 + 一处旧语义测试重写）

1. **repo**：`TeachingSessionRepository.abandonSessionFinalization(sessionId, endReason)`
   ——合并 endReason 进 teachingState、`status='abandoned'`、endTime、清 operationId/kind/
   lease、revision+1（status 列为 String，'abandoned' 合法；endTime 走 `simulatedNowOr`）。
2. **service 拦截**：finalize 的 end_only 分支入口处，`isAbnormalSessionClosure` 命中
   （learner-abandoned / discarded / superseded / failed）→ 直接 abandonSessionFinalization
   并返回；不再进 coordinator 结算链（wrapup/结算/温故回写全不产生）。**操作响应保持
   `status:'completed'`**（runner endTeaching 以顶层操作状态判定成功，session 载荷携带真实
   终态 abandoned）。
3. **测试**：旧「弃跑 end_only → mockEndSession 被调用」用例编码的正是被修掉的旧语义，
   重写为新语义断言（不走结算链/落 abandoned/操作态 completed/温故不回写）。

### 30.3 门禁插曲（门禁网自己抓了两个网外鱼）

- **模拟时钟审计真命中**：首版 repo 方法写 `endTime: new Date()` 被全量 jest 的
  simulation-clock-wiring.audit 抓住（任务结算业务时间戳不得落真墙钟）→ 改
  `simulatedNowOr()`。这是该审计守卫自部署以来首次拦下真实回归，非 flake。
- **陈年截断浮出**：negative-evidence.test.ts 自批 15 提交时即缺 describe 收尾括号
  （套件始终编译失败），此前多轮全量 jest 一直把它误归为「并发 flake」家族；本轮隔离
  复核定性后补 2 行修复（eaca34f3）。同轮删除空的 path.coordinator.test.ts 残骸
  （真实覆盖在 transient-retry.test.ts）。教训：**flake 名单要定期做隔离复核定性，
  不能只按名字滚动豁免**。
- 门禁终态：tsc 0 err；定向 6 套件 66/66 + finalization 23/23；全量 jest 7336+ 通过、
  剩余为逐轮轮换的 env-dependent 套件级失败（McpGateway 超时 / database-vacuum /
  infra-models 等，零断言失败，隔离全绿）。

### 30.4 验证注记 + 队列

- **本修复由验证批自然 exercise**：每批收口都会走 abandon 路径（runner 收口即
  endTeaching），下一验证批直接查 u07 形态课的落库 status 是否 abandoned + 完成课计数
  是否归位，无需专门构造。
- 批 21 队列：①F_001 修复自然验证 + 旧 completed 中止课的计数治理面复核；②agnes 收束
  家族——批 16/19 数据已足，**模型权衡三选一仍待用户网关侧定夺**（恢复 deepseek /
  维持 agnes / 混合；回滚 `node .runtime/flip-model-config.cjs rollback` 就绪，不代执行）；
  ③liveness 持续（延伸回退/短确认/meta-only 待场景）。

## 三十一、批 21（2026-11-15 当轮：F_001 自然验证 PASS + abandon 响应语义归位 + 判官新假阳性面定性）

### 31.1 reeval22 黑盒批（5 case 全走 abandon 收口 = 批 20 修复的自然 exercise）

**F_001 验证 PASS，对账精确**：
- 5 × `status='abandoned'` + `endReason='learner-abandoned'`（30-36s 中止课，全部 runner
  abandon 200 收口）——修复前同形态落 completed（批 S 遗留的 42s/38s completed 短课即
  before 对照，同窗反差成立）；
- 10 × `status='completed'`（88-292s 真实课堂，5 案例 × 2 课采样）零误标；
- 计数族归位：completed 579→589（+10 恰为真实课）、abandoned 0→5。
  `countCompletedLessonSessions(OnPath)` 按 status='completed' 过滤，中止课自然出列。

### 31.2 批 21 修复（critical ×1 达标）：abandon 响应 taskCompletion 语义归位

- referee 聚类 actionable 仅 1 类：**CRIT_METRICS_MISMATCH ×1 critical（u04）**——
  runner trace 的 endResult 显示中止课 `taskCompletion.status='completed'`，与 control
  台账 `taskCompleted=false` 冲突。根因是批 20 拦截器的设计选择：操作态 completed（runner
  契约）与 taskCompletion 字段（结算语义）共用一个值。
- 修复：拦截器 `taskCompletion.status='completed' → 'skipped'`（结算确实被跳过）；
  adapter 契约复核（`platform-user-adapter.ts:472` 只看顶层 `result.status`）确认零副作用。
  测试断言同步，54/54 + tsc 绿。**下一验证批自然复核**（每批收口必走）。

### 31.3 双评归因（referee + classroom 15 课）

- **CLOSURE_MISSING ×4（critical×4）→ 100% 假阳性，全落在 wrapup=false 的 abandon 课**
  （3/5/1 轮短课）。批 20 的正确语义（abandon 不产 wrapup）制造了判官不知情的新假阳性面：
  判官照常按「收束完整性」要求弃跑课。真实完成课的收束软缺口另有 3 例（closure_gap /
  next_step_vague / closure_missing_judgment，agnes 收束家族延续，severity 数字仍超簇
  计数，模型权衡继续是主变量）。
- **BOARD_MISMATCH ×4（major×3）→ 新家族第三形态**：板面在、软指认、内容滞后（u01：
  教师问「调岗调薪条款」，板面还是「支付时间对照表」）。与批 13 指认落空（指认元素不在
  板上）、批 15 无板面指认（根本没有板面）不同形。**本批窗口既有两检测器零命中**——
  判据是显式板面指认词面，软指认（「对着…条款」「哪一条」）不入网。批 22-① 取证靶点。
- referee 残余（METRICS_INCOMPLETE ×2 / METRIC_DEGRADED / WRAPUP_MISSING）同根：判官面
  不知 abandon 语义。TERMINAL_STATE_INCONSISTENCY ×1（u07）为 runner 台账口径噪声
  （platformStage=completed 指 goal 阶段达成，referee 自己也承认 abandoned 合法），不修。
- NOTATION_LEAK ×3（minor×6，u04/u07/u17）：未定义工程记号（cf/rev/np/binlog/cdncache）
  对零基础学员，提示词已有规则但 agnes 端持续违反——排在板面族之后。

### 31.4 批 22 队列

1. board_mismatch 取证：4 课逐轮还原（软指认形态 vs 批13/批15 判据缺口），设计
   「板面滞后检测」杠杆（指认内容 ∈ 提问 ∧ ∉ 当前板面 → 修复重调/板面刷新）；
2. 判官 abandon 语义对齐（评审面，非教学行为）：judge 脚本给 abandon 课注入
   「弃跑收口（设计无 wrapup）」标注豁免收束判据；referee 输入同理带 terminalReason
   豁免 METRICS/WRAPUP 族——预计直接消掉 CLOSURE_MISSING ×4 假阳性与 referee 残余 4 例；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 `node .runtime/flip-model-config.cjs
   rollback` 就绪）；agnes 收束家族真实缺口 3 例挂在该决策下。

## 三十二、批 22（2026-11-15 当轮：判官 abandon 语义对齐落地 + 板面滞后杠杆取证否定）

### 32.1 ②判官 abandon 语义对齐（落地，双 prompt 原位扩展条数守恒）

reeval22 已证 CLOSURE_MISSING ×4 全是弃跑课假阳性（wrapup=false 设计如此）。双端判据豁免：

- **classroom-quality-judge.yaml**：载荷键注释补 `classroom.sessionTerminal`；收束规则原位
  扩展——`sessionTerminal.status='abandoned'` 时 wrapup.present=false 不记 closure 缺口、
  closureQuality 不据此扣分（最多一条 info）。
- **virtual-learner-referee.yaml**：metricCompleteness 数据完整性规则原位扩展——
  experimentSummary/control 终态 abandoned 时不得据此输出 data 类扣分 finding。
- **接线**：`ClassroomQualityJudgeInput.classroom.sessionTerminal` + judge 脚本从
  ts.status / teachingState.endReason 注入。**referee 输入在场性核实**：terminalReason
  本就在 runner trace（u07 finding 逐字引用过 control.terminalReason='abandoned'）——
  缺的从来不是输入而是判据豁免，本轮补齐，runner 零改动。
- 门禁：compile-all 33 文件、check:all（threshold-coupling 12/12）、core:check 33/33、
  lint 全绿；prompts:sync already-in-sync；skills 套件 790/790；tsc 0 err。
  **验证批自然复核**：下一批 CLOSURE_MISSING 应只在真实完成课出现（弃跑课 0 记录）。

### 32.2 ①BOARD_MISMATCH 取证（完整）→ 引擎杠杆**取证否定**

4 课逐轮还原（原始字节，非判官转述），三形态：
- **A 提问维度错位**（u01L3 T2）：教师指派「对着支付时间」后问岗位/考核维度，板面右栏
  只有 支付时间/支付方式/补偿标准/义务对应 四行——真缺陷；
- **C 确认轮 ？ 占位未解锁**（u19L2 T6）：学员已答出两条理由、教师按完整叙述，板面右栏
  理由 2 槽位仍是 ？（fork 遮罩未随确认释放）——真缺陷（确认后遮罩应解除）；
- **B 抽象层级解读差**（u17L2/u04L1）：判官对推理链 vs 板面粒度的解读分歧——评审面
  主观带，不可机械化。

**判据原型 + 全语料回放（59 板书轮）→ 3 fires 全假阳性、0 真阳性**：假阳性全是
迁移/推演问句（「哪一条的应对策略你想再推演一遍」「哪一步最该在签之前跟 HR 谈」——
零交集是迁移题的**正确形态**）；真阳性 u01L3 T2 未入网（判官转述措辞≠教师原始字节，
单测首版烘焙了转述文本，回放当场抓住）。判别面（板面指派 vs 迁移问句）是语义级的，
正则级判据无法达宁窄勿宽 → **按战役纪律撤原型（board-lag-ask.ts 不落库），杠杆否定
存档**。board_mismatch 继续由课堂评审面监测（本批 4 例全由判官抓到，评审面是有效
检测器）；形态 C 若后续批次再现（≥2），考虑「确认轮 fork 遮罩释放」的板面管线杠杆。

### 32.3 批 23 队列

1. 下一验证批（reeval23）：①判官豁免复核——弃跑课 CLOSURE_MISSING 应归零、referee
   METRICS 族残余应收敛；②taskCompletion='skipped'（批 21）自然复核；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   agnes 收束真实缺口 3 例（closure_gap/next_step_vague/missing_judgment）与
   NOTATION_LEAK ×3 都挂在该决策下；
3. 形态 C（确认轮遮罩释放）观察位：跨批 ≥2 再立项。

## 三十三、批 23（2026-11-15 当轮：reeval23 验证批——批 21/22 修复三线全数实证 PASS）

### 33.1 三线验证结果（对账）

1. **弃跑课 CLOSURE_MISSING 归零 ✓**：4 个 wrapup=false 课（3 弃跑 + 1 失败跑）零 closure
   指控；u04 弃跑课自产出 `closure_abandoned` + `truncated_session` 码并落 inconclusive——
   豁免规则被模型语义级吸收（不止回避扣分，还自建了弃跑中性码）。CLOSURE_MISSING ×2
   聚类全部落在 wrapup=true 真实完成课（u07L2 41 轮 major：收束缺「主张解除」法定前提
   厘清；u01L2 nuance gap）——假阳性退场，真实收束缺口显形（agnes 家族，挂模型决策）。
2. **referee METRICS 族收敛 ✓**：CRIT_METRICS_MISMATCH（critical）消失、
   TERMINAL_STATE_INCONSISTENCY 消失、WRAPUP_MISSING 码消失；u07 verdict=pass（2 findings，
   历史最佳）。残余：u19 CTL-ABANDON + DATA-INCOMPLETE 双 major——细节已自认
   「因学习者主动中止（abandoned）未生成 wrapup」（因果归位），但 severity 未按规则降到
   info（单样本，噪音级，不立项；再现 ≥2 再收紧措辞）。
3. **taskCompletion='skipped' 落 trace ✓**：u07 result.json 实证
   `taskCompletion: { status: skipped`；abandon 落库 3/3（24s/54s/31s，reason=learner-
   abandoned）；completed 589→597、abandoned 5→8。

### 33.2 新 actionable（→批 24 队列）

- **CTRL_EXT_CONFLICT ×1 critical（u17，referee）**：学习者完成核心拆解后提出延伸需求，
  终端报「该任务还没有完成过课堂」400 → autopilot failed → 教学会话残留 active 未收口
  （幽灵 active 会话 + 失败跑收口缺口同链）。EXTENSION 语义族复发形态（批 17-② 同域）——
  但本次疑似身份/路径维度错位（完成课计数与发延伸意图的 user 对不上），批 24-① 取证：
  u17 全链路还原（延伸 400 落在哪条代码路径、计数查的是哪个 user/path、完成课落谁家）。
- **ASSESSMENT_INCONSISTENCY ×1 critical（u07L2，classroom）**：教师轮 5/8 判「逻辑松」、
  轮 26/33 无解释翻转为「紧」——判断口径自相矛盾贯穿 41 轮。真实教学质量 critical
  （agnes 时代形态，单样本）。
- **BOARD_DANGLING_TRACE ×2 minor（u04/u19）**：提问主体不在板面（问「短期借款」板上
  只有固定资产/折旧）——板面家族第三形态持续积累（批 22 ×4 → 批 23 ×2 跨批 6 例），
  引擎杠杆已证伪（批 22），评审面持续监测。
- **OPEN-001 ×1 critical（u17 失败跑首课）**：开场泄结论 + Meno 违规——与延伸 400 同
  案（失败链早段），随批 24-① 一并还原。

### 33.3 批 24 队列

1. u17 延伸 400 + 失败跑 active 残留取证（critical）：全链路还原 → 杠杆设计（收口兜底
   /计数口径归位）；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   ASSESSMENT_INCONSISTENCY / 真实收束缺口 / OPEN 泄结论三族都挂该决策；
3. board 族观察位维持（跨批计数持续）；referee severity 纪律观察位（≥2 再收紧）。

## 三十四、修复批 24（2026-11-15 当轮：u17 延伸 400 + 失败跑 active 残留取证 → 三杠杆落地）

### 34.1 取证（全链路还原，铁证链）

- **崩溃点**：`[autopilot] 运行未捕获异常 error=该任务还没有完成过课堂`——reeval22 期
  （2e05a357）与 reeval23（db7d0a44）**同签名两批**，跨批 ≥2 达标。
- **身份疑云澄清**：初判「双身份错位」被推翻——fb4decf7 是 u07 的学员（sim20-07 何静·
  英文论文），u17(d9d95337) 全程单身份。计数维度没有错位：400 是**守卫按字母正确执行**。
- **真链**：延伸意图在**课中**被记下（学习者在 active 课里说「还想深入」→
  extensionPhase=pending，blackbox-runner.ts:918）→ 收口闭合门禁延迟结算（03:10:16
  「完成信号延迟一轮：末问未答」实证）→ autoStep 的延伸触发（:952）**无源课结算检查**
  （注释写「本课已结算」但代码不查）→ 开延伸 → 平台守卫「完成课=0」400（守卫正确）→
  400 冒成未捕获异常 → autopilot 崩溃处理器只写 status=failed **不收口平台课** →
  教学会话永留 active（幽灵）+ 整场实验陪葬（goal+课的产出全废，referee 只能
  inconclusive）。
- **附带实锤**：崩溃前 14 秒同回复双发（gw_1eff81bc/gw_5b261479 同 contentPreview）——
  TEACH_LOOP_STUCK finding 的实物形态。

### 34.2 三杠杆（全 runner 侧确定性，platform 守卫不动——它是对的）

1. **L1 结算守卫**：新纯函数 `contracts.isExtensionSourceSettled(control)`——源课已让位
  （teachingSessionId ≠ 源课 / 清空）或阶段离开 teaching 才放行开延伸；旧回执无源课
  保持放行不收紧。autoStep 延伸分支接入。课中意图从此回到正常步进，结算后自然开课
  （计数守卫看到的是真实的完成课数）。
2. **L3 永久失败降级**：延伸开启失败时按 `isRecoverableExecutionFailure` 分流——瞬态照旧
  抛出走可恢复重试；永久性（守卫 400 等）取消意图（extensionPhase='cancelled'，
  contracts 联合类型放宽）+ recordDegradation P3 留痕 + run 继续。延伸是一期观测功能，
  不再用整场实验陪葬。
3. **L2 失败收口兜底**：autopilot 崩溃处理器在 writeState('failed') **之前** best-effort
  走 runner act(abandon)——平台课按批 20 语义落 status='abandoned'+endReason（完成课
  计数族天然隔离），失败只留日志不阻断终局化。幽灵 active 从源头消失。

### 34.3 门禁与验证

- tsc 0 err；blackbox-runner 套件 70/70（新增守卫 4 态 + 降级取消 5 测）；
  virtual-lab+coordinators 618/618；**全量 jest 792/792 套件零失败**（战役首次全绿全量，
  7361 tests）。
- **验证批自然复核点（批 25）**：①延伸意图课中出现的 case——结算后延伸正常开启或
  优雅取消（trace 中 extensionPhase ≠ 触发 run 失败）；②失败跑不再产生幽灵 active
  （teaching_sessions 无新增 active 残留）；③abandon 收口落库语义持续（批 20 链）。

### 34.4 批 25 队列

1. 下一验证批（reeval24）：批 24 三杠杆自然复核（上述三点）；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   ASSESSMENT_INCONSISTENCY（u07L2 口径翻转 critical）/真实收束缺口/NOTATION_LEAK 三族
   挂该决策；
3. board 族观察位维持（跨批 6 例）；referee severity 纪律观察位（u19 双 major 描述性
   残余，≥2 再收紧）。

## 三十五、批 25（2026-11-15 当轮：reeval24 验证批——批 24 三杠杆全数实证 PASS + referee 首次零 actionable）

### 35.1 三杠杆复核（对账）

1. **延伸不再触发 run 失败 ✓**：u17（前两批的崩溃案主）verdict=**pass**（22 fail→23
   inconclusive→24 pass），5/5 案例正常收口 abandon http=200，无任何 run failure、无
   CTRL_EXT_CONFLICT 复发。
2. **幽灵 active 零新增 ✓**：teaching_sessions active 恒为 1（reeval23 历史残留
   e2617d91，修复前产生），本批全程零新增。
3. **abandon 落库语义持续 ✓**：abandoned 8→12、completed 597→607——4 案例 abandon
   收口（20s/27s/35s/39s，reason=learner-abandoned）+ 1 案例 totalTasks≤maxTasks 自然
   跑完不制造弃跑（runner 既有规则），对账精确。
4. **附：批 22 severity 纪律首次实战生效**：referee 的 abandon 相关 finding 全部降到
   minor/info（RUN_ABORTED_NO_WRAPUP=info、DATA_INCOMPLETE_METRICS=minor），不再是 major。

### 35.2 双评结果

- **referee：actionable 0 类（战役首次）**——「所有 finding 都是单样本，按规则先视为
  噪音」。u07 pass_with_concerns / u17 pass / u19 pass。
- **classroom（14 课）**：4 pass / 5 pass_with_concerns / 2 fail / 3 inconclusive
  （弃跑课 inconclusive 化持续）。弃跑课 closure 豁免持续生效：u04 弃跑课自产出
  `closure_abandoned_no_wrapup`+`assessment_inconclusive` 中性码，u19 弃跑课
  `truncated_session_abandoned`——CLOSURE_MISSING ×3 簇全部落在 wrapup=true 真实课
  （redundant_closure/REPETITIVE_CLOSURE_1/CLOSURE_TRANSFER_WEAK：收束复述无新信息，
  agnes 真实缺口族，挂模型决策）。

### 35.3 新 actionable（→批 26 队列）

- **TASK_CONTENT_MISSING ×1 critical（u19L2，classroom）**：任务描述要求「一段 500 字
  杂乱进展文本」，transcript 从未展示该文本——学习者直接生成 90%/70% 等具体数据、教师
  直接评价「准确」。布题材料链断裂新形态：材料未注入（布题链缺陷）或判官看不到材料
  载荷（证据面缺口）。批 26-① 取证定向：拉 u19L2 的任务材料注入链（goal→task
  description→开场）与判官输入比对。
- **REPETITIVE_OPENING ×2（major×1）**：开场/引导语整段重复（u01L1 index2 复读 index0）
  ——与 u07L2 的 F-REPEAT-QUIZ/F-LOOP-ASSIGN（75 轮课）同属重复家族；批 19 已答不推进
  守卫管「作答后重复问句」，开场复读是另一形态，观察累积。
- NOTATION_LEAK ×3 minor（跨批 6 例持续）；CLOSURE 冗余 ×3（agnes 族）——均挂模型决策。

### 35.4 批 26 队列

1. u19L2 布题材料链取证（critical ×1）：材料注入 vs 判官证据面，产出杠杆设计；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）；
3. 重复家族（开场复读/quiz 循环）观察位累积 ≥2 立项。

## 三十六、修复批 26（2026-11-15 当轮：u19L2 布题材料链取证 → 双提示词杠杆落地）

### 36.1 取证（逐项比对，判官无罪）

u19L2（reeval24，13 轮 fail，task_content_missing critical）逐轮还原 + 任务行拉取：

- **任务描述（subtasks.description）**：「**提供一段** 500 字的杂乱项目进展文本，将其拆解为
  3 个核心结论……」——指令式措辞，要求（某个环节）提供一段文本；**这段文本从未被任何
  环节创作**：描述里没有、开场载荷里没有、教学链也没有材料注入点。
- **课堂实况（材料缺失的完整事故链）**：T0「这次要把一段500字的杂乱进展彻底整理成3点
  大纲」→ T2「你会**从这 500 字里**先挑哪两类事实」（引用不存在的材料）→ L3/L5/L9
  **学习者凭空编造**（90%/70%/下周一）→ T6 教师认证幻觉（「"90%"和"下周一"这两个具体
  锚点直接把"能按期"的判断立住了」）→ 伪造数据完成闭环。
- **判定**：材料未注入（真布题链缺陷），**判官证据面无罪**（它看到了全部 13 轮）。
  危害定性：真实学员会被教会「编数据也能被夸奖」。

### 36.2 双提示词杠杆（原位扩展，条数守恒）

1. **stage-designer 执行面铁律**（rule 102 尾部追加）：**材料自包含禁令**——description
   禁止「提供一段/给一段/基于一段…文本/材料」这类引用不存在材料的指令式措辞；材料
   三选一：①原文全文随 description 给出；②写明由学习者贴入真实文本（按既有三件事）；
   ③改写为不依赖原始材料的形态。既有路径存量不受影响处由杠杆 2 兜底。
2. **learn-turn-simulator rule 107**（记忆诚实规则尾部追加）：任务/老师引用了某份材料
   但对话里**从未给出原文**时，不得虚构材料中的数字或内容——应向老师要原文，或用自己
   真实经历举例并明说。即便存量描述带病，学员也不再共谋伪造。

### 36.3 门禁

compile-all 33 文件（双 skill 镜像含新文本）、check:all threshold-coupling 12/12、
core:check hasErrors=false 33/33、lint 全绿、prompts:sync already-in-sync；skills 套件
790/790。**验证批自然复核（批 27）**：新任务的 description 不再出现「提供一段…」措辞；
存量路径若再现材料缺失，学员应要材料而非编造（trace 可查）。

### 36.4 批 27 队列

1. 下一验证批（reeval25）：批 26 双杠杆自然复核 + 批 24 三杠杆持续观察；
2. 重复家族（开场复读 REPETITIVE_OPENING ×2 major / quiz 循环）观察位——跨批 ≥2 立项；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   收束冗余 CLOSURE_MISSING ×3（全部真实课）/ NOTATION_LEAK 跨批 6 例 / 口径翻转
   critical 均挂该决策。

## 三十七、批 27（2026-11-15 当轮：reeval25 验证批——批 26 双杠杆实证 PASS + referee 连续零 actionable）

### 37.1 双杠杆复核（对账）

1. **材料自包含禁令 ✓**：本批新建 4 个 subtask 的 description **违禁措辞零命中**
  （「提供一段/给一段/基于一段…」零出现）；抽样形态正是三选一设计——自带示例
  （「例：领导在听到第 3 项数据时问『那我们要不要调预算？』」）、学习者自带真实材料
  （「选一个你近期要交的真实汇报主题」）、文本等价（「不用贴原图，写出数据点与对应
  结论即可」）。全批 14 课 **task_content_missing 零复发**。
2. **材料诚实（学员侧）**：无编造类 finding；学习者侧无幻觉指控。
3. **批 24 三杠杆持续 ✓**：5/5 abandon 200 无 run 失败；abandoned 12→16、completed
  607→617（+10=5×2 完成课，4 弃跑收口 + 1 案例 totalTasks≤2 自然跑完，对账精确）；
  active 恒 1 零新增。
4. **referee：连续第二次 actionable 0 类**（u17 pass_with_concerns / u07 pass / u19
  pass_with_concerns）。

### 37.2 classroom（14 课）新聚类

- **BOARD_MISMATCH ×3（critical×1 + major×2）回潮，但形态已分化**：u07L2 critical 为
  **显式元素指认落空**——教师引用「result→discuss 的箭头写的是'支撑'」，板面只有
  gestal→gap/gap→hypo，result/discuss 节点不存在。与批 22 取证否定的「软指认」不同形：
  本形态带**显式节点/箭头名**，且引号用弯引号 ''——批 13 指认落空检测器的「」引号判据
  疑似被引号风格绕过。批 28-① 取证靶点：核对批 13 检测器在本课是否漏报 + 引号风格
  扩展（窄机械杠杆，非软指认那类语义判别）。
- **CLOSURE_MISSING ×2 minor**：新形态——wrapup.actionPlan **文本被截断**
  （「待验证：最后…」），学习者可见的下一步动作不完整。单簇观察。
- NOTATION_LEAK ×2 minor（跨批累计 8 例）；SCAFFOLD_LATE ×2（响应稍慢但有效，minor
  为主）——观察位维持。
- **判官 severity 纪律二次滑点**：u01L3 弃跑课（3 轮）被 F-001 critical 打 fail
  （「弃跑且无收束产出」）——批 22 豁免规则允许的形态（设计上无 wrapup），severity
  应为 info。reeval23 u19 major + 本批 critical = **滑点达 ≥2 阈**，批 28 候选：
  判官豁免规则的 severity 措辞收紧。

### 37.3 批 28 队列

1. board 显式指认落空取证（critical ×1 达标）：u07L2 逐轮还原 + 批 13 检测器漏报
  定性（引号风格 vs 判据缺口）→ 窄杠杆设计；
2. 判官 severity 纪律收紧候选（滑点 ≥2）：豁免规则的「最多一条 info」措辞强化；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
  收束冗余/NOTATION_LEAK 跨批 8 例/口径翻转等 quality 族挂该决策。

## 三十八、批 28（2026-11-15 当轮：board 显式指认取证反转（判官误配证据）+ 判官 severity 纪律收紧）

### 38.1 u07L2 取证（第二次反转：教师正确，判官误配证据）

- **铁证**：rev4 spec edges 原样 = `{from:'method',to:'result',label:'产出'}`
  `{from:'result',to:'discuss',label:'支撑'}` `{from:'intro',to:'discuss',label:'回应缺口'}`
  ——教师 T10「method→result 的箭头写的是"产出"，result→discuss 写的是"支撑"」**逐字
  正确**；学习者可见面同样含 结果（R）/讨论（D）/产出/支撑。
- **判官 critical 指控**（「仅存在 gestal→gap 和 gap→hypo，不存在 result/discuss 节点」）
  是把 rev3（完形心理学概念图，边 id 恰为 gestal→gap/gap→hypo）的证据**错配**到 index
  8-10 的 IMRaD 板上。
- **同簇定性**：major#1（u17L3）判官自 detail 算术混乱（100 进场 + 90 排队 = 190 总到达
  = 板面 190，一致，误读）；major#2（u19L2）为板面滞后软观察（批 22 形态 C 观察位）。
  **BOARD_MISMATCH ×3 簇 = 1 判官误配 + 1 判官算术混乱 + 1 软滞后**——agnes 证据处理
  质量族（挂模型决策），**引擎零杠杆**：批 13 检测器 43 轮 0 命中是正确行为（无真 miss）。
- 教训入档：board 族「回潮」聚类必须先做逐轮铁证比对再立项——reeval22 的 ×4 全真、
  reeval25 的 ×3 全假/软，同一 code 的证据质量天差地别。

### 38.2 判官 severity 纪律收紧（落地，条数守恒）

滑点 ≥2（reeval23 u19 major + reeval25 u01L3 critical）：u01L3 弃跑课（3 轮）被 F-001
critical 打 fail。classroom-quality-judge 收束豁免规则原位追加：**豁免覆盖一切 finding 码
（含自建码如 F-001/通用码）**——弃跑课的「无收束产出/学习目标未达成」是弃跑的当然结果，
不得按 critical/major 报；verdict 应按证据不足走 inconclusive 而非 fail。
门禁：compile 33 / threshold 12 / core:check 33/33 / lint 全绿 / sync 同步。

### 38.3 批 29 队列

1. 下一验证批（reeval26）：severity 收紧自然复核（弃跑课不再出 critical/major）+ 批 24/26
   杠杆持续观察；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——本批
   再添一证：board 误配/算术混乱属 agnes 证据处理质量（评审面），与教学面 quality 族同
   受该决策影响；
3. wrapup.actionPlan 截断（「待验证：最后…」，reeval25 CLOSURE_MISSING ×2 的真实成分）
   观察位：再现 ≥2 则取证 wrapup 产出链截断点。

## 三十九、批 29（2026-11-15 当轮：reeval26 验证批——severity 收紧首轮 PASS + 新发现 goal→path 断链）

### 39.1 severity 收紧复核 PASS（首轮即生效）

4 个弃跑课（1 轮，wrapup=false）全部 **inconclusive** + info 类码（ABANDONED_NO_WRAPUP_INFO /
C-ABANDONED-NO-SETTLEMENT / F-002 minor）——批 22 豁免 + 批 28 severity 措辞双重生效，
弃跑课 critical/major **零出现**（reeval25 的 F-001 critical 形态消失）。

### 39.2 杠杆持续对账

- abandoned 16→20、completed 617→625（+8 = 4 案例 × 2 完成课；u07 未进教学——见 39.3）；
  **active 归零**（reeval23 历史幽灵 e2617d91 已被闲置超时自然收编，timeout 60→61）——
  幽灵问题全清。
- referee：actionable 0 类（连续第三次）；u07 案例被本批唯一异常打 fail（见下）。

### 39.3 新发现：u07 goal→path 断链（批 30-① 取证靶）

u07 案例全程未进教学：goal 对话 05:23 最后活动后，**路径规划从未启动**（06:09 重启 +
06:40 手动 stop 重启后仍零 path-coordinator 日志、零 LLM 调用，observe 15s 空转）。
autopilot 自身 45 分钟路径等待超时触发（「Path 生成等待超时（45 分钟无进展）」→
failed）→ 脚本重启 ×2 → 120min 总超时兜底 abandon 收口（设计内降级，abandon 200）。
referee verdict=fail [PATH_MISMATCH, CONTROL_INCONSISTENCY, TERMINAL_ABANDONMENT]——
单样本不进聚类，但**整案例报废 + 首次出现**，批 30-① 取证：goal confirm→runGoalAsync
触发链在哪一环断（确认未发生 / 异步任务静默死亡 / 重启后任务不接管），产出触发链杠杆。
备注：取证插曲——手动 stop 需 Cookie + Origin 双头（403 教训入档）；脚本 120min 超时
兜底路径（stop+abandon+referee）全程按设计工作。

### 39.4 classroom（12 课，u07 零课）新聚类

- **F_001 ×2 major（u04L2）+ BOARD_MISMATCH ×2 major（u04L2/u17L2）→ 板面跨 rev 一致性
  族（真形态候选）**：rev3→rev4 比较对象漂移（应收账款→总资产）、第 8 轮右侧 7 项缺
  「未分配利润 -15」致 170 对平主张与板面 155 矛盾。与 reeval25 的判官误配不同，本簇
  带具体数字可复算——批 30-② 取证定性（真缺陷则入板面管线杠杆）。
- F_002 ×3 minor（SaaS 先验知识隐含）。弃跑课豁免码全中性。

### 39.5 批 30 队列

1. u07 goal→path 断链取证（整案例报废级）：触发链断点定位 → 杠杆（路径生成缺失检测/
   自动补触发）；
2. u04 板面跨 rev 一致性簇（×2 major 可复算数字）取证定性；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）。

## 四十、修复批 30（2026-11-15 当轮：u07 goal→path 断链根因闭合 + 提案分诊快照落地；u04 板面跨 rev 定性否定）

### 40.1 ①u07 断链：三次假设全推翻，真根因是确认轮 understanding 漂移 × 分诊回退

- **假设1 异步死亡/重启不接管 ❌**：goal 会话 gc_1794691315670 状态 completed、无
  learningPathId——不是后台任务丢失。
- **假设2 路径触发链 bug ❌**：触发链没断——是**被合法拒绝**。
- **真根因（铁证）**：提案已展示（confirmedProposal 完整且完全可排：「建立英文实验型论文
  的结构认知框架，并配备中断重启机制…」）、学员文本确认（「行，就照这版开始排吧」）后，
  **确认轮的 understanding 漂移**（primary_block_type 缺失 + supportNeed=emotional）→
  分诊走「缺阻塞类型+情绪需求」回退 → `emotional_support (medium)` → 硬阻断覆盖已确认
  提案（「这类目标当前不会生成学习路径：你此刻更需要的可能是情绪与信心上的支持」）。
  提案承诺 vs 闸门拒绝自相矛盾，整案例报废。
- **设计语义辨析**：确认时点硬阻断是 F96/F97 的**有意设计**（2026-10-28 R4 P0：分诊判
  referral 后不得再生成 5.3h 路径）——不能简单豁免确认时点。真正的缺口是**提案可见时刻
  没有定格分诊**，让确认轮的漂移有了翻转空间。

### 40.2 杠杆：提案时刻分诊快照（落地）

`writeProposalTriageSnapshot(stage, data)`（goal-conversation.service 导出纯函数，接入
updateConversationLifecycle 单咽喉点）：stage='proposing' 且无既有分诊/gated 待确认项时，
把当前 understanding 的分诊结论定格进 collectedData[RESPONSE_TRIAGE_KEY]。确认轮硬阻断
本就优先读 storedTriage——快照即生效，零额外接线。
- u07 形态：提案轮定格 learning_path → 确认轮漂移不翻转 → 承诺兑现、路径生成；
- F96/F97 保护不变：提案前已是 referral/emotional 的，快照本身就是阻断结论，确认照旧拦；
- gated 待确认项不覆盖。
- 门禁：tsc 0 err；新增 4 测（定格/漂移不覆盖/F96 保护/非 proposing 不写）；
  learning 全套 1048/1048。**验证批自然复核（批 31）**：u07 形态案例应正常进教学。

### 40.3 ②u04 板面跨 rev 簇：真实但瞬态/轻 grade，杠杆否定

- u04L1（9 轮）：rev3→rev4 应收账款→总资产 置换属实，但 rev4 带「分母不变」标注
  （为占比计算提供分母的有意演化），教师未口述——真实但轻 grade（判官 major 高估）。
- u04L2（11 轮勾稽课）：170/155 指控**部分属实但属脚手架过渡态**——T8 教师正让学员填
  「预收 5 亿」差额（板面按「答案不上板」纪律留白），rev3 恰处混合态（预收已上、
  未分配利润暂缺 = 155）；T10 rev4 完整对平 170=170。**最终态无错误**，瞬态留白是
  既有脚手架设计的正常形态。判官把过渡态当不一致，major 高估。
- **杠杆否定**（观察位维持）：板面跨 rev「最终态数字错误」（非瞬态）再现 ≥2 再立项。

### 40.4 批 31 队列

1. 下一验证批（reeval27）：批 30 快照杠杆自然复核（goal 确认后进教学不再断链）+ 既有
   杠杆持续观察；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   本批 understanding 漂移本身（goal-dialogue 模型逐轮重理解的不稳定）也是 agnes 时代
   形态，决策后复查频率。

## 四十一、批 31（2026-11-15 当轮：reeval27 验证批——批 30 快照杠杆实证 PASS + u07 断链修复闭环）

### 41.1 快照杠杆复核 PASS（u07 断链修复闭环）

- **u07：verdict=pass，完整走完 goal→path→教学**（reeval26 硬阻断报废 → 27 pass，
  +2 课入账）；全程无挂起、无 45min 路径等待超时、无 120min 兜底触发。
- 对账：abandoned 20→24（4 案例 abandon 收口 + 1 案例 totalTasks≤2 自然跑完）、
  completed 625→635（+10 = 5 案例 × 2 课，u07 本批贡献 2 课）；active 零新增持续。
- referee：**actionable 0 类（连续第四次）**；u17 pass_with_concerns / u19 inconclusive
  （TEACHING_OPEN_ENDING 单样本）。

### 41.2 classroom（14 课）：零 critical + 新家族浮现

- **批 28 severity 纪律完全干净**：全报告 critical 计数 **0**；4 个弃跑课全部
  inconclusive（F-ABANDON 等中性码）。
- **新 actionable：收束覆盖边界声明缺失（F_001 ×5 major×2+minor×5 全案例 + F_002 ×4
  minor×7+major×1）**：课程目标要求 5 类条款口径，课堂（max-tasks=2 采样）只覆盖竞业
  限制 4 条，wrapup 既未声明「未覆盖违约金/试用期工资/调岗/知识产权」，也未给这些条款
  的简易判断提示——学习者带着不完整的「检查清单」进实操，误以为已覆盖全部风险。
  双重定性：①采样截断是测试批固有（max-tasks=2），判官对采样场景不知情；②但**真实
  用户中途停学**（弃跑/时间不够）时 wrapup 同样不声明剩余范围——诚实缺口真实存在。
- 其余：REPETITIVE/notation 等零星 minor，观察位维持。

### 41.3 批 32 队列

1. **wrapup 覆盖边界声明杠杆（F_001 ×5 + F_002 ×4 强达标）**：session-wrapup skill
   提示词/产出闸——当 learnerGoal/task 要求的范围 > 实际课堂覆盖时，wrapup 必须列明
   「本次未覆盖 X」+ 后续学习建议；设计取证（wrapup 拿得到 task 全范围吗——
   structuredData/milestone 对比）→ 落地；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）；
3. 既有观察位维持（NOTATION_LEAK 跨批、重复家族、wrapup.actionPlan 截断）。

## 四十二、修复批 32（2026-11-15 当轮：wrapup 覆盖边界声明杠杆落地）

### 42.1 取证（wrapup 输入面）

session-wrapup 产出的 sessionInfo 已含 taskTitle/taskDescription/pathTitle（本课范围可见），
**缺 learnerGoal**——目标级范围（5 类条款横跨多课）无从对照，F_001 ×5 的覆盖缺口因此
不可声明。context.learnerPersona.surfaceGoal 在收束调用点现成可用（TeachingContextBuilder
开场画像摘要既有产物，零新查询）。

### 42.2 杠杆三件套（落地）

1. **lifecycle 接线**：wrapup 输入 sessionInfo 增 `learnerGoal`（learnerPersona.surfaceGoal）；
2. **skill 模板/类型**：sessionInfo 类型 + 两个 prompt 模板（主模式/评估回退）各加
  【学习目标】分区；snapshot-parity 测试抓到模板变化 → 快照更新（diff 恰为新增行）；
3. **yaml 规则原位扩展（条数守恒）**：输入字段清单补【学习目标】；诚实家族规则尾部追加
  **覆盖边界诚实**——输入提供【学习目标】时对照任务说明与本课实际覆盖，未全覆盖则
  summary 必须逐项列明「本次未覆盖：X/Y/Z」+ actionPlan 给 1 条后续方向；不得让学习者
  带「已覆盖全部」错觉收束。双重定性入档：采样截断（max-tasks=2）是测试批固有、判官
  不知情；但真实用户中途停学时 wrapup 同样不声明剩余范围——诚实缺口真实存在。
- 门禁：compile 33 / threshold 12 / core:check 33/33 / lint 全绿 / sync；wrapup+learning
  定向 1896 测全绿；全量 jest 出现 4 套件并发 flake（与本批改动无关的 prompt-lab/vision/
  goal-path 等，失败数逐轮轮换增长），隔离复测 22/22 全绿定性通过。

### 42.3 验证批自然复核（批 33）

u01 形态案例的 wrapup 应出现「本次未覆盖：违约金/试用期工资/调岗调薪/知识产权」+
后续方向建议；classroom F_001/F_002 簇应显著收敛（判官能看到声明）。

### 42.4 批 33 队列

1. 下一验证批（reeval28）：覆盖边界声明自然复核 + 既有杠杆持续观察；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）；
3. 既有观察位维持（NOTATION_LEAK 跨批 8 例、重复家族、actionPlan 截断）。

## 四十三、批 33（2026-11-15 当轮：reeval28 验证批——覆盖边界杠杆数据源二次接线（批内修复））

### 43.1 验证结果：杠杆未生效→数据源缺口批内定位修复

- 批次本身干净：5/5 案例完成、referee **连续第五次 actionable 0 类**、无挂起无兜底。
- **覆盖声明零命中**（7 wrapup 检查）：定位为**数据源缺口**——`learnerPersona.surfaceGoal`
  在实验环境全空（447 profile 零 non-null；叙事提取在虚拟学习者链路不落库）→
  【学习目标】传『无』→ 规则无从对照。批 32 的接线源选错。
- **批内二次接线**：改读 goal 会话 `collectedData.understanding.surface_goal`（学员目标
  原话，**30/30 填充**）——lifecycle 收束时按 userId 取最近 completed 会话解析，
  learnerPersona 兜底、失败不阻断。解析器实数据验证 ✓（学员原话正确解析）。U07 形态
  forensics 的 understanding.keys 早已显示 surface_goal 在案（数据一直在，取错了管子）。

### 43.2 classroom（15 课）观察

- **判官 F_001 码跨批不稳定**：reeval27 的 F_001=覆盖缺口，reeval28 的 F_001=脚手架
  对照缺口（scaffolding gap）——通用码语义漂移，跨批聚类需按 detail 而非 code 对齐
  （档案方法论注记）。
- **F_CLOSE_01 critical（u19 弃跑课）——批 28 收紧措辞被「引用后违反」**：判官 detail
  逐字引用规则 8 的豁免、完整推理（还讨论了 closureQuality 评分边界），然后仍落
  critical。verdict 却是 pass_with_concerns（批 28 主要目标「不得判 fail」达成）。
  定性：agnes severity 指令跟随上限，措辞强化已到边际——**join 模型决策族（×2）**，
  挂模型权衡。
- F_002 ×4（行动指令具体性 minor 族）、F_003 ×2（同构问法 minor）——观察位维持。

### 43.3 批 34 队列

1. 下一验证批（reeval29）：覆盖边界声明自然复核（二次接线后 u01 形态 wrapup 应出现
   「本次未覆盖：…」；【学习目标】应为学员目标原话而非『无』）；
2. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）——
   severity 指令跟随（×2）+ evidence 误配（批 28）+ understanding 漂移（批 30）三证
   皆指 agnes 时代形态；
3. 既有观察位维持。

## 四十四、批 34（2026-11-15 当轮：reeval29 验证批——覆盖边界声明实证 PASS（原文命中）；u19 快败 + BOARD_001 critical 入队）

### 44.1 覆盖边界声明 PASS（二次接线后原文实证）

u04 课（「辨认年报三张表的主角科目」，目标要求串勾稽、课堂只定位科目）wrapup 原文：
**「本次未覆盖：完整勾稽关系（如折旧→现金流出、未分配利润→净利润结转）及其他行业样本
的跨公司对比。」**——正是设计形态（目标要求 > 课堂覆盖时逐项点名）。其余课未声明=
正确行为（任务说明自包含，目标要求 ≤ 覆盖）。二次接线（批 33）确认生效。
对账：abandoned 29→33、completed 645→653（+8 = 4 案例 × 2 课；u19 快败零课）。

### 44.2 新 actionable（→批 35 队列）

1. **u19 goal 阶段 30 秒快败**（FAIL_PATH_GENERATION + FAIL_NO_RETRY，stage=error）：
   与 reeval26 的 45 分钟挂起不同形（本次是**快速失败且未重试**——脚本重启逻辑未触发，
   疑似失败分类进了不可重试档）。批 35-① 取证：backend 日志定位异常类型与失败分类
   （isRecoverableExecutionFailure 判定），产出重试/降级杠杆。
2. **BOARD-001 ×1 critical（u04）**：「看板上第4帧」指认悬空（rev4 仅索引 0-3）+
   「营业收入误标 2298 亿」（2298 实为净利润）——若取证属实则是**板面最终态数字错误**
   （批 40-② 观察位的「最终态数字错误」形态！再现 ≥2 达标候选）。批 35-② 取证。
3. F_001 ×2（纠正后重复同构解释）——重复家族近缘，观察位累积。

### 44.3 批 35 队列

1. u19 快败取证（失败分类 + 未重试）→ 杠杆；
2. BOARD-001 critical 取证（2298 亿数字错位真伪 + 第4帧悬空）→ 观察位升级判定；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）。

## 四十五、修复批 35（2026-11-15 当轮：u19 快败根因闭合 + 围栏解除杠杆落地；BOARD-001 混合定性）

### 45.1 ①u19 快败：批 11 重试杠杆结构性失效实证 + 围栏解除杠杆（落地）

铁证链（backend 日志 + DB）：
1. 09:42:09 首次失败 `PATH_PLANNING_META_ONLY_PATH`（批 11 已归瞬态 ✓）→ coordinator
   排 4s 延迟重试 ✓；
2. 09:42:13 重试 attempt 在 `normalizeGoalRequest` 处被**自家围栏拦死**：
   `GENERATION_RUN_FENCED`——首次失败已把 path_generation_runs 行写成 failed 终态
   （errorCode/finishedAt 落库），围栏要求 `status='processing'` +
   `learning_paths.activeGenerationRunId` 指回本 run → **重试从未真正执行过**；
3. 后台任务失败 → onError 钩子落路径失败 → autopilot step 传播 → 会话 failed
   （09:42:14「黑盒自动运行结束 status=failed」）→ 脚本见 session failed 判 terminal，
   重启分支不触发（FAIL_NO_RETRY 的真相：脚本重启只救「session 活着 autopilot 死」，
   不救「session 已被标死」）。
- **批 11-① 定性修正**：其延迟重试对「首败即围栏落库」的失败族**结构性失效**——
  该杠杆从未真正工作过（此前 6 批未复发是因为瞬态多数发生在 composer 层内被消化）。
- **杠杆（落地）**：`resetFencedGenerationRun(input)`（path.coordinator 私有方法，重试分支
  delay 后调用）——把 failed 行复位 processing（清 errorCode/errorMessage/finishedAt、
  heartbeat 刷新）+ activeGenerationRunId 为空时回挂；单飞语义不变（首败任务已结束，
  复位者即唯一在飞重试）；复位失败不阻断（按原链路继续）。新增 3 测（复位/缺参 no-op/
  DB 错误不抛），coordinators 339/339 全绿，tsc 0 err。**批 36 reeval30 自然复核**：
  META_ONLY_PATH 类瞬态失败后路径应能真正重试落地（不再 30 秒整案例报废）。

### 45.2 ②BOARD-001：混合定性（第4帧=判官数数错误 FALSE；2298 错位=真实 ×1 critical）

- **「第4帧悬空」FALSE**：rev4 确有 4 帧，中文「第4帧」= frame[3]（0-indexed），其 items
  逐字含「现金 ?」——判官按 0-indexed 解读「不存在索引4」，数数口径错误。
- **「营业收入 2298 亿」REAL**：T6 教师明言「腾讯净利润是 2298 亿」，rev4 frame[0]
  利润表却把 2298 写进「营业收入」行（营收应远大于净利）——**板面最终态数字错位**
  （批 40-② 观察位的形态首例确认，critical 达标）。
- **杠杆设计（批 36 落地）**：板面数字-指标绑定一致性守卫——从教师轮提取「(指标)是/为
  (数字)」绑定，板面 item 同数字异指标 → 修复重绘指令。需先取证 board-designer 输入面
  （教师近期文本是否在画板输入内）。批 36-①。
- 另：F_001 ×2（纠正后重复同构解释）重复家族观察位累积至 ×2+×2（跨批）。

### 45.3 批 36 队列

1. ①围栏解除自然复核（reeval30：META_ONLY_PATH 类瞬态后路径重试应真正落地）；
2. ②板面数字-指标绑定守卫：board-designer 输入面取证 → 落地；
3. 模型权衡三选一仍待用户网关侧定夺（回滚 flip-model-config.cjs rollback 就绪）。

## 四十六、批 36（2026-11-15 当轮：模型拆分执行（用户决策落地）+ reeval30 全 agnes 对照基线定格）

### 46.1 模型拆分（用户拍板：授课保持 ds，只有学员扮演用 agnes）

- 实况确认：11-14 因中转把 ds 通道限成 Coding 专用，flip 做的是**平台级**切换——授课
  （teaching-turn 等 20 skill）也全在 agnes，与预期不符。
- **拆分执行（定向恢复 11-14 备份形态）**：system.db skill_model_configs 32 行恢复为
  **ds ×20（授课+评审链路）/ agnes ×7（学员扮演族：persona/scenario/goal-dialogue/
  learn-turn/memory-curator/path-evaluator/epistemic-grounding）/ null ×5（继承
  platform default=ds）**；platform default 回 deepseek-v4.1-flash。后端重启生效。
- **ds 通道冒烟 ✓**：恢复后 classroom judge 15 课全部成功判出（若中转拦截仍在大面积
  失败）——中转限制已解除或对该调用形态放行。回滚备份两份在案（11-14 全 ds 形态 +
  11-15 全 agnes 形态）。

### 46.2 reeval30（全程 agnes——拆分前最后一轮，对照基线定格）

- referee：**actionable 0 类（连续第六次）**；5/5 abandon 200 无挂起无快败（u19 恢复
  正常，批 35 围栏解除未获自然 exercise——本批无 META_ONLY_PATH 瞬态，下批继续）。
- 对账：abandoned 29→38（含 reeval29+30 两批）、completed 645→663；active 零新增持续。
- classroom（15 课，全 agnes 教学质量族定格）：
  ASSESSMENT_REPEAT_RECALL ×5（复述家族，全案例）、SCAFFOLD_LATE ×5（major×5+critical×1，
  第8轮复读开场原文未响应卡点——重复×脚手架合流形态）、BOARD_MISMATCH ×4（软指认族）。
- 覆盖声明：reeval30 wrapup 零声明（max-tasks 采样 + agnes wrapup；下批 wrapup 转 ds
  后重新验证）。

### 46.3 批 37 队列（拆分后首轮对照）

1. **reeval31（拆分后首轮验证批）**：授课/评审 ds vs 学员 agnes 的水位对照——重点看
   agnes 时代三族（复述/脚手架/板面软指认）是否回落 + coverage 声明在 ds wrapup 下
   是否生效；
2. 围栏解除自然复核继续（等 META_ONLY_PATH 类瞬态出现）；
3. 模型拆分后的水位结论将回填「模型权衡」归档（原三选一已由用户裁决为拆分形态）。

## 四十七、批 37（2026-11-15 当轮：reeval31 拆分后首轮水位对照——三族未回落，agnes 归因否定 + 板面族升档）

**配置**：授课+评审 ds（deepseek-v4.1-flash）/ 学员扮演 agnes（用户拆分裁决 + 教学基准立规，见档首常设约束）。后端重启（tsc 快检过）后 runner 5 例全终态（04:56-05:40Z，u17 abandon 409 重试后 200），运行时面全零（epistemic 降级/LLM 失败/Path 超时 0/0/0）。

**水位对照（判官面板同步换 ds，混淆因子声明在案）**：

| 族 | reeval30（全 agnes） | reeval31（ds 授课+ds 判官） | 判读 |
| --- | --- | --- | --- |
| ASSESSMENT_REPEAT_RECALL | ×5（minor×9） | ×5（minor×9） | **持平**——ds 授课不复少，非模型缺陷 |
| SCAFFOLD_LATE | ×5（major×5+critical×1） | ×3（major×1+minor×3） | 降档，critical 清零（ds 正面信号，单批弱证据） |
| BOARD_MISMATCH | ×4（major×2） | ×5（**major×4**） | **升档**——形态同款：行/槽位悬空指认（「右栏第3行空槽」板上只有 2 行） |
| CLOSURE_MISSING | ×3 | ×1 | 降 |
| NOTATION_LEAK | ×1 | ×3 | 跨批已知观察位（累计 11 例） |
| BOARD_DANGLING_TRACE / STALE_REFERENCE | 未聚类 | ×2 / ×2 | 新聚类（全课无板书却用「尺子」指认；收束板面停留旧 rev） |

**核心结论（回填模型权衡归档）**：三族没有因拆分回落——复述 ×5→×5 持平、板面 4→5 且 major 升档、仅脚手架 5→3 降档。**agnes 时代三族质量缺陷不能归因于 agnes 授课模型**，属提示词/引擎结构形态（复述回链闸盲区、板面引用无存在性校验）。后续治理回归提示词/确定性杠杆路线。对照局限：判官同步换 ds，severity 校准漂移在案，升降幅度不可单变量归因；「没有消失」这一层结论稳健。

**取证三点**：
1. **数字绑定守卫首战=无靶子**：全批教师「X是/为N亿」句式 0 命中（u01 法律域天然无亿级数字）、板面同数字异指标 0、掩码 0。守卫针对的「数字错位」亚型本轮未出现；本批板面族形态是**行/槽位悬空**，守卫不覆盖该亚型。
2. **覆盖边界声明两模型下都稀发**：全库唯一命中仍是 reeval29 u04（01:29Z，agnes）；reeval30（agnes）0/10、reeval31（ds）0/10，learnerGoal 键/【学习目标】分区从未以结构形态落库。u01 五类条款目标 vs 2 课采样仍未列「本次未覆盖」。批 32 杠杆（模型自觉声明）效力不足是模型无关的——候选升级：lifecycle 确定性拼装未覆盖清单（task 全集 vs 已采样完成集，代码可算），进批 38 候选。
3. **wrapup 结构勘误**：wrapup.summary 为对象（topicSummary/knowledgeSummary/…/actionPlan 十键），「未覆盖」历史命中文本位于 knowledgeSummary 内联，非独立分区。

**referee 面**：零 actionable 连续纪录在第六次后中断——**PATH_GENERATION_LATENCY ×5**（minor×4+major×1，队列既有项，~3min 在承诺 5-20min 窗口内，豁免维持）+ **CONTROL_TASK_COMPLETION_MISMATCH ×2**（u17/u19，control 台账 completedTasks vs teaching 结算 taskCompletion='skipped'——批 20/21 设计语义的口径差，豁免维持，历史同类判过台账口径噪声）。二者均既有处置，不立项。

**批 38 候选（待用户启动）**：①板面引用存在性守卫（major×4 升档达立项门槛：教师「第N行/右栏空槽」类指认时校验 board spec 行数，不存在则 mask 指认或触发刷新）——先取证 u01L2 第4轮悬空形态；②lifecycle 确定性未覆盖清单；③u07L1 全课无板书取证（9 轮 0 板书轮 vs 教师「尺子」指认——是设计面无板书选择还是落库链缺口）。围栏解除自然复核继续。

## 四十八、修复批 38（2026-11-15/16 当轮：板面指认族双刀——位置/槽位守卫 v1 + 滞后引用豁免精准修；附 rogue 事故与中转故障废批记录）

**取证 38-①（reeval31 判官 11 例板面 detail 全还原 + 原始字节核验）**：亚型收敛=A1 越界指认（u01L2 T4「右栏第 3 行空槽」而右栏仅 2 行、空槽实为第 2 行 label"?"）、A2 计数承诺（u19L3「三条依据」板上 2 条）、B 板面滞后（u01L1 收束停旧 rev/u17L2 B组/u04L1 百分比切换）、C 板书反口径（u17L1 major「未命中→129」vs 口述「甲命中99」）、D 答案上板（u04L3）、E 渲染占位（u17L3 [?/?]）。**判官误报 1 处被抓**：u01L2 T12「右栏那个空槽」——`rows[3] label "?"` 就是空槽，判官数漏；守卫反例测试直接采用该字节事实。

**落地 38-②（位置/槽位指认存在性守卫 v1）**：`findDanglingBoardPositionReferences`（board-intent.ts）——F1 越界行/帧指认（中文序数含）+ F2 空槽承诺无空位；宁窄勿宽排除计数承诺与「第N条」法条语义；引擎在批 13-① 块后接线第四刀 repairInstruction 重调（重调一次→复检→遥测放行）。13 测绿+105 套件 1020 测绿+tsc 过。

**落地 38-③（滞后引用豁免精准修，reeval33 判官实证驱动）**：reeval33 剩余板面 ×3 全为旧 rev 对象残留引用（u17L1「向银行借款」仅存第2轮旧图）——暴露批 13-① 引对话豁免把教师此前说过的旧板对象也放行。`findUnmatchedBoardReferences` 增 `priorBoardText` 入参：命中历史板面而当前板面无 = 滞后引用 → 抓；从未上过板的纯对话引用 → 保持豁免；复检处同参。三态测试 4 例。**38-④**：离线重放假阳性分析（「空着」vs「—」占位）→ BLANKISH_ITEM_RE 增破折号形态。

**验证（三批）**：**reeval32=中转故障废批**（14:28-14:43Z provider 故障窗：u01/u04/u07/u17 goal 阶段黑盒三连败×3 重启无效 abandon，4/5 无 referee verdict（503 retry budget exhausted）；仅 u19 跑完 3 课 20 教师轮；离线重放零命中=无靶子非接线死；judge32 u19-only actionable 0）——按教学基准立规处置：不动模型、fail-closed。**reeval33**（5/5 健康）：判官板面族 ×5(major×4)→×3(major×3)；脚手架 ×3→0 清零；复述 ×5→×3；**新 critical ×3**（CONTRACT_VALUE_MISMATCH u01 期限两年误成六个月判对/DATA_MISREAD u19 支出121万当上季营收教师还表扬/SESSION_DEGENERATION_LOOP u17 马拉松 447 轮近 380 轮退化收束循环烧光预算并顶满 runner 120min）。**reeval34**（5/5，豁免精准修后）：判官板面族 ×3→×3 实例（BOARD_MISMATCH ×1 类集中 u01L1 + DANGLING ×1 + PREMATURE ×1）；复述 ×3→×1（低于聚类线）；referee actionable 2 类=PATH_LATENCY ×3（**critical×1 新形态：里程碑已出现但任务锁定不可开始**）+ TEACHING_HARD_TIMEOUT ×1 critical（u07，教学回合硬超时整案 failed）。

**守卫实战行为**：批 13-① 块（含滞后引用）reeval34 期间触发 14 次重调；位置守卫零触发（465+99 教师轮离线重放仅 1 例 borderline 假阳性→38-④ 修复）；板面实例轨迹 **×9（31）→×5（33）→×3（34）**（判官同为 ds 面板，可比；单批波动诚实声明）。

**事故与运行时记录**：①**rogue runner 事件**——judge 补跑链式命令误塞 `run-referee-minibatch.mjs --help`，脚本不识别 --help 即以默认批名真跑 ~6 分钟；处置：停进程→2 个服务端 autopilot 幽灵 stop+abandon 收口（200，running 归零）→minibatch-2026-11-15 目录留档。教训入档：**不猜测脚本参数，先读脚本源码**。②u07 hard-timeout 教学会话 active 残留（批 24 幽灵兜底未覆盖 hard-timeout 分支）——本例按仓库语义手工收口（abandoned+endTime=updatedAt+清租约+revision+1，active 归零），结构修复入批 39。

**批 39 队列（全部 critical/major 达标，待用户启动）**：①内容真值族三 critical（教师确认错误答案：CONTRACT_VALUE/DATA_MISREAD/CONTENT_PARSE_ERROR_ENDORSED）取证+杠杆；②收束退化循环断路器（SESSION_DEGENERATION critical + SESSION_LOOP major + u01L3 49 轮 no_termination——连续收束语+学员应和 N 轮强制收口）；③hard-timeout 分支接批 24 幽灵兜底；④PATH_LATENCY critical×1 新形态取证（里程碑可见但任务锁定窗口）；⑤OPENING_ASSUME ×3 判官证据面豁免注记（同会话续课「上节课」为真，u04L3/u07L2/u19L2 均有同会话前课）。

## 四十九、批 39（2026-11-16 当轮：gpt-6-luna 授课侧 A/B 试验配置 + reeval35 首轮对照（3/5 verdict，ds 锚晚间不稳待补齐）

**配置执行（用户指令「教学模型换成 gpt-6-luna 看看」）**：①网关探测——解密平台密钥直查 `/v1/models`：35 模型含 **gpt-6-luna**（初次误判「无此模型」来自 DB availableModels 旧缓存 37 项 + admin test 响应截断，用户纠正后复核确认）；`test-model` 实测 200/3.6s 出话。②切换边界——授课链路 **19 skill → gpt-6-luna**；**评审锚钉死 ds**（semantic-freeze-judge 显式 ds；classroom-quality-judge / virtual-learner-referee 经 platform default 继承 ds）→ 判官面板跨批可比；学员扮演族 agnes ×7 不动；null ×5 不动。③备份 `model-config-backup-2026-11-16T14-04-53.json`（ds×20 形态可整体回滚）。④重启生效，路由实证：luna 只打在 `skill:goal-conversation/material-collector/path-planning/path-reviewer` 等，agnes 家族调用原样。⑤档首常设约束更新为**试验态**（评审侧「不得移出 ds」继续有效）。

**reeval35 首轮 A/B（对照 reeval34=ds 授课）**：5/5 会话跑完，**referee verdict 3/5**（u01/u07 的 referee 长调用两度被 ds 间歇抖动打断：2 秒探活 200/1.8s，5 分钟长调用 fetch failed——今晚 ds 晚间不稳第二日重演，昨日 22:28-22:43Z 限流窗口同源）。
- **延迟硬伤**：luna teaching-turn 单次 **20-34s（ds 常态 5-13s，约 3 倍）**；luna 调用聚合 189 成功/10 失败；失败集中在支撑 skill（learning-predictor×3/concept-consolidator×5/concept-load-estimator×2，8s 硬帽族）。**u04 整案 failed**：开场后首个教学回合在 300s autopilot 步骤预算内未走完（同 key 3 连试超时）→ referee **TEACHING_RUNTIME_TIMEOUT critical**。
- **质量面初步信号（样本薄）**：u17 referee **pass**（该案是批 24 崩溃案 + reeval33 447 轮退化案的老病号，首次全绿）；u19 pass（2 minor）。judge35 首轮（仅排上 u04/u17 两案 4 课）**actionable 0**——全量 judge 待 ds 稳定后补。
- referee 面 actionable 1 类=TEACHING_RUNTIME_TIMEOUT critical（luna 延迟直接后果）。

**事故二次（同根因）**：`--only=u01,u07,u19` 非 runner 有效旗标（正确为 `--cases=`）→ resume 静默按默认 6 例跑，**u13 误启动真跑 1 分钟**——发现即停（进程 kill + u13 会话 stop+abandon 200，running/active 归零）。「读脚本不猜参数」教训第二次触发：rogue 事件根因同款（--help 亦为臆测旗标）。**规则升级：任何 runner 旗标组合，先 grep 脚本源码确认存在再执行。**

**待办（ds 稳定后）**：①补 u01/u07 referee（`--resume --cases=u01,u07` 语义已验证）②全量 judge 5 案 ③luna vs ds 逐族水位对照 + 延迟成本量化 ④结论交用户定夺：转正（gpt-6-luna 常驻授课 + 更新常设约束）或回滚（备份恢复 ds×20）。

**批 39 补完（2026-11-17 当轮）：u01/u07 referee 补齐 + 全量 judge 11 课——luna 授课可行性判定**

**评审面补齐**：referee 5/5 verdict（u07 pass / u17 pass / u19 pass / **u01 fail**（CONTROL_TIMEOUT_TERMINAL_FAILURE——超时终局第二例）/ u04 inconclusive（300s 步骤预算 death critical））；judge 全量 11 课 actionable 1 类。

**质量面判定（用户标准：课程质量没太大问题）——PASS**：judge 面板 **0 critical**、无 fail 教学课；聚类仅 1 类（CLOSURE_MISSING ×2，均为超时死亡案的兜底模板 wrapup，非教学缺陷）；三族水位与 ds 持平或更好（板面实例 ×3=ds 同水平 / 复述 ×4 minor / 脚手架 ×1）；批 39 队列的内容真值族（CONTRACT_VALUE/DATA_MISREAD 类）**未复现**；老病号 u17 referee+judge 双绿。vs reeval34（ds）：ds 批判官面板有 1 critical（content_parse_error_endorsed）+ u07 hard-timeout fail，luna 批反而更干净——超时风险非 luna 独有，luna 只是抬高概率（3 倍延迟）。

**可行性代价（非质量问题的运营面）**：5 案中 2 案撞 300s autopilot 步骤预算死亡（u04 首回合即死、u01 中途死）→ 完成率 3/5；死亡案 wrapup 为兜底模板空壳（口径 0 条）。缓解选项：调大 autopilot 步骤预算（300s→480s+）或 luna 降并发——属配置决定，交用户。

**结论**：**luna 授课质量可行性 PASS**（课程质量无大问题，未引入新缺陷族）；运营面需配套「步骤预算调宽」才能到 ds 时代的跑通率。配置维持试验态（19 skill=luna / 评审锚 ds / 备份在案），转正/回滚/调预算由用户定夺。
