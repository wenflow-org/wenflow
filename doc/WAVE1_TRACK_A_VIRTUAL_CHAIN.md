# WAVE1 · Track A：虚拟学习者链路修复（虚拟实验室侧）

> 上游依据：[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) 第一波。
> 并行流：Track B（真实教学侧治理）见 [`WAVE1_TRACK_B_TEACHING_GOVERNANCE.md`](./WAVE1_TRACK_B_TEACHING_GOVERNANCE.md)。
> 原则：**本流只碰"虚拟学习者 / 实验链路" + 一个共享降级类型文件**；不碰 `services/ai-teaching/*`、`prompts/core/teaching-turn.yaml`。
> 目的：把上一轮刚修好的"检查点出题"链路真正跑成端到端，并让虚拟链路的时间上下文/降级可观测。

---

## 0. 范围与文件所有权

| 归属 | 路径 |
|---|---|
| **本流可改（独占）** | `backend/src/skills/virtual-learner-learn-turn-simulator/**`<br>`backend/src/services/virtual-lab/**`<br>`backend/src/coordinators/simulation*.ts`（仅时间上下文相关行）<br>`backend/src/services/memory/actr.ts`<br>`backend/src/services/memory/memory-trace.service.ts`（仅注释）<br>`backend/src/services/yaml-vocabulary.ts`<br>`prompts/manifests/**`<br>`backend/src/services/skill-registry/skill-scaffold.service.ts`<br>**新增** `backend/src/skills/degradation-telemetry.ts`（本流创建，Track B 只读引用） |
| **禁止碰（Track B 领地）** | `backend/src/services/ai-teaching/**`<br>`backend/src/services/learner/**`<br>`prompts/core/teaching-turn.yaml`、`prompts/core/session-wrapup.yaml`、`prompts/skill.teaching-turn.md` 等教学 prompt 产物<br>`backend/src/skills/outcome.ts` |

> 若确需改禁碰文件：**不直接改**，在 PR/提交说明里写明，交给 Track B。

---

## 1. 工作项

### A1（=D1）检查点/时间上下文补进 payload —— 本轮最高优先
- **根因**：模拟器 `buildUserPayload` 在 **body 与 stable-prefix 两个分支都丢弃** `pendingCheckpoint` 与 `temporalContext`
  （`backend/src/skills/virtual-learner-learn-turn-simulator/index.ts:318-386`）。因此上一轮"黑盒消费检查点"（P1-3）
  是**半截线**：LLM 看不到结构化题目/选项，`normalizeCheckpointAnswer` 只能靠历史文本猜；yaml 里声明的 `temporalContext` 规则也是死的。
- **改动**：
  - 在 `body` 与 stable-prefix 分支都加入 `pendingCheckpoint`（原样透传，注意**不含答案键**）与 `temporalContext`。
  - **KV 缓存布局**：`temporalContext` 属慢变块 → 放稳定前缀区；`pendingCheckpoint` 逐回合变化 → 放**尾部逐回合块**
    （与 `visibleContext` 同侧），避免破坏前缀缓存（参考 `teaching-turn/index.ts:774` 既有做法）。
- **文件**：`index.ts` + `backend/src/skills/virtual-learner-learn-turn-simulator/__tests__/index.test.ts`
- **测试**：断言两分支产出的 payload 含 `pendingCheckpoint`（题目/选项）与 `temporalContext`；断言 payload **不含答案键**字段。
- **验收**：黑盒 runner 传入的 `visibleCheckpoint` 能出现在给模型的 payload 中。

### A2（=D2）运行时定义漂移修正
- **根因**：`definition.ts` 的 `inputSchema/outputSchema/variableBindings` 与代码级 `SkillDefinition`、yaml 契约不一致：
  缺 `learnerMemory`、`epistemicGrounding`、`pendingCheckpoint`（输入）与 `checkpointAnswer`（输出）。
- **改动**：补齐 `backend/src/skills/virtual-learner-learn-turn-simulator/definition.ts`；必要时重生成 `prompts/agent-snapshots.md`。
- **文件**：`definition.ts`、`prompts/agent-snapshots.md`（重生成）
- **测试/门禁**：snapshots drift 检查、`npm run prompts:core:check`、fields-sync 通过。
- **验收**：定义与运行时一致，无 drift。

### A3（=D4）时间上下文打通：`sinceLastSessionDays` 填充 + 死代码清理
- **根因**：`sinceLastSessionDays` 只声明、从不赋值（`backend/src/services/virtual-lab/simulated-day.service.ts:218-237`），
  配合 A1 才真正可用；`memory-trace.service.ts:333` 有指向 `isReviewDue` 的过期注释；
  `actr.ts` 的 `calculateRetention`/`isReviewDue` 已无生产调用（仅测试）。
- **改动**：
  - 在 `temporalContextFromClock` / `resolveSimulationClock` 内，按"该虚拟用户上一场会话的模拟日"计算 `sinceLastSessionDays`
    （数据来源实现时确认：候选=同一 profile 上一条 `virtual_sessions` 的模拟日窗口；首次会话为 `null`）。
  - 清 `actr.ts` 死函数或明确标注 `@internal 测试专用`；修正 `memory-trace.service.ts:333` 注释。
- **文件**：`simulated-day.service.ts`、`actr.ts`、`memory-trace.service.ts`（注释）
- **测试**：单测覆盖"首场=null / 相邻日=1 / 隔多日=N"。
- **验收**：A1 的 payload 里 `temporalContext.sinceLastSessionDays` 有真实值（或显式 null）。

### A4（=D3）`failurePolicy: fallback` 收敛
- **根因**：词表仍列 `fallback`（`backend/src/services/yaml-vocabulary.ts:48`）、两个 manifest 用 `deterministic-fallback`
  （`prompts/manifests/concept-priority.yaml:17`、`path-adjustment-generator.yaml:17`）、**scaffold 默认仍写 `fallback`**
  （`backend/src/services/skill-registry/skill-scaffold.service.ts:149`）。
- **改动**：保留**读取历史值**的兼容映射；把**可写/可校验**的取值收敛为 `retry | propagate`；改 manifests 与 scaffold 默认；
  更新 `doc/SKILL_PROTOCOL_V4.md` 若其措辞已过期。
- **文件**：`yaml-vocabulary.ts`、两个 manifest、`skill-scaffold.service.ts`
- **测试/门禁**：`prompts:lint`、`prompts:core:check`、skill-scaffold 单测。
- **验收**：新生成 skill 不再出现 `fallback`；历史值仍可读。

### A5（=Q3 虚拟侧）虚拟链路降级遥测
- **根因**：以下两处**真静默**（无日志/无标记/无事件）：
  - `backend/src/virtual-lab/learner-memory.ts:264-268`（画像/到期线索读取失败 → 返回空快照，被当"没有记忆"）
  - `backend/src/services/virtual-lab/simulated-day.service.ts:267-286`（整日快照多路 catch → 静默降级）
- **改动**：
  - 新建 `backend/src/skills/degradation-telemetry.ts`（见 §2 接口），由本流拥有。
  - 两处 catch 改为产出 `DegradationTelemetry`：结构化记录（winston）+ 进程内计数器（health-center 可读），并把
    "数据不全" 以 `degraded` 字段带进下游（虚拟侧：`buildLearnerMemorySnapshot` 返回空时附带 `degraded`）。
- **文件**：新增 `degradation-telemetry.ts`；`virtual-lab/learner-memory.ts`；`virtual-lab/simulated-day.service.ts`
- **测试**：注入失败（mock 抛错）→ 断言返回结构带 `degraded` 且计数器 +1。
- **验收**：虚拟链路不再有"未打标的降级"。

---

## 2. 与 Track B 的共享接口（本流先出，B 只读引用）

`backend/src/skills/degradation-telemetry.ts`（Track A 创建；Track B 直接 import，不改）：

```ts
export type DegradationFaultCategory =
  | 'NETWORK_TIMEOUT' | 'SCHEMA_VIOLATION' | 'RATE_LIMITED'
  | 'UPSTREAM_EMPTY' | 'DB_READ_FAILED' | 'PARSE_FAILED' | 'UNKNOWN';

export type DegradationSeverity = 'P1_CRITICAL' | 'P2_DEGRADED' | 'P3_NOTICE';

export interface DegradationTelemetry {
  /** 发生模块，如 'virtual-lab/learner-memory' */
  source: string;
  faultCategory: DegradationFaultCategory;
  severity: DegradationSeverity;
  /** 受损的数据维度/字段 */
  impactedDimensions: string[];
  /** 实际保底动作，如 'return-empty-snapshot' */
  mitigationApplied: string;
  rootCauseMessage?: string | null;
  at: string; // ISO
}

/** 记录一次降级（结构化日志 + 进程内计数），并返回补全 at 的对象 */
export function recordDegradation(fault: Omit<DegradationTelemetry, 'at'>): DegradationTelemetry;

/** 供 health-center / DNR 脚本读取的进程内计数（按 source 聚合） */
export function snapshotDegradationCounters(): Record<string, number>;
```

> DNR（降级告知率）**真实 SLO 统计在 Track B**（读本计数 + 结构化日志）；本流只负责产事件。

---

## 3. 提交 / 合并约定

- 每项独立提交，提交前 `git diff --cached --stat` 只含本流文件（`git commit` 会提交整个 index）。
- **合并顺序：Track A 先合**（B 依赖 A1 的检查点 payload 与 §2 的类型文件）。
- 提示词改动（manifest/编译产物）走 `prompts:compile-all` + `prompts:sync-core`，并跑门禁。
- 与另一进程共用 develop 时的风险已知：改 prompt/skill 会触发后端热重启，尽量小步。

## 4. 本流验收（Definition of Done）

1. `pendingCheckpoint`/`temporalContext` 真进 payload（有测试、无答案键泄漏）。
2. `definition.ts` 无 drift（snapshots/fields-sync 过）。
3. `sinceLastSessionDays` 有真实值（首场 null），死代码/过期注释清理。
4. `failurePolicy` 取值收敛，scaffold 不再写 `fallback`。
5. 虚拟链路两处真静默改为结构化降级（有测试、计数可读）。
6. 相关套件全绿（模拟器、virtual-lab、memory、fields-sync、prompts 门禁）。

---

## 6. 执行记录（2026-09-18，已完成）

| 项 | 提交 | 结果 |
|---|---|---|
| A1 检查点/时间上下文进 payload | `59483516` | 两分支透传（白名单投影，无答案键）；测试 4 例 |
| A2 运行时定义补齐 | `83c26460` | definition.ts + SkillDefinition 同步；snapshots/runtime-contract 过 |
| A3 时间上下文打通 + ACT-R 死代码清理 | `338c7717` | `previousCourseDayGap`（课表口径，首日省略键）；删 4 个死函数；yaml 去 `elapsedDays` |
| A5 降级遥测 + 虚拟侧两处真静默 | `c1f83891` | 新增 `skills/degradation-telemetry.ts`（Track B 直接 import）；learner-memory / simulated-day 打标 |
| A4 failurePolicy 收敛 | `955dbcdc` | 可写词表收敛为 retry\|propagate；scaffold 默认 retry |

**回归**：Track A 相关 23 套件 / 298 用例全绿；`tsc`、`eslint` 干净；
`prompts:core:check` / `lint 29-0` / `snapshots:check` / `runtime-contract` / `fields-sync` / `yaml:check C1~C5` / `handoff:strict` 全过；`sync-core` already-in-sync。

**遗留（不属于本流）**：`src/services/memory/__tests__/concept-load.service.test.ts` 与
`review-plan.service.test.ts` 两个套件当前因**另一进程在途改动** `src/skills/teaching-turn/index.ts:788`
的 TS2339（`timestamp` 属性不存在）而无法运行（ts-jest 编译失败），与本流改动无关；待其修复合入后应恢复。

**给 Track B 的交接**：`backend/src/skills/degradation-telemetry.ts` 已就绪（含 `recordDegradation` /
`snapshotDegradationCounters` / `resetDegradationCounters` / `degradationCause`），B1/B2 可直接 import。
